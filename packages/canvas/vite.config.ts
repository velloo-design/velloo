import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Matches modules of the named packages, under bun's nested store or a flat node_modules. */
function vendor(...packages: string[]): RegExp {
  return new RegExp(`[\\\\/]node_modules[\\\\/](?:${packages.join("|")})[\\\\/]`);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    // The one chunk past the 500 kB default is lucide's full icon set, which
    // loads on demand. The eager chunks sit well under this, so the warning
    // still fires if one of them grows into it.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        // Third-party code changes far less often than the canvas, so it gets
        // chunks of its own that stay cached across canvas-only rebuilds. The
        // groups name packages rather than matching all of node_modules: a
        // catch-all would sweep lucide's full icon set — reached only through
        // `lucide-glyphs.ts`'s dynamic import — back into an eager chunk.
        codeSplitting: {
          groups: [
            { name: "react", test: vendor("react", "react-dom", "scheduler"), priority: 30 },
            {
              name: "radix",
              test: vendor(
                "radix-ui",
                "@radix-ui/[^/\\\\]+",
                "@floating-ui/[^/\\\\]+",
                "react-remove-scroll",
                "react-remove-scroll-bar",
                "react-style-singleton",
                "use-callback-ref",
                "use-sidecar",
                "aria-hidden",
                "get-nonce",
              ),
              priority: 20,
            },
            {
              name: "vendor",
              test: vendor(
                "zod",
                "culori",
                "tailwind-merge",
                "clsx",
                "class-variance-authority",
                "sonner",
                "zustand",
              ),
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 7301, // Vite dev server (separate from `velloo run` :7300)
    proxy: {
      "/api": "http://127.0.0.1:7300",
      "/ws": { target: "ws://127.0.0.1:7300", ws: true },
    },
  },
});
