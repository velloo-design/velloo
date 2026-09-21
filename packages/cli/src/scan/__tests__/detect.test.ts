import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHost } from "../detect.ts";

/**
 * detectHost infers the host app's UI framework (the "existing project" flow)
 * so a scanned folder defaults to the matching adapter — MUI app ⇒ MUI.
 */

let tmp: string;

async function writePkg(deps: Record<string, string>): Promise<void> {
  await writeFile(join(tmp, "package.json"), JSON.stringify({ dependencies: deps }), "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("detectHost uiLibrary", () => {
  test("a @mui/material dependency ⇒ mui", async () => {
    await writePkg({ "@mui/material": "^6.1.0", react: "19.2.6" });
    expect(detectHost(tmp).uiLibrary).toBe("mui");
  });

  test("a components.json (shadcn) ⇒ shadcn", async () => {
    await writePkg({ react: "19.2.6", tailwindcss: "^4.0.0" });
    await writeFile(join(tmp, "components.json"), JSON.stringify({ style: "new-york" }), "utf8");
    const detected = detectHost(tmp);
    expect(detected.uiLibrary).toBe("shadcn");
    expect(detected.shadcn).toBe(true);
  });

  test("MUI wins over a stray components.json", async () => {
    await writePkg({ "@mui/material": "^6", react: "19.2.6" });
    await writeFile(join(tmp, "components.json"), JSON.stringify({ style: "default" }), "utf8");
    expect(detectHost(tmp).uiLibrary).toBe("mui");
  });

  test("an antd dependency ⇒ antd (a concrete install, like MUI)", async () => {
    await writePkg({ antd: "^5.20.0", react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBe("antd");
    expect(d.unsupportedUi).toBeUndefined();
  });

  test("antd (a real dependency) wins over a stray components.json; MUI wins over antd", async () => {
    await writePkg({ antd: "^5.20.0", react: "19.2.6" });
    await writeFile(join(tmp, "components.json"), JSON.stringify({ style: "default" }), "utf8");
    expect(detectHost(tmp).uiLibrary).toBe("antd");
    await writePkg({ antd: "^5.20.0", "@mui/material": "^6", react: "19.2.6" });
    expect(detectHost(tmp).uiLibrary).toBe("mui");
  });

  test("neither ⇒ undefined (caller keeps the default library)", async () => {
    await writePkg({ react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBeUndefined();
    expect(d.unsupportedUi).toBeUndefined();
  });

  test("a @chakra-ui/react dependency ⇒ chakra (adopted, no longer 'unsupported')", async () => {
    await writePkg({ "@chakra-ui/react": "^2.8.0", react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBe("chakra");
    expect(d.unsupportedUi).toBeUndefined();
  });

  test("chakra (a real dependency) wins over a stray components.json; antd wins over chakra", async () => {
    await writePkg({ "@chakra-ui/react": "^2.8.0", react: "19.2.6" });
    await writeFile(join(tmp, "components.json"), JSON.stringify({ style: "default" }), "utf8");
    expect(detectHost(tmp).uiLibrary).toBe("chakra");
    await writePkg({ antd: "^5.20.0", "@chakra-ui/react": "^2.8.0", react: "19.2.6" });
    expect(detectHost(tmp).uiLibrary).toBe("antd");
  });

  test("an unadapted framework still ⇒ unsupportedUi for the no-framework fallback", async () => {
    await writePkg({ "@mantine/core": "^7.0.0", react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBeUndefined();
    expect(d.unsupportedUi).toBe("Mantine");
  });

  test("a supported lib suppresses the unsupported signal", async () => {
    await writePkg({ "@mui/material": "^6", "@mantine/core": "^7", react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBe("mui");
    expect(d.unsupportedUi).toBeUndefined();
  });
});

describe("detectHost designMdPath", () => {
  const DESIGN_MD = `---
name: Acme
colors:
  primary: "#4f46e5"
---

## Overview

Calm.
`;

  test("finds a DESIGN.md at the app root", async () => {
    await writePkg({ react: "19.2.6" });
    await writeFile(join(tmp, "DESIGN.md"), DESIGN_MD, "utf8");
    expect(detectHost(tmp).designMdPath).toBe(join(tmp, "DESIGN.md"));
  });

  test("finds one at the repo root above the app", async () => {
    const app = join(tmp, "apps", "web");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "package.json"), "{}", "utf8");
    await writeFile(join(tmp, "apps", "DESIGN.md"), DESIGN_MD, "utf8");
    expect(detectHost(app).designMdPath).toBe(join(app, "..", "DESIGN.md"));
  });

  test("ignores a DESIGN.md that is an architecture document", async () => {
    // Plenty of repos keep one; it has no frontmatter and no tokens, and
    // treating it as a design system would theme the canvas from nothing.
    await writePkg({ react: "19.2.6" });
    await writeFile(join(tmp, "DESIGN.md"), "# Design\n\nWe use a queue.\n", "utf8");
    expect(detectHost(tmp).designMdPath).toBeUndefined();
  });

  test("ignores frontmatter without the required name", async () => {
    await writePkg({ react: "19.2.6" });
    await writeFile(join(tmp, "DESIGN.md"), "---\ntitle: nope\n---\n", "utf8");
    expect(detectHost(tmp).designMdPath).toBeUndefined();
  });

  test("absent ⇒ undefined, and the stylesheet path is unaffected", async () => {
    await writePkg({ react: "19.2.6" });
    expect(detectHost(tmp).designMdPath).toBeUndefined();
  });
});
