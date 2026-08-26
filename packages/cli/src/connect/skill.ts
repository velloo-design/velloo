import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { access, cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the skills source root. Works from source
 * (`packages/cli/src/connect/` → repo-root `skills/`) and from the bundled
 * binary, where `build.ts` copies the skills tree to `<dist>/skills/`.
 */
function resolveSkillsRoot(): string {
  const dev = join(here, "..", "..", "..", "..", "skills");
  const candidates = [process.env.VELLOO_SKILLS_SRC, join(here, "skills"), dev].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((p) => existsSync(p)) ?? dev;
}

export const SKILLS_ROOT = resolveSkillsRoot();

export interface SkillResult {
  name: string;
  installed: boolean;
  path?: string;
  reason?: string;
}

/**
 * Copy every bundled skill into `<projectRoot>/<baseDir>/skills/<name>/`. A
 * skill is any directory under the skills root that contains a `SKILL.md`; the
 * whole directory is copied so a skill can ship supporting files beside it.
 * `baseDir` defaults to `.agents` — the neutral SKILL.md location the growing
 * skills ecosystem (opencode and friends) reads; Claude Code gets its skills
 * through the velloo plugin instead (see plugin.ts). A missing skills root
 * (e.g. a bundle that didn't ship them) degrades to an empty list, never an
 * error.
 */
export async function installSkills(
  projectRoot: string,
  baseDir = ".agents",
): Promise<SkillResult[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: SkillResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const srcDir = join(SKILLS_ROOT, name);
    try {
      await access(join(srcDir, "SKILL.md"));
    } catch {
      continue; // a directory without a SKILL.md is not a skill
    }
    const destDir = join(projectRoot, baseDir, "skills", name);
    await mkdir(dirname(destDir), { recursive: true });
    await cp(srcDir, destDir, { recursive: true });
    results.push({ name, installed: true, path: join(destDir, "SKILL.md") });
  }
  return results;
}
