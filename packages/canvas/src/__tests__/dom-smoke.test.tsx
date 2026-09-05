import { expect, test } from "bun:test";
import { useState } from "react";
import { $, domSuite, interact, mount, press, text, typeInto } from "./dom.ts";

function Counter() {
  const [n, setN] = useState(0);
  return (
    <div>
      <span data-testid="n">{n}</span>
      <button type="button" onClick={() => setN((v) => v + 1)}>
        bump
      </button>
      <input aria-label="name" onChange={(e) => setN(e.target.value.length)} />
    </div>
  );
}

domSuite("the DOM harness itself", () => {
  test("mounts, clicks, types, and flushes state", async () => {
    const view = await mount(<Counter />);
    try {
      expect(text($('[data-testid="n"]'))).toBe("0");

      const button = view.host.querySelector("button");
      await interact(() => button?.click());
      expect(text($('[data-testid="n"]'))).toBe("1");

      const input = view.host.querySelector("input") as HTMLInputElement;
      await interact(() => typeInto(input, "abcd"));
      expect(text($('[data-testid="n"]'))).toBe("4");
    } finally {
      await view.unmount();
    }
  });

  test("delivers keyboard events", async () => {
    let seen = "";
    const view = await mount(
      // biome-ignore lint/a11y/noStaticElementInteractions: a keydown probe, not a control.
      <div onKeyDown={(e) => (seen = e.key)} data-testid="box" />,
    );
    try {
      await interact(() => press(view.host.firstElementChild as Element, "Escape"));
      expect(seen).toBe("Escape");
    } finally {
      await view.unmount();
    }
  });
});
