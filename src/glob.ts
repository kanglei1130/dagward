// Minimal glob subset for rule patterns: `**` matches across path segments,
// `*` matches within one segment, `{a,b}` alternates (nestable). No `?`, no
// negation.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "{") {
      braceDepth++;
      re += "(?:";
    } else if (ch === "}" && braceDepth > 0) {
      braceDepth--;
      re += ")";
    } else if (ch === "," && braceDepth > 0) {
      re += "|";
    } else if (/[A-Za-z0-9_/-]/.test(ch)) {
      re += ch;
    } else {
      re += "\\" + ch;
    }
  }
  if (braceDepth !== 0) throw new Error(`unbalanced { } in glob pattern: ${glob}`);
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}
