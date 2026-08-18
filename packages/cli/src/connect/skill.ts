import { existsSync } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the velloo-design skill source. Works from source
 * (`packages/cli/src/connect/` → repo-root `skills/`) and from the bundled
 * binary, where `build.ts` copies the skill to `<dist>/skills/`.
 */
function resolveSkillSrc(): string {
  const dev = join(here, "..", "..", "..", "..", "skills", "velloo-design", "SKILL.md");
  const candidates = [
    process.env.VELLOO_SKILL_SRC,
    join(here, "skills", "velloo-design", "SKILL.md"),
    dev,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? dev;
}

const SKILL_SRC = resolveSkillSrc();

export interface SkillResult {
  installed: boolean;
  path?: string;
  reason?: string;
}

/**
 * Copy the velloo-design skill into `<projectRoot>/.claude/skills/`. The
 * skill is Claude Code-shaped; callers install it only when claude-code is
 * a target. Missing source (e.g. running from a bundle that didn't ship
 * the skill) degrades to a skip, never an error.
 */
export async function installSkill(projectRoot: string): Promise<SkillResult> {
  try {
    await access(SKILL_SRC);
  } catch {
    return { installed: false, reason: "skill source not found" };
  }
  const dest = join(projectRoot, ".claude", "skills", "velloo-design", "SKILL.md");
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(SKILL_SRC, dest);
  return { installed: true, path: dest };
}
