# Velloo — technical docs

Technical reference for contributors working on Velloo itself.

- [architecture.md](./architecture.md) — design-folder format, runtime, component providers, codegen, and the canvas daemon.
- [external-local-design-folders.md](./external-local-design-folders.md) — local designs outside the repository: machine-only records, global agent wiring, relocation and binding.
- [mcp.md](./mcp.md) — the MCP tool surface agents use to read and mutate a design.
- [agent-tab.md](./agent-tab.md) — the canvas's Agent tab: running your own Codex or Claude Code beside the design, permissions, comments, history, troubleshooting and the release checklist.
- [agent-sessions.md](./agent-sessions.md) — how the daemon owns local agent sessions: the provider contract, adapters, what crosses each boundary and what is kept.

For how the repo is laid out and the invariants to respect when changing it, see [../AGENTS.md](../AGENTS.md).
