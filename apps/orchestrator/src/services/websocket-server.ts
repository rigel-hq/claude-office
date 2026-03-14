import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { AgentEvent } from '@rigelhq/shared';
import { REDIS_CHANNELS, REDIS_STREAMS } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';
import type { CEAManager } from './cea-manager.js';

export class WebSocketServer {
  private io: SocketServer;
  private ceaManager: CEAManager | null = null;

  constructor(
    httpServer: HttpServer,
    private eventBus: EventBus,
  ) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: ['http://localhost:3000'],
        methods: ['GET', 'POST'],
      },
    });

    this.setupHandlers();
  }

  /** Attach CEA manager for routing chat messages */
  setCEAManager(ceaManager: CEAManager): void {
    this.ceaManager = ceaManager;
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

      // Handle user chat messages — route to CEA
      socket.on('chat:message', async (data: { content: string; conversationId?: string }) => {
        console.log(`[WS] Chat message: ${data.content.slice(0, 80)}`);

        // Broadcast user message to all clients immediately
        this.io.emit('chat:user-message', data);

        // Route to CEA for processing
        if (this.ceaManager) {
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
