import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ANTHROPIC_API_KEY: z.string().optional(),
  RIGELHQ_ADAPTER: z.enum(['claude', 'mock']).default('mock'),
  RIGELHQ_MAX_CONCURRENT_AGENTS: z.coerce.number().default(5),
  RIGELHQ_TOKEN_BUDGET_DAILY: z.coerce.number().default(1_000_000),
  RIGELHQ_ORCHESTRATOR_PORT: z.coerce.number().default(4000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
