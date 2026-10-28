import type { ActivityEntry } from "./store/activity.ts";
import { useCanvas } from "./store.ts";
import { pushToast, toastError } from "./toast.ts";

/** What an agent does that changes the design language: its rules, or the theme they go with. */
const LANGUAGE_VERBS = new Set([
  "set_design_language",
  "import_theme",
  "set_token",
  "set_tokens",
  "set_fonts",
  "set_typeset",
  "set_radius",
  "set_custom_role",
  "custom_css",
  "apply_preset",
  "apply_starting_point",
  "derive_palette_from_color",
]);

const TOAST_ID = "design-language-changed";

function changesLanguage(entry: ActivityEntry): boolean {
  return (
    LANGUAGE_VERBS.has(entry.verb) || (entry.ops ?? []).some((op) => LANGUAGE_VERBS.has(op.verb))
  );
}

/** The agent's name as the Agent tab shows it, when the change came from there. */
function agentLabel(): string {
  const { agentSessions, agentActiveSessionId, agentProviders } = useCanvas.getState();
  const session = agentSessions.find((s) => s.id === agentActiveSessionId);
  const provider = agentProviders?.find((p) => p.id === session?.provider);
  return provider?.label ?? "Your agent";
}

/**
 * Say so when an agent changes the design language, and offer the stage where
 * the person reviews it. One toast however many changes follow, staying until
 * it is dismissed; none while the stage is already open, where the change
 * shows as it lands.
 */
export function announceLanguageChange(entry: ActivityEntry): void {
  if (entry.source !== "mcp" || !changesLanguage(entry)) return;
  if (useCanvas.getState().view === "language") return;
  const rules = entry.verb === "set_design_language";
  pushToast({
    id: TOAST_ID,
    title: `${agentLabel()} ${rules ? "proposed design rules" : "changed the design language"}`,
    message: "Review the theme and rules on a specimen of your components.",
    ttl: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: {
      label: "Review",
      onClick: () =>
        void useCanvas
          .getState()
          .openLanguage("review")
          .catch((err) => toastError(err, "Could not open the design language")),
    },
  });
}
