# External local design folders

A project can keep its editable design outside the application repository. The
application still supplies components, styles and agent configuration; the design
has its own local Git history. This does not upload or synchronize the editable
design. Publishing still creates a review bundle using the existing publish flow.

## Create and open

The init wizard offers **Default in repo** (`./velloo/`), **Default out of repo**
(Velloo-managed storage), or **Custom name** (a folder name or path). The two
defaults skip the name prompt; Custom name lets you choose it. For scripts:

```sh
velloo init --external --project web --non-interactive
velloo folder add --external --project explorations --non-interactive
velloo run web
velloo connect web
```

Use the ordinary init flags to select a library, initial content, scanning and
agent wiring. `--no-connect` skips agent setup. `--external` and `--design-folder`
are alternative choices. Existing string entries such as `"web": "velloo"` keep
working without migration.

An external project registration looks like:

```json
{
  "projects": {
    "web": { "managed": "7e17eeab-aab1-4db6-99de-1313b41a20f1", "appRoot": "." },
    "admin": "apps/admin/velloo"
  },
  "defaultProject": "web"
}
```

`appRoot` is relative to the manifest directory (and defaults to `.`). It retains
the application directory when the manifest belongs to a larger monorepo. No
machine-specific absolute storage path is committed.

## What lives where

| Location | Contents |
| --- | --- |
| Application repository | `velloo.json`, application source, project agent configuration and guidance |
| `~/.velloo/designs/<managed-id>/` | Editable design JSON, boards, notes, snippets, themes, assets, README and standalone `.git/` history |
| `~/.velloo/designs/.locations/<managed-id>.json` | Machine-local binding to the application root, manifest and project name |
| Design `.design/cache/` and `.velloo/` | Ignored daemon state, caches and debug traces |

`VELLOO_DESIGNS_HOME` overrides the managed storage root for portable local
installations and isolated tests. Keep it consistent across CLI and agent
processes. Never commit `.locations` files into the application or design repo.
Capture evidence continues to use Velloo's existing machine-local capture store.

The config uses `project:<relative-path>` for references into the application,
including host apps and in-repository component sources. Design-internal paths
remain design-relative. The binding resolves those references on this machine.
Agent launch arguments use the manifest project name, so project configurations
remain portable. GUI agents retain their existing machine-local absolute launch
configuration behavior.

## Checkpoints and recovery

New managed designs have an initial validated Git commit. Canvas undo/redo remains
short-lived editing history. Save a durable named checkpoint deliberately:

```sh
velloo folder checkpoint web --message "Approved account settings"
git -C ~/.velloo/designs/<managed-id> log --oneline
```

Velloo validates the design before committing. No per-mutation autocommit is
introduced. Git uses your configured identity, with a local Velloo author fallback
if no identity is configured. Runtime caches, traces, node_modules and macOS
metadata are ignored; editable content and assets are tracked.

Canvas **Revert all** restores the current committed checkpoint and removes
untracked, non-ignored design files. It acts on the design repository only.
The application working tree is unaffected. Commit important new files before
reverting. Checkpoint errors retain design content and report failure, never a
successful commit; inspect `git status` before retrying because staging may have
completed before a commit failed.

`publish --changed-since <ref>` compares refs in the **design** repository.
Application branch names are not design refs. Publishing records the design
branch/checkpoint and reports the absence of a remote; it does not invent an
application remote for the standalone history.

## Relocate an existing design

Run these from the application repository. The first invocation prints source,
destination and the project entry that will change. Add `--yes` to apply:

```sh
velloo folder relocate web --external
velloo folder relocate web --external --yes
velloo folder relocate web --to designs/web
velloo folder relocate web --to designs/web --yes
```

Close external editors while moving a design. Velloo stops its daemon, copies
content, checks copied bytes, rebases application references and validates the
result before atomically updating the manifest. Occupied destinations, nested
source/destination paths and symlink content are refused. A copy, validation,
Git initialization or manifest failure retains the original source. If cleanup
fails after the manifest changes, the message identifies both recoverable copies.
Project name, folder identity and default choice are preserved.

Returning a managed folder to the application retains its standalone `.git`
history. It remains a nested independent repository: an enclosing application Git
repository does not automatically absorb that history. Back it up before choosing
to flatten it manually. Existing agent wiring that contains an old filesystem
path should be refreshed with `velloo connect web` after relocation; project-name
wiring already follows the changed locator. Restart the canvas with `velloo run web`.

## Back up, move or clone

Back up the **entire** managed design, including `.git` and any uncommitted files.
An application clone alone contains the locator, not the design or its history.
Restore the design under the same managed ID on the new machine. Then explicitly
bind it from the application checkout:

```sh
velloo folder bind web
velloo folder bind web --yes
```

Binding validates the restored design and stops an existing daemon before changing
application context. A managed ID has one local application binding at a time;
opening a second clone does not silently reassign it. Use separate designs for
simultaneous independent work. `folder bind` also recovers a moved application,
stale mapping or lost `.locations` record. It retains `appRoot` from the portable
manifest so nested apps resolve correctly.

Legacy absolute or `../`-escaping string entries still parse, but cannot implicitly
authorize writes outside the manifest repository. Supply the design's path
explicitly to authorize that invocation, or migrate from the application root:

```sh
velloo folder relocate /absolute/old/design --external
velloo folder relocate /absolute/old/design --external --yes
```

The old source must be registered exactly once. Preview never rewrites legacy
entries. Windows separators in legacy relative paths are normalized; a Windows
absolute path on another platform needs an explicit current-machine path.

## Remove and diagnose

```sh
velloo folder remove web --yes                 # external content and Git retained
velloo folder remove web --delete-content --yes # explicitly delete both
```

For existing in-repository designs, removal keeps its original delete behavior.
To register retained external content again, restore its locator in `velloo.json`
from version control and run `folder bind web --yes`.

- **Missing mapping or stale application:** restore the manifest or move to the
  intended checkout and use `folder bind`.
- **Missing design content:** restore the whole design from backup to the printed
  managed path, then bind it. A locator cannot recreate missing design work.
- **Malformed locator or multiple projects:** fix the named manifest field or pass
  an explicit project name / set `defaultProject`.
- **Broken host reference:** restore the application directory or correct the
  `project:` reference; check `appRoot` before rebinding.
- **Git missing or checkpoint failure:** install Git, check repository permissions
  and identity, inspect `git status`, then retry the checkpoint.
- **Filesystem permission or storage failure:** ensure managed storage and the
  application manifest are writable and there is enough free disk space. Keep the
  original source and retry from the printed paths. Do not delete a recovery copy
  until the destination has been checked.

## Verification matrix

`packages/cli/src/__tests__/managed-folders.test.ts` covers real init, folder
management, relocation, binding, checkpoints, revert isolation, context/feedback,
agent configuration, daemon restart, MCP stdio launch, file watcher reload, status,
stop, capture listing, HTML render/export, emit, theme export and folder upgrade.
Publishing and changed-since use the standalone design Git boundary. Existing
provider, capture, screenshot and publish suites exercise their shared rendering
and upload implementations. Browser-dependent screenshot/capture tests remain in
`bun run test:e2e`.
