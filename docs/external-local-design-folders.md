# Local designs outside the repository

A design can live outside the application repository —
in Velloo-managed storage, or in a directory you choose. Such a **local design**
exists only on the machine that has it: nothing about it is written into the
checkout, it is **not version-controlled** unless you put it under Git yourself,
and a teammate cloning the repository does not see it. The application still
supplies components and styles. Publishing still creates a review bundle using
the existing publish flow.

## Why nothing goes into `velloo.json`

`velloo.json` is committed. Its entries are paths to design folders *inside* the
repository, and only those: a location outside it means nothing to anyone else,
and a repository you cloned must not be able to point Velloo at a directory
outside itself. So the only record that "this checkout has a design over there"
is a file on your machine, written by `init`, `design move` or `design bind`.

## Create and open

The init wizard offers **Default in repo** (`./velloo/`), **Default out of repo**
(managed storage under `~/.velloo/designs/`), or **Custom name** (a folder name or
path). The defaults skip the name prompt and print the exact design path they will
use. A custom path that lands outside the checkout — `../coda-designs`, say — is
detected and becomes a local design too; the wizard says so before continuing.
For scripts:

```sh
velloo init --external --name web --non-interactive
velloo init --design-folder ../coda-designs --name coda --non-interactive
velloo design add --external --name explorations --non-interactive
velloo run web
```

The checkout is the `velloo.json` directory above where init ran, else the Git
root, else the directory init ran in. From anywhere inside it, `velloo run`, `mcp`
and every other design-taking command see its local designs alongside its
`velloo.json` designs, as one set of design names. A design's name lives in its
own `.design/config.json`, wherever the design is stored.

## What lives where

| Location | Contents |
| --- | --- |
| Application repository | Application source only — no Velloo files for a local design |
| `~/.velloo/designs/<id>/` | A managed design: JSON, boards, notes, snippets, themes, assets and README |
| A directory you chose | A custom-path local design, same contents |
| `~/.velloo/designs/.locations/<id>.json` | The machine record: checkout, application root, and the folder when it is not in managed storage |
| Design `.design/cache/` and `.velloo/` | Ignored daemon state, caches and debug traces |

`VELLOO_DESIGNS_HOME` overrides the storage root (and with it `.locations`) for
portable installations and isolated tests. Keep it consistent across CLI and
agent processes.

The config uses `app:<relative-path>` for references into the application,
including host apps and in-repository component sources; the machine record
resolves them. Feedback preferences stay in the design's own config.

## Agents

A local design is wired into **global** agent configs only. Project-scoped
configs (`.mcp.json`, `.cursor/mcp.json`, …) and project guidance files
(`.agents/skills/`, the Cursor rule) would put a design nobody else has into the
repository, so `velloo connect` offers only global targets, refuses an explicit
project-scoped `--agent`, and non-interactive `init` leaves wiring to an explicit
`velloo connect`. The Claude Code plugin and Gemini extension are global and still
install.

A global entry runs `velloo mcp` with no folder: each agent session starts its own
server, which resolves the design from the directory the agent was opened in. Two
agents in two checkouts get their own designs. Two agents in the same checkout
resolve the same way — inside a design's folder or application, that design;
otherwise the only design, or `defaultDesign`. When a checkout has several
designs and nothing picks one, the session opens the first by name and tells the
agent to confirm with you; in a checkout with several designs the agent can list
them and `switch_design` to another without restarting.

## Version control

Velloo never runs Git commands that change a design, and it does not need Git
installed. Canvas undo/redo is the only history it keeps, and it is short-lived.

Velloo uses a repository when it finds one. A local design only counts a
repository rooted at the design folder itself: Git's discovery never climbs past
the folder, or to your home directory, so a dotfiles repository in `~` is never
mistaken for the design's. If you run `git init` in the design folder, `publish`
records that repository's commit and branch, and `publish --changed-since <ref>`
compares refs in it. Without a repository, publishing reports that it has no
repository or branch, and `--changed-since` fails because there are no refs to
compare.

## Relocate an existing design

Run these from the checkout. The first invocation prints source, destination and
where the design will be recorded. Add `--yes` to apply:

```sh
velloo design move web --external              # into managed storage
velloo design move web --to ../web-designs     # outside the repo: local
velloo design move web --to designs/web        # inside the repo: velloo.json
velloo design move web --to designs/web --yes
```

Moving out of the repository removes the `velloo.json` entry (and the file, when
it was the only design) and writes the machine record; moving in does the
reverse. Close external editors first. Velloo stops the daemon, copies content,
checks copied bytes, rebases application references and validates the result
before updating either record. Occupied destinations, nested source/destination
paths and symlink content are refused; a symlink that only looks like it is inside
the repository is treated as outside. A copy, validation or manifest failure
retains the original source. If cleanup fails afterwards, the message identifies
both recoverable copies. The design's name and folder identity are preserved; a
`defaultDesign` that named it is dropped when it leaves `velloo.json`.

Restart the canvas with `velloo run web` after relocating.

## Back up, move or clone

Back up the **entire** design folder. The record is keyed by the checkout's path,
so after moving or cloning the checkout, or restoring a design on another machine,
attach it from the checkout:

```sh
velloo design bind ~/.velloo/designs/<id>
velloo design bind ../coda-designs --yes
```

Binding validates the design, stops its daemon, and records it for this checkout,
keeping its name (or the one `--name` gives it) and its application's place within the checkout (so a
monorepo's `apps/web` still resolves). A design has one checkout at a time; bind
it again to move it. When no design resolves, commands name any local designs
whose checkout no longer exists.

`bind` is also how a legacy `velloo.json` entry that points outside the repository
becomes a local design: it drops that entry and writes the record. Until then the
entry is refused, unless you pass the design's path explicitly for one invocation.
A manifest that still holds an old `{ "managed": "<id>" }` entry is refused with
the same instruction — remove the entry, then bind the folder.

To *change* which application a design points at, use `design set-app-root`:

```sh
velloo design set-app-root web --to packages/triagem/web
velloo design set-app-root web --to packages/triagem/web --yes
```

The command previews before it applies. A local design changes only its machine
record — `app:` paths already mean "under the application root", so they
follow it — and the new root must be inside its checkout. An in-repo design has
no such symbolic form, so the paths that were *under* the old root (`hostApp.root`,
`hostApps[*].root`, an `in-repo` library's `componentsPath`) are re-anchored onto
the new one, and anything pointing elsewhere is left alone. `init` also asks when
the mistake is provable: the repo holds UI apps and the directory it was run in is
not one.

## Remove and diagnose

```sh
velloo design remove web --yes                  # forget the local design, keep its files
velloo design remove web --delete-content --yes # also delete the files
```

In-repository designs keep their original delete behavior.

- **No design found after moving the checkout:** run `velloo design bind <design
  folder>` from the new location; inside a project, the error lists the designs whose checkout moved.
- **`velloo.json` path outside the repository:** run `velloo design bind <path>`
  to keep it as a local design, or relocate it into the repository.
- **Missing design content:** restore the whole design folder from backup, then
  bind it.
- **Several designs:** pass a design name, run from inside the design's folder
  or application, or set `defaultDesign` in `velloo.json`.
- **Two designs with the same name:** pass one by path, and rename it with
  `velloo design rename <path> <new-name>`.
- **Broken host reference:** restore the application directory or correct the
  `app:` reference with `design set-app-root`.
- **`--changed-since` reports no git repository:** the design folder is not in
  one. Publish without it, or put the design folder under Git yourself.
- **Filesystem permission or storage failure:** ensure storage and the checkout
  are writable and there is enough free disk space. Keep the original source and
  retry from the printed paths.

## Verification matrix

`packages/cli/src/__tests__/managed-folders.test.ts` covers real init (managed
storage and a custom path outside the checkout), resolution, relocation in every
direction, binding after a clone or move, legacy and old managed entries, removal,
context and feedback, global-only agent wiring, daemon restart, MCP stdio launch,
file watcher reload, status, stop, capture listing, HTML render/export, emit,
theme export and design upgrade. It also checks that init works without Git, that
a local design never borrows a repository from above it, and that publishing and
changed-since use a repository you create in the design folder. Browser-dependent
screenshot and capture tests remain in `bun run test:browser`.
