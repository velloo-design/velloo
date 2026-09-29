/**
 * What the shipped `pkgs/helpers` source imports by bare name when the canvas
 * bundle compiles it for the browser (the `cn` helper). The published package
 * declares these as its own dependencies so they resolve from `dist/pkgs`
 * whatever the host app has: an MUI or no-framework app has no
 * `tailwind-merge`, and a Tailwind one may carry a different major. See
 * HOST_PACKAGES in packages/server/src/live/canvas-bundle.ts.
 */
export const CANVAS_SOURCE_PACKAGES = ["clsx", "tailwind-merge"] as const;
