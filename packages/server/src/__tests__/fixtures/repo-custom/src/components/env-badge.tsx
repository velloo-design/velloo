// Read at module load, as Next's own client modules do — with no `process` in
// the browser bundle this throws before any component renders.
const MODE = process.env.VELLOO_FIXTURE_MODE ?? "unset";

export function EnvBadge() {
  return <span data-env-mode={MODE}>env</span>;
}
