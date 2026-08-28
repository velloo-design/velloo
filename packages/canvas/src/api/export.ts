/**
 * Client side of the daemon's /api/export routes: fetch the artifact
 * as a blob and hand it to the browser as a download. Failures throw with the
 * server's error message (the routes answer `{error}` JSON) so callers can
 * toast them; inlining caveats come back as strings for an info toast.
 */

export type ExportFormat = "png" | "pdf" | "html";
export type ExportMode = "light" | "dark" | "compare";

export interface ExportRequest {
  kind: "frame" | "board";
  id: string;
  format: ExportFormat;
  mode: ExportMode;
  /** PNG raster density (1 = css px, 2 = retina). */
  scale?: number;
}

export async function downloadExport(req: ExportRequest): Promise<string[]> {
  const params = new URLSearchParams({ mode: req.mode });
  if (req.scale && req.scale !== 1) params.set("scale", String(req.scale));
  const url = `/api/export/${req.kind}/${encodeURIComponent(req.id)}.${req.format}?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `export failed (${res.status})`);
  }
  const blob = await res.blob();
  saveBlob(blob, filenameFrom(res.headers.get("content-disposition"), `${req.id}.${req.format}`));
  const warnings = res.headers.get("x-velloo-export-warnings");
  if (!warnings) return [];
  try {
    return JSON.parse(decodeURIComponent(warnings)) as string[];
  } catch {
    return [];
  }
}

function filenameFrom(disposition: string | null, fallback: string): string {
  const m = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return m?.[1] ?? fallback;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a beat to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
