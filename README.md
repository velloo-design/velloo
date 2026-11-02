<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/velloo-lockup-dark.png">
    <img src="./.github/assets/velloo-lockup.png" alt="Velloo" width="205">
  </picture>
</h1>

**Decide the design with your agent.**

Velloo is a free, open-source design canvas that sits beside your app. Your
coding agent draws directions on it from your real components, you and your
team react to the pixels, and the agent builds the one you choose.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-FFAB1F.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![npm](https://img.shields.io/npm/v/velloo.svg?color=FFAB1F)](https://www.npmjs.com/package/velloo)
[![CI](https://github.com/velloo-design/velloo/actions/workflows/ci.yml/badge.svg)](https://github.com/velloo-design/velloo/actions/workflows/ci.yml)
[![Discussions](https://img.shields.io/github/discussions/velloo-design/velloo?color=FFAB1F)](https://github.com/velloo-design/velloo/discussions)

[Quickstart](#quickstart) · [Watch the film](https://velloo.design/#walkthrough) · [Docs](https://velloo.design/docs/) · [Roadmap](https://github.com/orgs/velloo-design/projects/1) · [Discussions](https://github.com/velloo-design/velloo/discussions)

</div>

<p align="center">
  <a href="https://velloo.design/#walkthrough">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/walkthrough-dark.gif">
      <img src="./.github/assets/walkthrough.gif" alt="Slides from Velloo's film: a booking flow for Tidehouse, a Nordic bathhouse, in three directions; Claude Code started in Velloo's Agent tab and asked for them; the directions composed live from the app's real components; notes pinned on the design and handed to the agent; a headline selected and changed in place; the board published to a share link, where the founder comments from her own browser; her notes answered on the same link; the chosen design built in the real app; the design language the agent creates; and the setup page velloo init opens" width="100%">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://velloo.design/#walkthrough"><b>▶ Watch the 90-second film, with sound</b></a>
  ·
  <a href="https://share.velloo.dev/s/f499e7b93c/">Open the board it published</a>
  <br>
  <sub>One real run with Claude Code in Velloo's Agent tab, from three directions to the shipped app.</sub>
</p>

---

## Quickstart

```bash
npm install -g velloo
cd your-app        # or an empty folder, to start something new
velloo init        # opens a setup page in your browser
```

The setup page reads your app (its components, theme and routes) and asks only
what it can't tell. Then the canvas opens with your agent already at work in
the **Agent tab**. In an existing app it starts with setup: it imports your
theme and fonts, checks that your components render, and proposes a design
language for you to review.

Then ask for what you came for:

> Explore three different directions for the billing page, side by side on one
> board. Show me the canvas before you change any app code.

`velloo run` reopens the canvas later. `init` never changes your app's source.

<details>
<summary><b>More setup options</b></summary>

- **Which agents.** The Agent tab runs Claude Code, Codex, or any installed
  agent that speaks the Agent Client Protocol (OpenCode, GitHub Copilot,
  Cursor, Gemini CLI and more), on your own login and subscription.
- **Already working in a terminal?** Tick your agent on the setup page or run
  `velloo connect`, then ask it to "Set Velloo up for this app"
  (`/velloo:setup` in Claude Code). A Claude Code or Codex session from your
  terminal can also continue in the Agent tab.
- **Let the agent see its work.** `velloo browser install` adds the optional
  headless browser it uses for screenshots.
- **Other installs.** `pnpm add -g velloo`, or the standalone installer in the
  [quickstart guide](https://velloo.design/docs/quickstart/).

</details>

> Velloo is early and moving fast, so expect rough edges. `velloo upgrade`
> updates the tool and migrates your designs. Bug reports and design feedback
> are very welcome.

## How it works

1. **Explore.** One prompt, several directions, drawn live on the canvas from
   your real components.
2. **Refine.** Pin comments and hand them to the agent, select something and
   ask for a change, or edit props and styles yourself.
3. **Review** *(optional)*. Publish a board to a share link. Reviewers comment
   in their browser for free, and their notes come back to your canvas and your
   agent.
4. **Ship.** The agent writes the chosen design into your app, in its own
   framework, and compares the running app to the design.

Every screen follows your **design language** (colour, type, shape and written
rules), which your agent proposes from your app and you approve on the canvas.

Each screen is saved as a readable component tree in a folder you own, so your
agent edits exactly what you see. [Concepts →](https://velloo.design/docs/concepts/)

## What you can do

| You want to… | Start here |
|---|---|
| Design something new, with or without an app | [Design a screen](https://velloo.design/docs/guides/design-a-screen/) |
| Redesign a page your app already has | [Port an existing page](https://velloo.design/docs/guides/port-a-page/) |
| Start from a live page in your browser | `velloo capture` · [CLI](https://velloo.design/docs/reference/cli/) |
| Get feedback from people outside the repo | [Velloo Cloud](https://velloo.design/docs/cloud/) |
| Turn the chosen design into code | [From design to code](https://velloo.design/docs/guides/emit/) |
| Work with your agent beside the canvas | [The Agent tab](https://velloo.design/docs/agent/agent-tab/) |

## Works with your stack

| Your app | What the canvas renders and the agent writes |
|---|---|
| **shadcn/ui + Tailwind** | Your own component files, Tailwind `className` |
| **Material UI** | Real `@mui/material`, the `sx` prop |
| **Ant Design** | Real antd components, inline `style` |
| **Chakra UI v2** | Real Chakra components, `sx` |
| **React, no library** | Plain HTML primitives, Tailwind or inline `style` |
| **HTML + htmx** | Your app's CSS, native markup with `hx-*` ([guide](https://velloo.design/docs/guides/html/)) |
| **Anything else your app renders** | Mantine, a private design system, your own `components/` ([how](https://velloo.design/docs/concepts/repository-components/)) |

Agents outside the canvas connect over MCP: Claude Code, Codex, Cursor, GitHub
Copilot, Gemini CLI, OpenCode, Windsurf and other MCP clients
([connect an agent](https://velloo.design/docs/agent/connect/)). Velloo runs on
macOS, Linux and Windows.

## Private by default

- **Local and free.** The canvas needs no account and sends no telemetry. Its
  only request of its own is an anonymous, at most daily check for a new
  release (`VELLOO_DISABLE_UPDATE_CHECK=1` turns it off).
- **Your agent, your login.** The Agent tab starts your agent on your machine.
  Velloo holds no provider credentials, and the session never goes through
  Velloo Cloud.
- **Cloud only when you ask.** [Velloo Cloud](https://velloo.design/docs/cloud/)
  is opt-in (`velloo login`) and starts free: 3 live share links and 250 MB of
  storage, and reviewers never need a seat. `velloo publish` uploads what your
  machine rendered; the cloud never runs your app's code.
  [Pricing →](https://velloo.design/pricing/)

## Learn more

- **[Docs](https://velloo.design/docs/)**: guides, concepts and reference
  ([CLI](https://velloo.design/docs/reference/cli/),
  [MCP tools](https://velloo.design/docs/reference/mcp/),
  [themes](https://velloo.design/docs/guides/theme/)).
- **[What's new](https://velloo.design/docs/whats-new/)** in each release.
- **[Why I created Velloo](https://velloo.design/blog/why-i-created-velloo/)**,
  the thinking behind it.
- **How Velloo is built**: [architecture](./docs/architecture.md),
  [MCP surface](./docs/mcp.md), [writing a framework adapter](./docs/providers.md).

## Contributing

Bug reports, adapters, docs and design feedback are all welcome. Start with
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup and checks, and
[`AGENTS.md`](./AGENTS.md) for the package layout and architecture rules.

```bash
bun install
bun run --cwd packages/canvas build         # build the canvas
bun run velloo init /tmp/velloo-smoke
bun run velloo run /tmp/velloo-smoke        # canvas on :7300
bun run verify                              # typecheck, lint and tests
```

Planned work is on the [roadmap](https://github.com/orgs/velloo-design/projects/1).
Small issues are labelled
[`good first issue`](https://github.com/velloo-design/velloo/labels/good%20first%20issue),
larger ones ready to pick up
[`help wanted`](https://github.com/velloo-design/velloo/labels/help%20wanted).

## Community and support

- **Questions and ideas**: [Discussions](https://github.com/velloo-design/velloo/discussions)
- **Bugs and feature requests**: [open an issue](https://github.com/velloo-design/velloo/issues/new/choose)
- **Security issues**: [`SECURITY.md`](./SECURITY.md). Please don't file a public issue.
- **Ground rules**: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

## License

Velloo is open source under the [Apache License 2.0](./LICENSE).

The **Velloo** name and the interlinked-frames mark are trademarks and aren't
covered by the code license: fork the code freely, but don't ship a derivative
under the Velloo name or logo. See [`TRADEMARK.md`](./TRADEMARK.md).
