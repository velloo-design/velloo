// Velloo-flavored Carousel. The shadcn Carousel wraps Embla — heavyweight
// + JS-only. Design mode just needs a styled "first slide visible"
// preview. We render children in a row, clip overflow to the wrapper,
// and surface static arrow buttons.
//
// The agent's emitted code uses the real shadcn Carousel at runtime.
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { Children, type ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export interface CarouselProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical";
}

export function Carousel({ className, orientation = "horizontal", ...props }: CarouselProps) {
  return (
    <div
      data-slot="carousel"
      data-orientation={orientation}
      className={cn("relative", className)}
      {...props}
    />
  );
}

export function CarouselContent({ className, children, ...props }: React.ComponentProps<"div">) {
  // Wrap each child in a flex-shrink-0 cell so the horizontal lane
  // can be scrolled / "advanced" visually even though scroll is
  // disabled in design mode.
  const items = Children.toArray(children as ReactNode);
  return (
    <div className="overflow-hidden">
      <div data-slot="carousel-content" className={cn("flex", className)} {...props}>
        {items}
      </div>
    </div>
  );
}

export function CarouselItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: shadcn carousel item is a div with role=group + aria-roledescription
    <div
      data-slot="carousel-item"
      role="group"
      aria-roledescription="slide"
      className={cn("min-w-0 shrink-0 grow-0 basis-full", className)}
      {...props}
    />
  );
}

export function CarouselPrevious({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="carousel-previous"
      aria-label="Previous slide"
      className={cn(
        "absolute -left-12 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background shadow-xs hover:bg-accent",
        className,
      )}
      {...props}
    >
      <ChevronLeft className="size-4" />
    </button>
  );
}

export function CarouselNext({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="carousel-next"
      aria-label="Next slide"
      className={cn(
        "absolute -right-12 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background shadow-xs hover:bg-accent",
        className,
      )}
      {...props}
    >
      <ChevronRight className="size-4" />
    </button>
  );
}
