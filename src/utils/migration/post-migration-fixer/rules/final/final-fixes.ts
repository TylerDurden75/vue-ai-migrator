/**
 * Rules for final aggressive fixes (runs last)
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";
import { getCachedRegex } from "../../utils/regex-cache";

const OBJ_PATTERN = "\\{(?:[^{}]|\\{[^{}]*\\})*\\}";

/**
 * Fix: Add missing closing ")" on function call with object arg.
 * Handles two malformed patterns (migration artifacts):
 * - IDENT({ ... }; → IDENT({ ... }));
 * - IDENT({ ... }); inside arrow => (e.g. .then(x => Fn({ ... });) → })); (missing ) to close call)
 * Generic: applies to any .js/.ts/.vue file.
 */
export const missingCallParenRepairRule: FixRule = {
  id: "missing-call-paren-repair",
  description: "Add missing ) in IDENT({ ... }); or IDENT({ ... }; (malformed call)",
  priority: 25,
  shouldApply: (filePath, content) => {
    if (!/\.(js|ts|vue)$/i.test(filePath)) return false;
    return (
      /\w+\s*\(\s*\{[^}]*(?:\{[^{}]*\}[^{}]*)*\}\s*;\s*/.test(content) ||
      /=>\s*\w+\s*\(\s*\{[^}]*(?:\{[^{}]*\}[^{}]*)*\}\s*\)\s*;\s*/.test(content)
    );
  },
  apply: async (_filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    // Case 1: }; (no ) at all) → });
    const re1 = new RegExp(`(\\w+)\\s*\\(\\s*(${OBJ_PATTERN})\\s*;(\\s*)`, "g");
    // Case 2: }); after => (arrow callback - need extra ) to close .then) → });
    const re2 = new RegExp(`(=>)\\s*(\\w+)\\s*\\(\\s*(${OBJ_PATTERN})\\s*\\)\\s*;(\\s*)`, "g");
    let fixed = content;
    fixed = fixed.replace(re1, (_, name, obj, trailing) => {
      result.fixes.push(`Fixed missing ) in ${name}({ ... });`);
      return `${name}(${obj}));${trailing}`;
    });
    fixed = fixed.replace(re2, (_, arrow, name, obj, trailing) => {
      result.fixes.push(`Fixed missing ) in ${name}({ ... });`);
      return `${arrow} ${name}(${obj}));${trailing}`;
    });
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
    }
    return result;
  }
};

/**
 * Fix: Concatenated statements - )const / )let / )var without separator.
 * Pattern: fn()const x = ... (migration artifact - missing semicolon/newline).
 * Generic: applies to .js/.ts/.vue when ) is immediately followed by const/let/var.
 */
export const concatenatedStatementsRule: FixRule = {
  id: "concatenated-statements",
  description: "Add missing semicolon between statements (e.g. fn()const → fn(); const)",
  priority: 24,
  shouldApply: (_filePath, content) => /\)\s*(const|let|var)\s+/.test(content),
  apply: async (_filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(/\)\s*(const|let|var)\s+/g, ");\n$1 ");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added missing semicolon between concatenated statements");
    }
    return result;
  }
};

/**
 * Fix: Remove stray double semicolons ;; (migration artifacts).
 * Generic: applies to any file.
 */
export const removeDoubleSemicolonsRule: FixRule = {
  id: "remove-double-semicolons",
  description: "Remove stray ;; (double semicolons)",
  priority: 20,
  shouldApply: (_filePath, content) => /;;\s*\n/.test(content) || /;;\s*import/.test(content),
  apply: async (_filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(/;;+/g, ";");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed double semicolons");
    }
    return result;
  }
};

/**
 * Fix: Detect and fix wrong store property access (generic)
 * Pattern: wrongStore.allItems → correctStore.allItems
 */
export const wrongStorePropertyRule: FixRule = {
  id: "wrong-store-property",
  description: "Detect and fix wrong store property access (generic)",
  priority: 5,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("Store");
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

    let fixed = content;
    let hasChanges = false;

    // Pattern: storeVar.allPropertyName where property suggests a different store
    const storePropertyPattern = getCachedRegex(
      "(\\w+Store)\\.(all\\w+)",
      "g"
    );
    
    const wrongStoreFixes = new Map<string, { wrongStore: string; property: string; correctStore: string }>();
    let match;
    
    while ((match = storePropertyPattern.exec(_context.scriptContent)) !== null) {
      const wrongStoreVar = match[1];
      const propertyName = match[2];
      
      // Infer correct store from property name (generic)
      const propertyLower = propertyName.toLowerCase();
      const withoutAll = propertyLower.replace(/^all/, "");
      const singular = withoutAll.endsWith("s") ? withoutAll.slice(0, -1) : withoutAll;
      const normalized = singular.endsWith("ies") ? singular.slice(0, -3) + "y" : singular;
      const correctStoreVar = `${normalized}Store`;
      
      // Check if correct store is initialized
      const storesInScript = _context.scriptContent.match(/const\s+(\w+Store)\s*=\s*use\w+Store\s*\(\)/g);
      const initializedStores = storesInScript ? storesInScript.map(s => s.match(/const\s+(\w+Store)/)?.[1]).filter(Boolean) : [];
      
      if (normalized && correctStoreVar !== wrongStoreVar && initializedStores.includes(correctStoreVar)) {
        const key = `${wrongStoreVar}.${propertyName}`;
        if (!wrongStoreFixes.has(key)) {
          wrongStoreFixes.set(key, {
            wrongStore: wrongStoreVar,
            property: propertyName,
            correctStore: correctStoreVar
          });
        }
      }
    }

    // Apply fixes
    if (wrongStoreFixes.size > 0) {
      const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        
        wrongStoreFixes.forEach(({ wrongStore, property, correctStore }) => {
          const pattern = new RegExp(`\\b${wrongStore}\\.${property}\\b`, "g");
          scriptContent = scriptContent.replace(pattern, `${correctStore}.${property}`);
          hasChanges = true;
        });

        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
        );

        wrongStoreFixes.forEach(({ wrongStore, property, correctStore }) => {
          result.fixes.push(`Fixed wrong store property: ${wrongStore}.${property} → ${correctStore}.${property}`);
        });
      }
    }

    if (hasChanges) {
      result.content = fixed;
      result.fixed = true;
    }

    return result;
  }
};

/**
 * Fix: Add null checks for .length access
 */
export const nullChecksLengthRule: FixRule = {
  id: "null-checks-length",
  description: "Add null checks for .length access on computed properties",
  priority: 4,
  dependencies: ["wrong-store-property"],
  shouldApply: (filePath, content) => {
    return content.includes(".length") && (
      content.includes("computed") ||
      content.includes("Store")
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

    // Fix: store.property.length → (store.property ?? []).length
    // But only if not already wrapped
    fixed = fixed.replace(
      /(\w+Store\.\w+)\s*\.length(?!\s*\))/g,
      (match, propertyPath) => {
        // Check if already wrapped
        if (!match.includes("||") && !match.includes("??")) {
          return `(${propertyPath} ?? []).length`;
        }
        return match;
      }
    );

    // Fix: computedName.length → computedName.value.length (if computed)
    if (_context.scriptContent) {
      const computedPattern = /const\s+(\w+)\s*=\s*computed\s*(?:<[^>]*>)?\s*\(/g;
      const computedNames = new Set<string>();
      let match;
      while ((match = computedPattern.exec(_context.scriptContent)) !== null) {
        computedNames.add(match[1]);
      }

      computedNames.forEach(computedName => {
        // Fix: computedName.length → computedName.value.length (in script)
        const pattern = new RegExp(`\\b${computedName}\\.length\\b`, "g");
        if (pattern.test(_context.scriptContent!)) {
          const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
          if (scriptMatch) {
            let scriptContent = scriptMatch[1];
            scriptContent = scriptContent.replace(pattern, `${computedName}.value.length`);
            fixed = fixed.replace(
              /<script[^>]*>([\s\S]*?)<\/script>/,
              `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
            );
          }
        }
        // Fix: computedName.length in template → (computedName ?? []).length (null-safe)
        if (_context.templateContent && new RegExp(`\\b${computedName}\\.length\\b`).test(_context.templateContent)) {
          const templateMatch = fixed.match(/<template[^>]*>([\s\S]*?)<\/template>/);
          if (templateMatch) {
            const templatePattern = new RegExp(`\\b${computedName}\\.length\\b`, "g");
            const newTemplate = templateMatch[1].replace(templatePattern, `(${computedName} ?? []).length`);
            if (newTemplate !== templateMatch[1]) {
              fixed = fixed.replace(
                /<template[^>]*>([\s\S]*?)<\/template>/,
                `<template${templateMatch[0].match(/<template\s+([^>]+)>/)?.[1] || ""}>${newTemplate}</template>`
              );
              result.fixed = true;
            }
          }
        }
      });
    }

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added null checks for .length access");
    }

    return result;
  }
};

/**
 * Fix: Fix Detail views to use store.allItems.find() instead of store.currentItem
 * Do NOT apply when storeVar.method(id) exists: currentXxx is updated by the API.
 * Generic structural detection: any store call with an identifier (props, route, id).
 */
export const detailViewStoreRule: FixRule = {
  id: "detail-view-store",
  description: "Fix Detail views to use store.allItems.find() instead of store.currentItem",
  priority: 3,
  dependencies: ["null-checks-length"],
  shouldApply: (filePath, content) => {
    const suggestsDetailView = /Detail|Profile/.test(filePath) || content.includes("Detail");
    if (!suggestsDetailView ||
        !content.includes("current") ||
        !content.includes("Store")) {
      return false;
    }
    // Do not apply if storeVar.method(...) receives an identifier (generic structural pattern)
    // Couvre : props.id, props.xxx, route.params.id, route.params.xxx, id, slug, etc.
    if (/\w+Store\.\w+\s*\([^)]*(?:props\.\w+|route\.params(?:\.\w+|\[\s*['"]?\w+['"]?\s*\])|\.id\b|\bid\b|\bslug\b)[^)]*\)/.test(content)) {
      return false;
    }
    return true;
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

    let fixed = content;

    // Pattern: const item = computed(() => store.currentItem)
    const currentItemPattern = getCachedRegex(
      "const\\s+(\\w+)\\s*=\\s*computed\\s*<[^>]*>\\s*\\(\\s*\\(\\)\\s*=>\\s*(\\w+Store)\\.current(\\w+)",
      "g"
    );
    
    let match;
    while ((match = currentItemPattern.exec(_context.scriptContent)) !== null) {
      const itemVarName = match[1];
      const storeVar = match[2];
      
      // Find store name
      const storeNameMatch = _context.scriptContent.match(
        new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`)
      );
      
      if (storeNameMatch) {
        const storeName = storeNameMatch[1].toLowerCase();
        
        // Find actual allItems property
        const allItemsPattern = new RegExp(`${storeVar}\\.(all\\w+)`, "g");
        const allItemsMatches = [..._context.scriptContent.matchAll(allItemsPattern)];
        const actualAllItems = allItemsMatches.length > 0 
          ? allItemsMatches[0][1] 
          : `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
        
        // Get id source
        const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
        const userIdMatch = _context.scriptContent.match(userIdPattern);
        let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
        idSource = idSource.replace(/^\s*return\s+/, "").trim();
        idSource = idSource.replace(/;\s*$/, "").trim();
        
        const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${actualAllItems}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
        
        fixed = fixed.replace(match[0], fixedItemComputed);
        result.fixed = true;
        result.fixes.push(`Fixed Detail view: ${itemVarName} uses ${storeVar}.${actualAllItems}.find()`);
      }
    }

    if (result.fixed) {
      result.content = fixed;
    }

    return result;
  }
};

/**
 * Fix: Add || 1 to Math.ceil for pagination to avoid 0/NaN display
 * Generic: return Math.ceil(...); → return Math.ceil(...) || 1; when pagination-like
 */
export const mathCeilPaginationFallbackRule: FixRule = {
  id: "math-ceil-pagination-fallback",
  description: "Add || 1 to Math.ceil pagination to avoid 0/NaN",
  priority: 18,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    return (
      /return\s+Math\.ceil\([^)]*\)\s*;/.test(content) &&
      !/Math\.ceil\([^)]*\)\s*\|\|\s*1/.test(content) &&
      /\.length|itemsPerPage|pageSize/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(
      /(return\s+Math\.ceil\([^)]+\))(\s*;)/g,
      "$1 || 1$2"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added || 1 to Math.ceil pagination");
    }
    return result;
  },
};
