import { resolve } from "node:path";
import type { AssetsFile, CanvasNote, Theme } from "@velloo/schema";
import type { LibraryId } from "../wizard/answers.ts";
import sources from "./elsewhere/ASSET-SOURCES.md" with { type: "text" };
import elsewhere_alps from "./elsewhere/assets/elsewhere-alps.jpg" with { type: "file" };
import elsewhere_bali from "./elsewhere/assets/elsewhere-bali.jpg" with { type: "file" };
import elsewhere_forest from "./elsewhere/assets/elsewhere-forest.jpg" with { type: "file" };
import elsewhere_japan from "./elsewhere/assets/elsewhere-japan.jpg" with { type: "file" };
import elsewhere_kyoto from "./elsewhere/assets/elsewhere-kyoto.jpg" with { type: "file" };
import elsewhere_kyoto_map from "./elsewhere/assets/elsewhere-kyoto-map.svg" with { type: "file" };
import elsewhere_room from "./elsewhere/assets/elsewhere-room.jpg" with { type: "file" };
import provenance from "./elsewhere/assets.json" with { type: "json" };
import notes from "./elsewhere/boards/elsewhere-details.notes.json" with { type: "json" };
import customCss from "./elsewhere/theme/custom.css" with { type: "text" };
import { nativeElsewhere } from "./elsewhere-native.ts";
import { buildSampleBoards, buildSampleScreens } from "./sample-page.ts";
import { buildSampleSnippets } from "./sample-snippets.ts";
import type { Scaffold } from "./scaffold.ts";

export function buildElsewhereScaffold(library: LibraryId, theme: Theme): Scaffold {
  const screens = buildSampleScreens();
  const snippets = buildSampleSnippets();
  const native =
    library === "shadcn-upstream" ? undefined : nativeElsewhere(library, screens, snippets);
  return {
    theme,
    screens: native?.screens ?? screens,
    snippets: native?.snippets ?? snippets,
    boards: buildSampleBoards(),
    annotations: [],
    notes: [{ boardId: "elsewhere-details", entries: structuredClone(notes) as CanvasNote[] }],
    customCss: `${customCss}\n${native?.css ?? ""}`,
    assetMetadata: structuredClone(provenance) as AssetsFile,
    assetFiles: {
      "assets/elsewhere-alps.jpg": resolve(import.meta.dir, elsewhere_alps),
      "assets/elsewhere-bali.jpg": resolve(import.meta.dir, elsewhere_bali),
      "assets/elsewhere-forest.jpg": resolve(import.meta.dir, elsewhere_forest),
      "assets/elsewhere-japan.jpg": resolve(import.meta.dir, elsewhere_japan),
      "assets/elsewhere-kyoto-map.svg": resolve(import.meta.dir, elsewhere_kyoto_map),
      "assets/elsewhere-kyoto.jpg": resolve(import.meta.dir, elsewhere_kyoto),
      "assets/elsewhere-room.jpg": resolve(import.meta.dir, elsewhere_room),
    },
    documents: { "ASSET-SOURCES.md": sources },
  };
}
