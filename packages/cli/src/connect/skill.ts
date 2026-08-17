import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Repo-root skills/velloo-design/SKILL.md, resolved relative to this file
// (packages/cli/src/connect/). One source of truth: the same file the
// published skills repo would carry.
const SKILL_SRC = fileURLToPath(
  new URL("../../../../skills/velloo-design/SKILL.md", import.meta.url),
);

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
