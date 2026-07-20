import { fromB } from "./b";

export async function main(): Promise<string> {
  const lazy = await import("./lazy");
  return fromB() + lazy.lazyValue;
}

declare const someVar: string;
export function unsafe(): Promise<unknown> {
  return import(someVar);
}
