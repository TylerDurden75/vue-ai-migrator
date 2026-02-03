/**
 * Rules for fixing Pinia store issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";

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

/**
 * Fix: Make functions async if they use await (generic: any function with await).
 * Handles nested braces (try/finally, etc.) by matching brace depth.
 */
export const asyncFunctionRule: FixRule = {
  id: "async-functions",
  description: "Make functions async if they use await",
  priority: 90,
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") || filePath.endsWith(".ts") || filePath.endsWith(".js")) &&
           content.includes("await") &&
           !content.includes("async async");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Pattern: function name(...): returnType { ... } - find body by matching braces
    const functionStartRe = /function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>,\s\[\]|]+\s*)?\{/g;
    let match;
    const replacements: Array<{ start: number; end: number; funcName: string; replacement: string }> = [];

    while ((match = functionStartRe.exec(content)) !== null) {
      if (match[0].startsWith("async ")) continue;
      const braceStart = content.indexOf("{", match.index);
      const braceEnd = findMatchingBrace(content, braceStart);
      if (braceEnd === -1) continue;
      const body = content.slice(braceStart + 1, braceEnd);
      if (!body.includes("await")) continue;
      const full = content.slice(match.index, braceEnd + 1);
      let replacement = full.replace(/^function\s+/, "async function ");
      const returnTypeMatch = full.match(/\)\s*:\s*(\w+)\s*\{/);
      if (returnTypeMatch) {
        replacement = replacement.replace(
          new RegExp(`\\)\\s*:\\s*${returnTypeMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`),
          "): Promise<" + returnTypeMatch[1] + "> {"
        );
      }
      replacements.push({ start: match.index, end: braceEnd + 1, funcName: match[1], replacement });
    }

    for (const { start, end, replacement } of replacements.sort((a, b) => b.start - a.start)) {
      fixed = fixed.slice(0, start) + replacement + fixed.slice(end);
      result.fixed = true;
      result.fixes.push("Made function async (uses await)");
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

    fixed = fixed.replace(/async\s+async\s+/g, "async ");
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // For .ts/.js files (Pinia stores), use content directly
    // For .vue files, use scriptContent
    const sourceContent = filePath.endsWith('.vue') ? context.scriptContent : content;
    
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
 * Fix: In Pinia store files, convert Vuex getters['module/getter'] and dispatch('module/action')
 * to storeVar.getter / storeVar.action(), and add import + const storeVar = useXxxStore().
 * Aligns with legacy fixer behavior.
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const defineStoreMatch = content.match(/defineStore\s*\(\s*["'][^"']+["']\s*,\s*\(\s*\)\s*=>\s*\{/);
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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

    const blocks: string[] = [];
    const returnAdds: string[] = [];
    for (const [mutation, varName] of toAdd) {
      const type = typeDefault(mutation, varName);
      const def = defaultVal(varName);
      blocks.push(
        `\n  const ${varName} = ref<${type}>(${def});\n\n  function ${mutation}(value: ${type}): void {\n    ${varName}.value = value;\n  }\n`
      );
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
  apply: async (filePath, content, context) => {
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
      content.includes("Computed = computed") &&
      content.includes("return {")
    );
  },
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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
        ({ useName, moduleName }) =>
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
