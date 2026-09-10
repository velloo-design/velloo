import type { KeyboardEvent } from "react";

/**
 * Cmd/Ctrl+Enter submits, in every draft box that has a submit button.
 *
 * Enter alone stays a newline — these are all multi-line bodies — so the
 * shortcut is the only way to send from the keyboard, and it has to mean the
 * same thing in all of them. One helper rather than the handler written out
 * per box is what keeps that true as boxes are added.
 */
export function submitOnModEnter(submit: () => void): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    submit();
  };
}
