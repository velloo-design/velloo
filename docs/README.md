# Velloo

Working spec for **Velloo** — a local, code-shaped canvas for solo devs who want AI to be their design team. Designs live in a folder in your repo as JSON. Your AI agent reads them through a token-efficient MCP surface and writes the real code into your app, in your conventions.

The premise: a solo developer (and small teams without designers) can prototype and iterate on UI fastest by talking to an AI agent — *if* the agent has a fast, visual, code-shaped surface to work against. Existing tools fall on the wrong side of that:

- **Figma / Penpot / Paper** produce pixel-perfect designs disconnected from the codebase — agent-writable now (2026), but the agent still translates the design to code. That translation is lossy and takes iterations to converge.
- **v0 / Bolt / Lovable** skip design and go straight to code, hallucinating components and ignoring whatever design system you have.
- **Storybook** is per-component, not a place to compose pages or organize a customer flow.

Velloo's bet: designs that are made of **real shadcn components from the start** collapse the gap. The agent edits the design, the design *is* shaped like the code, emit is structural, and the implementation step is short.

## What Velloo is

- A **local CLI** that serves a canvas at `localhost:7300` and an MCP server at `localhost:7301`.
- A **canvas** that looks like Figma: many boards, each an infinite canvas with frames pointing at screens. The Pulse sample (shipped by `velloo init`) has a Marketing board (landing / pricing / signup), an App board (dashboard / insights / settings), and a Playground board hosting a Showcase screen that renders every shipping component.
- An **MCP surface** that exposes the design to your AI agent (Claude Code, Cursor, Codex) — ~55 tools, one per structural operation. Includes structural discovery + mutation, snippet management, theme synthesis (palette derivation, vibe matching, image extraction, contrast scoring), dark-mode audits, screenshots, codegen IR for screens + snippets, theme export, Tailwind class validation, and Claude Haiku / fal.ai-backed asset generation.
- A **design folder** in your repo: pure JSON for screens, boards (one per file under `boards/`), theme, snippets, annotations, and board notes. Components are embedded in the Velloo binary (no `components/*.tsx` in the design folder).

## Documents

- [product.md](./product.md) — Problem, audience, mental model, anti-positioning
- [architecture.md](./architecture.md) — Folder format, runtime, component sourcing, codegen
- [mcp.md](./mcp.md) — MCP tool surface for agents
- [roadmap.md](./roadmap.md) — Roadmap philosophy and the next ~8 weeks of sprints
- [decisions.md](./decisions.md) — Pivot log and design rationale
- [comparison/](./comparison/) — Dated per-tool competitive comparisons; the README there carries the consensus-gap rollup

## One-line pitch

> **Velloo** — a local canvas for solo devs whose design team is an AI agent. Designs live in your repo as JSON, made of real shadcn components, and your agent reads them through MCP and writes the real code into your app.

## Stance

- **Local-first.** Every byte of design state — screens, boards, theme, snippets — lives on disk in the user's repo. No account, no server, no telemetry. The CLI works offline.
- **Open source.** From the first public release. License TBD at release time; out of scope for now.
- **Useful first.** No monetization, no cloud, no hosted surfaces are being designed for. Once Velloo is genuinely useful for a single solo developer (the author), the question of what's next becomes worth asking.
- **shadcn-first.** Other libraries (Mantine, MUI, Chakra) are an internal abstraction for a possible later, not a public promise. React-only.

## Status

Working substrate, used end-to-end. Sprints A → L plus I-cont done (see [roadmap.md](./roadmap.md) for the changelog) — schema pivot, responsive viewport tooling, agent-consumed IR, Pulse sample, DX refactor pass, expanded shadcn palette (~35 primitives + 9 Velloo helpers), theme preset gallery with WCAG scoring, marketing helper nodes (SVG / Image / Layer / Gradient / Divider), AI asset generators, and the snippet editor view — snippet bodies are now editable through the canvas Inspector (and through MCP) via a `snippet:<id>` virtualized-screen surface. `velloo init` ships **Pulse** — a sample team-analytics design across three boards (Marketing + App + Playground) and seven screens, 100% dark-mode coherent. ~55 MCP tools live. No "V0 launch" milestone — the product gets more useful sprint over sprint.
