import { Bold, Heading1, Heading2, Italic, Link2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyInputRules,
  editorToMarkdown,
  fillEditor,
  lineOf,
  retagLine,
} from "../markdown/editor-dom.ts";
import { safeHref } from "../markdown/parse.ts";
import { MARKDOWN_PROSE } from "./Markdown.tsx";

/**
 * Markdown written in place, the way it will read: type `## ` and the line
 * becomes a heading, close a `**run**` and it turns bold. Selecting text shows
 * a small toolbar for the same few things — bold, italic, headings, a link.
 * The value in and out is markdown; the editor is a `contentEditable` with no
 * editor library behind it (see `markdown/editor-dom.ts`).
 *
 * `onBlur` fires only when focus leaves both the editor and its toolbar, so
 * typing a link's address doesn't end the edit.
 */
export function RichMarkdownEditor({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  autoFocus = false,
  ariaLabel,
  className = "",
  dataSlot,
}: {
  value: string;
  onChange(markdown: string): void;
  onBlur?: (() => void) | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  placeholder?: string | undefined;
  autoFocus?: boolean | undefined;
  ariaLabel: string;
  className?: string | undefined;
  /** For shadcn's InputGroup, which styles its control by `data-slot`. */
  dataSlot?: string | undefined;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  // The markdown this editor last reported: a `value` equal to it is our own
  // echo, and re-filling the DOM for it would throw the caret away.
  const emitted = useRef<string | null>(null);
  const [empty, setEmpty] = useState(value.trim() === "");
  const [hud, setHud] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || value === emitted.current) return;
    fillEditor(root, value);
    emitted.current = value;
    setEmpty(value.trim() === "");
  }, [value]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on mount
  useEffect(() => {
    const root = rootRef.current;
    if (!autoFocus || !root) return;
    root.focus();
    const selection = root.ownerDocument.getSelection();
    selection?.selectAllChildren(root);
    selection?.collapseToEnd();
  }, []);

  // The toolbar follows the selection while it's a non-empty run inside us.
  useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    if (!doc) return;
    const onSelection = () => {
      const root = rootRef.current;
      if (!root) return;
      if (hudRef.current?.contains(doc.activeElement)) return;
      const selection = doc.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) {
        setHud(null);
        return;
      }
      setHud(range.getBoundingClientRect());
    };
    doc.addEventListener("selectionchange", onSelection);
    return () => doc.removeEventListener("selectionchange", onSelection);
  }, []);

  const emit = () => {
    const root = rootRef.current;
    if (!root) return;
    if (!root.firstChild) fillEditor(root, "");
    const markdown = editorToMarkdown(root);
    emitted.current = markdown;
    setEmpty(markdown.trim() === "");
    onChange(markdown);
  };

  const leaveIfGone = () => {
    requestAnimationFrame(() => {
      const active = rootRef.current?.ownerDocument.activeElement;
      if (active && (rootRef.current?.contains(active) || hudRef.current?.contains(active))) return;
      setHud(null);
      onBlur?.();
    });
  };

  const run = (command: "bold" | "italic") => {
    rootRef.current?.ownerDocument.execCommand(command);
    emit();
  };

  const toggleHeading = (level: 1 | 2) => {
    const root = rootRef.current;
    const selection = root?.ownerDocument.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const line = lineOf(root, selection.anchorNode);
    if (!line) return;
    retagLine(line, line.tagName === `H${level}` ? "div" : `h${level}`);
    emit();
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a rich text field has no native element */}
      <div
        ref={rootRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        data-slot={dataSlot}
        data-rich-editor
        data-empty={empty ? "true" : undefined}
        data-placeholder={placeholder}
        className={`relative cursor-text whitespace-pre-wrap outline-none ${MARKDOWN_PROSE} data-[empty=true]:before:pointer-events-none data-[empty=true]:before:absolute data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)] ${className}`}
        onInput={() => {
          const root = rootRef.current;
          if (root) applyInputRules(root);
          emit();
        }}
        onPaste={(event) => {
          // Pasted HTML would bring its own markup; markdown is the format.
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          rootRef.current?.ownerDocument.execCommand("insertText", false, text);
        }}
        onKeyDown={(event) => {
          const root = rootRef.current;
          const selection = root?.ownerDocument.getSelection();
          // Backspace at the very start of a heading undoes the heading, as
          // deleting its `#`s would in the source.
          if (event.key === "Backspace" && root && selection?.isCollapsed) {
            const line = lineOf(root, selection.anchorNode);
            if (line && /^H[1-3]$/.test(line.tagName) && caretAtLineStart(line, selection)) {
              event.preventDefault();
              retagLine(line, "div");
              emit();
              return;
            }
          }
          onKeyDown?.(event);
        }}
        onBlur={leaveIfGone}
      />
      {hud
        ? createPortal(
            <FormattingHud
              ref={hudRef}
              rect={hud}
              onBold={() => run("bold")}
              onItalic={() => run("italic")}
              onHeading={toggleHeading}
              onLink={(href, range) => {
                const root = rootRef.current;
                const selection = root?.ownerDocument.getSelection();
                if (!root || !selection) return;
                root.focus();
                selection.removeAllRanges();
                selection.addRange(range);
                root.ownerDocument.execCommand("createLink", false, href);
                emit();
              }}
              onDone={() => rootRef.current?.focus()}
              onLeave={leaveIfGone}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function caretAtLineStart(line: HTMLElement, selection: Selection): boolean {
  const range = line.ownerDocument.createRange();
  range.selectNodeContents(line);
  range.setEnd(selection.anchorNode as Node, selection.anchorOffset);
  return range.toString().replaceAll("​", "") === "";
}

function FormattingHud({
  ref,
  rect,
  onBold,
  onItalic,
  onHeading,
  onLink,
  onDone,
  onLeave,
}: {
  ref: React.Ref<HTMLDivElement>;
  rect: DOMRect;
  onBold(): void;
  onItalic(): void;
  onHeading(level: 1 | 2): void;
  onLink(href: string, range: Range): void;
  onDone(): void;
  onLeave(): void;
}) {
  const [linking, setLinking] = useState<Range | null>(null);
  const [href, setHref] = useState("https://");
  // Buttons act on the editor's selection, so they must never take focus from it.
  const keep = (event: React.MouseEvent) => event.preventDefault();
  const button = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground"
      onMouseDown={keep}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Formatting"
      data-formatting-hud
      className="fixed z-[100] flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
      style={{ left: rect.left + rect.width / 2, top: rect.top - 6 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {linking ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: the link field opens to be typed in
          autoFocus
          aria-label="Link address"
          className="h-7 w-56 rounded-md bg-transparent px-2 text-xs outline-none"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onBlur={onLeave}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const safe = safeHref(href);
              if (safe) onLink(safe, linking);
              setLinking(null);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setLinking(null);
              onDone();
            }
          }}
        />
      ) : (
        <>
          {button("Bold", <Bold size={14} />, onBold)}
          {button("Italic", <Italic size={14} />, onItalic)}
          {button("Heading 1", <Heading1 size={14} />, () => onHeading(1))}
          {button("Heading 2", <Heading2 size={14} />, () => onHeading(2))}
          {button("Link", <Link2 size={14} />, () => {
            const selection = document.getSelection();
            if (selection && selection.rangeCount > 0) {
              setHref("https://");
              setLinking(selection.getRangeAt(0).cloneRange());
            }
          })}
        </>
      )}
    </div>
  );
}
