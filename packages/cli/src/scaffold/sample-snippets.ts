/** Elsewhere: the canonical welcome design shared by every provider. */
import type { Snippet } from "@velloo/schema";
import elsewhere_destination from "./elsewhere/snippets/elsewhere-destination.json" with {
  type: "json",
};
import elsewhere_metric from "./elsewhere/snippets/elsewhere-metric.json" with { type: "json" };
import elsewhere_nav from "./elsewhere/snippets/elsewhere-nav.json" with { type: "json" };
export function buildSampleSnippets(): Snippet[] {
  return structuredClone([elsewhere_destination, elsewhere_metric, elsewhere_nav] as Snippet[]);
}
