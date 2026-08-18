import pc from "picocolors";

/**
 * Compact figlet-style velloo wordmark printed at the top of the
 * interactive wizard. The letterforms use only basic ASCII (figlet
 * "slant") so every monospace font renders them identically — earlier
 * block/box-drawing variants stuttered in fonts where `█` and `╗` had
 * mismatched widths. The two sparkle glyphs sit in trailing whitespace
 * with nothing after them, so even a font that renders them double-width
 * can't push the letters out of alignment.
 */
const ASCII = String.raw`
                ____             ✦
    _   _____  / / /___  ____   ✧
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
