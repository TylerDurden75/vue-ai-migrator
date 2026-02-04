/**
 * Rules for fixing import issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";
import { getStoreMethodMap } from "../utils/store-analysis-cache";

const VUE_IMPORT_CANDIDATES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bref\s*\(/, name: "ref" },
  { pattern: /\breactive\s*\(/, name: "reactive" },
  { pattern: /\bcomputed\s*\(/, name: "computed" },
  { pattern: /\bwatch\s*\(/, name: "watch" },
  { pattern: /\bonMounted\s*\(/, name: "onMounted" },
  { pattern: /\bonUnmounted\s*\(/, name: "onUnmounted" },
  { pattern: /\bonBeforeMount\s*\(/, name: "onBeforeMount" },
  { pattern: /\bonBeforeUnmount\s*\(/, name: "onBeforeUnmount" },
  { pattern: /\bonUpdated\s*\(/, name: "onUpdated" },
  { pattern: /\bonBeforeUpdate\s*\(/, name: "onBeforeUpdate" },
  { pattern: /\bonActivated\s*\(/, name: "onActivated" },
  { pattern: /\bonDeactivated\s*\(/, name: "onDeactivated" },
  { pattern: /\bonErrorCaptured\s*\(/, name: "onErrorCaptured" },
];

/**
 * Fix: Add missing Vue imports (ref, computed, watch, lifecycle hooks, etc.) when used in script setup but not imported.
 */
export const missingVueImportsRule: FixRule = {
  id: "missing-vue-imports",
  description: "Add ref, computed, watch, lifecycle hooks to vue import when used in script setup but not imported",
  priority: 91,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const vueImport = script.match(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/);
    for (const { pattern, name } of VUE_IMPORT_CANDIDATES) {
      if (pattern.test(script) && (!vueImport || !new RegExp(`\\b${name}\\b`).test(vueImport[1]))) {
        return true;
      }
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const vueImportRegex = /import\s*\{([^}]*)\}\s*from\s*['"]vue['"]\s*;?/;
    const m = scriptContent.match(vueImportRegex);
    const toAdd: string[] = [];
    for (const { pattern, name } of VUE_IMPORT_CANDIDATES) {
      if (pattern.test(scriptContent) && (!m || !new RegExp(`\\b${name}\\b`).test(m[1]))) {
        toAdd.push(name);
      }
    }
    if (toAdd.length === 0) return result;
    if (m) {
      const existing = m[1].trim().split(/\s*,\s*/).filter(Boolean);
      const combined = [...new Set([...existing, ...toAdd])].join(", ");
      scriptContent = scriptContent.replace(vueImportRegex, `import { ${combined} } from 'vue';`);
    } else {
      const firstImportMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
      const afterImports = firstImportMatch ? firstImportMatch[0].length : 0;
      scriptContent =
        scriptContent.slice(0, afterImports) +
        `import { ${toAdd.join(", ")} } from 'vue';\n` +
        scriptContent.slice(afterImports);
    }
    result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push(`Added missing Vue imports: ${toAdd.join(", ")}`);
    return result;
  }
};

/**
 * Fix: Resolve data/import naming conflicts.
 * When data property has same name as import (e.g. imgBaseUrl from config), migration produces
 * redeclaration. Fix by aliasing the import.
 */
export const dataImportConflictRule: FixRule = {
  id: "data-import-conflict",
  description: "Fix const X = ref(X) or const X when X is imported - alias import to avoid redeclaration",
  priority: 89,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const importNames = new Set<string>();
    const importRe = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
    let im;
    while ((im = importRe.exec(script)) !== null) {
      im[1].split(",").forEach((n: string) => {
        const orig = n.trim().split(/\s+as\s+/)[0].trim();
        if (orig) importNames.add(orig);
      });
    }
    const constRe = /const\s+(\w+)\s*=/g;
    let cm;
    while ((cm = constRe.exec(script)) !== null) {
      if (importNames.has(cm[1])) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    const scriptContent = scriptMatch[2];

    const importNames = new Map<string, string>(); // original -> path
    const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*\n?/g;
    let importMatch;
    const conflicts = new Set<string>();
    const constRe = /const\s+(\w+)\s*=/g;
    let cm;
    while ((cm = constRe.exec(scriptContent)) !== null) {
      conflicts.add(cm[1]);
    }
    while ((importMatch = importRe.exec(scriptContent)) !== null) {
      importMatch[1].split(",").forEach((n: string) => {
        const orig = n.trim().split(/\s+as\s+/)[0].trim();
        if (orig && conflicts.has(orig)) importNames.set(orig, importMatch![2]);
      });
    }
    const toFix = Array.from(importNames.keys());
    if (toFix.length === 0) return result;

    const importRe2 = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*\n?/g;
    let fixed = scriptContent;
    let importMatch2;
    while ((importMatch2 = importRe2.exec(scriptContent)) !== null) {
      const namesStr = importMatch2[1];
      const path = importMatch2[2];
      const names = namesStr.split(",").map((n: string) => {
        const parts = n.trim().split(/\s+as\s+/);
        return { original: parts[0].trim(), alias: parts[1]?.trim() };
      });
      const newNames = names.map(({ original, alias }) => {
        if (toFix.includes(original) && !alias) {
          return `${original} as ${original}Imported`;
        }
        return alias ? `${original} as ${alias}` : original;
      });
      const newImport = `import { ${newNames.join(", ")} } from '${path}';\n`;
      fixed = fixed.replace(importMatch2[0], newImport);
    }

    for (const name of toFix) {
      const alias = `${name}Imported`;
      fixed = fixed.replace(
        new RegExp(`const\\s+${name}\\s*=\\s*ref\\s*\\(\\s*\\b${name}\\b\\s*\\)`, "g"),
        `const ${name} = ref(${alias})`
      );
    }

    result.content = content.replace(scriptMatch[0], scriptMatch[1] + fixed + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push(`Resolved data/import conflict: ${toFix.join(", ")}`);
    return result;
  }
};

/**
 * Fix: Split imports on the same line (';import or ";import → newline + import).
 */
export const splitImportsOnSameLineRule: FixRule = {
  id: "split-imports-same-line",
  description: "Split multiple import statements on same line",
  priority: 92,
  shouldApply: (_filePath, content) => {
    return /['"]\s*;\s*import\s+/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    let fixed = content.replace(/';\s*import\s+/g, "';\nimport ");
    fixed = fixed.replace(/";\s*import\s+/g, "\";\nimport ");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Split imports that were on the same line");
    }
    return result;
  }
};

/**
 * Fix: Remove Vuex imports
 */
export const removeVuexImportsRule: FixRule = {
  id: "remove-vuex-imports",
  description: "Remove Vuex imports (replaced by Pinia)",
  priority: 85,
  shouldApply: (filePath, content) => {
    return content.includes("vuex") || content.includes("Vuex");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Remove Vuex imports
    const vuexImportPattern = getCachedRegex(
      "import\\s+.*?from\\s+['\"]vuex['\"]",
      "g"
    );
    fixed = fixed.replace(vuexImportPattern, "");

    // Remove Vuex from destructured imports
    fixed = fixed.replace(/import\s*\{([^}]*)\}\s*from\s*['"]vuex['"]/g, (match, imports) => {
      const cleaned = imports.split(",")
        .map((imp: string) => imp.trim())
        .filter((imp: string) => !imp.includes("Store") && !imp.includes("mapGetters") && !imp.includes("mapActions"))
        .join(", ");
      return cleaned ? `import { ${cleaned} } from "vuex"` : "";
    });

    // Remove empty import lines
    fixed = fixed.replace(/import\s*\{\s*\}\s*from\s*['"]vuex['"];?\s*\n/g, "");

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed Vuex imports");
    }

    return result;
  }
};

/**
 * Fix: Remove Vue 3 compiler macros from "vue" imports (defineProps, defineEmits)
 * They are available globally in <script setup> and must not be imported
 */
export const removeVueCompilerMacrosRule: FixRule = {
  id: "remove-vue-compiler-macros",
  description: "Remove defineProps and defineEmits from vue imports (compiler macros)",
  priority: 86,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith(".vue") || filePath.endsWith(".ts")) &&
           /import\s*\{[^}]*\b(defineProps|defineEmits)\b[^}]*\}\s*from\s*['"]vue['"]/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    fixed = fixed.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/g,
      (match, imports) => {
        const items = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
        const filtered = items.filter(
          (item: string) => item !== "defineProps" && item !== "defineEmits"
        );
        if (filtered.length === items.length) return match;
        if (filtered.length === 0) return "";
        return `import { ${filtered.join(", ")} } from 'vue'`;
      }
    );

    fixed = fixed.replace(/\n\s*\n\s*import\s*\{\s*\}\s*from\s*['"]vue['"];?\s*\n/g, "\n");

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed defineProps/defineEmits from vue imports (compiler macros)");
    }

    return result;
  }
};

/**
 * Fix: Merge duplicate imports
 */
export const mergeDuplicateImportsRule: FixRule = {
  id: "merge-duplicate-imports",
  description: "Merge duplicate imports from same modules",
  priority: 15,
  dependencies: ["remove-vuex-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && content.includes("<script setup");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.scriptContent) {
      return result;
    }

    // Extract all imports
    const importPattern = getCachedRegex(
      "import\\s+\\{([^}]+)\\}\\s+from\\s+['\"]([^'\"]+)['\"]",
      "g"
    );
    
    const importsByModule = new Map<string, Set<string>>();
    let match;
    const importMatches: Array<{ fullMatch: string; exports: string[]; module: string }> = [];

    while ((match = importPattern.exec(_context.scriptContent)) !== null) {
      const exports = match[1].split(",").map(e => e.trim()).filter(Boolean);
      const module = match[2];
      
      if (!importsByModule.has(module)) {
        importsByModule.set(module, new Set());
      }
      
      exports.forEach(exp => importsByModule.get(module)!.add(exp));
      importMatches.push({
        fullMatch: match[0],
        exports,
        module
      });
    }

    // Check if we have duplicates from the same module (need to merge)
    const hasDuplicates = Array.from(importsByModule.values()).some(
      (exports) => exports.size > 0
    ) && importMatches.some((match, idx) => {
      // Check if there's another import from the same module
      return importMatches.some((otherMatch, otherIdx) => 
        otherIdx !== idx && otherMatch.module === match.module
      );
    });

    // If we have duplicates from same module, merge them
    if (hasDuplicates) {
      let fixed = content;
      const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        
        // Remove all imports
        importMatches.forEach(({ fullMatch }) => {
          scriptContent = scriptContent.replace(fullMatch, "");
        });

        // Add merged imports at the top
        const mergedImports: string[] = [];
        importsByModule.forEach((exports, module) => {
          if (exports.size > 0) {
            const exportsList = Array.from(exports).join(", ");
            mergedImports.push(`import { ${exportsList} } from '${module}';`);
          }
        });

        // Find first non-import line
        const firstCodeLine = scriptContent.match(/^[^i]*?(\n|$)/);
        const insertPos = firstCodeLine ? firstCodeLine.index! : 0;
        
        scriptContent = mergedImports.join("\n") + "\n" + scriptContent.substring(insertPos).trim();
        
        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
        );

        if (fixed !== content) {
          result.content = fixed;
          result.fixed = true;
          result.fixes.push("Merged duplicate imports from same modules");
        }
      }
    }

    return result;
  }
};

/**
 * Fix: Remove duplicate imports of the same identifier from different paths.
 * Pattern: import { useIndexStore } from "@/store/modules/index"; import { useIndexStore } from "@/store/index";
 * → keep only one (prefer @/store/index over @/store/modules/ for store roots).
 * Also removes duplicate const declarations (e.g. const indexStore = useIndexStore(); twice).
 */
export const duplicateSameIdentifierImportsRule: FixRule = {
  id: "duplicate-same-identifier-imports",
  description: "Remove duplicate imports of same identifier from different paths and duplicate const declarations",
  priority: 84,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") && !filePath.endsWith(".ts") && !filePath.endsWith(".js")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? (filePath.endsWith(".vue") ? "" : content);
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*\n?/g;
    const byName = new Map<string, Array<{ path: string; full: string }>>();
    let m;
    while ((m = importRegex.exec(script)) !== null) {
      const paths = m[2];
      const names = m[1].split(",").map((n: string) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      names.forEach((name: string) => {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push({ path: paths, full: m![0] });
      });
    }
    const hasDuplicateImports = Array.from(byName.values()).some(
      entries => new Set(entries.map(e => e.path)).size > 1
    );
    const duplicateConst = /const\s+(\w+)\s*=\s*[^;]+;\s*\n\s*const\s+\1\s*=\s*[^;]+;/;
    return hasDuplicateImports || duplicateConst.test(script);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    const scriptContent = scriptMatch ? scriptMatch[2] : (filePath.endsWith(".vue") ? "" : content);
    if (!scriptContent) return result;

    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*\n?/g;
    const byName = new Map<string, Array<{ path: string; full: string; namesInLine: string[] }>>();
    let m;
    const allImports: Array<{ full: string; path: string; names: string[] }> = [];
    while ((m = importRegex.exec(scriptContent)) !== null) {
      const path = m[2];
      const names = m[1].split(",").map((n: string) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      allImports.push({ full: m[0], path, names });
      names.forEach((name: string) => {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push({ path, full: m![0], namesInLine: names });
      });
    }

    const toRemove = new Set<string>();
    byName.forEach((entries, name) => {
      const paths = entries.map(e => e.path);
      const uniquePaths = [...new Set(paths)];
      if (uniquePaths.length <= 1) return;
      const preferred = uniquePaths.find(p => /@\/store\/index['"]?$/.test(p) || (p.includes("/store/") && !p.includes("/store/modules/")));
      const keepPath = preferred ?? uniquePaths[0];
      entries.forEach(({ path, full, namesInLine }) => {
        if (path !== keepPath && namesInLine.length === 1 && namesInLine[0] === name) toRemove.add(full);
      });
    });

    let fixed = scriptContent;
    toRemove.forEach(full => {
      fixed = fixed.replace(full, "");
    });

    // Remove duplicate const declarations (keep first occurrence, remove subsequent)
    const constLinePattern = /^(\s*const\s+(\w+)\s*=\s*[^;]+;\s*)$/gm;
    const seenConst = new Set<string>();
    const constFixed = fixed;
    fixed = fixed.replace(constLinePattern, (line, fullMatch, varName) => {
      if (seenConst.has(varName)) {
        return ""; // remove duplicate line (leave nothing)
      }
      seenConst.add(varName);
      return fullMatch;
    });
    // Collapse multiple consecutive blank lines left by removed const
    fixed = fixed.replace(/\n(\s*\n)\s*\n/g, "\n\n");
    if (fixed !== constFixed) result.fixes.push("Removed duplicate const declaration");

    if (toRemove.size > 0) result.fixes.push("Removed duplicate import of same identifier from different path");
    if (fixed !== scriptContent) {
      result.fixed = true;
      result.content = scriptMatch
        ? content.replace(scriptMatch[0], scriptMatch[1] + fixed + scriptMatch[3])
        : fixed;
    }
    return result;
  }
};

/**
 * Fix 7b: Detect and correct wrong store imports
 * Pattern: import { useXStore } from '@/store/modules/Y' where X ≠ Y
 * Uses store analysis to determine which store should actually be used based on method/property usage
 */
export const correctWrongStoreImportsRule: FixRule = {
  id: "correct-wrong-store-imports",
  description: "Detect and correct wrong store imports based on actual usage",
  priority: 82,
  dependencies: ["remove-vuex-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && 
           content.includes("<script setup") &&
           /import\s+\{\s*use\w+Store\s*\}\s+from\s+['"]@\/store\/modules\/\w+['"]/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.scriptContent || !_context.projectRoot) {
      return result;
    }

    // Get store analysis using centralized cache
    const storeMethodMap = await getStoreMethodMap(_context.projectRoot);
    
    if (Object.keys(storeMethodMap).length === 0) {
      return result; // No store information available
    }

    let fixed = content;
    const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    
    if (!scriptMatch) {
      return result;
    }

    let scriptContent = scriptMatch[1];
    const originalScriptContent = scriptContent;

    // Track usage per store variable to determine correct module for each
    const storeVarUsage = new Map<string, Map<string, number>>(); // storeVar → (module → count)
    const storeVarMembers = new Map<string, Set<string>>(); // storeVar → Set<member> (for exclusive-module check)

    const addUsage = (storeVar: string, member: string, module: string) => {
      if (!storeVarUsage.has(storeVar)) {
        storeVarUsage.set(storeVar, new Map());
        storeVarMembers.set(storeVar, new Set());
      }
      storeVarUsage.get(storeVar)!.set(module, (storeVarUsage.get(storeVar)!.get(module) || 0) + 10);
      storeVarMembers.get(storeVar)!.add(member);
    };

    // Pattern 1: Detect store.method() calls
    const storeMethodPattern = /(\w+Store)\.(\w+)\s*\(/g;
    let match;
    while ((match = storeMethodPattern.exec(scriptContent)) !== null) {
      const [, storeVar, methodName] = match;
      const module = storeMethodMap[methodName];
      if (module) {
        addUsage(storeVar, methodName, module);
      }
    }

    // Pattern 2: Detect store.property access
    const storePropertyPattern = /(\w+Store)\.(\w+)(?!\s*\()/g;
    while ((match = storePropertyPattern.exec(scriptContent)) !== null) {
      const [, storeVar, propertyName] = match;
      const module = storeMethodMap[propertyName];
      if (module) {
        addUsage(storeVar, propertyName, module);
      }
    }

    // Find store imports and map them to store variables
    const storeImports = new Map<string, {
      importLine: string;
      storeName: string;
      storeVar: string;
      importedModule: string;
    }>();

    const wrongStorePattern = /import\s+\{\s*use(\w+)Store\s*\}\s+from\s+['"]@\/store\/modules\/(\w+)['"]/g;
    while ((match = wrongStorePattern.exec(scriptContent)) !== null) {
      const [, storeName, importedModule] = match;
      const storeNameLower = storeName.toLowerCase();
      const storeVar = `${storeNameLower}Store`;
      const importedModuleLower = importedModule.toLowerCase();
      
      storeImports.set(storeVar, {
        importLine: match[0],
        storeName: `use${storeName}Store`,
        storeVar,
        importedModule: importedModuleLower
      });
    }

    // Map: for each canonical storeVar, which actual variable names are assigned from it (e.g. productStore = useUserStore() -> userStore has actualVar productStore)
    const storeVarToActualVars = new Map<string, string[]>();
    const initPattern = /const\s+(\w+Store)\s*=\s*use(\w+)Store\s*\(\s*\)/g;
    while ((match = initPattern.exec(scriptContent)) !== null) {
      const [, actualVar, storeName] = match;
      const canonical = `${storeName.charAt(0).toLowerCase() + storeName.slice(1)}Store`;
      if (!storeVarToActualVars.has(canonical)) {
        storeVarToActualVars.set(canonical, []);
      }
      if (!storeVarToActualVars.get(canonical)!.includes(actualVar)) {
        storeVarToActualVars.get(canonical)!.push(actualVar);
      }
    }

    // Determine correct module for each store variable based on its usage (aggregate usage from canonical var and all actual vars)
    const wrongImports: Array<{
      importLine: string;
      wrongStore: string;
      wrongStoreVar: string;
      wrongModule: string;
      correctModule: string;
      actualVarNames: string[];
    }> = [];

    storeImports.forEach(({ importLine, storeName, storeVar, importedModule }) => {
      const actualVars = [storeVar, ...(storeVarToActualVars.get(storeVar) || [])].filter((v, i, a) => a.indexOf(v) === i);
      const aggregatedUsage = new Map<string, number>();
      for (const av of actualVars) {
        const usage = storeVarUsage.get(av);
        if (usage) {
          usage.forEach((count, module) => {
            aggregatedUsage.set(module, (aggregatedUsage.get(module) || 0) + count);
          });
        }
      }
      if (aggregatedUsage.size === 0) return;

      let correctModule = importedModule;
      let maxUsage = 0;
      aggregatedUsage.forEach((count, module) => {
        if (count > maxUsage) {
          maxUsage = count;
          correctModule = module;
        }
      });

      const storeNameFromImport = storeVar.replace(/Store$/, ""); // e.g. productStore -> product
      const wrongModulePath = importedModule !== correctModule;
      const wrongStoreName = storeNameFromImport !== correctModule; // e.g. importing useProductStore but usage says user
      if (maxUsage > 0 && (wrongModulePath || wrongStoreName)) {
        // Don't replace module store with index when the store uses methods exclusive to the module
        // (e.g. userStore.fetchUser - index has fetchCurrentUser but not fetchUser(id))
        if (correctModule === "index" && importedModule !== "index") {
          const indexMembers = new Set(
            Object.entries(storeMethodMap).filter(([, mod]) => mod === "index").map(([m]) => m)
          );
          const usedMembers = new Set<string>();
          for (const av of actualVars) {
            storeVarMembers.get(av)?.forEach((m) => usedMembers.add(m));
          }
          const usesExclusiveModuleMethod = [...usedMembers].some(
            (member) => storeMethodMap[member] === importedModule && !indexMembers.has(member)
          );
          if (usesExclusiveModuleMethod) {
            return; // Keep module store - it's needed for fetchUser/fetchProduct etc.
          }
        }
        wrongImports.push({
          importLine,
          wrongStore: storeName,
          wrongStoreVar: storeVar,
          wrongModule: importedModule,
          correctModule,
          actualVarNames: actualVars
        });
      }
    });

    // Fix wrong imports
    if (wrongImports.length > 0) {
      wrongImports.forEach(({ importLine, wrongStore, wrongModule: _wrongModule, correctModule, actualVarNames }) => {
        const correctStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
        const correctImportPath =
          correctModule === "index" ? "@/store/index" : `@/store/modules/${correctModule}`;
        const correctImport = `import { ${correctStore} } from '${correctImportPath}'`;
        const correctStoreVar = `${correctModule}Store`;

        scriptContent = scriptContent.replace(importLine, correctImport);

        for (const wrongStoreVarName of actualVarNames) {
          if (wrongStoreVarName === correctStoreVar) continue;
          const escapedWrongStoreVar = wrongStoreVarName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const escapedWrongStore = wrongStore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          scriptContent = scriptContent.replace(
            new RegExp(`const\\s+${escapedWrongStoreVar}\\s*=\\s*${escapedWrongStore}\\(\\)`, "g"),
            `const ${correctStoreVar} = ${correctStore}()`
          );
          scriptContent = scriptContent.replace(
            new RegExp(`\\b${escapedWrongStoreVar}\\.`, "g"),
            `${correctStoreVar}.`
          );
        }
      });

      if (scriptContent !== originalScriptContent) {
        // Preserve script tag attributes properly
        const scriptTagMatch = scriptMatch[0].match(/<script([^>]*)>/);
        const scriptAttrs = scriptTagMatch ? scriptTagMatch[1] : "";
        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${scriptAttrs}>${scriptContent}</script>`
        );

        result.content = fixed;
        result.fixed = true;
        result.fixes.push(
          `Corrected wrong store imports: ${wrongImports.map((i) => 
            `${i.wrongStore} → use${i.correctModule.charAt(0).toUpperCase() + i.correctModule.slice(1)}Store`
          ).join(", ")}`
        );
      }
    }

    return result;
  }
};

/**
 * Fix 8d: Add missing imports for stores/functions used but not imported
 * Detects usage of stores (via storeVar.method() or storeVar.property) and adds missing imports
 */
export const addMissingStoreImportsRule: FixRule = {
  id: "add-missing-store-imports",
  description: "Add missing imports for stores/functions used but not imported",
  priority: 81,
  dependencies: ["remove-vuex-imports", "correct-wrong-store-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && 
           content.includes("<script setup") &&
           (/\w+Store\.\w+/.test(content) || /use\w+Store/.test(content));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.scriptContent || !_context.projectRoot) {
      return result;
    }

    // Get store analysis using centralized cache
    const storeMethodMap = await getStoreMethodMap(_context.projectRoot);
    
    if (Object.keys(storeMethodMap).length === 0) {
      return result; // No store information available
    }

    let fixed = content;
    const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    
    if (!scriptMatch) {
      return result;
    }

    let scriptContent = scriptMatch[1];
    const originalScriptContent = scriptContent;

    // Detect used stores
    const usedStores = new Map<string, string>(); // storeVarName → moduleName

    // Pattern 1: Detect storeVar.method() or storeVar.property
    const storeUsagePattern = /(\w+Store)\.(\w+)/g;
    let match;
    while ((match = storeUsagePattern.exec(scriptContent)) !== null) {
      const [, storeVar, member] = match;
      const moduleName = storeVar.replace(/Store$/, "").toLowerCase();
      
      // Verify this is actually a store method/property
      if (storeMethodMap[member] === moduleName || 
          Object.values(storeMethodMap).some((mod: string) => mod === moduleName)) {
        usedStores.set(storeVar, moduleName);
      }
    }

    // Pattern 2: Detect direct method calls that are store methods
    Object.keys(storeMethodMap).forEach((method) => {
      const methodCallPattern = new RegExp(`\\b${method}\\s*\\(`, "g");
      let _methodMatch;
      while ((_methodMatch = methodCallPattern.exec(scriptContent)) !== null) {
        // Check if method is not defined locally
        const isDefinedLocally = scriptContent.match(
          new RegExp(`(const|let|var|function|import)\\s+${method}\\b`)
        );
        const isStoreCall = scriptContent.match(
          new RegExp(`\\w+Store\\.${method}`)
        );
        const isVueAPI = [
          "computed", "ref", "reactive", "watch", "onMounted", "onUnmounted",
          "defineProps", "defineEmits", "console", "setTimeout", "setInterval"
        ].includes(method);

        if (!isDefinedLocally && !isStoreCall && !isVueAPI) {
          const moduleName = storeMethodMap[method];
          if (moduleName) {
            const storeVar = `${moduleName}Store`;
            usedStores.set(storeVar, moduleName);
            
            // Replace direct method call with store method call
            scriptContent = scriptContent.replace(
              new RegExp(`\\b${method}\\s*\\(`, "g"),
              `${storeVar}.${method}(`
            );
          }
        }
      }
    });

    // Add missing imports and initializations
    const addedImports: string[] = [];
    
    usedStores.forEach((moduleName, storeVar) => {
      const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
      const importPath = moduleName === "index" ? "@/store/index" : `@/store/modules/${moduleName}`;

      // Check if store is already imported
      const importPattern = new RegExp(`import\\s+.*${storeName}.*from`, "g");
      if (!importPattern.test(scriptContent)) {
        // Add import
        const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        if (importMatch) {
          scriptContent = scriptContent.replace(
            /(import\s+[^;]+;[\s\n]*)+/,
            `$&import { ${storeName} } from '${importPath}';\n`
          );
        } else {
          scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
        }
        addedImports.push(storeName);
      }

      // Check if store is initialized
      const initPattern = new RegExp(`const\\s+${storeVar}\\s*=\\s*${storeName}\\(\\)`, "g");
      if (!initPattern.test(scriptContent)) {
        // Add initialization after imports
        const afterImportsMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        if (afterImportsMatch) {
          const insertIndex = afterImportsMatch[0].length;
          scriptContent = scriptContent.slice(0, insertIndex) +
            `\nconst ${storeVar} = ${storeName}();\n` +
            scriptContent.slice(insertIndex);
        } else {
          scriptContent = `const ${storeVar} = ${storeName}();\n${scriptContent}`;
        }
      }
    });

    if (scriptContent !== originalScriptContent) {
      fixed = fixed.replace(
        /<script[^>]*>([\s\S]*?)<\/script>/,
        `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
      );

      result.content = fixed;
      result.fixed = true;
      if (addedImports.length > 0) {
        result.fixes.push(`Added missing store imports: ${addedImports.join(", ")}`);
      }
    }

    return result;
  }
};

/**
 * Fix: Replace Vue.set/$set and Vue.delete/$delete (removed in Vue 3)
 * Vue 3 reactivity allows direct assignment and delete with reactive()/ref()
 */
export const vueSetRule: FixRule = {
  id: "vue-set-removal",
  description: "Replace Vue.set/$set and Vue.delete/$delete (removed in Vue 3)",
  priority: 88,
  shouldApply: (_filePath, content) => {
    return (
      content.includes("Vue.set") ||
      content.includes("this.$set") ||
      content.includes("Vue.delete") ||
      content.includes("this.$delete")
    );
  },
  apply: async (_filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;
    // Vue.set(obj, key, value) or this.$set → obj[key] = value
    fixed = fixed.replace(
      /(?:Vue\.set|this\.\$set)\s*\(\s*([^,]+?),\s*([^,]+?),\s*((?:[^()]|\([^)]*\))*)\s*\)/g,
      (_, obj, key, val) => {
        result.fixed = true;
        return `${obj.trim()}[${key.trim()}] = ${val.trim()}`;
      }
    );
    // Vue.delete(obj, key) or this.$delete → delete obj[key]
    fixed = fixed.replace(
      /(?:Vue\.delete|this\.\$delete)\s*\(\s*([^,]+?),\s*([^)]+?)\s*\)/g,
      (_, obj, key) => {
        result.fixed = true;
        return `delete ${obj.trim()}[${key.trim()}]`;
      }
    );
    if (result.fixed) {
      result.content = fixed;
      result.fixes.push("Replaced Vue.set/$set and Vue.delete/$delete with direct assignment/delete");
    }
    return result;
  }
};
