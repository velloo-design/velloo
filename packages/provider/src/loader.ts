import type { Library } from "@velloo/schema";
import type { ComponentProvider, ProviderLoader } from "./types.ts";
import { UnknownProviderError } from "./types.ts";

/**
 * Factory function for one provider id. The library config (with version,
 * source, componentsPath) lets the factory pull the right snapshot copy
 * or download from cache — wiring those is the factory's job.
 */
export type ProviderFactory = (library: Library) => Promise<ComponentProvider> | ComponentProvider;

/**
 * Build a `ProviderLoader` from a map of `library.id → factory`. The
 * server constructs one of these at boot time with the providers the
 * binary knows about (shadcn-upstream, none, mui).
 */
export function createProviderLoader(factories: Record<string, ProviderFactory>): ProviderLoader {
  return async (library) => {
    const factory = factories[library.id];
    if (!factory) {
      const known = Object.keys(factories).sort();
      throw new UnknownProviderError(
        library.id,
        `Unknown component provider: "${library.id}". Known providers: ${known.join(", ")}.`,
      );
    }
    return factory(library);
  };
}
