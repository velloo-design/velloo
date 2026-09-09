import type {
  Annotation,
  AssetsFile,
  Board,
  CanvasNote,
  Screen,
  Snippet,
  Theme,
} from "@velloo/schema";

/** Everything `velloo init` writes into a fresh design folder. */
export interface Scaffold {
  theme: Theme;
  /** Bundled files copied byte-for-byte; keys are design-relative paths. */
  assetFiles?: Record<string, string>;
  assetMetadata?: AssetsFile;
  customCss?: string;
  documents?: Record<string, string>;
  screens: Screen[];
  boards: Board[];
  snippets: Snippet[];
  annotations: { screenId: string; entries: Annotation[] }[];
  notes: { boardId: string; entries: CanvasNote[] }[];
}
