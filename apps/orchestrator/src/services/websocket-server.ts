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
      const systemPrompt = agentConfigLoader.generateSystemPrompt(agentId);

      // Stop existing run if active (each message gets a fresh agent run)
      try {
        await this.agentManager.stopAgent(agentId);
      } catch {
        // Agent may not be active — fine
      }

      await this.agentManager.spawnAgent(agentId, systemPrompt, content);
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
