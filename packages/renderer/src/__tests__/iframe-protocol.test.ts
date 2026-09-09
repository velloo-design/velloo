import { describe, expect, test } from "bun:test";
import { CANVAS_RUNTIME } from "../canvas-runtime.ts";
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

/**
 * Only one tree in the document may answer to node identity.
 *
 * The repo-backed canvas mount leaves the SSR tree in place, hidden, so a
 * failed mount can restore it. While it is there wearing the same
 * `data-node-path`s, every consumer that resolves a path to ONE element takes
 * the `display:none` copy: rects come back 0x0 (the resize grips collapse onto
 * the frame corner), computed values are read off an unrendered node, and the
 * capture path's clip locator waits for a hidden element until it times out.
 *
 * The mount strips those attributes off the hidden copy the moment it commits,
 * which is the only fix that reaches the Playwright consumers too — they use
 * their own selectors, not our lookups.
 */
describe("only the rendered tree answers to node identity", () => {
  test("committing the mount strips identity from the hidden SSR copy", () => {
    const settle = extractFrom(CANVAS_RUNTIME, "settleOnMount");
    expect(settle).toContain('ssr.style.display = "none"');
    expect(settle).toContain("dropIdentity(ssr)");
  });

  test("dropIdentity (extracted, real shipped code) clears every identifying attribute", () => {
    const removed: [string, string][] = [];
    const node = (name: string) => ({
      removeAttribute: (attr: string) => removed.push([name, attr]),
    });
    const child = node("child");
    const root = { ...node("root"), querySelectorAll: () => [child] };
    const dropIdentity = new Function(
      `${extractFrom(CANVAS_RUNTIME, "dropIdentity")}
       var IDENTITY_ATTRS = ["data-node-path", "data-snippet-id", "data-snippet-path"];
       return dropIdentity;`,
    )() as (el: unknown) => void;
    dropIdentity(root);
    expect(removed).toEqual([
      ["child", "data-node-path"],
      ["child", "data-snippet-id"],
      ["child", "data-snippet-path"],
      ["root", "data-node-path"],
      ["root", "data-snippet-id"],
      ["root", "data-snippet-path"],
    ]);
  });

  test("a failed mount leaves the SSR tree's identity alone — it is the rendered one", () => {
    const settle = extractFrom(CANVAS_RUNTIME, "settleOnSsr");
    expect(settle).not.toContain("dropIdentity");
    expect(settle).toContain('ssr.style.display = ""');
  });

  test("the selector the strip removes is the one the runtime looks up by", () => {
    // Drift here is silent: the strip would clear attributes nothing reads,
    // and the runtime would keep resolving to the hidden copy.
    for (const attr of ["data-node-path", "data-snippet-id", "data-snippet-path"]) {
      expect(CANVAS_RUNTIME).toContain(attr);
      expect(IFRAME_RUNTIME).toContain(attr);
    }
  });

  test("pathSelector escapes a quote in the path", () => {
    const pathSelector = build<(path: string) => string>("pathSelector");
    expect(pathSelector("0.1")).toBe('[data-node-path="0.1"]');
    expect(pathSelector('a"b')).toBe('[data-node-path="a\\"b"]');
  });
});

/** Pull a top-level `function <name>(…) { … }` out of a runtime by brace-balancing. */
function extractFrom(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/** The real shipped function, compiled on its own. */
function build<T>(name: string): T {
  return new Function(`${extractFrom(IFRAME_RUNTIME, name)}; return ${name};`)() as T;
}
