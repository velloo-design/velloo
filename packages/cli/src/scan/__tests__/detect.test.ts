import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHost, findComponentsDir } from "../detect.ts";
import { looksLikeUiApp } from "../routes.ts";

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

  test("a static site — an index.html and no script UI framework ⇒ html", async () => {
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5.4.10" } }),
      "utf8",
    );
    await writeFile(join(tmp, "index.html"), '<link rel="stylesheet" href="/style.css" />', "utf8");
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("an index.html that a script framework renders into is not a static site", async () => {
    await writeFile(join(tmp, "index.html"), '<div id="app"></div>', "utf8");
    for (const deps of [{ vue: "^3.5.0" }, { react: "19.2.6" }, { svelte: "^5.0.0" }]) {
      await writePkg(deps);
      expect(detectHost(tmp).uiLibrary).toBeUndefined();
    }
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

  /** Every case nests the app inside `tmp`, which stands in for the repo root. */
  let app: string;
  beforeEach(async () => {
    app = join(tmp, "app");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "package.json"), JSON.stringify({ dependencies: {} }), "utf8");
  });

  test("finds a DESIGN.md at the app root", async () => {
    await writeFile(join(app, "DESIGN.md"), DESIGN_MD, "utf8");
    expect(detectHost(app).designMdPath).toBe(join(app, "DESIGN.md"));
  });

  test("finds one at the repo root above the app", async () => {
    await writeFile(join(tmp, "DESIGN.md"), DESIGN_MD, "utf8");
    expect(detectHost(app, tmp).designMdPath).toBe(join(tmp, "DESIGN.md"));
  });

  test("does not look above the app when init runs in the app itself", async () => {
    await writeFile(join(tmp, "DESIGN.md"), DESIGN_MD, "utf8");
    expect(detectHost(app).designMdPath).toBeUndefined();
  });

  test("finds a prose-only file, as the design will when it follows one", async () => {
    await writeFile(
      join(app, "DESIGN.md"),
      "# Acme\n\n## Overview\n\nCalm.\n\n## Colors\n\nOne accent.\n\n## Typography\n\nInter.\n",
      "utf8",
    );
    expect(detectHost(app).designMdPath).toBe(join(app, "DESIGN.md"));
  });

  test("ignores a DESIGN.md that is an architecture document", async () => {
    // Plenty of repos keep one, and treating it as a design system would
    // point the design agents at someone's database notes.
    await writeFile(join(app, "DESIGN.md"), "# Design\n\nWe use a queue.\n", "utf8");
    expect(detectHost(app).designMdPath).toBeUndefined();
  });

  test("ignores frontmatter without the required name", async () => {
    await writeFile(join(app, "DESIGN.md"), "---\ntitle: nope\n---\n", "utf8");
    expect(detectHost(app).designMdPath).toBeUndefined();
  });

  test("absent ⇒ undefined", async () => {
    expect(detectHost(app).designMdPath).toBeUndefined();
  });
});

describe("findComponentsDir", () => {
  test("follows components.json's ui alias through the tsconfig paths", async () => {
    const app = join(tmp, "client-app");
    await mkdir(join(app, "src", "client", "components", "ui"), { recursive: true });
    await writeFile(
      join(app, "components.json"),
      JSON.stringify({ aliases: { components: "@/components", ui: "@/components/ui" } }),
    );
    await writeFile(
      join(app, "tsconfig.json"),
      '{ "compilerOptions": { "paths": { "@/*": ["./src/client/*"] } } } // jsonc',
    );
    expect(findComponentsDir(app)).toBe("src/client/components/ui");
  });

  test("falls back to the conventional places when the alias points nowhere", async () => {
    const app = join(tmp, "conventional-app");
    await mkdir(join(app, "components", "ui"), { recursive: true });
    await writeFile(join(app, "components.json"), JSON.stringify({ aliases: { ui: "@/ui" } }));
    expect(findComponentsDir(app)).toBe("components/ui");
  });
});

async function writeAt(rel: string, contents: string): Promise<void> {
  const path = join(tmp, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
}

describe("detectHost html", () => {
  test("a Go app writing htmx in its source ⇒ html, even with a Tailwind-only package.json", async () => {
    await writePkg({ tailwindcss: "^3.4.0", daisyui: "^4" });
    await writeAt("go.mod", "module example.com/app\n\ngo 1.23\n");
    await writeAt(
      "internal/view/web/dashboard/page.go",
      'package dashboard\n\nconst row = `<button hx-post="/backups/run">Run</button>`\n',
    );
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("a Go htmx app is a UI app, so init offers to start from it", async () => {
    // pgbackweb: a Tailwind-only package.json, no template directory, htmx in Go source.
    await writePkg({ tailwindcss: "^3.4.0" });
    await writeAt("go.mod", "module example.com/app\n");
    await writeAt(
      "internal/view/page.go",
      'package view\n\nconst b = `<button hx-get="/x">X</button>`\n',
    );
    expect(await looksLikeUiApp(tmp)).toBe(true);
  });

  test("a Go htmx or templ module in go.mod ⇒ html without reading the source", async () => {
    await writeAt(
      "go.mod",
      "module example.com/app\n\nrequire (\n\tgithub.com/a-h/templ v0.3.0\n)\n",
    );
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("a Go service with no markup is not html", async () => {
    await writeAt("go.mod", "module example.com/api\n");
    await writeAt("main.go", "package main\n\nfunc main() {}\n");
    expect(detectHost(tmp).uiLibrary).toBeUndefined();
  });

  test("htmx from npm ⇒ html", async () => {
    await writePkg({ "htmx.org": "^2.0.0" });
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("React outranks htmx: htmx beside React is an add-on", async () => {
    await writePkg({ "htmx.org": "^2.0.0", react: "19.2.6", "react-dom": "19.2.6" });
    expect(detectHost(tmp).uiLibrary).toBeUndefined();
    await writePkg({ "htmx.org": "^2.0.0", next: "16.0.0" });
    expect(detectHost(tmp).uiLibrary).toBeUndefined();
    await writePkg({ "htmx.org": "^2.0.0", "@mui/material": "^6", react: "19.2.6" });
    expect(detectHost(tmp).uiLibrary).toBe("mui");
  });

  test("htmx markup in a nested template ⇒ html, even with no server entry", async () => {
    await writeAt("templates/contacts/list.html", '<input hx-get="/contacts/search">');
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("htmx loaded from a CDN in a Django app's package templates ⇒ html", async () => {
    await writeAt(
      "contacts/templates/base.html",
      '<script src="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js"></script>',
    );
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("a server-rendered app with templates and no htmx still ⇒ html", async () => {
    await writeAt("app/main.py", "from fastapi import FastAPI\napp = FastAPI()");
    await writeAt("app/templates/index.html", "<h1>Hi</h1>");
    expect(detectHost(tmp).uiLibrary).toBe("html");
  });

  test("a plain Node project with no templates is not html", async () => {
    await writePkg({ express: "^5.0.0" });
    await writeAt("index.js", "console.log('hi')");
    expect(detectHost(tmp).uiLibrary).toBeUndefined();
  });
});

describe("looksLikeUiApp server-rendered", () => {
  test("FastAPI (main.py) and Flask (app.py) apps with templates are UI apps", async () => {
    await writeAt("main.py", "from fastapi import FastAPI");
    expect(await looksLikeUiApp(tmp)).toBe(false);
    await writeAt("templates/index.html", "<h1>Hi</h1>");
    expect(await looksLikeUiApp(tmp)).toBe(true);
  });

  test("a package.json kept only for a CSS build does not hide the templates", async () => {
    await writePkg({ tailwindcss: "^4.0.0" });
    await writeAt("app.py", "from flask import Flask");
    await writeAt("templates/base.html", "<main></main>");
    expect(await looksLikeUiApp(tmp)).toBe(true);
  });
});
