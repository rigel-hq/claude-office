import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { AgentEvent } from '@rigelhq/shared';
import { REDIS_CHANNELS, REDIS_STREAMS } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';
import type { CEAManager } from './cea-manager.js';
import type { AgentManager } from './agent-manager.js';
import { agentConfigLoader } from './agent-config-loader.js';

export class WebSocketServer {
  private io: SocketServer;
  private ceaManager: CEAManager | null = null;
  private agentManager: AgentManager | null = null;

  constructor(
    httpServer: HttpServer,
    private eventBus: EventBus,
  ) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001'],
        methods: ['GET', 'POST'],
      },
    });

    this.setupHandlers();
  }

  /** Attach CEA manager for routing chat messages */
  setCEAManager(ceaManager: CEAManager): void {
    this.ceaManager = ceaManager;
  }

  /** Attach agent manager for direct agent messaging */
  setAgentManager(agentManager: AgentManager): void {
    this.agentManager = agentManager;
  }

  private setupHandlers(): void {
    this.io.on('connection', async (socket) => {
      console.log(`[WS] Client connected: ${socket.id}`);

      // Send recent event history on connect
      try {
        const history = await this.eventBus.getHistory(REDIS_STREAMS.EVENTS, '0', 50);
        socket.emit('event:history', history);
      } catch {
        // Redis might not have stream yet
      }

      // Handle user chat messages — route to CEA or specific agent
      socket.on('chat:message', async (data: { content: string; targetAgent?: string }) => {
        const target = data.targetAgent;
        console.log(`[WS] Chat message (target: ${target ?? 'cea'}): ${data.content.slice(0, 80)}`);

        // Broadcast user message to all clients immediately
        this.io.emit('chat:user-message', data);

        // Route to specific agent or CEA
        if (target && target !== 'cea' && this.agentManager) {
          await this.routeToAgent(target, data.content, socket);
        } else if (this.ceaManager) {
          try {
            await this.ceaManager.sendMessage(data.content);
          } catch (err) {
            console.error('[WS] Error routing message to CEA:', err);
            socket.emit('chat:error', { message: 'Failed to process message' });
          }
        }
      });

      // Summarize text for TTS via CEA's summarizer subagent
      socket.on('voice:summarize', async (data: { text: string }, ack?: (resp: { summary: string }) => void) => {
        if (!this.ceaManager) {
          ack?.({ summary: data.text?.slice(0, 200) ?? '' });
          return;
        }
        try {
          const summary = await this.ceaManager.summarize(data.text);
          ack?.({ summary });
        } catch (err) {
          console.error('[WS] Summarize error:', err);
          ack?.({ summary: data.text?.slice(0, 200) ?? '' });
        }
      });

      // Send a message to any Claude session by ID
      socket.on('session:send', async (data: { sessionId: string; message: string }) => {
        if (!this.agentManager) {
          socket.emit('chat:error', { message: 'Agent manager not available' });
          return;
        }
        try {
          console.log(`[WS] Sending to session ${data.sessionId.slice(0, 8)}...: ${data.message.slice(0, 80)}`);
          await this.agentManager.sendToSession(data.sessionId, data.message);
        } catch (err) {
          console.error('[WS] Error sending to session:', err);
          socket.emit('chat:error', { message: `Failed to send to session ${data.sessionId.slice(0, 8)}` });
        }
      });

      // Open a terminal window attached to an agent's Claude session
      socket.on('session:open-terminal', async (data: { configId: string }) => {
        if (!this.agentManager) {
          socket.emit('chat:error', { message: 'Agent manager not available' });
          return;
        }

        // Try agent manager first, then CEA manager as fallback
        const handle = this.agentManager.getHandle(data.configId);
        let sessionId = handle?.sessionId ?? null;
        let cwd = handle?.cwd ?? null;

        // Fallback: check CEA manager's stored handle (survives active map removal)
        if (!sessionId && data.configId === 'cea' && this.ceaManager) {
          const ceaHandle = (this.ceaManager as unknown as { handle?: { sessionId?: string; cwd?: string } }).handle;
          sessionId = ceaHandle?.sessionId ?? null;
          cwd = ceaHandle?.cwd ?? cwd;
        }

        if (!sessionId) {
          console.log(`[WS] No session found for ${data.configId} — handle: ${JSON.stringify(handle)}`);
          socket.emit('chat:error', { message: `No active session for ${data.configId}` });
          return;
        }

        console.log(`[WS] Opening terminal for ${data.configId} (session: ${sessionId.slice(0, 8)}..., cwd: ${cwd})`);

        try {
          const { execFile } = await import('child_process');
          const { writeFileSync, unlinkSync } = await import('fs');
          const { tmpdir } = await import('os');
          const path = await import('path');

          // cd to the agent's working directory first so claude --resume finds the session
          const cdCmd = cwd ? `cd ${cwd.replace(/"/g, '\\"')} && ` : '';
          const cmd = `${cdCmd}claude --resume ${sessionId}`;
          const scriptPath = path.join(tmpdir(), `rigel-terminal-${Date.now()}.scpt`);

          // AppleScript to open Terminal.app with the claude resume command
          const script = [
            'tell application "Terminal"',
            '  activate',
            `  do script "${cmd}"`,
            'end tell',
          ].join('\n');

          writeFileSync(scriptPath, script);
          execFile('osascript', [scriptPath], (err) => {
            try { unlinkSync(scriptPath); } catch { /* cleanup best effort */ }
            if (err) {
              console.error('[WS] AppleScript failed:', err.message);
              socket.emit('chat:error', { message: 'Failed to open terminal — check macOS permissions for Terminal automation' });
            } else {
              console.log(`[WS] Terminal opened for ${data.configId}`);
            }
          });
        } catch (err) {
          console.error('[WS] Error opening terminal:', err);
          socket.emit('chat:error', { message: 'Failed to open terminal' });
        }
      });

      // List all Claude sessions (managed + external)
      socket.on('sessions:list', async () => {
        if (!this.agentManager) {
          socket.emit('sessions:data', { managed: [], external: [] });
          return;
        }
        try {
          const sessions = await this.agentManager.listAllSessions();
          socket.emit('sessions:data', sessions);
        } catch (err) {
          console.error('[WS] Error listing sessions:', err);
          socket.emit('sessions:data', { managed: [], external: [] });
        }
      });

      socket.on('disconnect', () => {
        console.log(`[WS] Client disconnected: ${socket.id}`);
      });
    });

    // Subscribe to Redis events and relay to all connected clients
    this.eventBus.subscribe(REDIS_CHANNELS.EVENTS, (event: AgentEvent) => {
      this.io.emit('agent:event', event);
    });
  }

  /** Route a message directly to a specific agent */
  private async routeToAgent(
    agentId: string,
    content: string,
    socket: { emit: (event: string, data: unknown) => void },
  ): Promise<void> {
    if (!this.agentManager) return;

    try {
      // Resume existing session if available
      if (this.agentManager.hasActiveSession(agentId)) {
        console.log(`[WS] Resuming session for ${agentId}`);
        await this.agentManager.sendMessage(agentId, content);
      } else {
        // First message — spawn fresh agent
        console.log(`[WS] Spawning fresh session for ${agentId}`);
        const systemPrompt = agentConfigLoader.generateSystemPrompt(agentId);
        await this.agentManager.spawnAgent(agentId, systemPrompt, content);
      }
    } catch (err) {
      console.error(`[WS] Error routing message to agent ${agentId}:`, err);
      socket.emit('chat:error', { message: `Failed to reach ${agentId}` });
    }
  }

  /** Broadcast an event to all connected clients */
  broadcast(eventName: string, data: unknown): void {
    this.io.emit(eventName, data);
  }

  /** Get count of connected clients */
  get clientCount(): number {
    return this.io.engine.clientsCount;
  }

  close(): void {
    this.io.close();
  }
}
