import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_VERSION } from "../version.ts";
import { SKILLS_ROOT } from "./skill.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the plugin assets root (`plugins/` at the repo root). Works from
 * source (`packages/cli/src/connect/` → repo-root `plugins/`) and from the
 * bundled binary, where `build.ts` copies the tree to `<dist>/plugins/`.
 */
function resolvePluginsRoot(): string {
  const dev = join(here, "..", "..", "..", "..", "plugins");
  const candidates = [process.env.VELLOO_PLUGINS_SRC, join(here, "plugins"), dev].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((p) => existsSync(p)) ?? dev;
}

const PLUGINS_ROOT = resolvePluginsRoot();

/** CLI semver without the build stamp — plugin versions track the CLI. */
const bareVersion = () => TOOL_VERSION.split(" ")[0] ?? "0.0.0";

async function patchVersion(manifestPath: string): Promise<string> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.version = bareVersion();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return bareVersion();
}

export interface ClaudePluginResult {
  /** The materialized local marketplace dir (`~/.velloo/claude-plugins`). */
  marketplaceDir: string;
  /** The user settings file that registers + enables the plugin. */
  settingsPath: string;
  version: string;
}

/**
 * Materialize the velloo Claude Code plugin as a LOCAL-PATH marketplace under
 * `~/.velloo/claude-plugins` and register it in the user's Claude settings.
 *
 * Why local-path instead of a git marketplace: the plugin content ships inside
 * the installed CLI package, so the plugin version always matches the CLI (no
 * clone, no version skew, works offline). Re-running connect refreshes the
 * materialized copy in place — the marketplace path stays stable across CLI
 * upgrades, so the settings entry never dangles.
 *
 * The plugin bundles the velloo skills, slash commands (`/velloo:design`,
 * `/velloo:implement`, `/velloo:review`), and subagents (velloo-designer,
 * velloo-design-reviewer). It deliberately does NOT bundle an MCP server —
 * connect wires that into the agent config directly, and a plugin copy would
 * register the server twice.
 *
 * Returns null when the bundle didn't ship plugin assets (degrade, don't
 * error). Throws if `~/.claude/settings.json` exists but isn't valid JSON —
 * mirroring write-config's refuse-to-clobber stance.
 */
export async function installClaudePlugin(homeDir = homedir()): Promise<ClaudePluginResult | null> {
  const src = join(PLUGINS_ROOT, "claude", "velloo");
  if (!existsSync(src)) return null;

  const marketplaceDir = join(homeDir, ".velloo", "claude-plugins");
  const pluginDir = join(marketplaceDir, "plugins", "velloo");
  await rm(pluginDir, { recursive: true, force: true });
  await mkdir(join(marketplaceDir, ".claude-plugin"), { recursive: true });
  await cp(src, pluginDir, { recursive: true });
  // Skills live once in the repo (skills/) and ride into the plugin here, so
  // the plugin and the .agents/skills install never drift.
  if (existsSync(SKILLS_ROOT)) {
    await cp(SKILLS_ROOT, join(pluginDir, "skills"), { recursive: true });
  }
  const version = await patchVersion(join(pluginDir, ".claude-plugin", "plugin.json"));

  await writeFile(
    join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(
      {
        name: "velloo",
        owner: { name: "Velloo", url: "https://velloo.design" },
        plugins: [
          {
            name: "velloo",
            source: "./plugins/velloo",
            description:
              "Design and implement UI on the Velloo canvas — skills, slash commands, and subagents.",
            version,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  // Register + enable in the user's Claude settings so no /plugin gesture is
  // needed. Only velloo's two keys are touched; everything else is preserved.
  const settingsPath = join(homeDir, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `${settingsPath} exists but isn't valid JSON — fix or remove it, then re-run connect.`,
      );
    }
  }
  const marketplaces =
    settings.extraKnownMarketplaces && typeof settings.extraKnownMarketplaces === "object"
      ? (settings.extraKnownMarketplaces as Record<string, unknown>)
      : {};
  const enabled =
    settings.enabledPlugins && typeof settings.enabledPlugins === "object"
      ? (settings.enabledPlugins as Record<string, unknown>)
      : {};
  const merged = {
    ...settings,
    extraKnownMarketplaces: {
      ...marketplaces,
      velloo: { source: { source: "directory", path: marketplaceDir } },
    },
    enabledPlugins: { ...enabled, "velloo@velloo": true },
  };
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);

  return { marketplaceDir, settingsPath, version };
}

export interface GeminiExtensionResult {
  /** The materialized extension dir (`~/.velloo/gemini-extension`). */
  dir: string;
  /** Whether `gemini extensions link` succeeded (real home + binary only). */
  linked: boolean;
}

/**
 * Materialize the velloo Gemini CLI extension (manifest + GEMINI.md context +
 * /velloo:* commands + the skills tree) under `~/.velloo/gemini-extension`,
 * then best-effort `gemini extensions link` it. The link is a symlink, so
 * re-running connect refreshes the content without re-linking.
 *
 * The link step runs only against the REAL home dir — tests inject a fake
 * homeDir and must never symlink a tmp dir into the user's ~/.gemini.
 */
export async function installGeminiExtension(
  homeDir = homedir(),
): Promise<GeminiExtensionResult | null> {
  const src = join(PLUGINS_ROOT, "gemini");
  if (!existsSync(src)) return null;

  const dir = join(homeDir, ".velloo", "gemini-extension");
  await rm(dir, { recursive: true, force: true });
  await cp(src, dir, { recursive: true });
  if (existsSync(SKILLS_ROOT)) {
    await cp(SKILLS_ROOT, join(dir, "skills"), { recursive: true });
  }
  await patchVersion(join(dir, "gemini-extension.json"));

  let linked = false;
  if (homeDir === homedir() && Bun.which("gemini")) {
    try {
      const proc = Bun.spawn(["gemini", "extensions", "link", dir], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      const timeout = setTimeout(() => proc.kill(), 15_000);
      linked = (await proc.exited) === 0;
      clearTimeout(timeout);
    } catch {
      linked = false;
    }
  }
  return { dir, linked };
}
