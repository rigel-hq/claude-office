# Command Center UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the visual Command Center — a 2D SVG virtual office showing all 21 agents with real-time status updates, walking animations, and an integrated chat panel.

**Architecture:** Zustand store manages agent state, hydrated from Socket.io events. SVG floor plan renders 4 zones with positioned agents. Framer-motion handles status ring animations and speech bubbles. Chat panel sends messages to orchestrator via Socket.io.

**Tech Stack:** Next.js 15, React 19, Zustand 5, Immer, Socket.io-client, Framer Motion, Tailwind v4, SVG

---

## File Structure

### Create:
- `apps/web/src/store/agent-store.ts` — Zustand store for agents + connection state
- `apps/web/src/hooks/use-socket.ts` — Socket.io connection hook
- `apps/web/src/components/office/office-floor.tsx` — SVG floor plan with zones
- `apps/web/src/components/office/agent-avatar.tsx` — Agent circle with status ring
- `apps/web/src/components/office/zone-label.tsx` — Zone name label
- `apps/web/src/components/chat/chat-panel.tsx` — Chat message panel
- `apps/web/src/components/chat/chat-input.tsx` — Message input
- `apps/web/src/components/layout/top-bar.tsx` — System status bar
- `apps/web/src/components/layout/command-center.tsx` — Main layout combining all

### Modify:
- `apps/web/src/app/page.tsx` — Replace placeholder with CommandCenter
- `apps/web/src/app/globals.css` — Add animation keyframes

---

## Tasks

### Task 1: Zustand store
### Task 2: Socket.io hook
### Task 3: Agent avatar component (SVG)
### Task 4: Office floor plan (SVG)
### Task 5: Chat panel
### Task 6: Top bar + Command Center layout
### Task 7: Wire page.tsx + globals.css animations
### Task 8: Typecheck + commit + push
