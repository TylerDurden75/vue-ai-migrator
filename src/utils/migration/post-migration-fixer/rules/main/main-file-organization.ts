/**
 * Organize main.js/main.ts: imports at top, remove unused imports, clean structure
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

const IMPORT_REGEX = /^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*\n?/gm;

/**
 * Extract import statement and the names it brings into scope
 */
function parseImports(content: string): Array<{ fullMatch: string; names: string[]; from: string }> {
  const imports: Array<{ fullMatch: string; names: string[]; from: string }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(IMPORT_REGEX.source, "gms");
  while ((m = re.exec(content)) !== null) {
    const fullMatch = m[0];
    const clause = m[1].trim();
    const from = m[2];
    const names: string[] = [];
    if (clause.startsWith("{")) {
      const inner = clause.slice(1, -1).split(",");
      for (const n of inner) {
        const t = n.trim();
        const aliasMatch = t.match(/(\w+)\s+as\s+(\w+)/);
        names.push(aliasMatch ? aliasMatch[2] : t.split(/\s+/)[0] || "");
      }
    } else if (clause.startsWith("*")) {
      const asMatch = clause.match(/\*\s+as\s+(\w+)/);
      if (asMatch) names.push(asMatch[1]);
    } else if (clause) {
      names.push(clause);
    }
    imports.push({ fullMatch, names: names.filter(Boolean), from });
  }
  return imports;
}

/**
 * Check if a name is used in active code (exclude comments and its own import line)
 */
function isNameUsedInActiveCode(content: string, name: string): boolean {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (/^import\s+/.test(trimmed) && new RegExp(`\\b${escapeRegex(name)}\\b`).test(line)) continue; // skip own import
    const regex = new RegExp(`\\b${escapeRegex(name)}\\b`);
    if (regex.test(line)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove useless comments from main.js rest content (orphan section headers, dead Vue.filter lines)
 */
function removeUselessMainComments(rest: string): string {
  const lines = rest.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Orphan section headers from Vue 2 migration (Register global X)
    if (/^\/\/\s*Register global (mixin|filters|directives|component)\s*$/.test(trimmed)) continue;
    // Vue.filter commented lines (dead code - filters removed in Vue 3)
    if (/\/\/.*Vue\.filter\s*\(.*Filters removed in Vue 3/i.test(trimmed)) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Rewrite import { a, b, c } from 'x' to import { a, c } from 'x' (keep only used names)
 */
function rewriteImportRemoveUnused(
  fullMatch: string,
  allNames: string[],
  usedNames: string[],
  from: string
): string {
  const m = fullMatch.match(/^import\s+(.+?)\s+from\s+(['"][^'"]+['"])\s*;?\s*$/s);
  if (!m) return fullMatch;
  const clause = m[1].trim();
  const quote = fullMatch.includes('"') ? '"' : "'";
  if (clause.startsWith("{")) {
    const inner = clause.slice(1, -1).split(",").map((s) => s.trim());
    const origMap = new Map<string, string>();
    for (const item of inner) {
      const aliasMatch = item.match(/(\w+)\s+as\s+(\w+)/);
      const localName = aliasMatch ? aliasMatch[2] : item.split(/\s+/)[0];
      origMap.set(localName, item);
    }
    const kept = usedNames.map((n) => origMap.get(n)).filter(Boolean) as string[];
    const newClause = kept.length > 0 ? `{ ${kept.join(", ")} }` : "";
    if (newClause) {
      return `import ${newClause} from ${quote}${from}${quote};\n`;
    }
  }
  return fullMatch;
}

export const mainFileOrganizationRule: FixRule = {
  id: "main-file-organization",
  description: "Organize main.js/main.ts: imports at top, remove unused imports",
  priority: 93,
  dependencies: ["vue2-global-api"],
  shouldApply: (filePath) => {
    return filePath.includes("main.js") || filePath.includes("main.ts");
  },
  apply: async (_filePath, content, _context: FixContext): Promise<FixRuleResult> => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;

    const imports = parseImports(fixed);
    if (imports.length === 0) return result;

    const importLines: string[] = [];

    for (const imp of imports) {
      const usedNames = imp.names.filter((n) => isNameUsedInActiveCode(fixed, n));
      const allUnused = usedNames.length === 0 && imp.names.length > 0;
      if (allUnused) {
        let toRemove = imp.fullMatch;
        const idx = fixed.indexOf(toRemove);
        if (idx > 0) {
          const before = fixed.slice(0, idx);
          const lines = before.split("\n");
          const prevLine = lines.length >= 2 ? lines[lines.length - 2] + "\n" : lines[lines.length - 1] || "";
          const prevTrimmed = prevLine.trim();
          if (prevTrimmed && /^\s*\/\/[^/].*$/.test(prevTrimmed) && !prevTrimmed.toLowerCase().includes("import")) {
            toRemove = prevLine + toRemove;
            fixed = fixed.replace(toRemove, "\n");
          } else {
            fixed = fixed.replace(toRemove, "");
          }
        } else {
          fixed = fixed.replace(toRemove, "");
        }
        result.fixed = true;
        result.fixes.push(`Removed unused import from ${imp.from}`);
      } else if (usedNames.length > 0 && usedNames.length < imp.names.length && imp.fullMatch.includes("{")) {
        const newLine = rewriteImportRemoveUnused(imp.fullMatch, imp.names, usedNames, imp.from);
        fixed = fixed.replace(imp.fullMatch, newLine);
        result.fixed = true;
        result.fixes.push(`Removed unused names from import ${imp.from}`);
        importLines.push(newLine.trim());
      } else {
        importLines.push(imp.fullMatch.trim());
      }
    }

    if (importLines.length === 0) {
      result.content = fixed.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trim() + "\n";
      return result;
    }

    const importBlock = importLines.join("\n");
    const restRe = /^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?\s*\n?/gm;
    let restWithoutImports = fixed.replace(restRe, "");
    restWithoutImports = restWithoutImports.replace(/^\s*\n+/, "");

    // Remove useless comments (orphan section headers, dead Vue.filter lines)
    const cleanedRest = removeUselessMainComments(restWithoutImports);
    if (cleanedRest !== restWithoutImports) {
      restWithoutImports = cleanedRest;
      result.fixed = true;
      result.fixes.push("Removed useless comments");
    }

    const newContent = `${importBlock}\n\n${restWithoutImports}`.replace(/\n{3,}/g, "\n\n").trim();

    if (newContent !== content.trim()) {
      result.content = newContent + "\n";
      result.fixed = true;
      result.fixes.push("Organized imports at top");
    }

    return result;
  },
};
