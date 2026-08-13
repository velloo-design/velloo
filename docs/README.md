# Velloo

Working spec for **Velloo** — a local, code-shaped canvas for solo devs who want AI to be their design team. Designs live in a folder in your repo as JSON. Your AI agent reads them through a token-efficient MCP surface and writes the real code into your app, in your conventions.

The premise: a solo developer (and small teams without designers) can prototype and iterate on UI fastest by talking to an AI agent — *if* the agent has a fast, visual, code-shaped surface to work against. Existing tools fall on the wrong side of that:

- **Figma / Penpot / Paper** produce vector-perfect designs that the agent then translates to code. That translation is lossy and takes iterations to converge.
- **v0 / Bolt / Lovable** skip design and go straight to code, hallucinating components and ignoring whatever design system you have.
- **Storybook** is per-component, not a place to compose pages or organize a customer flow.

Velloo's bet: designs that are made of **real shadcn components from the start** collapse the gap. The agent edits the design, the design *is* shaped like the code, emit is structural, and the implementation step is short.

## What Velloo is

- A **local CLI** that serves a canvas at `localhost:7300` and an MCP server at `localhost:7301`.
- A **canvas** that looks like Figma: an infinite board where you arrange the screens of your product (landing, pricing, signup, settings, onboarding) at different sizes so you can see the whole flow at once.
- An **MCP surface** that exposes the design to your AI agent (Claude Code, Cursor, Codex) with one tool per structural operation — token-efficient by construction.
- A **design folder** in your repo: pure JSON for screens, board layout, theme, snippets, annotations, plus a copy of the chosen UI library's components on disk.

## Documents

- [product.md](./product.md) — Problem, audience, mental model, anti-positioning
- [architecture.md](./architecture.md) — Folder format, runtime, component sourcing, codegen
- [mcp.md](./mcp.md) — MCP tool surface for agents
- [roadmap.md](./roadmap.md) — Roadmap philosophy and the next ~8 weeks of sprints
- [decisions.md](./decisions.md) — Pivot log and design rationale

## One-line pitch

> **Velloo** — a local canvas for solo devs whose design team is an AI agent. Designs live in your repo as JSON, made of real shadcn components, and your agent reads them through MCP and writes the real code into your app.

## Stance

- **Local-first.** Every byte of design state — pages, theme, manifest, the library's components — lives on disk in the user's repo. No account, no server, no telemetry. The CLI works offline.
- **Open source.** From the first public release. License TBD at release time; out of scope for now.
- **Useful first.** No monetization, no cloud, no hosted surfaces are being designed for. Once Velloo is genuinely useful for a single solo developer (the author), the question of what's next becomes worth asking.
- **shadcn-first.** Other libraries (Mantine, MUI, Chakra) are an internal abstraction for a possible later, not a public promise. React-only.

## Status

Specification + working substrate (CLI, canvas, MCP server, codegen, theme engine, ~22 MCP tools, file watcher, undo history, screenshot pipeline). Working through the sprints in [roadmap.md](./roadmap.md). No "V0 launch" milestone — the product gets more useful sprint over sprint.
