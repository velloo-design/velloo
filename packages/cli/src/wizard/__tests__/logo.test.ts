import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderLogo } from "../logo.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI color escape codes are this pattern's literal target.
const ANSI = /\x1b\[[0-9;]*m/g;

function colorless(): string {
  return renderLogo().replace(ANSI, "");
}

const LOCKUP = [
  "   .o8888888o.      ",
  "  d88       88b                           oooo oooo                    ",
  "  88    .o8888888o.                       `888 `888                    ",
  "  88   d88   88  88b  oooo    ooo .ooooo.  888  888  .ooooo.   .ooooo. ",
  "  88   88    88   88   `88.  .8' d88' `88b 888  888 d88' `88b d88' `88b",
  "  Y88  88   88P   88    `88..8'  888ooo888 888  888 888   888 888   888",
  "   `o8888888P'    88     `888'   888    .o 888  888 888   888 888   888",
  "       Y88       88P      `8'    `Y8bod8P'o888oo888o`Y8bod8P' `Y8bod8P'",
  "        `o8888888P' ",
  "",
  "  Design like a developer. Build like a designer.",
].join("\n");

describe("init logo", () => {
  test("is the thick interlinked-frames lockup plus a solid roman velloo wordmark", () => {
    expect(colorless()).toBe(LOCKUP);
  });

  test("the two frames pass through each other", () => {
    expect(colorless()).toContain("88   88    88   88");
  });

  test("paints brand amber and coral when color is on", async () => {
    const logoPath = resolve(import.meta.dir, "../logo.ts");
    const env: Record<string, string | undefined> = {
      ...process.env,
      FORCE_COLOR: "1",
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
      TERM_PROGRAM: "vscode",
    };
    delete env.NO_COLOR;
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `import { renderLogo } from ${JSON.stringify(logoPath)}; process.stdout.write(renderLogo())`,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(stdout).toContain("\x1b[38;2;255;171;31m"); // amber #FFAB1F
    expect(stdout).toContain("\x1b[38;2;255;111;77m"); // coral #FF6F4D
  });
});
