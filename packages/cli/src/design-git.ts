import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { localDesignOf, managedDesignId } from "@velloo/server";

/**
 * Environment for a git process run against a design folder. Git is optional,
 * so repository discovery must not borrow an unrelated one from an ancestor:
 * it never climbs to the home directory (a repository there is a dotfiles
 * checkout, not the design's), and a local design only counts a repository
 * rooted at the folder itself — whatever holds it (Velloo's storage, or the
 * directory the user picked) is not the project the design belongs to.
 */
export function designGitEnv(folder: string): NodeJS.ProcessEnv {
  const ceilings = [homedir()];
  if (managedDesignId(folder) || localDesignOf(folder)) ceilings.push(dirname(resolve(folder)));
  const inherited = process.env.GIT_CEILING_DIRECTORIES;
  if (inherited) ceilings.push(inherited);
  return { ...process.env, GIT_CEILING_DIRECTORIES: ceilings.join(delimiter) };
}
