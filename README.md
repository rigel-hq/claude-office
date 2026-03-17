<p align="center">
  <img src="./assets/rigelhq-logo.png" alt="RigelHQ Logo" width="120" />
</p>

<h1 align="center">RigelHQ</h1>

<p align="center">
  <strong>Your AI-powered engineering command center — 21 specialist agents, one office.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#tech-stack">Tech Stack</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

RigelHQ is a visual AI agent orchestration platform that renders a team of **21 specialist Claude-powered agents** as digital employees in an **isometric virtual office**. Monitor tasks in real time, delegate work through natural conversation, watch agents collaborate across zones, and manage everything from a single console.

> **Agent = Digital Employee | Office = Agent Runtime | Desk = Active Session | Meeting Pod = Collaboration Context**

![RigelHQ Office View](./assets/office-screenshot.png)

---

## Features

### Virtual Office

- **2D Isometric Floor Plan** with 5 distinct zones — CEO Suite, Executive, Engineering, Quality, and Operations
- **Agent Avatars** with real-time status animations: `IDLE`, `THINKING`, `TOOL_CALLING`, `SPEAKING`, `COLLABORATING`, `ERROR`
- **Walking animations** when agents move between zones for task delegation
- **SVG collaboration lines** showing inter-agent message flow in real time
- **Speech bubbles** with live streaming text as agents work

### 21 Specialist Agents

Agents are organized into five zones, each with a clear domain of responsibility:

| Zone | Agents |
|------|--------|
| **CEO Suite** | Chief Executive Agent 👔 |
| **Executive** | Product Manager 📋 &middot; Projects Manager 📁 &middot; Technical Architect 🏛️ |
| **Engineering** | Backend Engineer ⚙️ &middot; Frontend Engineer 🎨 &middot; App Developer 📱 &middot; Infra Engineer ☁️ &middot; Platform Engineer 🏗️ &middot; DevOps Engineer 🚀 |
| **Quality** | UX Designer 🎯 &middot; QA Tester 🧪 &middot; Automation QA Tester 🤖 &middot; Code Review Engineer 👁️ &middot; GitHub Repos Owner 🔄 |
| **Operations** | Load Tester 📊 &middot; SRE Engineer 🔧 &middot; DBA Engineer 🗄️ &middot; NOC Engineer 📡 &middot; Operations Engineer ⚡ &middot; Security Engineer 🔒 |

### Chat and Communication

- **Real-time chat** with any agent via Socket.IO
- **Agent selector** for targeted conversations
- **Streaming markdown** message display
- **Chat history** with timeline view
- Voice support (STT/TTS) — Phase 2

![Chat Interface](./assets/chat-screenshot.png)

### Console and Management

- Session management — create, switch, and monitor active sessions
- Hierarchical task system with full delegation chains
- Agent status dashboard with live activity logs
- Token usage tracking and cost monitoring

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Backend** | Node.js + TypeScript + Express |
| **Frontend** | Next.js 15 + React 19 |
| **AI Engine** | Claude Agent SDK + Claude Code CLI |
| **Database** | PostgreSQL 16 + Prisma 6.0 |
| **Cache / Pub-Sub** | Redis 7 |
| **Real-time** | Socket.IO (WebSocket) |
| **Animation** | Framer Motion + Anime.js |
| **State** | Zustand + Immer |
| **Styling** | Tailwind CSS 4 |
| **Shared Types** | `@rigelhq/shared` workspace package |

---

## Architecture

RigelHQ uses an **event-driven architecture** built on Redis pub/sub for decoupled, real-time communication between the orchestrator and the web frontend.

- **Adapter pattern** — swap between `claude` and `mock` adapters to test without API calls
- **Hook-driven agent lifecycle** — agents are managed through Claude Code CLI hooks
- **Bidirectional JSON streaming** — real-time event capture between agents and the UI
- **Redis pub/sub** — all agent events, status changes, and messages flow through Redis channels

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 22+ |
| pnpm | 9.15+ |
| PostgreSQL | 16 |
| Redis | 7 |
| Claude Code CLI | Latest (`claude login`) |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/anthropics/claude-office.git
cd claude-office

# Start infrastructure
docker-compose up -d    # PostgreSQL + Redis

# Install dependencies
pnpm install

# Run database migrations
pnpm db:migrate

# Start all services
pnpm dev
```

Once running:

| Service | URL |
|---|---|
| **Orchestrator** | http://localhost:4000 |
| **Web UI** | http://localhost:3001 |

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis connection string | — |
| `RIGELHQ_ADAPTER` | Agent adapter (`claude` / `mock`) | `claude` |
| `RIGELHQ_MAX_CONCURRENT_AGENTS` | Max parallel agents | `5` |
| `RIGELHQ_TOKEN_BUDGET_DAILY` | Daily token limit | — |
| `RIGELHQ_WEB_PORT` | Frontend port | `3001` |
| `RIGELHQ_ORCHESTRATOR_PORT` | Backend port | `4000` |

---

## Project Structure

```
claude-office/
├── apps/
│   ├── orchestrator/          # Backend — session gateway & agent orchestration
│   │   ├── src/
│   │   │   ├── adapters/      # Claude & Mock agent adapters
│   │   │   ├── services/      # EventBus, SessionGateway, WebSocket
│   │   │   └── config.ts      # Environment configuration
│   │   └── prisma/
│   │       └── schema.prisma  # Database schema
│   └── web/                   # Frontend — Next.js visual office
│       └── src/
│           ├── app/           # Pages & API routes
│           └── components/    # Office, Chat, Sidebar, Agents
├── packages/
│   └── shared/                # Shared types & constants
│       └── src/
│           ├── types/         # Agent, Message, Session types
│           ├── constants/     # Agent configs, events, channels
│           └── utils/         # ID generation, helpers
├── docs/                      # PRDs & Architecture Decision Records
├── docker-compose.yml         # PostgreSQL + Redis
├── turbo.json                 # Monorepo pipeline config
└── package.json
```

---

## Development

| Command | Description |
|---|---|
| `pnpm dev` | Start all services in dev mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Run TypeScript checks across the monorepo |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:push` | Push schema changes without migrations |
| `pnpm db:generate` | Regenerate Prisma client |

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository and create your branch from `main`
2. Follow [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages
3. Add tests for any new functionality
4. Run `pnpm typecheck` and `pnpm build` before submitting
5. Open a pull request with a clear description of your changes

---

## License

This project is licensed under the [MIT License](./LICENSE).

---

<p align="center">
  Built with Claude Agent SDK &middot; Powered by Anthropic
</p>
