#!/usr/bin/env bun
/**
 * Pulls upstream shadcn into every place this repo keeps a copy.
 *
 *   bun run vendor                        # both targets, plus their shared CSS
 *   bun run vendor --target=chrome        # one of them, while the pin holds
 *   bun run vendor --target=chrome button # a few components of one
 *   bun run vendor --force                # overwrite adapted files too
 *   bun run vendor --list                 # what the targets are
 *
 * A component pass lands in both copies from the one pull, and the pin lives in
 * `pipeline.ts` — bumping it moves both, which is the whole point: while any
 * target's stamps disagree with it, only the full pull runs. Every target is
 * planned (fetched, checked, rendered) before any file is written, so a failed
 * pull leaves the tree as it was. After a pull: define any new `cn-*` class the
 * sources reference in each entry stylesheet (upstream emits them and does not
 * ship them, so an undefined one renders inert rather than failing), add a
 * shelf in `packages/shadcn-snapshot/src/groups.ts` for a new family, and
 * rebuild the manifest with `bun run --cwd packages/shadcn-snapshot build`.
 */
import {
  fetchRegistryUiIds,
  format,
  pinDrift,
  planTarget,
  SHADCN_PIN,
  type VendorPlan,
  writePlan,
} from "./pipeline.ts";
import { TARGETS } from "./targets.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const list = args.includes("--list");
const requestedTargets = args
  .filter((a) => a.startsWith("--target="))
  .map((a) => a.slice("--target=".length));
const ids = args.filter((a) => !a.startsWith("--"));

if (list) {
  const width = Math.max(...TARGETS.map((t) => t.id.length));
  for (const t of TARGETS) {
    console.log(`${t.id.padEnd(width)}  ${t.description}`);
    console.log(
      `${"".padEnd(width)}  ${t.catalog.length} components, ${Object.keys(t.skipped).length} skipped, ${t.adapted.size} adapted`,
    );
  }
  process.exit(0);
}

const targets =
  requestedTargets.length === 0
    ? TARGETS
    : requestedTargets.map((id) => {
        const target = TARGETS.find((t) => t.id === id);
        if (!target) {
          throw new Error(
            `unknown --target=${id}; expected one of ${TARGETS.map((t) => t.id).join(", ")}`,
          );
        }
        return target;
      });

if (ids.length > 0 && targets.length > 1) {
  throw new Error("naming components needs a single --target=<id>: the two catalogs differ");
}

const everything = ids.length === 0 && TARGETS.every((t) => targets.includes(t));
if (!everything) {
  const drift = (
    await Promise.all(TARGETS.map(async (t) => (await pinDrift(t)).map((d) => `${t.id}: ${d}`)))
  ).flat();
  if (drift.length > 0) {
    throw new Error(
      `SHADCN_PIN has moved since the last pull (${drift.join("; ")}) — ` +
        "run `bun run vendor` with no --target or component so every copy moves together",
    );
  }
}

console.log(`shadcn ${SHADCN_PIN.style} @ CLI ${SHADCN_PIN.cliVersion} (pull ${SHADCN_PIN.pull})`);

const registryUi = await fetchRegistryUiIds();
const plans: VendorPlan[] = [];
for (const target of targets) {
  plans.push(await planTarget(target, { ids, force }, registryUi));
}
for (const plan of plans) await writePlan(plan);

const dirs = plans
  .filter((p) => p.written.length > 0)
  .map((p) => `${p.target.packageDir}/${p.target.uiDir}`);
const formatError = dirs.length > 0 ? format(dirs) : undefined;
// Not fatal: the files are on disk and correct, they just aren't formatted.
if (formatError) console.error(`! biome could not format the pull:\n${formatError}`);

for (const p of plans) {
  console.log(
    `✓ ${p.target.id}: vendored ${p.written.length} component(s) into ${p.target.packageDir}/${p.target.uiDir}`,
  );
  if (p.skipped.length > 0) {
    console.log(`  · left ${p.skipped.length} file(s) alone: ${p.skipped.join(", ")}`);
  }
  if (p.orphans.length > 0) {
    console.log(`  · on disk but not in the catalog: ${p.orphans.join(", ")}`);
  }
}
