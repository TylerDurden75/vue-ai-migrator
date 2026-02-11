/**
 * Rules for fixing Pinia store issues
 */

import * as fs from "fs/promises";
import { glob } from "glob";
import type { FixRule, FixContext, FixRuleResult } from "../../types";

/** Find the index of the closing brace that matches the opening brace at startIdx */
function findMatchingBrace(content: string, startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Find the index of the closing paren that matches the opening paren at startIdx */
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
 * Fix: Make functions async if they use await (generic: any function with await).
 * Handles nested braces (try/finally, etc.) by matching brace depth.
 */
export const asyncFunctionRule: FixRule = {
  id: "async-functions",
  description: "Make functions async if they use await",
  priority: 90,
  shouldApply: (filePath, content) => {
    // Apply to any JS/TS/Vue file that uses await or has duplicate async (stores, components, composables, etc.)
    const isScriptFile = /\.(ts|js|vue)$/i.test(filePath);
    return isScriptFile && (content.includes("await") || content.includes("async async"));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Pattern: function name(params): returnType { ... } - use findMatchingParen for params with nested ()
    const replacements: Array<{ start: number; end: number; funcName: string; replacement: string }> = [];
    let i = 0;
    while ((i = content.indexOf("function ", i)) !== -1) {
      if (content.substring(i, i + 15) === "async function ") {
        i++;
        continue;
      }
      const nameMatch = content.slice(i + 9).match(/^(\w+)\s*\(/);
      if (!nameMatch) {
        i++;
        continue;
      }
      const parenStart = i + 9 + nameMatch[0].indexOf("(");
      const parenEnd = findMatchingParen(content, parenStart);
      if (parenEnd === -1) {
        i++;
        continue;
      }
      const afterParams = content.slice(parenEnd + 1);
      const braceMatch = afterParams.match(/^\s*(?::\s*[^{]+)?\s*\{/);
      if (!braceMatch) {
        i++;
        continue;
      }
      const braceStart = parenEnd + 1 + braceMatch[0].indexOf("{");
      const braceEnd = findMatchingBrace(content, braceStart);
      if (braceEnd === -1) {
        i++;
        continue;
      }
      const body = content.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) {
        i++;
        continue;
      }
      const full = content.slice(i, braceEnd + 1);
      let replacement = full.replace(/^function\s+/, "async function ");
      const returnTypeMatch = full.match(/\)\s*:\s*([^{]+)\s*\{/);
      if (returnTypeMatch) {
        const returnType = returnTypeMatch[1].trim();
        const newReturnType = returnType.startsWith("Promise<") ? returnType : `Promise<${returnType}>`;
        replacement = replacement.replace(
          new RegExp(`\\)\\s*:\\s*${returnType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`),
          "): " + newReturnType + " {"
        );
      }
      replacements.push({ start: i, end: braceEnd + 1, funcName: nameMatch[1], replacement });
      i = braceEnd + 1;
    }

    // Pattern: object method name(params) { - no "function" keyword, no return type before {
    const objectMethodBlocklist = new Set(["function", "defineStore", "state", "actions", "getters", "mutations", "if", "for", "while", "switch", "catch"]);
    const methodShorthandRe = /(\w+)\s*\(/g;
    let match;
    while ((match = methodShorthandRe.exec(content)) !== null) {
      const methodName = match[1];
      if (objectMethodBlocklist.has(methodName) || content.substring(match.index, match.index + 6) === "async ") continue;
      if (content.substring(Math.max(0, match.index - 9), match.index) === "function ") continue;
      const parenStart = match.index + match[0].indexOf("(");
      const parenEnd = findMatchingParen(content, parenStart);
      if (parenEnd === -1) continue;
      const afterParams = content.slice(parenEnd + 1);
      if (!/^\s*\{/.test(afterParams)) continue; // must be ) followed by { (no return type)
      const braceStart = parenEnd + 1 + afterParams.match(/^\s*/)![0].length;
      const braceEnd = findMatchingBrace(content, braceStart);
      if (braceEnd === -1) continue;
      const body = content.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) continue;
      const full = content.slice(match.index, braceEnd + 1);
      const replacement = "async " + full;
      replacements.push({ start: match.index, end: braceEnd + 1, funcName: methodName, replacement });
    }

    if (replacements.length > 0) {
      const sorted = replacements.sort((a, b) => a.start - b.start);
      let built = "";
      let lastEnd = 0;
      for (const { start, end, replacement, funcName } of sorted) {
        built += fixed.slice(lastEnd, start) + replacement;
        lastEnd = end;
        result.fixed = true;
        result.fixes.push(funcName ? `Made function ${funcName} async (uses await)` : "Made function async (uses await)");
      }
      built += fixed.slice(lastEnd);
      fixed = built;
    }

    // Pattern: const name = () => { ... await ... } - non-greedy match
    const arrowRe = /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*\{/g;
    while ((match = arrowRe.exec(fixed)) !== null) {
      const braceStart = fixed.indexOf("{", match.index);
      const braceEnd = findMatchingBrace(fixed, braceStart);
      if (braceEnd === -1) continue;
      const body = fixed.slice(braceStart + 1, braceEnd);
      if (!body.includes("await") || fixed.slice(match.index, match.index + 10).includes("async")) continue;
      const full = fixed.slice(match.index, braceEnd + 1);
      const asyncVersion = full.replace(/const\s+(\w+)\s*=\s*\(/, "const $1 = async (");
      fixed = fixed.slice(0, match.index) + asyncVersion + fixed.slice(braceEnd + 1);
      result.fixed = true;
      result.fixes.push("Made arrow function async (uses await)");
    }

    // Pattern: methodName: () => { ... await ... } (object property arrow)
    const propArrowRe = /(\w+)\s*:\s*\([^)]*\)\s*=>\s*\{/g;
    while ((match = propArrowRe.exec(fixed)) !== null) {
      if (fixed.slice(match.index, match.index + 15).includes("async")) continue;
      const braceStart = fixed.indexOf("{", match.index);
      const braceEnd = findMatchingBrace(fixed, braceStart);
      if (braceEnd === -1) continue;
      const body = fixed.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) continue;
      const full = fixed.slice(match.index, braceEnd + 1);
      const asyncVersion = full.replace(/^(\w+)\s*:\s*\(/, "$1: async (");
      fixed = fixed.slice(0, match.index) + asyncVersion + fixed.slice(braceEnd + 1);
      result.fixed = true;
      result.fixes.push("Made arrow function async (uses await)");
    }

    // Pattern: onMounted(() => { ... await ... }), onBeforeMount(() => { ... }), watch(() => ..., async () => {}), etc.
    const callbackArrowRe = /(onMounted|onBeforeMount|onUpdated|onUnmounted|onBeforeUnmount|watch)\s*\(\s*\(([^)]*)\)\s*=>\s*\{/g;
    while ((match = callbackArrowRe.exec(fixed)) !== null) {
      if (fixed.slice(match.index, match.index + 20).includes("async")) continue;
      const braceStart = fixed.indexOf("{", match.index);
      const braceEnd = findMatchingBrace(fixed, braceStart);
      if (braceEnd === -1) continue;
      const body = fixed.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) continue;
      const full = fixed.slice(match.index, braceEnd + 1);
      const asyncVersion = full.replace(/(\()\s*\(/, "$1async (");
      fixed = fixed.slice(0, match.index) + asyncVersion + fixed.slice(braceEnd + 1);
      result.fixed = true;
      result.fixes.push("Made lifecycle/watch callback async (uses await)");
    }

    // Pattern: param => { ... await ... } - single param without parens (e.g. historyValue => { await x })
    const paramArrowRe = /(\w+)\s*=>\s*\{/g;
    const paramArrowReplacements: Array<{ start: number; end: number; replacement: string }> = [];
    while ((match = paramArrowRe.exec(fixed)) !== null) {
      if (fixed.slice(Math.max(0, match.index - 10), match.index + 15).includes("async")) continue;
      const braceStart = fixed.indexOf("{", match.index);
      const braceEnd = findMatchingBrace(fixed, braceStart);
      if (braceEnd === -1) continue;
      const body = fixed.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) continue;
      const full = fixed.slice(match.index, braceEnd + 1);
      const asyncVersion = full.replace(/^(\w+)\s*=>\s*\{/, "async $1 => {");
      if (asyncVersion !== full) {
        paramArrowReplacements.push({ start: match.index, end: braceEnd + 1, replacement: asyncVersion });
      }
    }
    for (let i = paramArrowReplacements.length - 1; i >= 0; i--) {
      const { start, end, replacement } = paramArrowReplacements[i];
      fixed = fixed.slice(0, start) + replacement + fixed.slice(end);
      result.fixed = true;
      result.fixes.push("Made arrow function async (uses await)");
    }

    // Pattern: (param) or (param1, param2) => { ... await ... } - arrow with params in parens (e.g. .then((res) => { await x }))
    // Use lookbehind to match the arrow's ( not the preceding .then( - so we match (res) not ((res)
    const parenArrowRe = /(?<=[,({\s])\(\s*[^)]*\s*\)\s*=>\s*\{/g;
    const parenArrowReplacements: Array<{ start: number; end: number; replacement: string }> = [];
    while ((match = parenArrowRe.exec(fixed)) !== null) {
      if (fixed.slice(Math.max(0, match.index - 15), match.index + 20).includes("async")) continue;
      const braceStart = fixed.indexOf("{", match.index);
      const braceEnd = findMatchingBrace(fixed, braceStart);
      if (braceEnd === -1) continue;
      const body = fixed.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) continue;
      const full = fixed.slice(match.index, braceEnd + 1);
      const asyncVersion = full.replace(/^\(\s*([^)]*)\s*\)\s*=>\s*\{/, "async ($1) => {");
      if (asyncVersion !== full) {
        parenArrowReplacements.push({ start: match.index, end: braceEnd + 1, replacement: asyncVersion });
      }
    }
    for (let i = parenArrowReplacements.length - 1; i >= 0; i--) {
      const { start, end, replacement } = parenArrowReplacements[i];
      fixed = fixed.slice(0, start) + replacement + fixed.slice(end);
      result.fixed = true;
      result.fixes.push("Made arrow function async (uses await)");
    }

    while (fixed.includes("async async")) {
      fixed = fixed.replace(/async\s+async\s+/g, "async ");
    }
    result.content = fixed;
    return result;
  }
};

/**
 * Fix: Remove duplicate keys in store return objects
 */
export const duplicateKeysRule: FixRule = {
  id: "duplicate-keys",
  description: "Remove duplicate keys in store return objects",
  priority: 20,
  dependencies: ["async-functions"],
  shouldApply: (filePath, content) => {
    return filePath.includes("/store/") && content.includes("return {");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // For .ts/.js files (Pinia stores), use content directly
    // For .vue files, use scriptContent
    const sourceContent = filePath.endsWith('.vue') ? _context.scriptContent : content;
    
    if (!sourceContent) {
      return result;
    }

    let fixed = sourceContent;
    let hasChanges = false;

    // Find the return block - handle both .ts/.js files and .vue files
    // Pattern: return { ... };
    const returnMatch = fixed.match(/return\s+\{([\s\S]*?)\}\s*;?\s*\)/);
    if (!returnMatch) {
      return result;
    }

    const returnBlock = returnMatch[1];
    const lines = returnBlock.split('\n');
    const seenKeys = new Map<string, { lineIndex: number; value: string; isComputed: boolean; fullLine: string }>();

    // First pass: identify all key-value pairs
    lines.forEach((line, index) => {
      // Match patterns like: key: value, or key: valueComputed,
      // Handle both with and without trailing comma
      const match = line.match(/^\s*(\w+):\s*(\w+)(?:,)?\s*$/);
      if (match) {
        const key = match[1];
        const value = match[2];
        // Check if value is a computed property (ends with Computed or is defined as computed)
        const isComputed = value.toLowerCase().endsWith('computed') || 
                          value.toLowerCase().includes('computed') ||
                          sourceContent.includes(`const ${value} = computed`) ||
                          sourceContent.includes(`const ${value}Computed = computed`);
        
        if (seenKeys.has(key)) {
          const existing = seenKeys.get(key)!;
          // Prefer ref over computed: duplicate keys keep the ref (source of truth in Pinia)
          if (!isComputed && existing.isComputed) {
            seenKeys.set(key, { lineIndex: index, value, isComputed, fullLine: line });
          }
          // If both computed or both ref, keep first (existing)
          else if (isComputed && !existing.isComputed) {
            // Keep existing ref, skip this computed duplicate
          }
          else if (isComputed && existing.isComputed) {
            // Both computed: keep first
          }
          else {
            // Both ref: keep first
          }
        } else {
          seenKeys.set(key, { lineIndex: index, value, isComputed, fullLine: line });
        }
      }
    });

    // Second pass: build new lines array, removing duplicates
    const newLines: string[] = [];
    
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(\w+):\s*(\w+)(?:,)?\s*$/);
      if (match) {
        const key = match[1];
        const keptEntry = seenKeys.get(key);
        if (keptEntry && keptEntry.lineIndex === index) {
          // Keep this line (it's the one we want to keep)
          newLines.push(line);
        } else if (keptEntry && keptEntry.lineIndex !== index) {
          // This is a duplicate, skip it
          hasChanges = true;
        } else {
          // Not a duplicate, keep it
          newLines.push(line);
        }
      } else {
        // Not a key-value pair, keep it
        newLines.push(line);
      }
    });

    if (hasChanges) {
      const newReturnBlock = newLines.join('\n');
      // Replace the return block in the source
      const returnPrefix = 'return {';
      const returnStartIndex = fixed.indexOf(returnPrefix);
      if (returnStartIndex !== -1) {
        // Find the matching closing brace for the return object
        let braceCount = 0;
        let returnEndIndex = returnStartIndex + returnPrefix.length;
        let inReturn = false;
        
        for (let i = returnStartIndex; i < fixed.length; i++) {
          if (fixed[i] === '{') {
            braceCount++;
            inReturn = true;
          } else if (fixed[i] === '}') {
            braceCount--;
            if (inReturn && braceCount === 0) {
              returnEndIndex = i;
              break;
            }
          }
        }
        
        const beforeReturn = fixed.substring(0, returnStartIndex + returnPrefix.length);
        const afterReturn = fixed.substring(returnEndIndex);
        fixed = beforeReturn + '\n' + newReturnBlock + '\n' + afterReturn;
      }
      
      // Update the full content
      if (filePath.endsWith('.vue')) {
        const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        if (scriptMatch) {
          const scriptTag = scriptMatch[0].match(/<script[^>]*>/)?.[0] || '<script setup>';
          result.content = content.replace(
            /<script[^>]*>([\s\S]*?)<\/script>/,
            `${scriptTag}${fixed}</script>`
          );
          result.fixed = true;
          result.fixes.push("Removed duplicate keys in store return objects");
        }
      } else {
        // For .ts/.js files, replace the entire content
        result.content = fixed;
        result.fixed = true;
        result.fixes.push("Removed duplicate keys in store return objects");
      }
    }

    return result;
  }
};

/**
 * Fix: SET_ITEMS({ items }) param shadows reactive items - rename param to newItems
 */
export const storeSetItemsParamShadowRule: FixRule = {
  id: "store-set-items-param-shadow",
  description: "Fix SET_ITEMS param shadowing reactive items object",
  priority: 86,
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") || filePath.endsWith("store.js") || filePath.endsWith("store.ts")) &&
           content.includes("defineStore") &&
           /function SET_ITEMS\s*\(\s*\{\s*items\s*\}\s*\)/.test(content) &&
           /items\.forEach\s*\(/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const fixed = content.replace(
      /function SET_ITEMS\s*\(\s*\{\s*items\s*\}\s*\)\s*\{\s*items\.forEach/g,
      "function SET_ITEMS({ items: newItems }) {\n    newItems.forEach"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed SET_ITEMS param shadowing");
    }
    return result;
  },
};

/**
 * Fix: In Pinia store files, convert Vuex getters['module/getter'] and dispatch('module/action')
 * to storeVar.getter / storeVar.action(), and add import + const storeVar = useXxxStore().
 * Keeps store return shape consistent.
 */
export const storeVuexGettersDispatchRule: FixRule = {
  id: "store-vuex-getters-dispatch",
  description: "Convert getters['module/x'] and dispatch('module/x') to storeVar in Pinia stores",
  priority: 89,
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
           content.includes("defineStore") &&
           (content.includes("getters[") || content.includes("dispatch('") || content.includes('dispatch("'));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // Match both sync () => and async () => (Pinia setup stores)
    const defineStoreMatch = content.match(
      /defineStore\s*\(\s*["'][^"']+["']\s*,\s*(?:async\s+)?\(\s*\)\s*=>\s*\{/
    );
    if (!defineStoreMatch) {
      return result;
    }

    let insertPoint = content.indexOf(defineStoreMatch[0]) + defineStoreMatch[0].length;

    const moduleToStore = (module: string) => {
      const storeVarName = `${module}Store`;
      const useName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
      return { storeVarName, useName };
    };

    const modulesNeeded = new Set<string>();
    content.replace(/getters\[['"]([^'"]+)\/([^'"]+)['"]\]/g, (_, module) => {
      modulesNeeded.add(module);
      return "";
    });
    content.replace(/dispatch\s*\(\s*['"]([^'"]+)\/([^'"]+)['"]\s*\)/g, (_, module) => {
      modulesNeeded.add(module);
      return "";
    });

    let fixed = content;

    for (const module of modulesNeeded) {
      const { storeVarName, useName } = moduleToStore(module);
      const importPath = module === "index" ? "@/store/index" : `@/store/modules/${module}`;
      const hasImport = fixed.includes(`from "${importPath}"`) || fixed.includes(`from '${importPath}'`);
      if (!hasImport) {
        const lastImportIdx = fixed.lastIndexOf("import ");
        const insertAfter = lastImportIdx >= 0 ? fixed.indexOf("\n", lastImportIdx) + 1 : 0;
        fixed =
          fixed.slice(0, insertAfter) +
          `import { ${useName} } from '${importPath}';\n` +
          fixed.slice(insertAfter);
        if (insertAfter <= insertPoint) insertPoint += `import { ${useName} } from '${importPath}';\n`.length;
      }
      const hasInit = fixed.includes(`const ${storeVarName} = ${useName}()`);
      if (!hasInit) {
        const initLine = `\n  const ${storeVarName} = ${useName}();\n`;
        fixed = fixed.slice(0, insertPoint) + initLine + fixed.slice(insertPoint);
        insertPoint += initLine.length;
      }
    }

    fixed = fixed.replace(/getters\[['"]([^'"]+)\/([^'"]+)['"]\]/g, (_, module, getter) => {
      const { storeVarName } = moduleToStore(module);
      return `${storeVarName}.${getter}`;
    });
    fixed = fixed.replace(/dispatch\s*\(\s*['"]([^'"]+)\/([^'"]+)['"]\s*\)/g, (_, module, action) => {
      const { storeVarName } = moduleToStore(module);
      return `${storeVarName}.${action}()`;
    });

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Converted Vuex getters/dispatch to Pinia store refs and added cross-store deps");
    }

    return result;
  }
};

/**
 * Fix: Remove unnecessary async from defineStore setup.
 * When async is used, Pinia exposes the store only after the setup promise resolves,
 * causing "X is not a function" when components call store methods immediately.
 * Remove async when await is only inside nested async functions (common migration case).
 */
export const storeRemoveUnnecessaryAsyncRule: FixRule = {
  id: "store-remove-unnecessary-async",
  description: "Remove async from defineStore when await is only inside nested async functions",
  priority: 88,
  dependencies: ["store-vuex-getters-dispatch"],
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      /defineStore\s*\(\s*["'][^"']+["']\s*,\s*async\s+\(\s*\)\s*=>\s*\{/.test(content) &&
      // Only remove when await is inside nested async functions (body contains "async function")
      /async\s+function\s+\w+/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(
      /(defineStore\s*\(\s*["'][^"']+["']\s*,\s*)async\s+(\(\s*\)\s*=>\s*\{)/g,
      "$1$2"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed unnecessary async from defineStore setup (await only in nested async functions)");
    }
    return result;
  }
};

/**
 * Fix: Replace Vuex commit('MUTATION', value, { root: true }) with direct MUTATION(value) in Pinia stores.
 */
export const storeCommitToDirectRule: FixRule = {
  id: "store-commit-to-direct",
  description: "Replace commit('SET_LOADING', ...) with SET_LOADING(...) in Pinia stores",
  priority: 87,
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      (content.includes("commit('") || content.includes('commit("'))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(
      /commit\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([^,)]+))?\s*(?:,\s*\{[^}]*root:\s*true[^}]*\})?\s*\)/g,
      (_match, mutation, value) => {
        const valuePart = value !== undefined ? `(${value.trim()})` : "()";
        return `${mutation}${valuePart}`;
      }
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced Vuex commit with direct function calls in Pinia store");
    }
    return result;
  }
};

/**
 * Fix: Replace getters.xxx with xxx.value in Pinia store (same-store computed/ref access).
 */
export const storeGettersToRefRule: FixRule = {
  id: "store-getters-to-ref",
  description: "Replace getters.property with property.value in Pinia stores",
  priority: 86,
  dependencies: ["store-commit-to-direct"],
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      content.includes("getters.")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(/getters\.(\w+)/g, (_match, property) => {
      return `${property}.value`;
    });
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced getters.property with property.value in Pinia store");
    }
    return result;
  }
};

/**
 * Fix: computed(() => refVar) where refVar is a ref - add .value (returns array, not ref).
 * Pattern: filteredPosts = computed(() => posts) → computed(() => posts.value)
 */
export const storeComputedRefMissingValueRule: FixRule = {
  id: "store-computed-ref-missing-value",
  description: "Fix computed(() => refVar) to use refVar.value when refVar is a ref",
  priority: 86,
  shouldApply: (filePath, content) => {
    if (
      !(filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) ||
      !content.includes("defineStore") ||
      !content.includes("computed")
    ) {
      return false;
    }
    const refVars = Array.from(content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*ref\s*\(/g)).map((m) => m[1]);
    if (refVars.length === 0) return false;
    const refPattern = new RegExp(
      `computed\\s*(<[^>]+>)?\\s*\\(\\s*[^)]*\\)\\s*=>\\s*(${refVars.join("|")})\\s*\\)`,
      "g"
    );
    return refPattern.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const refVars = Array.from(content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*ref\s*\(/g)).map((m) => m[1]);
    if (refVars.length === 0) return result;

    let fixed = content;
    for (const refVar of refVars) {
      // Match => refVar ) but not => refVar.value ) - use (?:) for non-capturing type param to get $2 = closing )
      const pattern = new RegExp(
        `(computed\\s*(?:<[^>]+>)?\\s*\\(\\s*[^)]*\\)\\s*=>\\s*)${refVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\.value)(\\s*\\))`,
        "g"
      );
      const before = fixed;
      fixed = fixed.replace(pattern, `$1${refVar}.value$2`);
      if (fixed !== before) {
        result.fixed = true;
        result.fixes.push(`Added .value to ${refVar} in computed`);
      }
    }
    if (result.fixed) result.content = fixed;
    return result;
  }
};

/**
 * Fix: computed(() => result) where result is undefined → generate filter logic (filters + array).
 */
export const storeComputedResultRule: FixRule = {
  id: "store-computed-result",
  description: "Fix computed(() => result) by adding filter logic when result is undefined",
  priority: 85,
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      content.includes("computed") &&
      /=>\s*result\s*\)/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const resultPattern = /const\s+(\w+)\s*=\s*computed\s*(<[^>]+>)?\s*\(\s*[^)]*\)\s*=>\s*result\s*\)/g;
    let match;
    const replacements: Array<{ full: string; computedName: string; replacement: string }> = [];

    while ((match = resultPattern.exec(content)) !== null) {
      const computedName = match[1];
      const typePart = match[2] || "";
      const computedNameLower = computedName.toLowerCase();

      const arrayVars = Array.from(content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*ref\s*\(/g)).map(
        (m) => m[1]
      );
      const filterVars = Array.from(content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*reactive\s*\(/g)).map(
        (m) => m[1]
      );

      let arrayVar: string | null = null;
      for (const v of arrayVars) {
        const vLower = v.toLowerCase();
        if (
          computedNameLower.includes(vLower) ||
          vLower.includes(computedNameLower.replace("filtered", ""))
        ) {
          arrayVar = v;
          break;
        }
      }
      if (!arrayVar && arrayVars.length > 0) arrayVar = arrayVars[0];
      if (!arrayVar) continue; // Skip if no ref to use (avoid null.value)

      let filterVar: string | null = null;
      for (const v of filterVars) {
        if (v.toLowerCase().includes("filter")) {
          filterVar = v;
          break;
        }
      }

      let filterLogic = `let result = ${arrayVar}.value;`;
      if (filterVar) {
        let filterProps = Array.from(
          content.matchAll(new RegExp(`${filterVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\w+)`, "g"))
        ).map((m) => m[1]);
        const reactiveMatch = content.match(
          new RegExp(`${filterVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*reactive\\s*\\(\\s*\\{([^}]+)\\}`)
        );
        if (reactiveMatch) {
          const keys = reactiveMatch[1].match(/(\w+)\s*:/g)?.map((k) => k.replace(/\s*:$/, "")) || [];
          filterProps = Array.from(new Set([...filterProps, ...keys]));
        }
        const unique = Array.from(new Set(filterProps));
        const searchFilter = unique.find((p) =>
          ["search", "query", "term", "filter"].includes(p.toLowerCase())
        );
        const categoryFilter = unique.find((p) =>
          ["category", "role", "type", "status", "tag"].includes(p.toLowerCase())
        );
        if (categoryFilter) {
          filterLogic += `\n    if (${filterVar}.${categoryFilter}) {\n      result = result.filter(item => item.${categoryFilter} === ${filterVar}.${categoryFilter});\n    }`;
        }
        if (searchFilter) {
          filterLogic += `\n    if (${filterVar}.${searchFilter}) {\n      const searchLower = ${filterVar}.${searchFilter}.toLowerCase();\n      result = result.filter(item => \n        Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(searchLower))\n      );\n    }`;
        }
      }
      filterLogic += `\n    return result;`;

      const replacement = `const ${computedName} = computed${typePart}(() => {\n    ${filterLogic}\n  })`;
      replacements.push({ full: match[0], computedName, replacement });
    }

    let fixed = content;
    for (const { full, replacement } of replacements) {
      fixed = fixed.replace(full, replacement);
    }
    if (replacements.length > 0) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(
        `Fixed computed(() => result) with filter logic for ${replacements.map((r) => r.computedName).join(", ")}`
      );
    }
    return result;
  }
};

/** Derive state var name from SET_XXX: SET_LOADING → loading, SET_CURRENT_USER → currentUser */
function setMutationToVarName(mutation: string): string {
  if (!mutation.startsWith("SET_")) return mutation.toLowerCase();
  const rest = mutation.slice(4).replace(/_/g, " ");
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "value";
  const camel = parts[0].toLowerCase() + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
  return camel;
}

/**
 * Fix: Add state + setter when SET_XXX(...) is called but not defined (generic).
 * SET_LOADING → loading ref + SET_LOADING, SET_CURRENT_USER → currentUser ref + SET_CURRENT_USER, etc.
 */
export const storeAddLoadingRule: FixRule = {
  id: "store-add-set-mutation",
  description: "Add state ref and SET_XXX when SET_XXX(...) is called but not defined (generic)",
  priority: 84,
  dependencies: ["store-commit-to-direct"],
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      /SET_\w+\s*\(/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const setCallsRe = /SET_(\w+)\s*\(/g;
    const toAdd = new Map<string, string>(); // mutationName -> varName
    let match;
    while ((match = setCallsRe.exec(content)) !== null) {
      const mutation = "SET_" + match[1];
      const varName = setMutationToVarName(mutation);
      if (toAdd.has(mutation)) continue;
      const hasFunc = new RegExp(`function\\s+${mutation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(content);
      const hasVar = new RegExp(`(?:const|let|var)\\s+${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:ref|reactive)\\s*\\(`).test(content);
      if (!hasFunc && !hasVar) {
        toAdd.set(mutation, varName);
      }
    }

    if (toAdd.size === 0) return result;

    const defineMatch = content.match(/defineStore\s*\(\s*["'][^"']+["']\s*,\s*\(\s*\)\s*=>\s*\{/);
    if (!defineMatch) return result;

    const afterDefine = content.indexOf(defineMatch[0]) + defineMatch[0].length;
    const firstRefMatch = content.slice(afterDefine).match(/(const\s+\w+\s*=\s*ref\s*\()/);
    let insertPos = afterDefine;
    if (firstRefMatch) {
      const refStart = afterDefine + content.slice(afterDefine).indexOf(firstRefMatch[0]);
      const lineEnd = content.indexOf("\n", refStart + firstRefMatch[0].length);
      insertPos = lineEnd !== -1 ? lineEnd + 1 : refStart + firstRefMatch[0].length;
    }

    const typeDefault = (m: string, v: string) =>
      v === "loading" ? "boolean" : "any";
    const defaultVal = (v: string) => (v === "loading" ? "false" : "undefined");
    const ts = _context.enableTypeScript;

    const blocks: string[] = [];
    const returnAdds: string[] = [];
    for (const [mutation, varName] of toAdd) {
      const type = typeDefault(mutation, varName);
      const def = defaultVal(varName);
      const refDecl = ts ? `ref<${type}>(${def})` : `ref(${def})`;
      const funcDecl = ts
        ? `function ${mutation}(value: ${type}): void {\n    ${varName}.value = value;\n  }`
        : `function ${mutation}(value) {\n    ${varName}.value = value;\n  }`;
      blocks.push(`\n  const ${varName} = ${refDecl};\n\n  ${funcDecl}\n`);
      returnAdds.push(`${varName}: ${varName},\n    ${mutation}: ${mutation}`);
    }
    const block = blocks.join("\n ") + "\n\n ";
    let fixed = content.slice(0, insertPos) + block + content.slice(insertPos);

    const returnMatch = fixed.match(/return\s*\{([\s\S]*?)\}\s*;/);
    if (returnMatch) {
      const returnBody = returnMatch[1];
      const toInsert = returnAdds.filter(
        (s) => !returnBody.includes(s.split(":")[0].trim() + ":")
      );
      if (toInsert.length > 0) {
        const insertReturn = toInsert.join(",\n    ");
        const newBody = returnBody.trimEnd().endsWith(",")
          ? `${returnBody.trimEnd()}\n    ${insertReturn}`
          : `${returnBody.trimEnd()},\n    ${insertReturn}`;
        fixed = fixed.replace(/return\s*\{([\s\S]*?)\}\s*;/, `return {\n${newBody}\n  };`);
      }
    }

    result.content = fixed;
    result.fixed = true;
    result.fixes.push(`Added state + setter for ${Array.from(toAdd.keys()).join(", ")}`);
    return result;
  }
};

/**
 * Fix: Wrong Event type in store params (generic: any ": Event" type → ": any").
 * In Pinia stores, Event is often a migration mistake for user/entity data.
 */
export const storeEventTypeRule: FixRule = {
  id: "store-event-type",
  description: "Replace wrong Event type with any in store function params",
  priority: 83,
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      /\bEvent\b/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    let fixed = content;
    // Replace type annotations: param: Event → param: any (any param name)
    fixed = fixed.replace(/\b(\w+):\s*Event\b/g, "$1: any");
    // Replace object type }: Event → }: any
    fixed = fixed.replace(/\}:\s*Event\b/g, "}: any");
    // Destructured object with wrong key type: { key: Event, value } → { key, value }: any
    fixed = fixed.replace(/\{\s*(\w+):\s*Event,\s*(\w+)\s*\}:\s*any/g, "{ $1, $2 }: any");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced wrong Event types with any in store params");
    }
    return result;
  }
};

/**
 * Fix: In return, use key: keyComputed when both key and keyComputed exist (generic).
 * Avoids duplicate key and exposes the computed alias (e.g. currentUser: currentUserComputed).
 */
export const storeReturnCurrentUserRule: FixRule = {
  id: "store-return-computed-alias",
  description: "Use key: keyComputed in return when both exist (generic)",
  priority: 82,
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      /\w+Computed\s*=\s*computed/.test(content) &&
      content.includes("return {")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    // Find all names where we have both "const nameComputed = computed" and "name: name" in return
    const computedNamesRe = /const\s+(\w+Computed)\s*=\s*computed/g;
    const computedVars = new Set<string>();
    let m;
    while ((m = computedNamesRe.exec(content)) !== null) {
      computedVars.add(m[1]);
    }
    let fixed = content;
    for (const computedVar of computedVars) {
      const baseName = computedVar.replace(/Computed$/, "");
      if (baseName === computedVar) continue;
      const returnKeyPattern = new RegExp(
        `\\b${baseName}:\\s*${baseName}\\b,?\\s*\\n?\\s*`,
        "g"
      );
      if (returnKeyPattern.test(content)) {
        fixed = fixed.replace(
          new RegExp(`\\b${baseName}:\\s*${baseName}\\b,?\\s*\\n?\\s*`, "g"),
          `${baseName}: ${computedVar},\n    `
        );
        result.fixed = true;
        result.fixes.push(`Use ${baseName}: ${computedVar} in return`);
      }
    }
    result.content = fixed;
    return result;
  }
};

/**
 * Fix: In store/index.js or store/index.ts (Pinia), remove obsolete Vuex-style imports.
 * After migration, modules export useXxxStore (named), not default, so
 * "import userModule from './modules/user'" is invalid. Also remove unused "import Vue from 'vue'".
 */
export const storeIndexRemoveObsoleteImportsRule: FixRule = {
  id: "store-index-remove-obsolete-imports",
  description: "Remove default imports from ./modules/* and unused Vue import in store/index",
  priority: 79,
  shouldApply: (filePath, content) => {
    if (!(filePath.endsWith("store/index.js") || filePath.endsWith("store/index.ts"))) return false;
    if (!content.includes("defineStore")) return false;
    const hasDefaultModuleImport = /import\s+\w+\s+from\s+['"]\.\/modules\/\w+['"]/.test(content);
    const hasVueImport = /import\s+Vue\s+from\s+['"]vue['"]/.test(content);
    return hasDefaultModuleImport || hasVueImport;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;
    const fixes: string[] = [];

    // Remove import X from "./modules/YYY" (modules no longer have default export after Pinia migration)
    const defaultModuleRe = /import\s+\w+\s+from\s+['"]\.\/modules\/\w+['"];?\s*\n?/g;
    const beforeModules = fixed;
    fixed = fixed.replace(defaultModuleRe, () => "");
    if (fixed !== beforeModules) {
      fixes.push("Removed obsolete default imports from store modules");
    }

    // Remove import Vue from "vue" if Vue is not used in the file
    const vueImportRe = /import\s+Vue\s+from\s+['"]vue['"];?\s*\n?/g;
    if (vueImportRe.test(fixed)) {
      const withoutVueImport = fixed.replace(vueImportRe, "");
      const vueUsage = /\bVue\./.test(withoutVueImport);
      if (!vueUsage) {
        fixed = withoutVueImport;
        fixes.push("Removed unused Vue import from store/index");
      }
    }

    if (fixes.length > 0) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(...fixes);
    }
    return result;
  }
};

/**
 * Fix: Store index with only default export - add named export useIndexStore so
 * "import { useIndexStore } from '@/store/index'" works.
 */
export const storeIndexNamedExportRule: FixRule = {
  id: "store-index-named-export",
  description: "Add named export useIndexStore to store/index when only default export exists",
  priority: 78,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith("store/index.ts") || filePath.endsWith("store/index.js")) &&
           /export\s+default\s+defineStore\s*\(\s*["']index["']/.test(content) &&
           !content.includes("export const useIndexStore");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    let fixed = content.replace(
      /export\s+default\s+defineStore\s*\(\s*["']index["']/,
      "export const useIndexStore = defineStore(\"index\""
    );
    if (fixed === content) return result;
    if (!fixed.includes("export default useIndexStore")) {
      fixed = fixed.replace(/\}\);?\s*$/, "});\n\nexport default useIndexStore;\n");
    }
    result.content = fixed;
    result.fixed = true;
    result.fixes.push("Added named export useIndexStore to store/index");
    return result;
  }
};

/**
 * Fix: export function createStore() { return defineStore(...) } → export const useIndexStore = defineStore(...)
 */
export const storeCreateStoreToUseIndexRule: FixRule = {
  id: "store-create-store-to-use-index",
  description: "Convert createStore() wrapper to direct useIndexStore export",
  priority: 77,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith("store/index.ts") || filePath.endsWith("store/index.js")) &&
           /export\s+function\s+createStore\s*\(\s*\)\s*\{\s*return\s+defineStore/.test(content) &&
           !content.includes("export const useIndexStore");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    if (!/export\s+function\s+createStore\s*\(\s*\)\s*\{\s*return\s+defineStore/.test(content)) return result;
    let fixed = content.replace(
      /export\s+function\s+createStore\s*\(\s*\)\s*\{\s*return\s+defineStore/,
      "export const useIndexStore = defineStore"
    );
    fixed = fixed.replace(/\}\)\s*;?\s*\n\s*\}\s*$/, "});");
    result.content = fixed;
    result.fixed = true;
    result.fixes.push("Converted createStore() to useIndexStore export");
    return result;
  }
};

/** Regex: }; }; }); at end of file, with any whitespace between and optional trailing newline */
const STORE_CLOSING_MALFORMED = /\}\s*;\s*\s+\}\s*;\s*\s+\}\s*\)\s*;\s*\s*$/m;

/**
 * Fix: Malformed defineStore closing - "}; }; });" at end of store (return object + arrow body
 * closed with semicolons). Replace with "} });" so defineStore parses correctly.
 */
export const storeDefineStoreClosingRule: FixRule = {
  id: "store-define-store-closing",
  description: "Fix defineStore closing: }; }; }); → } });",
  priority: 79,
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("/store/") || filePath.includes("store.ts") || filePath.includes("store.js")) &&
      content.includes("defineStore") &&
      STORE_CLOSING_MALFORMED.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(STORE_CLOSING_MALFORMED, "  }\n});");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed defineStore closing (}; }; }); → } });)");
    }
    return result;
  }
};

/**
 * Fix: Add missing store dependency when a Pinia store uses another store (e.g. userStore)
 * without defining it. Generic: infers module from store var (userStore -> user) - no disk read needed.
 * Supports both "export const useXxxStore = defineStore" and "export default defineStore".
 */
export const piniaStoreCrossStoreDepsRule: FixRule = {
  id: "pinia-cross-store-deps",
  description: "Add useXxxStore import and const when a store references another store",
  priority: 88,
  dependencies: ["store-vuex-getters-dispatch"],
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") && content.includes("defineStore") &&
            /\b\w+Store\.\w+/.test(content));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // Infer store vars from usage: xxxStore.property -> xxxStore, derive module = xxx (convention)
    const usedStoreVars = new Set<string>();
    const storeUsagePattern = /\b(\w+Store)\.\w+/g;
    let usageMatch;
    while ((usageMatch = storeUsagePattern.exec(content)) !== null) {
      const storeVar = usageMatch[1];
      if (storeVar.endsWith("Store") && storeVar.length > 5) {
        usedStoreVars.add(storeVar);
      }
    }

    // Support both "export const useXxxStore = defineStore(...)" and "export default defineStore(...)"
    const defineStoreMatch = content.match(/defineStore\s*\(\s*["'][^"']+["']\s*,\s*\(\s*\)\s*=>\s*\{/);
    if (!defineStoreMatch) {
      return result;
    }

    const callbackStart = content.indexOf(defineStoreMatch[0]) + defineStoreMatch[0].length;
    const snippet = content.substring(callbackStart, callbackStart + 1200);
    const existingInits = snippet.match(/const\s+(\w+Store)\s*=\s*use\w+Store\s*\(\s*\)/g) || [];
    const definedStoreVars = new Set(
      existingInits.map((line) => {
        const m = line.match(/const\s+(\w+Store)\s*=/);
        return m ? m[1] : "";
      }).filter(Boolean)
    );

    const missingStoreVars = Array.from(usedStoreVars).filter((v) => !definedStoreVars.has(v));
    if (missingStoreVars.length === 0) {
      return result;
    }

    // Derive module from store var: userStore -> user (convention: @/store/modules/user)
    const importsToAdd: Array<{ storeVar: string; moduleName: string; useName: string }> = [];
    missingStoreVars.forEach((storeVar) => {
      const moduleName = storeVar.replace(/Store$/, "").toLowerCase();
      const useName = "use" + moduleName.charAt(0).toUpperCase() + moduleName.slice(1) + "Store";
      importsToAdd.push({ storeVar, moduleName, useName });
    });

    let fixed = content;

    const importPath = (moduleName: string) =>
      moduleName === "index" ? "@/store/index" : `@/store/modules/${moduleName}`;
    const newImportLines = importsToAdd
      .filter(
        ({ useName: _useName, moduleName }) =>
          !content.includes(`from "${importPath(moduleName)}"`) &&
          !content.includes(`from '${importPath(moduleName)}'`)
      )
      .map(({ useName, moduleName }) => `import { ${useName} } from '${importPath(moduleName)}';`);
    if (newImportLines.length > 0) {
      const lastImportIndex = fixed.lastIndexOf("import ");
      const insertAfter = lastImportIndex >= 0 ? fixed.indexOf("\n", lastImportIndex) + 1 : 0;
      fixed = fixed.slice(0, insertAfter) + newImportLines.join("\n") + "\n" + fixed.slice(insertAfter);
    }

    const initLines = importsToAdd
      .map(({ storeVar, useName }) => `  const ${storeVar} = ${useName}();`)
      .join("\n");
    const insertPoint = fixed.indexOf(defineStoreMatch[0]) + defineStoreMatch[0].length;
    fixed = fixed.slice(0, insertPoint) + "\n" + initLines + "\n" + fixed.slice(insertPoint);

    result.content = fixed;
    result.fixed = true;
    result.fixes.push(
      `Added cross-store deps: ${importsToAdd.map((i) => i.storeVar).join(", ")}`
    );
    return result;
  }
};

/** Index-store variable names (convention: useIndexStore → indexStore, store, or $store) */
const INDEX_STORE_VAR_PATTERN =
  /(?:indexStore|(?<![a-zA-Z])store(?![a-zA-Z])|\$store)\.(\w+)(?:\s*\(|\b)/g;

/**
 * Detect which store methods are called on the index store in the project.
 * Generic: no hardcoded method names; extracts any method called on indexStore/store/$store.
 */
/** Store-like names (store, XStore) - never add as methods (store.indexStore is wrong) */
function isStoreVarName(name: string): boolean {
  return name === "store" || /^\w+Store$/.test(name);
}

async function getCalledIndexStoreMethods(projectRoot: string): Promise<Set<string>> {
  const called = new Set<string>();
  try {
    const files = await glob("**/*.{vue,js,ts}", {
      cwd: projectRoot,
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
    });
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8").catch(() => "");
      let m: RegExpExecArray | null;
      INDEX_STORE_VAR_PATTERN.lastIndex = 0;
      while ((m = INDEX_STORE_VAR_PATTERN.exec(content)) !== null) {
        const method = m[1];
        if (!isStoreVarName(method)) called.add(method);
      }
    }
  } catch {
    // If scan fails, return empty (no methods to add)
  }
  return called;
}

/** Extract members already in the store return object */
function getMembersInReturn(content: string): Set<string> {
  const inReturn = new Set<string>();
  const returnMatch = content.match(/return\s*\{([\s\S]+?)\}\s*;?\s*\n\s*\}\)/);
  if (returnMatch) {
    const returnContent = returnMatch[1];
    const propPattern = /(\w+)(?:\s*:\s*\w+)?/g;
    let p: RegExpExecArray | null;
    while ((p = propPattern.exec(returnContent)) !== null) {
      inReturn.add(p[1]);
    }
  }
  return inReturn;
}

/** Extract functions/const defined in the store (before return) */
function getMembersDefined(content: string): Set<string> {
  const defined = new Set<string>();
  const funcPattern = /(?:function|const)\s+(\w+)\s*[=:(]/g;
  let f: RegExpExecArray | null;
  while ((f = funcPattern.exec(content)) !== null) {
    const name = f[1];
    if (!/^use\w+Store$/.test(name) && !["ref", "computed", "defineStore", "return", "export"].includes(name)) {
      defined.add(name);
    }
  }
  return defined;
}

/**
 * Fix: Add missing store methods as no-op when called in project but absent from store.
 * Generic: detects any method called on indexStore/store/$store by scanning project.
 */
export const storeAddMissingAuthMethodsRule: FixRule = {
  id: "store-add-missing-auth-methods",
  description: "Add no-op methods to index store when called in project but missing",
  priority: 78,
  shouldApply: (filePath, content) => {
    const normalized = filePath.replace(/\\/g, "/");
    const isIndexStore =
      normalized.endsWith("store/index.js") ||
      normalized.endsWith("store/index.ts") ||
      normalized.endsWith("src/store/index.js") ||
      normalized.endsWith("src/store/index.ts");
    return isIndexStore && content.includes("defineStore") && content.includes("return {");
  },
  apply: async (filePath, content, context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const inReturn = getMembersInReturn(content);
    const defined = getMembersDefined(content);
    const called = context.projectRoot
      ? await getCalledIndexStoreMethods(context.projectRoot)
      : new Set<string>();
    // Methods called but not in return object (defined or not)
    const toAddToReturn = [...called].filter((m) => !inReturn.has(m));
    if (toAddToReturn.length === 0) return result;

    let fixed = content;

    // 1. Add function declarations for methods that don't exist yet
    const toAddAsNew = toAddToReturn.filter((m) => !defined.has(m));
    const returnIdx = fixed.search(/\breturn\s*\{/);
    if (returnIdx === -1) return result;

    if (toAddAsNew.length > 0) {
      const funcBlock = toAddAsNew.map((m) => `  function ${m}() {\n    return Promise.resolve();\n  }\n`).join("");
      fixed = fixed.slice(0, returnIdx) + funcBlock + fixed.slice(returnIdx);
    }

    // 2. Add to return object (all toAddToReturn: new + defined-but-not-exported like setRoute)
    const newReturnIdx = fixed.indexOf("return {", returnIdx);
    const braceOpen = fixed.indexOf("{", newReturnIdx);
    if (braceOpen === -1) return result;
    const returnClose = findMatchingBrace(fixed, braceOpen);
    if (returnClose === -1) return result;

    const returnContent = fixed.slice(braceOpen + 1, returnClose);
    const additions = toAddToReturn.map((m) => `    ${m}: ${m},`).join("\n");
    const newReturnContent = returnContent.trimEnd().replace(/,?\s*$/, "") + ",\n" + additions;
    fixed =
      fixed.slice(0, braceOpen + 1) +
      newReturnContent +
      fixed.slice(returnClose);

    result.content = fixed;
    result.fixed = true;
    const fixMsgs: string[] = [];
    if (toAddAsNew.length > 0) fixMsgs.push(`Added no-op: ${toAddAsNew.join(", ")}`);
    const toExportOnly = toAddToReturn.filter((m) => defined.has(m));
    if (toExportOnly.length > 0) fixMsgs.push(`Added to return: ${toExportOnly.join(", ")}`);
    result.fixes.push(fixMsgs.join("; "));
    return result;
  },
};
