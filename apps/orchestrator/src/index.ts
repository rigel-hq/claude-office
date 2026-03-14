import { loadConfig } from './config.js';
import { getDb, disconnectDb } from './services/db-service.js';
import { getRedisPublisher, disconnectRedis } from './services/redis-service.js';

async function main() {
  const config = loadConfig();
  console.log('[RigelHQ Orchestrator] Starting...');
  console.log(`[RigelHQ Orchestrator] Adapter: ${config.RIGELHQ_ADAPTER}`);
  console.log(`[RigelHQ Orchestrator] Max concurrent agents: ${config.RIGELHQ_MAX_CONCURRENT_AGENTS}`);

  // Initialize services
  const db = getDb();
  const redis = getRedisPublisher(config.REDIS_URL);

  // Verify connections
  await db.$queryRaw`SELECT 1`;
  console.log('[RigelHQ Orchestrator] PostgreSQL connected');

  await redis.ping();
  console.log('[RigelHQ Orchestrator] Redis connected');

  console.log(`[RigelHQ Orchestrator] Ready on port ${config.RIGELHQ_ORCHESTRATOR_PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[RigelHQ Orchestrator] Shutting down...');
    await disconnectRedis();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[RigelHQ Orchestrator] Fatal error:', err);
  process.exit(1);
});
