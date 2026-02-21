/**
 * Replace mixins: [X] with useX() composable when mixin was converted
 */

import * as path from "path";
import type { FixRule, FixContext, FixRuleResult } from "../../types";

export const mixinsToComposablesRule: FixRule = {
  id: "mixins-to-composables",
  description: "Replace mixins with composable when mixin was converted",
  priority: 60,

  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith(".vue") || filePath.endsWith(".ts") || filePath.endsWith(".js")) &&
      /mixins\s*:\s*\[/.test(content)
    );
  },

  apply: async (filePath, content, context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };

    const map = context.mixinComposablesMap;
    if (!map || map.size === 0) return result;

    const mixinsMatch = content.match(/mixins\s*:\s*\[([^\]]+)\]/);
    if (!mixinsMatch) return result;

    const mixinRefs = mixinsMatch[1].split(",").map((s) => s.trim());
    const replacements: Array<{
      ref: string;
      composableName: string;
      returnKeys: string[];
      importPath: string;
    }> = [];

    const fileDir = path.dirname(filePath);
    const projectRoot = context.projectRoot ?? fileDir;

    const resolveImport = (imp: string): string => {
      if (imp.startsWith("@/")) {
        return path.join(projectRoot, "src", imp.slice(2));
      }
      return path.resolve(fileDir, imp);
    };

    // Resolve mixin import path to absolute path for map lookup
    const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    const importMap = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(content)) !== null) {
      importMap.set(m[1], resolveImport(m[2]));
    }

    for (const ref of mixinRefs) {
      const varMatch = ref.match(/(\w+)/);
      const varName = varMatch?.[1];
      if (!varName) continue;

      const resolvedPath = importMap.get(varName);
      if (resolvedPath) {
        const absPath = path.resolve(resolvedPath);
        let info = map.get(absPath);
        if (!info) {
          info = map.get(absPath + ".js");
          if (!info) info = map.get(absPath + ".ts");
        }
        if (info) {
          replacements.push({
            ref: varName,
            composableName: info.composableName,
            returnKeys: info.returnKeys,
            importPath: `@/composables/${info.composableName}`,
          });
          continue;
        }
      }

      // Fallback: heuristic match by variable name
      for (const [, info] of map) {
        const useName = info.composableName.replace(/^use/, "");
        if (
          varName.toLowerCase().includes(useName.toLowerCase()) ||
          info.composableName === `use${varName}`
        ) {
          replacements.push({
            ref: varName,
            composableName: info.composableName,
            returnKeys: info.returnKeys,
            importPath: `@/composables/${info.composableName}`,
          });
          break;
        }
      }
    }

    if (replacements.length === 0) return result;

    let modified = content;
    const importLines: string[] = [];
    const composableCalls: string[] = [];

    for (const r of replacements) {
      importLines.push(`import { ${r.composableName} } from '${r.importPath}';`);
      const destructure =
        r.returnKeys.length > 0
          ? `const { ${r.returnKeys.join(", ")} } = ${r.composableName}();`
          : `const _${r.ref} = ${r.composableName}();`;
      composableCalls.push(destructure);
    }

    const firstImport = modified.match(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?/m);
    const insertPos = firstImport ? (firstImport.index ?? 0) + (firstImport[0]?.length ?? 0) : 0;
    const newImports = importLines.join("\n") + "\n";
    modified = modified.slice(0, insertPos) + newImports + modified.slice(insertPos);

    const mixinsBlock = mixinsMatch[0];
    if (modified.indexOf(mixinsBlock) >= 0) {
      const composableBlock = composableCalls.join("\n  ") + "\n  ";
      modified = modified.replace(mixinsBlock, "").replace(/,\s*,/g, ",");
      const scriptMatch = modified.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        const script = scriptMatch[1];
        const firstStmt = script.match(/\n?(?:const|let|import|function)\s/);
        const stmtPos = firstStmt ? script.indexOf(firstStmt[0]) : 0;
        const newScript =
          script.slice(0, stmtPos) +
          composableBlock +
          script.slice(stmtPos);
        modified = modified.replace(scriptMatch[1], newScript);
      }
      result.fixed = true;
      result.fixes.push(`Replaced mixins with composables: ${replacements.map((r) => r.composableName).join(", ")}`);
    }

    result.content = modified;
    return result;
  },
};
