import { used, alsoUnused } from "./lib";
import type { Thing } from "./lib";

// `used` is called, `Thing` is used as a type, `alsoUnused` is never used.
export function run(t: Thing): number {
  return used() + t.n;
}
