import { afterEach, expect, test } from "bun:test";
import type { Server } from "bun";
import { fetchCloudAppUrl, publishedBoardsUrl } from "../cloud.ts";

/**
 * The canvas "Open velloo-cloud" item and `velloo published` management links
 * take the home from `GET /v1/auth/config` — the cloud's APP_BASE_URL — not a
 * client-side hostname map.
 */

let server: Server<undefined> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function serveCloud(handler: (req: Request) => Response | Promise<Response>): string {
  server = Bun.serve({ port: 0, fetch: handler });
  return `http://localhost:${server.port}`;
}

test("uses the advertised app home from /v1/auth/config", async () => {
  const url = serveCloud(() =>
    Response.json({
      issuer: "https://auth.example.test",
      clientId: "cli",
      appUrl: "https://app.example.test",
    }),
  );
  expect(await fetchCloudAppUrl(url)).toBe("https://app.example.test");
  expect(await publishedBoardsUrl(url)).toBe("https://app.example.test/boards");
});

test("falls back to the API origin when the cloud does not advertise a home", async () => {
  const url = serveCloud(() =>
    Response.json({ issuer: "https://auth.example.test", clientId: "cli" }),
  );
  expect(await fetchCloudAppUrl(url)).toBe(url);
  expect(await publishedBoardsUrl(url)).toBe(`${url}/boards`);
});

test("falls back when config is unreachable", async () => {
  const url = serveCloud(() => Response.json({ appUrl: "https://app.example.test" }));
  server?.stop(true);
  server = null;
  expect(await fetchCloudAppUrl(url)).toBe(url);
});

test("ignores an advertised home that is not a secure URL", async () => {
  const url = serveCloud(() => Response.json({ appUrl: "http://evil.example" }));
  expect(await fetchCloudAppUrl(url)).toBe(url);
});
