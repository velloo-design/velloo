import { defineCommand } from "citty";
import pc from "picocolors";
import { detectShell, installCompletions } from "../completions/install.ts";
import { completionScript, SHELLS, type Shell } from "../completions/script.ts";
import { commandSpecs } from "../completions/spec.ts";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "completions",
    description: "Shell TAB completions — print the script, or install it with --install",
  },
  args: {
    shell: {
      type: "positional",
      required: false,
      description: `Shell: ${SHELLS.join(" | ")} (default: detected from $SHELL)`,
    },
    install: {
      type: "boolean",
      default: false,
      description: "Write the script + wire it into your shell (idempotent)",
    },
  },
  async run({ args }) {
    const shell = (args.shell as Shell | undefined) ?? detectShell();
    if (!shell || !SHELLS.includes(shell)) {
      fail(
        "completions",
        `unsupported or undetected shell${args.shell ? ` "${args.shell}"` : ""} — pass one of: ${SHELLS.join(", ")}.`,
      );
    }

    if (!args.install) {
      // Print to stdout for manual wiring (`velloo completions zsh > _velloo`).
      console.log(completionScript(shell, await commandSpecs()));
      return;
    }

    const r = await installCompletions(shell);
    console.log("");
    console.log(pc.green(`✓ ${shell} completions installed.`));
    console.log(`    script   ${pc.cyan(r.scriptPath)}`);
    if (r.rcPath) {
      console.log(
        r.rcUpdated
          ? `    rc       ${pc.cyan(r.rcPath)} ${pc.dim("(source line appended)")}`
          : `    rc       ${pc.cyan(r.rcPath)} ${pc.dim("(already wired)")}`,
      );
    }
    console.log("");
    console.log(
      pc.dim(
        shell === "fish"
          ? "  New fish sessions pick it up automatically."
          : `  Restart your shell (or \`source ${r.rcPath}\`) to activate TAB completion.`,
      ),
    );
  },
});
