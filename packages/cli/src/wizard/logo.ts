import pc from "picocolors";

// ✦ ✧ — the two sparkle glyphs, injected via interpolation (see below).
const [SPARKLE_HI, SPARKLE_LO] = ["✦", "✧"];

/**
 * Compact figlet-style velloo wordmark printed at the top of the
 * interactive wizard. The letterforms use only basic ASCII (figlet
 * "slant") so every monospace font renders them identically — earlier
 * block/box-drawing variants stuttered in fonts where `█` and `╗` had
 * mismatched widths. The two sparkle glyphs sit in trailing whitespace
 * with nothing after them, so even a font that renders them double-width
 * can't push the letters out of alignment.
 *
 * `String.raw` is required so the slant letterforms' `\` survive verbatim,
 * but it also means any literal non-ASCII in the template is at the mercy
 * of the bundler: Bun.build rewrites a literal glyph to its `\u`-escape
 * source text, which String.raw then preserves *uninterpreted* — so the
 * published binary would print the six characters of the escape (e.g.
 * a backslash, `u`, then the hex code point) rather than the glyph. The
 * sparkles therefore come in through `${}` substitutions (cooked, not
 * raw), which keeps them correct after bundling.
 */
const ASCII = String.raw`
                ____             ${SPARKLE_HI}
    _   _____  / / /___  ____   ${SPARKLE_LO}
   | | / / _ \/ / / __ \/ __ \
   | |/ /  __/ / / /_/ / /_/ /
   |___/\___/_/_/\____/\____/
`.replace(/^\n|\n$/g, "");

const TAGLINE = "designs that ship";

/**
 * Print the logo + tagline to stdout. Uses picocolors so terminals
 * without color support get plain text instead of escape sequences.
 */
export function printLogo(): void {
  console.log("");
  console.log(pc.magenta(ASCII));
  console.log(pc.dim(`   ${TAGLINE}`));
  console.log("");
}
