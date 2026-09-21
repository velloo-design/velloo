/**
 * The glyph that opens a tree row.
 *
 * One slot answers two different questions. For a `$ref` the library resolves,
 * it answers *provenance* — a real project component, a registered extension,
 * or nothing at all — which earns a colour, because it's the one thing the
 * row's text cannot say. For everything else it answers *what kind of thing
 * this is*: a velloo screen is overwhelmingly `Box` and `Text`, so a shape at
 * the start of the row is what lets you find the one image among a hundred
 * rows of layout without reading any of them.
 */
import type { ComponentDescriptor } from "@velloo/provider";
import { isParamRef, isRepoNode, isSnippetInstance, type Node } from "@velloo/schema";
import {
  Blend,
  Blocks,
  Boxes,
  Braces,
  Component as ComponentIcon,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Layers,
  Link2,
  List,
  type LucideIcon,
  Minus,
  Navigation,
  PanelBottom,
  PanelTop,
  Pilcrow,
  Puzzle,
  Quote,
  Shapes,
  Sparkles,
  Square,
  SquareDashed,
  SquareMousePointer,
  Table,
  TextCursorInput,
  TriangleAlert,
  Type,
  Video,
} from "lucide-react";

/** `/api/components` tags entries with `kind`; the Manifest type predates it. */
export type LibraryEntry = ComponentDescriptor & { kind?: "library" | "extension" | "snippet" };

export interface NodeIcon {
  Icon: LucideIcon;
  /** Tailwind text colour for an unselected row. */
  tone: string;
  /** Set only when the glyph carries something the row's label doesn't. */
  title?: string;
}

/** Velloo's own helpers, whose names already name a kind. */
const BY_REF: Record<string, LucideIcon> = {
  Divider: Minus,
  Gradient: Blend,
  Heading: HeadingIcon,
  Icon: Sparkles,
  Image: ImageIcon,
  Layer: Layers,
  Placeholder: SquareDashed,
  Prose: Pilcrow,
  SVG: Shapes,
  Text: Type,
};

/**
 * `Box` is the whole structural vocabulary, tagged by `as` — so the tag is the
 * only thing that distinguishes a list from a link from a plain div, and it's
 * what the label already leads with.
 */
const BY_TAG: Record<string, LucideIcon> = {
  a: Link2,
  blockquote: Quote,
  button: SquareMousePointer,
  em: Type,
  footer: PanelBottom,
  form: TextCursorInput,
  h1: HeadingIcon,
  h2: HeadingIcon,
  h3: HeadingIcon,
  h4: HeadingIcon,
  h5: HeadingIcon,
  h6: HeadingIcon,
  header: PanelTop,
  img: ImageIcon,
  input: TextCursorInput,
  label: Type,
  li: List,
  nav: Navigation,
  ol: List,
  p: Type,
  small: Type,
  span: Type,
  strong: Type,
  svg: Shapes,
  table: Table,
  textarea: TextCursorInput,
  ul: List,
  video: Video,
};

/**
 * A glyph for every row. Provenance wins where it applies: which rows are the
 * project's real components is worth more than which of them is a button, and
 * two competing marks on one row would bury both.
 */
export function nodeIcon(node: Node, byId: Map<string, LibraryEntry>): NodeIcon {
  if (isParamRef(node)) {
    return { Icon: Braces, tone: "text-muted-foreground" };
  }
  if (isSnippetInstance(node)) {
    return {
      Icon: Blocks,
      tone: "text-violet-500",
      title: `@${node.$snippet} — a snippet instance.`,
    };
  }
  // Ahead of the manifest: a repo node's `$ref` is only its JSX name, and may
  // match an unrelated provider component.
  if (isRepoNode(node)) {
    const { importPath, exportName, member, app } = node.$repo;
    const binding = exportName === "default" ? "default export" : exportName;
    const what = member ? `${binding}.${member}` : binding;
    return {
      Icon: Boxes,
      tone: "text-primary",
      title: `${node.$ref} — the app's own component: ${what} from ${importPath}${app ? ` (${app})` : ""}.`,
    };
  }
  const entry = byId.get(node.$ref);
  if (!entry) {
    return {
      Icon: TriangleAlert,
      tone: "text-destructive",
      title: `${node.$ref} isn't in this screen's library — it renders as a fallback.`,
    };
  }
  if (entry.kind === "extension") {
    return {
      Icon: Puzzle,
      tone: "text-primary",
      title: `${node.$ref} — a custom component registered with add_extension.`,
    };
  }
  if (entry.source !== "velloo") {
    return {
      Icon: ComponentIcon,
      tone: "text-primary",
      title: `${node.$ref} — a real ${entry.source} component from this project's library.`,
    };
  }
  const byRef = BY_REF[node.$ref];
  if (byRef) return { Icon: byRef, tone: "text-muted-foreground" };
  const as = typeof node.props?.as === "string" ? node.props.as : null;
  return { Icon: (as ? BY_TAG[as] : undefined) ?? Square, tone: "text-muted-foreground" };
}
