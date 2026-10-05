import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * A publish that stops short of the cloud: the same pipeline, the same
 * multipart upload, received by a listener in this process and written to a
 * directory instead of to a share link.
 *
 * It exists so that what a share will look like can be checked without an
 * account, a network or a deploy — the bundle on disk is byte for byte what
 * the cloud would have stored, because it went through the real upload path
 * rather than a second code path that only resembles it. A test or an eval
 * hands the directory to the share viewer and compares the result with the
 * canvas.
 */

const SLUG = "local";

/** The cloud endpoints a publish calls, answering as the cloud does and keeping every file. */
export async function withLocalReceiver<T>(
  run: (cloud: { baseUrl: string; token: string }) => Promise<T>,
): Promise<{ result: T; files: Map<string, Uint8Array> }> {
  const files = new Map<string, Uint8Array>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/health") return Response.json({ ok: true });
      if (request.method === "POST" && pathname === "/v1/links") {
        return Response.json(
          { slug: SLUG, visibility: "public", passwordProtected: false },
          { status: 201 },
        );
      }
      if (request.method === "POST" && pathname === `/v1/links/${SLUG}/versions`) {
        const form = await request.formData();
        let bytes = 0;
        for (const part of form.getAll("file")) {
          if (!(part instanceof File)) continue;
          const data = new Uint8Array(await part.arrayBuffer());
          files.set(part.name, data);
          bytes += data.byteLength;
        }
        return Response.json({ files: files.size, bytes, url: `/s/${SLUG}/` }, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const result = await run({ baseUrl: `http://127.0.0.1:${server.port}`, token: "local" });
    return { result, files };
  } finally {
    await server.stop(true);
  }
}

/** Write a received bundle under `dir`, refusing a path that would land outside it. */
export async function writeBundle(dir: string, files: Map<string, Uint8Array>): Promise<void> {
  const root = resolve(dir);
  for (const [path, bytes] of files) {
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`bundle file ${path} would be written outside ${root}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(join(target), bytes);
  }
}
