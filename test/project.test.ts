import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadProject, relativeId } from "../src/project.js";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

describe("loadProject", () => {
  it("loads all non-declaration project files", () => {
    const project = loadProject(fixture("simple"));
    const ids = project.sourceFiles.map((sf) => relativeId(project.rootDir, sf.fileName)).sort();
    expect(ids).toEqual(["src/a.ts", "src/b/c.ts", "src/b/index.ts", "src/lazy.ts"]);
  });

  it("throws ConfigError when no tsconfig exists", () => {
    expect(() => loadProject("/nonexistent-dir-for-dagward-test")).toThrow(ConfigError);
  });
});
