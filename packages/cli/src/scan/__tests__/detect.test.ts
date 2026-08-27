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

  test("a Chakra app ⇒ unsupportedUi (no supported lib) for the no-framework fallback", async () => {
    await writePkg({ "@chakra-ui/react": "^2.8.0", react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBeUndefined();
    expect(d.unsupportedUi).toBe("Chakra UI");
  });

  test("a supported lib suppresses the unsupported signal", async () => {
    await writePkg({ "@mui/material": "^6", "@chakra-ui/react": "^2", react: "19.2.6" });
    const d = detectHost(tmp);
    expect(d.uiLibrary).toBe("mui");
    expect(d.unsupportedUi).toBeUndefined();
  });
});
