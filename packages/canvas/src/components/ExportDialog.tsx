import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { preflightExportTarget, type ScreenRenderFailure } from "../api/preflight.ts";
import { downloadExport, type ExportFormat, type ExportMode } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { RenderFailureDialog } from "./RenderFailureDialog.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

/**
 * The export dialog: pointed at a frame or board via the modes slice's
 * `exportTarget`, it downloads PNG / PDF / standalone HTML through the
 * daemon's /api/export routes. Mode compare is frame-PNG-only (side-by-side
 * light|dark); scale applies to PNG raster density.
 */
export function ExportDialog() {
  const target = useCanvas((s) => s.exportTarget);
  const setTarget = useCanvas((s) => s.setExportTarget);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [mode, setMode] = useState<ExportMode>("light");
  const [scale, setScale] = useState<"1" | "2">("1");
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<ScreenRenderFailure[] | null>(null);

  // Fresh defaults per target; also drop a compare selection that the new
  // target/format combination doesn't support.
  useEffect(() => {
    if (target) {
      setFormat("png");
      setMode("light");
      setScale("1");
      setBusy(false);
      setFailures(null);
    }
  }, [target]);

  const compareAllowed = target?.kind === "frame" && format === "png";
  const effectiveMode = mode === "compare" && !compareAllowed ? "light" : mode;

  const download = async () => {
    if (!target) return;
    try {
      const warnings = await downloadExport({
        kind: target.kind,
        id: target.id,
        format,
        mode: effectiveMode,
        ...(format === "png" ? { scale: Number(scale) } : {}),
      });
      for (const warning of warnings) pushToast({ kind: "info", message: warning });
      setTarget(null);
    } catch (err) {
      toastError(err, "Export failed");
      setBusy(false);
    }
  };

  const run = async () => {
    if (!target || busy) return;
    setBusy(true);
    // A component that threw renders as a placeholder rather than failing the
    // export, so ask before writing that into a file meant for someone else.
    // A pre-flight that itself fails is not a reason to block the export.
    const found = await preflightExportTarget(target.kind, target.id).catch(() => []);
    if (found.length > 0) {
      setFailures(found);
      return;
    }
    await download();
  };

  return (
    <>
      <RenderFailureDialog
        failures={failures}
        verb="Export"
        onCancel={() => {
          setFailures(null);
          setBusy(false);
        }}
        onConfirm={() => {
          setFailures(null);
          void download();
        }}
      />
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Export {target?.kind === "board" ? "board" : "frame"}</DialogTitle>
            <DialogDescription className="truncate">{target?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="export-format">Format</Label>
              <Select
                value={format}
                onValueChange={(v) => {
                  setFormat(v as ExportFormat);
                  if (v !== "png" && mode === "compare") setMode("light");
                }}
              >
                <SelectTrigger id="export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG image</SelectItem>
                  <SelectItem value="pdf">
                    {target?.kind === "board"
                      ? "PDF deck (one frame per page)"
                      : "PDF (single page)"}
                  </SelectItem>
                  <SelectItem value="html">Standalone HTML (self-contained)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="export-mode">Mode</Label>
              <Select value={effectiveMode} onValueChange={(v) => setMode(v as ExportMode)}>
                <SelectTrigger id="export-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  {compareAllowed ? (
                    <SelectItem value="compare">Compare (light | dark)</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
            {format === "png" ? (
              <div className="grid gap-2">
                <Label htmlFor="export-scale">Scale</Label>
                <Select value={scale} onValueChange={(v) => setScale(v as "1" | "2")}>
                  <SelectTrigger id="export-scale">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1× (CSS pixels)</SelectItem>
                    <SelectItem value="2">2× (retina)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void run()} disabled={busy}>
              <Download />
              {busy ? "Exporting…" : "Export"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
