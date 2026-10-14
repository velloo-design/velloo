import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DetectedHost, hasAppToMatch, type WizardAnswers } from "../answers.ts";

/**
 * Whether there is an app for the design to match decides three things at
 * once — the closing steps, the README and the handoff prompt all open with
 * the setup, or none of them does — so it is pinned here rather than through
 * any one of them.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-has-app-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const NOTHING: DetectedHost = { shadcn: false, tailwindMajor: null };

function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    appRoot: root,
    scanRoot: root,
    folder: join(root, "velloo"),
    library: "none",
    source: "binary",
    componentsRelative: "src/components/ui",
    initialContent: "blank",
    ...overrides,
  };
}

describe("hasAppToMatch", () => {
  test("an empty directory is not an app, detected or not", () => {
    expect(hasAppToMatch(answers())).toBe(false);
    expect(hasAppToMatch(answers({ detected: NOTHING }))).toBe(false);
  });

  test("a package.json at the app root is an app, whatever it uses", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app" }));
    expect(hasAppToMatch(answers())).toBe(true);
  });

  test("an app with no package.json is one by what was found in it", () => {
    // A Flask app, a static site: nothing to install, and still a look to match.
    expect(hasAppToMatch(answers({ detected: { ...NOTHING, uiLibrary: "html" } }))).toBe(true);
    expect(hasAppToMatch(answers({ detected: { ...NOTHING, unsupportedUi: "Mantine" } }))).toBe(
      true,
    );
    expect(
      hasAppToMatch(
        answers({ detected: { ...NOTHING, globalsCssPath: join(root, "static/site.css") } }),
      ),
    ).toBe(true);
  });

  test("Tailwind or a DESIGN.md alone is not an app", () => {
    expect(
      hasAppToMatch(
        answers({
          detected: { shadcn: false, tailwindMajor: 4, designMdPath: join(root, "DESIGN.md") },
        }),
      ),
    ).toBe(false);
  });

  test("an app nested below the directory init ran in is still the app", async () => {
    // A repo with `web/` beside a backend and no package.json of its own.
    const web = join(root, "web");
    await mkdir(web, { recursive: true });
    await writeFile(join(web, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    expect(hasAppToMatch(answers({ scanRoot: web, detected: NOTHING }))).toBe(true);
  });

  test("the welcome sample matches no app, even in one", async () => {
    // It keeps its own theme: setting it up for the app would repaint it.
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app" }));
    const detected = { ...NOTHING, uiLibrary: "mui" as const };
    expect(hasAppToMatch(answers({ initialContent: "sample", detected }))).toBe(false);
    expect(hasAppToMatch(answers({ initialContent: "blank", detected }))).toBe(true);
  });
});
