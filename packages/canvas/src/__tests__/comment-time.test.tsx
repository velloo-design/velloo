import { expect, jest, test } from "bun:test";
import { domSuite, interact, mount, text } from "./dom.ts";

/**
 * The relative stamp on a comment, which is read at render — and a comment
 * pane sits open beside work that takes as long as it takes, with nothing
 * re-rendering it in the meantime. So the stamp has to age on its own, or it
 * reads "1m" for the rest of the afternoon.
 */

const { ThreadMessages } = await import("../components/comment-threads.tsx");

domSuite("relative comment stamps", () => {
  test("a stamp ages while the pane sits untouched", async () => {
    jest.useFakeTimers();
    try {
      const view = await mount(
        <ThreadMessages
          messages={[
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              author: { kind: "user" },
              body: "Tighten this",
              createdAt: new Date().toISOString(),
            },
          ]}
        />,
      );
      const stamp = () => text(view.host.querySelector('[data-slot="message-header"] span'));
      expect(stamp()).toBe("now");

      await interact(() => {
        jest.advanceTimersByTime(5 * 60_000);
      });
      expect(stamp()).toBe("5m");

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
