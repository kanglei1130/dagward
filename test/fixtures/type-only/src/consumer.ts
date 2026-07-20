import type { T } from "./types";
import { type A, makeT } from "./mixed";

export interface Consumer {
  t: T;
}

export function consume(): A {
  return { t: makeT(null) };
}
