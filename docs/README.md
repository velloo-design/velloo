# Velloo

Working spec for **Velloo** — a code-shaped design tool for shadcn devs, with an agent-native MCP server.

The premise: solo developers and small teams can't justify a designer or Figma seats, but the alternatives are worse — code-first generators (v0/Bolt) hallucinate components and ignore your design system; design tools (Figma/Paper) produce artifacts disconnected from your codebase; Storybook is per-component and not a place to compose pages. Velloo is the missing tool.

## Documents

- [product.md](./product.md) — Problem, audience, mental model, pitch, anti-positioning
- [architecture.md](./architecture.md) — Folder format, runtime, codegen, distribution
- [mcp.md](./mcp.md) — MCP tool surface for agents
- [v0.md](./v0.md) — V0 scope, sprint plan, timeline, risks, launch artifact
- [decisions.md](./decisions.md) — Pivot log and design rationale

## One-line pitch

> **Velloo** — the design tool for shadcn devs. Live local. Real shadcn components. AI-native MCP. Designs commit to your repo as JSON; theme exports as Tailwind config; pages export as shadcn JSX. No Figma seats, no translation tax, no hallucinated components.

## Brand handles (claim before launch)

| Surface | Identifier | Status |
|---|---|---|
| CLI / binary | `velloo` | — |
| npm package | `velloo` | available |
| npm scope | `@velloo` | verify on claim |
| GitHub org | `velloo-app` or `getvelloo` (user `velloo` is camped, low activity) | — |
| Domain (primary) | `velloo.dev` | available |
| Domain (secondary) | `velloo.io` | available |
| Domain (.com) | `velloo.com` | parked at HugeDomains; skip until traction |
| Brew tap | `velloo/tap` | — |

## Pre-launch legal checklist

- [ ] UKIPO trademark filing in Classes 9 + 42 (~£170 + £50/extra class)
- [ ] USPTO trademark filing (intent-to-use) in Classes 9 + 42 (~$350/class)
- [ ] Trademark clearance search by counsel before filing (~£300–500)
- [ ] UK Ltd registered as `Velloo Software Ltd` (avoids the struck-off-pending `Velloo Ltd` 16201713; rename to clean form if/when that entity is removed)
- [ ] License decision (MIT vs BSL vs fair-source) before line one of code

## Status

Pre-V0. Specification only.
