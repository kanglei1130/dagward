import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-test-"));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("cli", () => {
  it("writes all output files for a fixture project", () => {
    const fixture = path.join(__dirname, "fixtures", "simple");
    const code = main(["init", fixture, "--out", tmpDir]);
    expect(code).toBe(0);

    const written = fs.readdirSync(tmpDir).sort();
    expect(written).toEqual([
      "ARCHITECTURE.md",
      "graph.files.json",
      "graph.folders.json",
      "graph.functions.json",
      "graph.unified.json",
    ]);

    const files = JSON.parse(fs.readFileSync(path.join(tmpDir, "graph.files.json"), "utf8"));
    expect(files.version).toBe(1);
    expect(files.level).toBe("file");

    const unified = JSON.parse(fs.readFileSync(path.join(tmpDir, "graph.unified.json"), "utf8"));
    expect(unified.level).toBe("unified");
    // module nodes (file ids, no #) + function nodes (with #)
    expect(unified.nodes.some((n: { id: string }) => n.id.includes("#"))).toBe(true);
    expect(unified.nodes.some((n: { id: string }) => !n.id.includes("#"))).toBe(true);
  });

  it("returns 2 for a directory without a tsconfig", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-empty-"));
    try {
      expect(main(["init", emptyDir])).toBe(2);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown commands", () => {
    expect(main(["frobnicate"])).toBe(2);
  });

  it("preserves node annotations when regenerating graphs", () => {
    const fixture = path.join(__dirname, "fixtures", "simple");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-ann-"));
    try {
      expect(main(["init", fixture, "--out", dir])).toBe(0);
      const graphFile = path.join(dir, "graph.files.json");
      const graph = JSON.parse(fs.readFileSync(graphFile, "utf8"));
      const node = graph.nodes.find((n: { id: string }) => n.id === "src/a.ts");
      node.annotation = { summary: "entry module", side: "shared", pure: false };
      fs.writeFileSync(graphFile, JSON.stringify(graph));

      expect(main(["init", fixture, "--out", dir])).toBe(0);
      const regen = JSON.parse(fs.readFileSync(graphFile, "utf8"));
      expect(regen.nodes.find((n: { id: string }) => n.id === "src/a.ts").annotation).toEqual({
        summary: "entry module",
        side: "shared",
        pure: false,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check exits 0 on a clean fixture with committed rules", () => {
    const fixture = path.join(__dirname, "fixtures", "simple");
    expect(main(["check", fixture])).toBe(0);
  });

  it("check exits 1 and prints violation JSON when a rule is broken", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-check-"));
    try {
      fs.cpSync(path.join(__dirname, "fixtures", "simple"), dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "dagward.yml"),
        [
          "version: 1",
          "rules:",
          "  - id: no-a-to-b",
          "    type: forbidden-edge",
          '    from: "src/a.ts"',
          '    to: "src/b/**"',
          "    rationale: a must not reach b",
          "    fix: invert the dependency",
        ].join("\n"),
      );
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((m: string) => {
        logs.push(m);
      });
      try {
        expect(main(["check", dir])).toBe(1);
      } finally {
        spy.mockRestore();
      }
      const output = JSON.parse(logs.join("")) as {
        violations: { rule: string; edge: { from: string }; fix?: string }[];
      };
      expect(output.violations).toHaveLength(1);
      expect(output.violations[0]).toMatchObject({
        rule: "no-a-to-b",
        edge: { from: "src/a.ts" },
        fix: "invert the dependency",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check without a dagward.yml exits 2", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-checkempty-"));
    try {
      expect(main(["check", emptyDir])).toBe(2);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("viz writes viz.html from existing graph outputs", () => {
    const fixture = path.join(__dirname, "fixtures", "simple");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-viz-"));
    try {
      expect(main(["init", fixture, "--out", dir])).toBe(0);
      expect(main(["viz", fixture, "--out", dir, "--no-open"])).toBe(0);
      const html = fs.readFileSync(path.join(dir, "viz.html"), "utf8");
      expect(html).toContain("application/json");
      expect(html).toContain("src/a.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("viz without prior graph outputs returns 2", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dagward-vizempty-"));
    try {
      expect(main(["viz", emptyDir, "--no-open"])).toBe(2);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
