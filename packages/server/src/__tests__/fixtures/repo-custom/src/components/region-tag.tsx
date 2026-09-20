import { useFixtureStore } from "../store";

/** Takes no props worth previewing: its content comes from the store. */
export function RegionTag() {
  const region = useFixtureStore((state) => state.region);
  return <span data-region={region}>{region}</span>;
}
