# Velloo

Working spec for **Velloo** — a git-native canvas for solo devs and small teams who want AI to prototype UI without becoming designers. Designs live in your repo as JSON. Your AI agent reads them through a token-efficient MCP surface and writes the real code into your app — using your stack, your conventions, your handlers.

The premise: solo developers and small teams can't justify a designer or Figma seats, but the alternatives are worse — code-first generators (v0/Bolt) hallucinate components and ignore your design system; design tools (Figma/Paper) produce artifacts disconnected from your codebase; Storybook is per-component and not a place to compose pages. Velloo is the missing tool — shadcn-first, open source.

## Documents

- [product.md](./product.md) — Problem, audience, mental model, pitch, anti-positioning, pricing
- [architecture.md](./architecture.md) — Folder format, runtime, Library Registry, codegen, distribution, cloud sketch
- [mcp.md](./mcp.md) — MCP tool surface for agents
- roadmap.md — Roadmap philosophy, next ~8 weeks of sprints, longer-term feature lines
- decisions.md — Pivot log and design rationale

## One-line pitch

> **Velloo** — a git-native canvas for solo devs and small teams who want AI to prototype UI without becoming designers. Designs live in your repo as JSON. Your agent reads them through a fast MCP surface and writes the real code into your app — using your stack, your conventions, your handlers. shadcn-first, open source. No Figma seats, no design-file lock-in, no paste-ready JSX you have to babysit.

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
- [ ] License: ships **BSL 1.1** with a 4-year change date to Apache 2.0 from the first public release ( Cloud-server code stays proprietary.
- [ ] CONTRIBUTING.md, code of conduct, issue templates, and community docs before the first public link is shared.

## Status

Specification + working substrate. Working through the sprints in roadmap.md. No "V0 launch" milestone — usefulness compounds sprint over sprint (
