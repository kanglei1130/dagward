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

  it("expands brace alternatives", () => {
    const re = globToRegExp("src/{components,hooks,store}/**");
    expect(re.test("src/components/ui/button.tsx")).toBe(true);
    expect(re.test("src/hooks/use-mobile.tsx")).toBe(true);
    expect(re.test("src/store/use-auth.ts")).toBe(true);
    expect(re.test("src/lib/prisma.ts")).toBe(false);
    expect(re.test("src/components,hooks/x.ts")).toBe(false); // not a literal comma
  });

  it("expands nested braces", () => {
    const re = globToRegExp("src/{db,lib/{auth,services}}/**");
    expect(re.test("src/db/prisma.ts")).toBe(true);
    expect(re.test("src/lib/auth/jwt.ts")).toBe(true);
    expect(re.test("src/lib/services/geocoding.ts")).toBe(true);
    expect(re.test("src/lib/helper/formatter.ts")).toBe(false);
  });

  it("rejects unbalanced braces instead of silently matching nothing", () => {
    expect(() => globToRegExp("src/{a,b/**")).toThrow(/unbalanced/);
  });
});
