import http from 'http';
import { loadConfig } from './config.js';
import { getDb, disconnectDb } from './services/db-service.js';
import { getRedisPublisher, getRedisSubscriber, disconnectRedis } from './services/redis-service.js';
import { EventBus } from './services/event-bus.js';
import { AgentManager } from './services/agent-manager.js';
import { TaskManager } from './services/task-manager.js';
import { CEAManager } from './services/cea-manager.js';
import { CollaborationManager } from './services/collaboration-manager.js';
import { WebSocketServer } from './services/websocket-server.js';
import { MockSimulation } from './services/mock-simulation.js';
import { createAdapter } from './adapters/index.js';
import { AGENT_ROLES } from '@rigelhq/shared';
import type { PrismaClient } from '@prisma/client';

async function main() {
  const config = loadConfig();
  console.log('[RigelHQ Orchestrator] Starting...');
  console.log(`[RigelHQ Orchestrator] Adapter: ${config.RIGELHQ_ADAPTER}`);
  console.log(`[RigelHQ Orchestrator] Max concurrent agents: ${config.RIGELHQ_MAX_CONCURRENT_AGENTS}`);

  // Initialize core services
  const db = getDb();
  const redisPub = getRedisPublisher(config.REDIS_URL);
  const redisSub = getRedisSubscriber(config.REDIS_URL);

  // Verify connections
  await db.$queryRaw`SELECT 1`;
  console.log('[RigelHQ Orchestrator] PostgreSQL connected');

  await redisPub.ping();
  console.log('[RigelHQ Orchestrator] Redis connected');

  // Build service graph
  const eventBus = new EventBus(redisPub, redisSub);
  const adapter = createAdapter(config.RIGELHQ_ADAPTER);
  const agentManager = new AgentManager(adapter, eventBus, db, config.RIGELHQ_MAX_CONCURRENT_AGENTS);
  const taskManager = new TaskManager(db, eventBus);
  const ceaManager = new CEAManager(agentManager, taskManager, eventBus);
  const collaborationManager = new CollaborationManager(eventBus);
  agentManager.setCollaborationManager(collaborationManager);

  // HTTP + WebSocket server
  const httpServer = http.createServer();
  const wsServer = new WebSocketServer(httpServer, eventBus);

  // Wire CEA, AgentManager, CollaborationManager, and DB to WebSocket for chat message routing and status sync
  wsServer.setCEAManager(ceaManager);
  wsServer.setAgentManager(agentManager);
  wsServer.setCollaborationManager(collaborationManager);
  wsServer.setDb(db);

  httpServer.listen(config.RIGELHQ_ORCHESTRATOR_PORT, () => {
    console.log(`[RigelHQ Orchestrator] WebSocket server on port ${config.RIGELHQ_ORCHESTRATOR_PORT}`);
  });

  // Seed all MVP agents in DB so they appear in the UI from the start
  await seedMvpAgents(db);

  // Start CEA
  await ceaManager.start();

  // Start mock simulation in dev mode for a living office feel
  let mockSim: MockSimulation | null = null;
  if (config.RIGELHQ_ADAPTER === 'mock') {
    mockSim = new MockSimulation(agentManager);
    mockSim.start();
    console.log('[RigelHQ Orchestrator] Mock simulation active — agents will come alive');
  }

  console.log('[RigelHQ Orchestrator] Ready');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[RigelHQ Orchestrator] Shutting down...');

    // 1. Stop accepting connections
    wsServer.close();

    // 2. Stop all agents (30s grace period)
    const shutdownTimeout = setTimeout(() => {
      console.log('[RigelHQ Orchestrator] Force shutdown after timeout');
      process.exit(1);
    }, 30_000);

    if (mockSim) mockSim.stop();
    await collaborationManager.shutdown();
    await ceaManager.stop();
    await agentManager.stopAll();

    // 3. Close connections
    await disconnectRedis();
    await disconnectDb();

    clearTimeout(shutdownTimeout);
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/** Reset all agent statuses on boot (clears stale state from prior runs)
 *  then pre-register mvpActive agents so the UI shows them from the start. */
async function seedMvpAgents(db: PrismaClient) {
  // Reset ALL existing agents to OFFLINE — no agents are running at boot time
  await db.agent.updateMany({
    data: { status: 'OFFLINE', pid: null },
  });

  // Upsert mvpActive agents as IDLE (ready/available) so the UI shows them as active from boot
  const mvpAgents = AGENT_ROLES.filter(r => r.mvpActive);
  for (const role of mvpAgents) {
    await db.agent.upsert({
      where: { configId: role.id },
      update: { status: 'IDLE' },
      create: {
        configId: role.id,
        name: role.name,
        role: role.role,
        icon: role.icon,
        status: 'IDLE',
        pid: null,
      },
    });
  }
  console.log(`[RigelHQ Orchestrator] Reset all agents, ${mvpAgents.length} MVP agents set to IDLE`);
}

main().catch((err) => {
  console.error('[RigelHQ Orchestrator] Fatal error:', err);
  process.exit(1);
});
