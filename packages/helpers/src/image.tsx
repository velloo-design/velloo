// Velloo-owned image helper. Renders a real `<img>` in design mode (so
// designs look like the user's final page, not like Placeholder
// abstractions) but carries Velloo-shaped metadata the agent reads when
// emitting code: focal point for object-position, aspect for sizing,
// treatment for overlays.
//
// The `src` is preserved verbatim in codegen — point at `assets/`,
// arbitrary URLs, or whatever the host app convention is.
import type * as React from "react";
import { cn } from "./cn.ts";

export interface ImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "loading"> {
  /**
   * Asset path. Relative paths resolve against the design folder's
   * `assets/` directory in design mode; the agent emits them verbatim.
   */
  src: string;
  /**
   * Aspect ratio shorthand. Matches Placeholder's set so designs stay
   * consistent when swapping placeholder → real image.
   */
  aspect?: "1/1" | "4/3" | "3/4" | "16/9" | "21/9";
  /**
   * Focal point (0-1 coords). When the image is cropped via aspect,
   * the cropping window centers on this point. Defaults to center.
   */
  focal?: { x: number; y: number };
  /**
   * Optional visual treatment layered on top.
   * `"overlay-dark"` darkens for hero text legibility;
   * `"overlay-light"` lightens for light-text-on-bright-image cases;
   * `"blend-multiply"` blends with the theme's primary;
   * `"grayscale"` desaturates.
   */
  treatment?: "overlay-dark" | "overlay-light" | "blend-multiply" | "grayscale";
  /**
   * Whether the image should fill its parent (`true`, default — uses
   * absolute-positioning inside a relative wrapper) or render at intrinsic
   * size (`false`).
   */
  fill?: boolean;
}

const ASPECT_CLASS: Record<NonNullable<ImageProps["aspect"]>, string> = {
  "1/1": "aspect-square",
  "4/3": "aspect-[4/3]",
  "3/4": "aspect-[3/4]",
  "16/9": "aspect-video",
  "21/9": "aspect-[21/9]",
};

const TREATMENT_CLASS: Record<NonNullable<ImageProps["treatment"]>, string> = {
  "overlay-dark":
    "after:absolute after:inset-0 after:bg-black/40 after:pointer-events-none after:rounded-[inherit]",
  "overlay-light":
    "after:absolute after:inset-0 after:bg-white/40 after:pointer-events-none after:rounded-[inherit]",
  "blend-multiply": "[&>img]:mix-blend-multiply",
  grayscale: "[&>img]:grayscale",
};

function focalToObjectPosition(focal: { x: number; y: number } | undefined): string | undefined {
  if (!focal) return undefined;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return `${(clamp(focal.x) * 100).toFixed(1)}% ${(clamp(focal.y) * 100).toFixed(1)}%`;
}

export function Image({
  src,
  alt = "",
  aspect,
  focal,
  treatment,
  fill = true,
  className,
  style,
  ...rest
}: ImageProps) {
  const objectPosition = focalToObjectPosition(focal);
  const aspectClass = aspect ? ASPECT_CLASS[aspect] : "";
  const treatmentClass = treatment ? TREATMENT_CLASS[treatment] : "";

  if (!fill) {
    return (
      <img
        src={src}
        alt={alt}
        data-slot="image"
        className={cn("inline-block", className)}
        style={objectPosition ? { ...style, objectPosition } : style}
        {...rest}
      />
    );
  }

  return (
    <div
      data-slot="image-wrapper"
      className={cn("relative overflow-hidden", aspectClass, treatmentClass, className)}
      style={style}
    >
      <img
        src={src}
        alt={alt}
        data-slot="image"
        className="absolute inset-0 h-full w-full object-cover"
        style={objectPosition ? { objectPosition } : undefined}
        {...rest}
      />
    </div>
  );
}
