import pc from "picocolors";

/**
 * Compact figlet-style velloo wordmark printed at the top of the
 * interactive wizard. Uses only basic ASCII (figlet "slant") so every
 * monospace font renders it identically — earlier block/box-drawing
 * variants stuttered in fonts where `█` and `╗` had mismatched widths.
 */
const ASCII = String.raw`
                ____
    _   _____  / / /___  ____
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
