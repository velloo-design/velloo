import { useEffect } from "react";

/**
 * An app modal, behaving like the real ones: its content ends up at the body
 * rather than where the component sits, and while it is open the page behind
 * it stops taking pointer events. Radix, Headless UI and react-aria all do
 * both — through `createPortal`, which lands in exactly the same place this
 * does, and which the fixture avoids only because react-dom isn't resolvable
 * from this package.
 */
export function Overlay({ title = "Confirm" }: { title?: string }) {
  useEffect(() => {
    const node = document.createElement("div");
    node.setAttribute("data-fixture-overlay", "");
    node.className = "fx-overlay";
    node.textContent = title;
    document.body.appendChild(node);
    document.body.style.pointerEvents = "none";
    return () => {
      node.remove();
      document.body.style.pointerEvents = "";
    };
  }, [title]);
  return null;
}
