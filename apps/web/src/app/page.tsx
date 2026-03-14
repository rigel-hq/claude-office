import { AGENT_ROLES } from '@rigelhq/shared';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
      <h1 className="text-4xl font-bold text-rigel-blue">⬡ RigelHQ</h1>
      <p className="text-rigel-muted">Command Center — {AGENT_ROLES.length} agents configured</p>
      <div className="grid grid-cols-4 gap-3 max-w-2xl">
        {AGENT_ROLES.map((agent) => (
          <div
            key={agent.id}
            className="flex flex-col items-center gap-1 p-3 rounded-lg bg-rigel-surface border border-rigel-border"
          >
            <span className="text-2xl">{agent.icon}</span>
            <span className="text-xs text-rigel-text font-medium text-center">{agent.name}</span>
            <span className={`text-[10px] ${agent.mvpActive ? 'text-rigel-green' : 'text-rigel-muted'}`}>
              {agent.mvpActive ? 'MVP Active' : 'Standby'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
