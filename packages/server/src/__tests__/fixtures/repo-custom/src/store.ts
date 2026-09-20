export function useFixtureStore<T>(select: (state: { region: string }) => T): T {
  return select({ region: "eu-west" });
}
