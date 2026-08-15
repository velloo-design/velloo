import { describe, expect, test } from "bun:test";
import {
  CHILD_MESSAGE_TYPES,
  INIT_MESSAGE_TYPE,
  PARENT_MESSAGE_TYPES,
  PROTOCOL_VERSION,
} from "../iframe-protocol.ts";
import { IFRAME_RUNTIME } from "../iframe-runtime.ts";

/**
 * The iframe runtime is a raw JS string, so nothing type-checks it
 * against the protocol unions. This suite greps the source for message
 * literals: a message the runtime sends must exist in ChildMessage, a
 * message it handles must exist in ParentMessage — and vice versa, so a
 * union member the runtime forgot about fails too.
 */

function unique(matches: IterableIterator<RegExpMatchArray>): string[] {
  return [...new Set([...matches].map((m) => m[1] as string))].sort();
}

describe("iframe runtime ↔ protocol parity", () => {
  test("every message the runtime sends is a ChildMessage, and all ChildMessages are sent", () => {
    const sent = unique(
      IFRAME_RUNTIME.matchAll(/(?:send|port\.postMessage)\(\{ type: '([a-zA-Z]+)'/g),
    );
    expect(sent).toEqual([...CHILD_MESSAGE_TYPES].sort());
  });

  test("every message the runtime handles is a ParentMessage, and all ParentMessages are handled", () => {
    const handled = unique(IFRAME_RUNTIME.matchAll(/msg\.type === '([a-zA-Z]+)'/g));
    expect(handled).toEqual([...PARENT_MESSAGE_TYPES].sort());
  });

  test("the handshake listens for the init envelope and embeds the current version", () => {
    expect(IFRAME_RUNTIME).toContain(`ev.data.type === '${INIT_MESSAGE_TYPE}'`);
    expect(IFRAME_RUNTIME).toContain(`const PROTOCOL_VERSION = ${PROTOCOL_VERSION};`);
    expect(IFRAME_RUNTIME).toContain("{ type: 'ready', version: PROTOCOL_VERSION }");
  });
});
