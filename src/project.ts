import path from "node:path";
import ts from "typescript";

export class ConfigError extends Error {}

export interface Project {
  program: ts.Program;
  checker: ts.TypeChecker;
  options: ts.CompilerOptions;
  rootDir: string;
  sourceFiles: ts.SourceFile[];
}

export function relativeId(rootDir: string, fileName: string): string {
  return path.relative(rootDir, fileName).split(path.sep).join("/");
}

export function loadProject(searchDir: string, explicitConfig?: string): Project {
  const configPath =
    explicitConfig ?? ts.findConfigFile(searchDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath || !ts.sys.fileExists(configPath)) {
    throw new ConfigError(`No tsconfig.json found from ${searchDir}`);
  }

  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new ConfigError(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, host);
  if (!parsed) throw new ConfigError(`Failed to parse ${configPath}`);

  // dagward never emits — it only analyzes — so turning on unused-symbol
  // reporting is free here and lets findUnusedImports read the compiler's
  // own (JSX/type-aware) unused-import diagnostics off this one Program.
  parsed.options.noUnusedLocals = true;

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sf));

  return {
    program,
    checker: program.getTypeChecker(),
    options: parsed.options,
    rootDir: path.dirname(configPath),
    sourceFiles,
  };
}
