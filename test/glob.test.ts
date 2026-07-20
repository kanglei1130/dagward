import { describe, expect, it } from "vitest";
import { globToRegExp } from "../src/glob.js";

describe("globToRegExp", () => {
  it("** matches across path segments", () => {
    const re = globToRegExp("packages/domain/**");
    expect(re.test("packages/domain/src/a.ts")).toBe(true);
    expect(re.test("packages/domain/x")).toBe(true);
    expect(re.test("packages/app/src/a.ts")).toBe(false);
  });

  it("* stays within one segment", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/sub/a.ts")).toBe(false);
  });

  it("escapes literal dots", () => {
    expect(globToRegExp("a.ts").test("axts")).toBe(false);
    expect(globToRegExp("a.ts").test("a.ts")).toBe(true);
  });

  it("matches exact paths without wildcards", () => {
    const re = globToRegExp("src/graph.ts");
    expect(re.test("src/graph.ts")).toBe(true);
    expect(re.test("src/graph.tsx")).toBe(false);
  });
});
