import { expect, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { MCP_SERVER_INFO, SERVER_VERSION } from "../version.ts";

/**
 * The handshake version was a hardcoded "0.1.0" in two files, so it could not
 * have tracked a release even in principle. These assert it is derived, and
 * that both MCP entry points now read the same constant — a second literal
 * would drift again the moment one of them is edited.
 */
test("the announced version comes from the package, not a literal", () => {
  // From source there is no build define, so the fallback is what runs here.
  expect(SERVER_VERSION).toBe(pkg.version);
  expect(MCP_SERVER_INFO).toEqual({ name: "velloo", version: pkg.version });
});

test("no MCP entry point declares its own version literal", async () => {
  for (const path of ["src/mcp/server.ts", "src/mcp/format-gate.ts"]) {
    const source = await Bun.file(new URL(`../../${path}`, import.meta.url)).text();
    expect(source).toContain("MCP_SERVER_INFO");
    expect(source).not.toMatch(/name:\s*"velloo",\s*version:/);
  }
});
