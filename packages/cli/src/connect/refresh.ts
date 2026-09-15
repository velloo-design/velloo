import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installCursorRules } from "./cursor-rules.ts";
import { installClaudePlugin, installGeminiExtension } from "./plugin.ts";
import { installSkills } from "./skill.ts";

export interface RefreshResult {
  /** Human-readable lines describing what was brought up to date. */
  refreshed: string[];
}

/**
 * Re-install the agent-facing guidance this velloo ships — the Claude plugin,
 * the neutral `.agents/skills/` copies, the Gemini extension, the Cursor rule —
 * for whatever is *already* installed.
 *
 * Upgrading the binary moves the skills and the plugin forward too, and a stale
 * skill is worse than a missing one: it keeps confidently describing tools and
 * workflows that changed underneath it. So `velloo upgrade` refreshes them
 * alongside the folder format.
 *
 * Strictly a refresh, never a new wiring: each artifact is rewritten only where
 * one already exists. Upgrading a folder is not consent to start configuring an
 * agent the user never connected — that stays `velloo connect`.
 */
export async function refreshAgentArtifacts(opts: {
  projectRoots: string[];
  designFolder: string;
  homeDir?: string;
}): Promise<RefreshResult> {
  const homeDir = opts.homeDir ?? homedir();
  const refreshed: string[] = [];

  if (existsSync(join(homeDir, ".velloo", "claude-plugins", "plugins", "velloo"))) {
    const plugin = await installClaudePlugin(homeDir);
    if (plugin) refreshed.push(`claude plugin (${plugin.marketplaceDir})`);
  }

  for (const projectRoot of opts.projectRoots) {
    const skillsDir = join(projectRoot, ".agents", "skills");
    if (existsSync(skillsDir)) {
      const skills = await installSkills(projectRoot);
      if (skills.length > 0) refreshed.push(`${skills.length} skills (${skillsDir})`);
    }
  }

  if (existsSync(join(homeDir, ".velloo", "gemini-extension"))) {
    const ext = await installGeminiExtension(homeDir);
    if (ext) refreshed.push(`gemini extension (${ext.dir})`);
  }

  for (const projectRoot of opts.projectRoots) {
    const cursorRule = join(projectRoot, ".cursor", "rules", "velloo.mdc");
    if (existsSync(cursorRule)) {
      const rules = await installCursorRules(projectRoot, opts.designFolder);
      if (rules.installed && rules.path) refreshed.push(`cursor rule (${rules.path})`);
    }
  }

  return { refreshed };
}
