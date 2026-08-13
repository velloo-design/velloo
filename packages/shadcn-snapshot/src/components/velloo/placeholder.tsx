// Velloo-owned placeholder component. Designs often need a "picture goes
// here" slot — agent-authored marketing pages especially. This stands in
// for real imagery during design time and emits as a `<div role="img">` in
// codegen so the user can swap in a real `<img>` / `<Image>` / `<Avatar>`
// after export.
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface PlaceholderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Visual shape. `"image"` is a rounded rectangle with an optional label;
   * `"avatar"` is a circle with a fallback letter — both honor a custom
   * className for sizing.
   */
  kind?: "image" | "avatar";
  /**
   * Fallback letter or short label inside the placeholder. For avatars
   * this is typically a single initial; for images it's a hint about
   * the content ("Hero", "Logo", "Product").
   */
  label?: string;
  /**
   * Aspect ratio — `"16/9"`, `"4/3"`, `"1/1"`, `"3/4"`. Only used when
   * `kind: "image"`. Defaults to `"16/9"`.
   */
  aspect?: "1/1" | "4/3" | "3/4" | "16/9" | "21/9";
}

const ASPECT_CLASS: Record<NonNullable<PlaceholderProps["aspect"]>, string> = {
  "1/1": "aspect-square",
  "4/3": "aspect-[4/3]",
  "3/4": "aspect-[3/4]",
  "16/9": "aspect-video",
  "21/9": "aspect-[21/9]",
};

export function Placeholder({
  kind = "image",
  label,
  aspect = "16/9",
  className,
  ...rest
}: PlaceholderProps) {
  if (kind === "avatar") {
    return (
      <div
        role="img"
        aria-label={label ? `placeholder: ${label}` : "placeholder avatar"}
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium",
          "size-10 text-sm",
          className,
        )}
        {...rest}
      >
        {label?.slice(0, 2).toUpperCase() ?? ""}
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={label ? `placeholder: ${label}` : "placeholder image"}
      className={cn(
        "flex w-full items-center justify-center bg-muted text-muted-foreground text-xs uppercase tracking-wider rounded-md border border-dashed border-border",
        ASPECT_CLASS[aspect],
        className,
      )}
      {...rest}
    >
      {label ?? "image"}
    </div>
  );
}
