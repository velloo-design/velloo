/**
 * Sample snippets shipped by `velloo init`. The welcome sample uses three:
 * stat-card (dashboard tiles), feature-row (landing features), and
 * sidebar-nav-row (every app screen's sidebar). Definitions live as JSON
 * under ./pulse/snippets/ so they can be iterated on in the canvas and
 * re-copied here.
 */
import type { Snippet } from "@velloo/schema";

import featureRow from "./pulse/snippets/feature-row.json" with { type: "json" };
import sidebarNavRow from "./pulse/snippets/sidebar-nav-row.json" with { type: "json" };
import statCard from "./pulse/snippets/stat-card.json" with { type: "json" };

export function buildSampleSnippets(): Snippet[] {
  return [statCard as Snippet, featureRow as Snippet, sidebarNavRow as Snippet];
}
