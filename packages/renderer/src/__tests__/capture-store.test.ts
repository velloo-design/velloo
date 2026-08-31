import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CaptureManifest,
  captureDir,
  capturesDir,
  deleteCapture,
  folderKey,
  isSafeCaptureFile,
  isSafeCaptureId,
  listCaptures,
  newCaptureId,
  readSessionState,
  sessionStatePath,
  writeCaptureManifest,
  writeSessionState,
} from "../capture-store.ts";

let home: string;
let root: string;
const prevHome = process.env.VELLOO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "velloo-home-"));
  root = mkdtempSync(join(tmpdir(), "velloo-folder-"));
  process.env.VELLOO_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.VELLOO_HOME;
  else process.env.VELLOO_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

const manifest = (id: string, capturedAt: string): CaptureManifest => ({
  id,
  url: "https://app.example.com/x",
  finalUrl: "https://app.example.com/x",
  title: "X",
  capturedAt,
  viewport: { w: 1440, h: 900 },
  files: ["page.png"],
  assetCount: 0,
  nodeCount: 10,
  themeOnly: false,
});

describe("store location", () => {
  test("captures and sessions live under VELLOO_HOME, never in the design folder", () => {
    const dir = capturesDir(root);
    expect(dir.startsWith(home)).toBe(true);
    expect(dir.startsWith(root)).toBe(false);
    const state = sessionStatePath(root, "https://app.example.com");
    expect(state.startsWith(home)).toBe(true);
    expect(state.startsWith(root)).toBe(false);
  });

  test("folderId wins over the path hash, so a moved folder keeps its captures", () => {
    expect(folderKey(root, "fixed-id")).toBe("fixed-id");
    expect(folderKey(root)).not.toBe(folderKey(`${root}-other`));
  });

  test("session files partition by target origin", () => {
    const a = sessionStatePath(root, "https://a.example.com");
    const b = sessionStatePath(root, "https://b.example.com");
    expect(a).not.toBe(b);
  });
});

describe("capture listing and deletion", () => {
  test("lists newest first and skips unreadable directories", () => {
    writeCaptureManifest(captureDir(root, "aaa"), manifest("aaa", "2026-08-01T00:00:00.000Z"));
    writeCaptureManifest(captureDir(root, "bbb"), manifest("bbb", "2026-08-05T00:00:00.000Z"));
    mkdirSync(captureDir(root, "junk"), { recursive: true });
    writeFileSync(join(captureDir(root, "junk"), "capture.json"), "{not json");

    expect(listCaptures(root).map((m) => m.id)).toEqual(["bbb", "aaa"]);
  });

  test("delete removes the directory and reports whether anything went", () => {
    writeCaptureManifest(captureDir(root, "aaa"), manifest("aaa", "2026-08-01T00:00:00.000Z"));
    expect(deleteCapture(root, "aaa")).toBe(true);
    expect(existsSync(captureDir(root, "aaa"))).toBe(false);
    expect(deleteCapture(root, "aaa")).toBe(false);
  });

  test("delete refuses a traversal id", () => {
    expect(deleteCapture(root, "../..")).toBe(false);
  });
});

describe("id and file validation", () => {
  test("rejects traversal and accepts generated ids", () => {
    expect(isSafeCaptureId(newCaptureId())).toBe(true);
    expect(isSafeCaptureId("../etc")).toBe(false);
    expect(isSafeCaptureId("a/b")).toBe(false);
    expect(isSafeCaptureId("")).toBe(false);
  });

  test("file names allow capture artifacts but not traversal", () => {
    expect(isSafeCaptureFile("page.png")).toBe(true);
    expect(isSafeCaptureFile("snapshot.mhtml")).toBe(true);
    expect(isSafeCaptureFile("..")).toBe(false);
    expect(isSafeCaptureFile("../secret")).toBe(false);
    expect(isSafeCaptureFile(".hidden")).toBe(false);
  });
});

describe("session state file", () => {
  const state = {
    cookies: [
      {
        name: "session",
        value: "secret",
        domain: "app.example.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const,
      },
      {
        name: "g",
        value: "third-party",
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };

  test("writes 0600 and scopes on the way in", () => {
    const path = sessionStatePath(root, "https://app.example.com");
    writeSessionState(path, state, ["https://app.example.com"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("app.example.com");
    expect(raw).not.toContain("third-party");
  });

  test("round-trips through read", () => {
    const path = sessionStatePath(root, "https://app.example.com");
    writeSessionState(path, state, ["https://app.example.com"]);
    expect(readSessionState(path)?.cookies).toHaveLength(1);
  });

  test("an aged-out file reads as absent and is removed", () => {
    const path = sessionStatePath(root, "https://app.example.com");
    writeSessionState(path, state, ["https://app.example.com"]);
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    require("node:fs").utimesSync(path, old, old);
    expect(readSessionState(path)).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  test("a missing file is null, not a throw", () => {
    expect(readSessionState(join(home, "nope.json"))).toBeNull();
  });
});
