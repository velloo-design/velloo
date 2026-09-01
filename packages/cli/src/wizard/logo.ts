import pc from "picocolors";

/**
 * Init banner: thick interlinked frames (roman `8`/`o`/`d`/`P`/`Y`/`b`
 * strokes, coral over amber at the top crossing) + a solid roman-figlet
 * `velloo` wordmark (the `oo` in amber then coral) + the official tagline.
 *
 *   .o8888888o.
 *  d88       88b
 *  88    .o8888888o.
 *  88   d88   88  88b  oooo    ooo .ooooo.  888  888  .ooooo.   .ooooo.
 *  88   88    88   88   `88.  .8' d88' `88b 888  888 d88' `88b d88' `88b
 *  Y88  88   88P   88    `88..8'  888ooo888 888  888 888   888 888   888
 *   `o8888888P'    88     `888'   888    .o 888  888 888   888 888   888
 *       Y88       88P      `8'    `Y8bod8P'o888oo888o`Y8bod8P' `Y8bod8P'
 *        `o8888888P'
 */
type Frame = "amber" | "coral";

/** Brand duotone — guidelines: amber #FFAB1F, coral #FF6F4D. */
const RGB: Record<Frame, readonly [number, number, number]> = {
  amber: [255, 171, 31],
  coral: [255, 111, 77],
};
/** Closest 256-color cubes when truecolor isn't available. */
const ANSI256: Record<Frame, number> = { amber: 214, coral: 209 };

const TAGLINE = "Design like a developer. Build like a designer.";

const V = [
  "           ",
  "           ",
  "oooo    ooo",
  " `88.  .8' ",
  "  `88..8'  ",
  "   `888'   ",
  "    `8'    ",
] as const;
const E = [
  "         ",
  "         ",
  " .ooooo. ",
  "d88' `88b",
  "888ooo888",
  "888    .o",
  "`Y8bod8P'",
] as const;
const L = ["oooo ", "`888 ", " 888 ", " 888 ", " 888 ", " 888 ", "o888o"] as const;
const O = [
  "         ",
  "         ",
  " .ooooo. ",
  "d88' `88b",
  "888   888",
  "888   888",
  "`Y8bod8P'",
] as const;

/** 9×18 mark. `c` coral, `a` amber, space unpainted. */
const MARK = [
  " .o8888888o.      ",
  "d88       88b     ",
  "88    .o8888888o. ",
  "88   d88   88  88b",
  "88   88    88   88",
  "Y88  88   88P   88",
  " `o8888888P'    88",
  "     Y88       88P",
  "      `o8888888P' ",
] as const;
const MARK_OWN = [
  " ccccccccccc      ",
  "ccc       ccc     ",
  "cc    aaaaaccaaaa ",
  "cc   aaa   cc  aaa",
  "cc   aa    cc   aa",
  "ccc  aa   ccc   aa",
  " ccccaaccccc    aa",
  "     aaa       aaa",
  "      aaaaaaaaaaa ",
] as const;

function supportsTruecolor(): boolean {
  const colorterm = process.env.COLORTERM ?? "";
  if (/truecolor|24bit/i.test(colorterm)) return true;
  if (process.env.TERM_PROGRAM === "Apple_Terminal") return false;
  const program = process.env.TERM_PROGRAM ?? "";
  if (["iTerm.app", "vscode", "ghostty", "WarpTerminal", "WezTerm"].includes(program)) {
    return true;
  }
  return /truecolor|-direct$/i.test(process.env.TERM ?? "");
}

function paint(frame: Frame, text: string): string {
  if (!text || !pc.isColorSupported) return text;
  if (supportsTruecolor()) {
    const [r, g, b] = RGB[frame];
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
  }
  return `\x1b[38;5;${ANSI256[frame]}m${text}\x1b[39m`;
}

function paintMarkRow(chars: string, owners: string): string {
  let out = "";
  let i = 0;
  while (i < chars.length) {
    const who = owners[i];
    let j = i + 1;
    while (j < owners.length && owners[j] === who) j++;
    const slice = chars.slice(i, j);
    out += who === "c" ? paint("coral", slice) : who === "a" ? paint("amber", slice) : slice;
    i = j;
  }
  return out;
}

export function renderLogo(): string {
  const pad = "  ";
  const gap = "  ";
  const rows = MARK.map((chars, i) => {
    const mark = paintMarkRow(chars, MARK_OWN[i] ?? "");
    const k = i - 1;
    const v = V[k];
    const o = O[k];
    const right =
      v === undefined || o === undefined
        ? ""
        : `${gap}${pc.bold(`${v}${E[k]}${L[k]}${L[k]}`)}${paint("amber", o)} ${paint("coral", o)}`;
    return `${pad}${mark}${right}`;
  });
  return [...rows, "", pad + pc.dim(TAGLINE)].join("\n");
}

/** Print the lockup + tagline. Color falls off with picocolors when unsupported. */
export function printLogo(): void {
  console.log("");
  console.log(renderLogo());
  console.log("");
}
