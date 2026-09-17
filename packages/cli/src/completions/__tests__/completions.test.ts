import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completionsInstalled, detectShell, installCompletions } from "../install.ts";
import { completionScript } from "../script.ts";
import { commandSpecs } from "../spec.ts";

const specs = await commandSpecs();

/**
 * Check a script with the shell's own parser (`-n`). Locally a missing shell
 * skips the check; Linux CI installs all three, so there a missing one is a
 * failure rather than a pass that never ran. The Windows runners have none.
 */
async function assertParses(shell: "zsh" | "bash" | "fish", script: string): Promise<void> {
  if (!Bun.which(shell)) {
    if (process.env.CI && process.platform !== "win32") {
      throw new Error(`${shell} is not installed; CI must install it`);
    }
    return;
  }
  const file = join(await mkdtemp(join(tmpdir(), "velloo-comp-")), `completions.${shell}`);
  await writeFile(file, script);
  const proc = Bun.spawn([shell, "-n", file], { stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(await new Response(proc.stderr).text());
}

describe("commandSpecs", () => {
  test("covers the public commands and skips internal ones", () => {
    const names = specs.map((s) => s.name);
    for (const expected of ["init", "connect", "run", "status", "theme", "completions"]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("ci");
    expect(names).not.toContain("__daemon");
  });

  test("subcommands carry their own flags", () => {
    const theme = specs.find((s) => s.name === "theme");
    const exportTheme = theme?.subcommands.find((s) => s.name === "export");
    expect(exportTheme?.flags.map((f) => f.flag)).toContain("--design");
    const publish = specs.find((s) => s.name === "publish");
    expect(publish?.subcommands.map((s) => s.name)).toEqual(["list", "remove"]);
    expect(publish?.flags.map((f) => f.flag)).toContain("--visibility");
  });

  test("flags are kebab-case; default-true booleans surface as --no-", () => {
    const init = specs.find((s) => s.name === "init");
    const flags = init?.flags.map((f) => f.flag) ?? [];
    expect(flags).toContain("--force");
    expect(flags).toContain("--design-folder");
    // `connect` defaults to true — the only form worth completing is --no-connect.
    expect(flags).toContain("--no-connect");
    expect(flags).not.toContain("--connect");
    expect(init?.flags.find((f) => f.flag === "--design-folder")?.takesValue).toBe(true);
    expect(init?.flags.find((f) => f.flag === "--force")?.takesValue).toBe(false);
    const run = specs.find((s) => s.name === "run");
    const runFlags = run?.flags.map((f) => f.flag) ?? [];
    expect(runFlags).toContain("--background");
    expect(runFlags).toContain("--open");
    expect(runFlags).not.toContain("--no-open");
  });

  test("descriptions are single-line and free of spec-breaking characters", () => {
    for (const s of specs.flatMap((spec) => [spec, ...spec.subcommands])) {
      for (const text of [s.description, ...s.flags.map((f) => f.description)]) {
        expect(text).not.toMatch(/[\n'"[\]:`$\\]/);
      }
    }
  });
});

describe("completionScript", () => {
  test("zsh script offers subcommands and parses under zsh -n", async () => {
    const script = completionScript("zsh", specs);
    expect(script).toContain("#compdef velloo");
    expect(script).toContain("_describe 'velloo theme command'");
    expect(script).toContain("'--force[");
    await assertParses("zsh", script);
  });

  test("bash script lists commands + flags and parses under bash -n", async () => {
    const script = completionScript("bash", specs);
    expect(script).toContain("complete -o default -F _velloo velloo");
    expect(script).toContain("init login");
    expect(script).toContain("--design-folder");
    expect(script).toContain('subs="install"');
    await assertParses("bash", script);
  });

  test("fish script declares subcommands and value flags with -r, and parses under fish -n", async () => {
    const script = completionScript("fish", specs);
    expect(script).toContain('-a "init"');
    expect(script).toContain('-n "__velloo_is init"');
    expect(script).toContain('-n "__velloo_is theme export" -l design -r');
    expect(script).toContain("-l design-folder -r");
    expect(script).toContain("-l force -d");
    await assertParses("fish", script);
  });
});

describe("detectShell", () => {
  test("reads $SHELL and rejects unsupported shells", () => {
    expect(detectShell({ SHELL: "/bin/zsh" })).toBe("zsh");
    expect(detectShell({ SHELL: "/usr/local/bin/fish" })).toBe("fish");
    expect(detectShell({ SHELL: "/bin/tcsh" })).toBeNull();
    expect(detectShell({})).toBeNull();
  });
});

describe("installCompletions", () => {
  test("zsh install writes the script and appends one guarded rc line, idempotently", async () => {
    const home = await mkdtemp(join(tmpdir(), "velloo-comp-home-"));
    await writeFile(join(home, ".zshrc"), "export FOO=1\n");

    expect(completionsInstalled(home)).toBe(false);
    const r = await installCompletions("zsh", home);
    expect(r.rcUpdated).toBe(true);
    expect(completionsInstalled(home, "zsh")).toBe(true);

    const rc = await readFile(join(home, ".zshrc"), "utf8");
    expect(rc).toContain("export FOO=1");
    expect(rc).toContain('source "$HOME/.velloo/completions/velloo.zsh"');
    expect(rc).toContain("# velloo completions");

    // Re-running refreshes the script but never duplicates the rc line.
    const again = await installCompletions("zsh", home);
    expect(again.rcUpdated).toBe(false);
    const rc2 = await readFile(join(home, ".zshrc"), "utf8");
    expect(rc2.split("# velloo completions").length).toBe(2);
  });

  test("fish install is file-only (autoloaded, no rc edit)", async () => {
    const home = await mkdtemp(join(tmpdir(), "velloo-comp-home-"));
    const r = await installCompletions("fish", home);
    expect(r.rcPath).toBeUndefined();
    const script = await readFile(
      join(home, ".config", "fish", "completions", "velloo.fish"),
      "utf8",
    );
    expect(script).toContain("complete -c velloo");
  });

  test("bash install creates the rc when missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "velloo-comp-home-"));
    const r = await installCompletions("bash", home);
    expect(r.rcUpdated).toBe(true);
    const rc = await readFile(join(home, ".bashrc"), "utf8");
    expect(rc).toContain('source "$HOME/.velloo/completions/velloo.bash"');
  });
});
