import { packageOf } from "../discover.ts";
import { mantineRecipe } from "./mantine.ts";
import type { FrameworkRecipe } from "./types.ts";

export type { FrameworkRecipe } from "./types.ts";

/** Every built-in recipe. Adding a library = one entry here. */
const RECIPES: readonly FrameworkRecipe[] = [mantineRecipe];

/** Recipes whose primary package the host app has installed. */
export function recipesForHost(hostRoot: string): FrameworkRecipe[] {
  return RECIPES.filter((recipe) => {
    const primary = recipe.packages[0];
    if (!primary) return false;
    try {
      Bun.resolveSync(`${primary}/package.json`, hostRoot);
      return true;
    } catch {
      return false;
    }
  });
}

/** The recipe that speaks for a module specifier's package, if any. */
export function recipeForSpecifier(specifier: string): FrameworkRecipe | undefined {
  const pkg = packageOf(specifier);
  return RECIPES.find((recipe) => recipe.packages.includes(pkg));
}
