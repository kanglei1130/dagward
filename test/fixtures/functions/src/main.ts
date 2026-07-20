import { helper } from "./util";

export function main(): number[] {
  const arr = [1, 2, 3];
  return arr.map(helper).map((n) => n + helper());
}

export const startup = helper();
