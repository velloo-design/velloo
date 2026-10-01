import { describe, expect, test } from "bun:test";
import { ANTD_MANIFEST } from "../manifest.ts";

/**
 * A listed component warns on every prop it doesn't list, so a real antd prop
 * missing here reads to the agent as a prop antd lacks. These are props agents
 * reached for and were told were unknown, plus their neighbours from the same
 * audit against antd's own `<Name>Props` types.
 */
const REAL_PROPS: Record<string, string[]> = {
  Progress: ["strokeColor", "trailColor", "size", "showInfo", "strokeWidth", "steps"],
  Statistic: ["valueStyle", "precision", "prefix", "suffix"],
  Tag: ["bordered", "icon", "closable"],
  Card: ["styles", "variant", "hoverable", "cover", "actions"],
  Button: ["icon", "shape", "loading", "variant", "htmlType"],
  Input: ["prefix", "suffix", "allowClear", "status", "variant"],
  Badge: ["status", "text", "color", "showZero"],
  Avatar: ["shape", "icon"],
  Row: ["align", "justify"],
  TypographyText: ["italic", "underline", "ellipsis"],
};

describe("antd manifest", () => {
  test.each(Object.entries(REAL_PROPS))("%s lists antd's real props", (id, props) => {
    const descriptor = ANTD_MANIFEST.find((c) => c.id === id);
    expect(descriptor).toBeDefined();
    const names = new Set(descriptor?.props.map((p) => p.name));
    expect(props.filter((name) => !names.has(name))).toEqual([]);
  });

  test("no component lists a prop twice", () => {
    for (const descriptor of ANTD_MANIFEST) {
      const names = descriptor.props.map((p) => p.name);
      expect({ id: descriptor.id, dupes: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({
        id: descriptor.id,
        dupes: [],
      });
    }
  });
});
