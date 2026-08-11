/** Convert canvas string path "0.2.1" → [0, 2, 1]. Empty string → []. */
export function pathFromString(s: string): number[] {
  if (s === "") return [];
  return s.split(".").map((p) => Number(p));
}

export function pathToString(p: number[]): string {
  return p.join(".");
}
