// Deliberately broken: a missing module, so it never compiles for the browser.
import { nothing } from "./does-not-exist";

export function Broken() {
  return <div>{nothing}</div>;
}
