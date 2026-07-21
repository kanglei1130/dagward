import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProject } from "../src/project.js";
import { findUnusedImports } from "../src/unusedImports.js";

describe("findUnusedImports", () => {
  it("flags only the genuinely-unused named import, not used values or used types", () => {
    const project = loadProject(path.join(__dirname, "fixtures", "unused"));
    const unused = findUnusedImports(project);
    // main.ts imports { used, alsoUnused } and type { Thing }; only alsoUnused
    // is dead. `used` (called) and `Thing` (used in a type position) are live.
    expect(unused).toHaveLength(1);
    expect(unused[0]).toMatchObject({ file: "src/main.ts", specifier: "./lib" });
    expect(unused[0].message).toContain("alsoUnused");
  });
});
