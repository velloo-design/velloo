# Local agent sessions

The canvas's Agent tab runs the person's own CLI agent — Codex or Claude Code —
beside the design. This page is the runtime model: who owns what, what crosses
which boundary, and what is kept.

## Ownership

```
canvas (browser)          daemon (velloo, loopback)              provider process
────────────────          ─────────────────────────              ────────────────
Agent tab  ── HTTP ──▶    /api/agent  ─▶ AgentSessionManager ─▶  AgentAdapter ── stdio ──▶ codex app-server
           ◀── WS ───     `agent` frames ◀──── AgentSink ◀──────────────────────────────    claude -p --stream-json
                                                                    │
                                                                    └─ MCP (HTTP) ──▶ this daemon's /mcp
```

- **The daemon owns every provider process** (`packages/server/src/agent/`).
  A browser tab can close, reload or reconnect without touching a session; the
  daemon stays up while a session's process runs (`connections().agents` in
  the idle check) and stops every process when it stops.
- **The browser holds a projection.** It reads a snapshot
  (`GET /api/agent/sessions/:id`) and patches it from `agent` frames on the
  canvas socket. A reconnect reads the snapshot again.
- **Three adapters:** Codex over `codex app-server` (JSON-RPC on stdio),
  Claude Code over `claude -p` stream-json, and any Agent Client Protocol
  agent (JSON-RPC 2.0 on stdio — `agent/acp/`), which is offered only once it
  is installed and answers `initialize` with a compatible version.
- **Adapters normalize.** Each adapter turns its provider's own protocol into
  the contract in `@velloo/protocol/agent` — providers, capabilities,
  sessions, turns, items, approvals. The canvas never sees a provider's event
  names, so it renders Codex and Claude Code with the same components, and
  capability flags (not provider ids) decide what it offers.

## What the browser can and can't decide

The canvas names a provider, a prompt (with context cards), an approval
decision, a title, and one of the permission modes the session's controls
offer. It cannot name a working directory, an executable, a sandbox, an
environment, or credentials, nor a mode that turns approvals off (each
adapter leaves those out of `controls.modes`): the request bodies are strict
schemas, and anything else is refused. The daemon decides the
working directory (the app the design belongs to), the MCP endpoint (its own,
so edits land on the open design through the existing watcher and history,
and no second daemon starts), and the instructions that say the agent is in
the canvas.

A running session also has *controls* — what the slash menu offers: the
agent's own commands, the models it can switch to, and whether it can list its
MCP servers (`AgentSessionControls`, sent with the snapshot and as a `controls`
frame, and never stored). `/model` (`POST …/model`) takes only an id from that
list, and `/mcp` (`GET`/`POST …/mcp`) only a server name and one of the actions
the provider offered; none of them writes the person's config.

Each provider keeps its own login, settings, MCP servers and approval rules.
Velloo adds its MCP server to the session and otherwise inherits what the
person configured; it never auto-approves and never widens a sandbox.

## What is kept

Normalized history only, per design folder, outside the checkout:
`~/.velloo/agents/<folder id>/<session id>.json` (`VELLOO_AGENTS_DIR`
overrides the root). It holds the session summary and its turns, bounded by
`agent/bounds.ts` — command output keeps its tail, diffs their head, and old
turns fall off. No raw provider payloads, environment or credentials are
written. The provider keeps its own full record in its own store, which is
what resuming a session reopens.

After a daemon restart the sessions are listed as exited; a resumable one can
be reopened, which starts a new process on the provider's saved conversation.

## The terminal hand-off

A session summary carries `terminalCommand` — the command that continues the
conversation in a terminal (`codex resume <id>`, `claude --resume <id>`). When
the embedded terminal exists, it runs that command; until then the tab offers
to copy it. Terminal bytes never travel through the agent protocol: the
terminal resumes from the provider's own store, so the two surfaces never
share a PTY.

## Local sessions and the hosted agent

This runtime is **local execution**: the person's machine, their installed
CLI, their subscription or key. Velloo holds no provider credentials and pays
for no inference here.

A hosted design agent (a separate, later initiative) runs elsewhere and owns
its own execution, credentials and billing. What it may share with this work
is presentation only: the contract in `@velloo/protocol/agent` is zod-only and
names no process, and the conversation components in the canvas consume only
that contract — so a cloud run that produces turns and items renders through
them. Process management, adapters, approvals routed to a local CLI and the
local history store stay here.
