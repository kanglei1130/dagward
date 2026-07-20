import type { Consumer } from "./consumer";

export interface T {
  name: string;
}

export interface A {
  t: T;
}

export function makeT(c: Consumer | null): T {
  return { name: c ? "linked" : "t" };
}
