/**
 * Rules for replacing Vuex this.$store.getters / this.$store.dispatch with Pinia in .vue files
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getStoreMethodMap } from "../utils/store-analysis-cache";

function moduleToStore(module: string): { storeVar: string; storeName: string; importPath: string } {
  if (module === "index") {
    return { storeVar: "indexStore", storeName: "useIndexStore", importPath: "@/store/index" };
  }
  const storeVar = `${module}Store`;
  const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
  const importPath = `@/store/modules/${module}`;
  return { storeVar, storeName, importPath };
}

/** Find the position of the closing paren that matches the open paren at startIdx */
function findMatchingParen(content: string, startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Fix: Replace this.$store.getters['module/getter'] and this.$store.dispatch('module/action')
 * with Pinia store usage. Also handles getters.property and dispatch('action') when projectRoot
 * is available (uses store analysis to infer module).
 */
export const vueStoreVuexToPiniaRule: FixRule = {
  id: "vue-store-vuex-to-pinia",
  description: "Replace this.$store.getters and this.$store.dispatch with Pinia stores in .vue",
  priority: 84,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script setup") &&
      (content.includes("this.$store.getters") || content.includes("this.$store.dispatch"))
    );
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      return result;
    }

    const openTag = scriptMatch[0].slice(0, scriptMatch[0].indexOf(">") + 1);
    let scriptContent = scriptMatch[1];

    const storesToAdd = new Map<
      string,
      { storeVar: string; storeName: string; importPath: string }
    >();

    const ensureStore = (module: string) => {
      const { storeVar, storeName, importPath } = moduleToStore(module);
      if (!storesToAdd.has(storeVar)) {
        storesToAdd.set(storeVar, { storeVar, storeName, importPath });
      }
    };

    // 1) this.$store.getters['module/getter'] → storeVar.getter
    scriptContent = scriptContent.replace(
      /this\.\$store\.getters\s*\[\s*['"]([^'"]+)\/([^'"]+)['"]\s*\]/g,
      (_match, module, getter) => {
        ensureStore(module);
        const { storeVar } = moduleToStore(module);
        return `${storeVar}.${getter}`;
      }
    );

    // 2) this.$store.dispatch('module/action') and this.$store.dispatch('module/action', args)
    const dispatchWithModuleRe = /this\.\$store\.dispatch\s*\(\s*['"]([^'"]+)\/([^'"]+)['"]/g;
    let dispatchMatch;
    const dispatchReplacements: Array<{ start: number; end: number; replacement: string }> = [];
    while ((dispatchMatch = dispatchWithModuleRe.exec(scriptContent)) !== null) {
      const module = dispatchMatch[1];
      const action = dispatchMatch[2];
      const startParen = scriptContent.indexOf("(", dispatchMatch.index);
      const endParen = findMatchingParen(scriptContent, startParen);
      if (endParen === -1) continue;
      const afterQuote = scriptContent.slice(
        dispatchMatch.index + dispatchMatch[0].length,
        endParen + 1
      );
      const argsMatch = afterQuote.match(/^\s*,\s*([\s\S]*)\s*\)\s*$/);
      const args = argsMatch ? argsMatch[1].trim() : "";
      ensureStore(module);
      const { storeVar } = moduleToStore(module);
      const replacement = args ? `${storeVar}.${action}(${args})` : `${storeVar}.${action}()`;
      dispatchReplacements.push({ start: dispatchMatch.index, end: endParen + 1, replacement });
    }
    for (const { start, end, replacement } of dispatchReplacements.sort((a, b) => b.start - a.start)) {
      scriptContent = scriptContent.slice(0, start) + replacement + scriptContent.slice(end);
    }

    // 3) this.$store.getters.property and this.$store.dispatch('action') without module
    let storeMethodMap: Record<string, string> = {};
    if (context.projectRoot) {
      storeMethodMap = await getStoreMethodMap(context.projectRoot);
    }

    // this.$store.getters.property → storeVar.property (use storeMethodMap or fallback to index)
    scriptContent = scriptContent.replace(
      /this\.\$store\.getters\.(\w+)/g,
      (_match, property) => {
        const module = storeMethodMap[property] ?? "index";
        ensureStore(module);
        const { storeVar } = moduleToStore(module);
        return `${storeVar}.${property}`;
      }
    );

    // this.$store.dispatch('action') or this.$store.dispatch('action', args) → storeVar.action()
    const dispatchNoModuleRe = /this\.\$store\.dispatch\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([\s\S]*?))?\s*\)/g;
    let dispMatch;
    const dispReplacements: Array<{ start: number; end: number; replacement: string }> = [];
    while ((dispMatch = dispatchNoModuleRe.exec(scriptContent)) !== null) {
      const action = dispMatch[1];
      const args = dispMatch[2]?.trim() ?? "";
      const module = storeMethodMap[action] ?? "index";
      ensureStore(module);
      const { storeVar } = moduleToStore(module);
      const endParen = findMatchingParen(scriptContent, scriptContent.indexOf("(", dispMatch.index));
      const replacement = args ? `${storeVar}.${action}(${args})` : `${storeVar}.${action}()`;
      dispReplacements.push({ start: dispMatch.index, end: endParen + 1, replacement });
    }
    for (const { start, end, replacement } of dispReplacements.sort((a, b) => b.start - a.start)) {
      scriptContent = scriptContent.slice(0, start) + replacement + scriptContent.slice(end);
    }

    if (storesToAdd.size === 0 && scriptContent === scriptMatch[1]) {
      return result;
    }

    for (const { storeVar, storeName, importPath } of storesToAdd.values()) {
      if (!scriptContent.includes(`from '${importPath}'`) && !scriptContent.includes(`from "${importPath}"`)) {
        const importLine = `import { ${storeName} } from '${importPath}';\n`;
        const importBlockMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        const insertIdx = importBlockMatch ? importBlockMatch[0].length : 0;
        scriptContent = scriptContent.slice(0, insertIdx) + importLine + scriptContent.slice(insertIdx);
      }
      if (!scriptContent.includes(`const ${storeVar} = ${storeName}()`)) {
        const initLine = `const ${storeVar} = ${storeName}();\n`;
        const importBlockMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        const insertIdx = importBlockMatch ? importBlockMatch[0].length : 0;
        scriptContent = scriptContent.slice(0, insertIdx) + initLine + scriptContent.slice(insertIdx);
      }
    }

    result.content = content.replace(
      /<script\s+setup[^>]*>[\s\S]*?<\/script>/,
      `${openTag}${scriptContent}</script>`
    );
    result.fixed = true;
    result.fixes.push(
      `Replaced this.$store.getters/dispatch with Pinia stores (${Array.from(storesToAdd.keys()).join(", ")})`
    );

    return result;
  }
};
