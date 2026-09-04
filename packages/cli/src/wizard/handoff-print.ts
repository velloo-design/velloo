import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import type { Board, Screen } from "@velloo/schema";
import pc from "picocolors";
import { ensureDaemon } from "../daemon/runtime.ts";
import { openUrl } from "../open-url.ts";
import type { WizardAnswers } from "./answers.ts";
import {
  buildHandoffPrompt,
  expandHandoffPrompt,
  SCREENS_PLACEHOLDER,
  wantsHandoff,
} from "./handoff.ts";

/**
 * The user's terminal editor: `$VISUAL` / `$EDITOR` (honoring args like
 * `code --wait`) when its binary resolves on PATH, else the first of
 * nano/vim/vi that's installed.
 */
function detectEditor(): string[] {
  const env = (process.env.VISUAL || process.env.EDITOR || "").trim();
  if (env) {
    const parts = env.split(/\s+/);
    if (parts[0] && Bun.which(parts[0])) return parts;
  }
  for (const cand of ["nano", "vim", "vi"]) {
    if (Bun.which(cand)) return [cand];
  }
  return ["vi"];
}

/**
 * Open the handoff prompt in the user's editor and return what they saved
 * (trimmed). Returns null if no editor could be launched. Claude Code has no
 * prefill-without-submit flag, so editing here is how the user shapes the
 * prompt before it's sent.
 */
async function editPrompt(prompt: string): Promise<string | null> {
  const file = join(tmpdir(), `velloo-handoff-${process.pid}-${Date.now()}.md`);
  await writeFile(file, prompt, "utf8");
  const editor = detectEditor();
  try {
    await Bun.spawn([...editor, file], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).exited;
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  } finally {
    await rm(file, { force: true });
  }
}

/**
 * Agent CLIs the handoff step can launch straight into the task. Only agents
 * velloo can also wire (see connect/agents.ts) belong here — launching an
 * agent that can't carry the velloo MCP hands the user a tool-less session.
 * `agentIds` ties each launcher to its wiring targets: a launcher is offered
 * only when installed AND one of those ids actually got (or already was) wired.
 */
const AGENT_LAUNCHERS = [
  {
    bin: "claude",
    label: "Claude Code",
    agentIds: ["claude-code", "claude-code-global"],
    argv: (p: string) => ["claude", p],
  },
  {
    bin: "cursor-agent",
    label: "Cursor CLI",
    agentIds: ["cursor", "cursor-global"],
    argv: (p: string) => ["cursor-agent", p],
  },
  {
    bin: "codex",
    label: "Codex CLI",
    agentIds: ["codex", "codex-global"],
    argv: (p: string) => ["codex", p],
  },
  {
    bin: "opencode",
    label: "opencode",
    agentIds: ["opencode", "opencode-global"],
    argv: (p: string) => ["opencode", "--prompt", p],
  },
  {
    bin: "droid",
    label: "Droid",
    agentIds: ["droid-global"],
    argv: (p: string) => ["droid", p],
  },
  {
    bin: "cline",
    label: "Cline",
    agentIds: ["cline-global"],
    argv: (p: string) => ["cline", p],
  },
  {
    bin: "gemini",
    label: "Gemini CLI",
    agentIds: ["gemini", "gemini-global"],
    argv: (p: string) => ["gemini", "-i", p],
  },
] as const;
type AgentLauncher = (typeof AGENT_LAUNCHERS)[number];

/** Best-effort clipboard write via the platform's native CLI. */
async function copyToClipboard(text: string): Promise<boolean> {
  const candidates: string[][] =
    process.platform === "darwin"
      ? [["pbcopy"]]
      : process.platform === "win32"
        ? [["clip"]]
        : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  for (const argv of candidates) {
    const bin = argv[0];
    if (!bin || !Bun.which(bin)) continue;
    const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    await proc.stdin.end();
    if ((await proc.exited) === 0) return true;
  }
  return false;
}

/**
 * Print the agent handoff (scan only) and — interactively — offer to start
 * velloo and launch a wired, installed agent CLI straight into the task, or
 * copy the prompt for any other agent. Launch options are limited to agents
 * that actually carry the velloo MCP (`wiredIds`): launching an unwired agent
 * hands the user a tool-less session. After the user picks an agent, they
 * choose whether to open the canvas in the browser — watching the design
 * build is half the demo, but the agent's MCP-approval prompt lands in the
 * terminal, so it stays an explicit opt-in rather than an automatic yank.
 */
export async function printAgentHandoff(
  answers: WizardAnswers,
  scaffold: { screens: Screen[]; boards: Board[] },
  interactive: boolean,
  wiredIds: string[],
): Promise<void> {
  if (!wantsHandoff(answers)) return;

  const { screens } = scaffold;
  const prompt = buildHandoffPrompt(answers, screens, scaffold.boards);
  console.log(pc.bold("  Finish setup with your agent"));
  console.log(pc.dim("    Paste this to your AI agent:"));
  console.log("");
  for (const line of prompt.split("\n")) console.log(pc.cyan(`    ${line}`));
  if (prompt.includes(SCREENS_PLACEHOLDER)) {
    console.log("");
    console.log(
      pc.dim(
        `    ${SCREENS_PLACEHOLDER} is replaced with your selected screens when the prompt is sent (an agent can also discover them with list_screens).`,
      ),
    );
  }
  console.log("");

  if (!interactive) return;
  const launchers = AGENT_LAUNCHERS.filter(
    (l) => Bun.which(l.bin) && l.agentIds.some((id) => wiredIds.includes(id)),
  );
  const first = launchers[0];
  const action = await select<string>({
    message: first
      ? "Start velloo and launch your agent to do this now?"
      : "No wired agent CLI to launch — what next?",
    options: [
      ...launchers.map((l) => ({
        value: `launch:${l.bin}`,
        label: `Yes — launch ${l.label} with this prompt`,
      })),
      ...(first
        ? [
            {
              value: "edit",
              label: "Edit the prompt first",
              hint: `opens ${detectEditor()[0] ?? "your editor"}`,
            },
          ]
        : []),
      { value: "copy", label: "Copy the prompt to my clipboard" },
      { value: "skip", label: first ? "No — I'll run it later" : "Skip" },
    ],
    initialValue: first ? `launch:${first.bin}` : "copy",
  });
  if (isCancel(action) || action === "skip") return;

  if (action === "copy") {
    const copied = await copyToClipboard(expandHandoffPrompt(prompt, screens));
    console.log(
      copied
        ? `  ${pc.green("✓")} Prompt copied — paste it into your agent.`
        : pc.dim("  Couldn't reach a clipboard tool — copy the prompt printed above."),
    );
    return;
  }

  let finalPrompt = prompt;
  let launcher: AgentLauncher | undefined = first;
  if (action.startsWith("launch:")) {
    launcher = launchers.find((l) => `launch:${l.bin}` === action);
  } else {
    // action === "edit"
    const edited = await editPrompt(prompt);
    if (edited === null) {
      console.error("  Couldn't open an editor. Set $EDITOR and retry, or copy the prompt above.");
      return;
    }
    if (edited === "") {
      console.log(pc.dim("  Prompt was emptied — nothing launched."));
      return;
    }
    finalPrompt = edited;
    if (launchers.length > 1) {
      const pick = await select<string>({
        message: "Launch which agent?",
        options: launchers.map((l) => ({ value: l.bin, label: l.label })),
        ...(launchers[0] ? { initialValue: launchers[0].bin } : {}),
      });
      if (isCancel(pick)) return;
      launcher = launchers.find((l) => l.bin === pick);
    }
  }
  if (!launcher) return;

  // The user reads + edits the compact placeholder form; the agent gets the
  // real screen list.
  finalPrompt = expandHandoffPrompt(finalPrompt, screens);

  // Start the persistent canvas so it's ready to watch; the agent attaches its
  // own `velloo mcp` (wired during init) to the same daemon. The canvas stays
  // up after the agent exits (auto-stops after 5 min idle).
  let canvasUrl: string;
  try {
    const rec = await ensureDaemon(answers.folder);
    canvasUrl = rec.canvasUrl;
  } catch (err) {
    console.error(
      `  Couldn't start the canvas (${(err as Error).message}). ` +
        `Run \`velloo run ${answers.folder}\` yourself, then paste the prompt above.`,
    );
    return;
  }
  // Watching the agent design on the board is the best first-run demo — offer
  // it, but warn that the approval prompt is about to land in THIS terminal.
  const openCanvas = await confirm({
    message:
      "Open the board in your browser to watch? (your agent runs here in this terminal and may ask for MCP approval first)",
    initialValue: true,
  });
  if (!isCancel(openCanvas) && openCanvas) await openUrl(canvasUrl);
  console.log("");
  console.log(`  Canvas running at ${pc.cyan(canvasUrl)}.`);
  console.log(
    pc.dim(
      `  Launching ${launcher.label} here — it may ask you to approve the velloo MCP server first.`,
    ),
  );
  await Bun.spawn(launcher.argv(finalPrompt), {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).exited;
}
