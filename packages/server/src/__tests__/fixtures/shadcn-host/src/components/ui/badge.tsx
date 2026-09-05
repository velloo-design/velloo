const missingRuntime = require("@/does-not-exist").missingRuntime;

export function Badge(props: Record<string, unknown>) {
  return <div {...props}>{missingRuntime}</div>;
}
