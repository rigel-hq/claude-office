import { AGENT_ROLES } from '@rigelhq/shared';
import type { AgentManager } from './agent-manager.js';

const MOCK_TASKS: Record<string, string[]> = {
  'backend-engineer': [
    'Optimizing database query performance for user dashboard',
    'Implementing rate limiting middleware for API endpoints',
    'Refactoring authentication service to support OAuth2',
  ],
  'frontend-engineer': [
    'Building responsive data visualization component',
    'Fixing CSS grid layout issues on mobile breakpoints',
    'Implementing client-side form validation with Zod',
  ],
  'product-manager': [
    'Analyzing user feedback from latest sprint demo',
    'Drafting PRD for notification system feature',
    'Prioritizing backlog items based on user impact scores',
  ],
  'devops-engineer': [
    'Setting up GitHub Actions CI/CD pipeline',
    'Configuring Docker multi-stage builds for production',
    'Monitoring deployment health checks and rollback procedures',
  ],
  'qa-tester': [
    'Writing integration tests for payment flow',
    'Verifying accessibility compliance on login page',
    'Running regression suite against staging environment',
  ],
  'security-engineer': [
    'Auditing API endpoints for injection vulnerabilities',
    'Reviewing dependency tree for known CVEs',
    'Implementing CSP headers for the web application',
  ],
  'dba-engineer': [
    'Analyzing slow query logs for optimization opportunities',
    'Planning database migration for schema v2',
    'Setting up read replicas for high-traffic tables',
  ],
  'sre-engineer': [
    'Configuring alerting thresholds for P99 latency',
    'Investigating memory leak in worker processes',
    'Setting up distributed tracing with OpenTelemetry',
  ],
  'technical-architect': [
    'Evaluating microservices vs monolith trade-offs for new service',
    'Drafting architecture decision record for event-driven messaging',
    'Reviewing API contract design for backward compatibility',
  ],
};

const DEFAULT_TASKS = [
  'Reviewing latest changes and updating documentation',
  'Running analysis on project metrics',
  'Preparing status report for the team',
];

const SYSTEM_PROMPT_STUB = 'You are a specialist agent at RigelHQ. Execute the assigned task.';

/**
 * MockSimulation periodically activates random agents in mock mode
 * to simulate a living office with agents doing work.
 */
export class MockSimulation {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private running = false;

  constructor(
    private agentManager: AgentManager,
    private intervalMs: number = 8_000,
    private maxSimultaneous: number = 3,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[MockSim] Starting office simulation');

    // Activate MVP agents immediately with staggered starts
    const mvpAgents = AGENT_ROLES.filter(a => a.mvpActive && a.id !== 'cea');
    mvpAgents.forEach((agent, i) => {
      const timer = setTimeout(() => {
        if (this.running) this.activateAgent(agent.id);
      }, 2000 + i * 1500);
      this.timers.push(timer);
    });

    // Schedule periodic random activations
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (!this.running) return;

    const jitter = Math.random() * this.intervalMs;
    const delay = this.intervalMs + jitter;

    const timer = setTimeout(() => {
      if (!this.running) return;

      // Only activate if under threshold
      if (this.agentManager.activeCount < this.maxSimultaneous + 1) {
        const candidates = AGENT_ROLES.filter(
          a => a.id !== 'cea',
        );
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        this.activateAgent(pick.id);
      }

      this.scheduleNext();
    }, delay);

    this.timers.push(timer);
  }

  private activateAgent(configId: string): void {
    const tasks = MOCK_TASKS[configId] ?? DEFAULT_TASKS;
    const task = tasks[Math.floor(Math.random() * tasks.length)];

    this.agentManager
      .spawnAgent(configId, SYSTEM_PROMPT_STUB, task)
      .catch(() => {
        // Agent may already be active or pool full — that's fine
      });
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    console.log('[MockSim] Simulation stopped');
  }
}
