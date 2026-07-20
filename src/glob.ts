// Minimal glob subset for rule patterns: `**` matches across path segments,
// `*` matches within one segment. No braces, no `?`, no negation.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (/[A-Za-z0-9_/-]/.test(ch)) {
      re += ch;
    } else {
      re += "\\" + ch;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}
