/**
 * Convenience hooks for the canvas store. These bundle related state +
 * actions for the most common groupings — `useSelection`, `useViewport`,
 * `useCursorMode`, `useDesignMode`. Equivalent to `useCanvas(s => …)`
 * at every call site, but readable in one line.
 *
 * Existing `useCanvas((s) => s.field)` call sites stay valid; these are
 * additive. New components should prefer the namespaced hook when
 * touching three or more related fields.
 */
import { useShallow } from "zustand/react/shallow";
import type { AppTheme, CursorMode, DesignMode, NodeState, Selection } from "./store.ts";
import { useCanvas } from "./store.ts";

export function useSelection(): {
  selection: Selection | null;
  hover: Selection | null;
  setSelection: (s: Selection | null) => void;
  setHover: (h: Selection | null) => void;
} {
  return useCanvas(
    useShallow((s) => ({
      selection: s.selection,
      hover: s.hover,
      setSelection: s.setSelection,
      setHover: s.setHover,
    })),
  );
}

export function useViewport(): {
  canvasZoom: number;
  pan: { x: number; y: number };
  setCanvasZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
} {
  return useCanvas(
    useShallow((s) => ({
      canvasZoom: s.canvasZoom,
      pan: s.pan,
      setCanvasZoom: s.setCanvasZoom,
      setPan: s.setPan,
    })),
  );
}

export function useCursorMode(): {
  cursorMode: CursorMode;
  setCursorMode: (m: CursorMode) => void;
} {
  return useCanvas(
    useShallow((s) => ({
      cursorMode: s.cursorMode,
      setCursorMode: s.setCursorMode,
    })),
  );
}

export function useNodeState(): {
  nodeState: NodeState;
  setNodeState: (s: NodeState) => void;
} {
  return useCanvas(
    useShallow((s) => ({
      nodeState: s.nodeState,
      setNodeState: s.setNodeState,
    })),
  );
}

export function useAppTheme(): {
  appTheme: AppTheme;
  setAppTheme: (t: AppTheme) => void;
  designMode: DesignMode;
  setDesignMode: (m: DesignMode) => void;
} {
  return useCanvas(
    useShallow((s) => ({
      appTheme: s.appTheme,
      setAppTheme: s.setAppTheme,
      designMode: s.designMode,
      setDesignMode: s.setDesignMode,
    })),
  );
}
