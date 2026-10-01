import * as React from "react";

/**
 * A host app's live-island component, for a capture that must prove the island
 * actually ran. Deliberately a flat unmistakable colour: the static placeholder
 * this falls back to is text on white, so one look at the pixels settles it.
 * React resolves from the workspace root, as it would from a real app's own
 * node_modules.
 */
export function Sparkline() {
  return React.createElement("div", {
    style: { background: "#ff00aa", width: "100%", height: "160px" },
  });
}
