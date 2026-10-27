# The Agent tab

The Agent tab runs your own coding agent — Codex or Claude Code — beside the
design, in the canvas's right panel. It is the same agent you use in a
terminal: your login, your settings, your MCP servers, your permission rules.
Velloo adds one thing to it, the Velloo MCP server for the design that is open,
so every design edit lands on the canvas as the agent makes it.

The right panel opens on the agent, beside **Design** (the Node and Theme tabs,
coming back to the one you had open) and **Comments**; in a window too narrow
for both side panes, the right one — the agent — is the one kept. In a session,
the back arrow returns to the agents and this design's recent sessions (the
session keeps running), and **+** starts another session with the same agent.

For how it works inside the daemon, see [agent-sessions.md](agent-sessions.md).

## What you need

| Agent | Install | Sign in | Velloo checks |
|---|---|---|---|
| Codex | `npm install -g @openai/codex` or `brew install codex` | `codex login` | the app-server methods it needs, read from the installed version's own schema |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` or `npm install -g @anthropic-ai/claude-code` | run `claude` and sign in | the print-mode flags it needs, read from `claude --help` |

Other CLI agents that speak the [Agent Client
Protocol](https://agentclientprotocol.com) appear in the picker once they're
installed and answer Velloo's handshake:

| Agent | Command Velloo runs |
|---|---|
| OpenCode | `opencode acp` |
| GitHub Copilot | `copilot --acp` |
| Cursor | `cursor-agent acp` |
| Gemini CLI | `gemini --acp` (a recent version; older ones only had `--experimental-acp`) |
| Qwen Code | `qwen --acp` |
| Kimi CLI | `kimi acp` |
| Mistral Vibe | `vibe-acp` |
| Cline | `cline --acp` |
| Kilo | `kilo acp` |
| Auggie (Augment Code) | `auggie --acp` |
| Factory Droid | `droid exec --output-format acp-daemon` |
| Goose (Block's open-source agent) | `goose acp` |

The commands are the ones the [ACP registry](https://agentclientprotocol.com/registry)
lists. What each can do (reopening a session, MCP over HTTP, its own slash
commands) comes from what it advertises; they sign in their own way, and a
session that needs it says how. Adding another is one entry in `ACP_AGENTS`
(`packages/server/src/agent/acp/adapter.ts`).

The tab lists Codex and Claude Code always, with what each needs: **Ready**, **Not installed**,
**Not signed in**, **Needs an update** or **Unavailable**, and the command that
fixes it. **Check again** re-reads them after you install, sign in or update.
The agent you used last leads the list, marked **Last used**, and its **Start
session** is the highlighted one; with none used yet, the first ready one is.

## Local, not cloud

Everything runs on this computer. The agent process is started by the Velloo
daemon for this design, in your app's folder, and it talks to its own provider
with your own account and subscription. Velloo holds no provider credentials,
pays for no inference, and sends nothing about your sessions to Velloo cloud.

A hosted design agent is a separate, later product. It would run in the cloud
with its own execution and billing; it may share the look of this tab, but
nothing of how this one runs.

## What the agent is given

- **Its working directory:** the app this design belongs to.
- **Velloo's MCP server** for this exact design, added to the agent's own
  servers. A Codex `velloo` entry you already have keeps its other settings
  (tool approvals) and is pointed at this design; Claude Code is given it as a
  session server that takes precedence over a same-named one.
- **A short instruction** that it is in the canvas, beside this design, and
  should read and change the design only through Velloo's tools — never by
  opening a browser or using computer use on the canvas.
- **Where you are.** Each message carries the open board, the frame in view
  (named as it is on the canvas) and the selected node, shown above the box as
  a **Viewing** card, so "this board" means the one on screen. Take the card
  off to send one message without it.
- **What you attach.** Select something on the canvas and a **+** card for it
  appears above the box: press it to add that node, or the whole frame when
  its screen is selected. The frames button beside the box lists this board,
  each of its frames by name, and its notes, to add or take off. Comments come
  as cards of their own. Each is spelled out in the design's own ids when you
  send; nothing else from the design or your machine is attached.

**Enter** sends and **Shift+Enter** starts a new line, as in the agents' own
prompts.

The browser decides none of this. A page can't set the directory, the
executable, the environment or the sandbox, and can only pick among the
permission modes below; the daemon refuses a request that tries anything else.

## Permissions

Velloo never auto-approves anything on its own.

A session starts in your own mode, and the shield button beside the message
box shows it and switches it for that session, as the agent's own mode switch
would. Modes that turn every check off — Claude Code's "bypass permissions",
Codex's full access, an ACP agent's "yolo" — are never offered there; they stay
a choice made in the agent itself, and a session already in one shows it.

- **Codex** runs with the approval policy and sandbox from your Codex config
  (`approval_policy`, `sandbox_mode`), or Codex's interactive defaults —
  `on-request` and `workspace-write` — when you set none. The switch offers
  **Read only**, **Ask first** (`untrusted`) and **Workspace** (`on-request`,
  your workspace sandbox settings), from the next message.
- **Claude Code** runs with your own permission mode and rules; Velloo passes
  no mode of its own. The switch offers **Ask**, **Accept edits**, **Plan**,
  **Auto** and **Don't ask**.
- **An Agent Client Protocol agent** offers its own session modes (Cursor's
  Agent, Plan and Ask, for example), when it has any. Its approvals offer only
  its one-time choices — never "always allow" or "always reject", which would
  outlive the session in that agent's settings.

When the agent asks — or one of its MCP servers asks a yes/no question — the
request appears above the composer with exactly the choices that agent
supports: **Allow once** (Enter), **Allow for this session**
(⌘/Ctrl+Enter), **Deny** (Esc) and **Deny and stop**. For Claude Code, "for this
session" applies only the session-scoped rule Claude itself proposed, never one
that would be saved to your settings.

## Comments

- **While you work with the agent** — its tab is open, or a session is
  running — a comment you write on the canvas goes straight to the composer as
  a card instead of opening the thread.
- **Local comments:** **Add to agent** on a comment's row, its open thread or its
  pin on the canvas — or **Add N open comments to agent** in the Comments tab —
  puts each one in the composer as a card. Send them on their own and the agent
  addresses them, or add instructions. The agent replies on each thread and
  leaves resolving it to you; **Resolve** on the sent message does it.
- **Cloud comments:** when the sync pulls new reviewer comments on a published
  board, the canvas says so — "3 new comments on Pricing" — without taking
  focus, and the Agent tab keeps the notice until you act on it. **Add to agent**
  puts them in the composer; nothing is sent until you press Send. Dismissing
  the notice means you won't be offered the same comments again.

## Slash commands

Type `/` at the start of the message box for a menu of commands. Arrow keys and
**Enter** (or **Tab**) pick one; **Esc** puts the menu away.

- **`/model`** opens a list of the models the session can use, the current one
  checked. The choice applies from your next message. Codex lists its own
  picker's models, Claude Code the ones its `/model` offers, and an ACP agent
  whichever it advertises. Velloo doesn't write it to your settings, though an
  agent may remember the choice itself, as it would from its own `/model`.
- **`/mcp`** lists the agent's MCP servers as the agent sees them — your own,
  plus the one Velloo adds for this design, marked **This design** — with each
  one's state and tool count. With Claude Code you can **reconnect** a server or
  switch one off or on for this session; Codex reports status only. ACP agents
  don't report their servers, so they have no `/mcp`.
- **The agent's own commands** follow — Claude Code's skills and custom
  commands, an ACP agent's advertised commands. Picking one puts `/name` in the
  box; it is sent as the message, the way the agent's terminal would send it.
  A command goes on its own: the attached cards wait for your next message.
  Codex's slash commands exist only in its terminal interface, so it has none
  here.

Commands that only make sense in a terminal interface (a full-screen picker,
login) are not in the list; **Copy resume command** continues the session in a
terminal for those.

## Sessions and history

- Sessions belong to the design. The tab's switcher lists them; **New session**
  starts another; closing the browser tab doesn't stop a session, and the
  daemon stays up while an agent runs.
- **Stop agent** ends the process. A stopped session — or one found after the
  daemon restarted — can be **Reopened**, which continues the conversation from
  the agent's own record of it.
- **Copy resume command** gives you `codex resume <id>` or `claude --resume <id>`
  with the folder, to continue the same conversation in a terminal. That is the
  fallback whenever you want the agent's own terminal interface.
- Velloo keeps a readable copy of each session — the conversation, not the raw
  provider messages — in `~/.velloo/agents/<design>/`, outside your repository.
  Long command output keeps its last 32 KB, diffs their first 48 KB, and a
  session its newest 200 turns. **Delete session** removes the copy; the
  provider's own record is managed by the provider.

## Troubleshooting

| What you see | What to do |
|---|---|
| Codex **Not signed in** | Run `codex login` in a terminal, then **Check again**. |
| Claude Code **Not signed in**, or a turn fails with "Failed to authenticate" | Run `claude` in a terminal and sign in, then **Check again**. |
| **Needs an update** | Update the CLI (`npm install -g @openai/codex@latest`, `brew upgrade codex`, or `claude update`). |
| **Not installed**, but it runs in your terminal | Velloo looks on its own PATH plus `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`. Start Velloo from a shell where the CLI is on PATH. |
| "The Velloo MCP server didn't start" in a turn | Design edits won't reach the canvas in that session. Check `velloo status`; a Codex `velloo` entry with an unusual transport may be the cause. |
| "Velloo was updated" in the tab | Reload the canvas. |
| A session **Stopped unexpectedly** | The message is the agent's own last words. **Reopen** to continue. |

## Release checklist

Run before a release that changes the agent path.

1. `bun run test` — includes `agent-e2e.test.ts`, which drives the real daemon,
   socket and MCP endpoint with real adapters over scripted Codex and Claude
   Code stand-ins: start, prompt, streaming, a Velloo MCP edit, approval allow
   and deny, interrupt, completion, crash, reconnect, daemon restart and resume,
   and comments (local and pulled from the cloud) sent as cards.
2. By hand, with the installed CLIs, against `velloo run` from the release build:
   - Codex: start; a prompt with a node card; a network command raises an
     approval, **Deny** returns `declined`; a design edit renders on the canvas.
   - Claude Code with a project `defaultMode: "manual"`: a Write raises an
     approval; **Allow once** writes, **Deny** declines; a follow-up while it
     works is queued and sent after.
3. Confirm the guarantees still hold:
   - [ ] Codex is started as `codex app-server` on stdio — no `--listen`, never
         its WebSocket transport (asserted in `agent-e2e.test.ts`).
   - [ ] Claude Code is started without `--permission-mode`,
         `--dangerously-skip-permissions` or `--remote-control` (asserted).
   - [ ] Approvals offer only the provider's decisions, and Velloo answers none
         by itself (asserted in the adapter suites).
   - [ ] `/api/agent` refuses cross-origin and non-loopback requests, and bodies
         naming a directory, executable, environment, sandbox or permission
         mode (asserted).
   - [ ] Agent history stays in `~/.velloo/agents`, never in the checkout.
4. Light and dark, and the panel at its narrowest (240px), in the browser.
