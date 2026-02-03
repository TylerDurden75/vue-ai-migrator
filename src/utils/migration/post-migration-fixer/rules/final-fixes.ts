/**
 * Rules for final aggressive fixes (runs last)
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";

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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!context.scriptContent) {
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
    
    while ((match = storePropertyPattern.exec(context.scriptContent)) !== null) {
      const wrongStoreVar = match[1];
      const propertyName = match[2];
      
      // Infer correct store from property name (generic)
      const propertyLower = propertyName.toLowerCase();
      const withoutAll = propertyLower.replace(/^all/, "");
      const singular = withoutAll.endsWith("s") ? withoutAll.slice(0, -1) : withoutAll;
      const normalized = singular.endsWith("ies") ? singular.slice(0, -3) + "y" : singular;
      const correctStoreVar = `${normalized}Store`;
      
      // Check if correct store is initialized
      const storesInScript = context.scriptContent.match(/const\s+(\w+Store)\s*=\s*use\w+Store\s*\(\)/g);
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: store.property.length → (store.property || []).length
    // But only if not already wrapped
    fixed = fixed.replace(
      /(\w+Store\.\w+)\s*\.length(?!\s*\))/g,
      (match, propertyPath) => {
        // Check if already wrapped
        if (!match.includes("||") && !match.includes("?")) {
          return `(${propertyPath} || []).length`;
        }
        return match;
      }
    );

    // Fix: computedName.length → computedName.value.length (if computed)
    if (context.scriptContent) {
      const computedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
      const computedNames = new Set<string>();
      let match;
      while ((match = computedPattern.exec(context.scriptContent)) !== null) {
        computedNames.add(match[1]);
      }

      computedNames.forEach(computedName => {
        // Fix: computedName.length → computedName.value.length (in script)
        const pattern = new RegExp(`\\b${computedName}\\.length\\b`, "g");
        if (pattern.test(context.scriptContent!)) {
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
 */
export const detailViewStoreRule: FixRule = {
  id: "detail-view-store",
  description: "Fix Detail views to use store.allItems.find() instead of store.currentItem",
  priority: 3,
  dependencies: ["null-checks-length"],
  shouldApply: (filePath, content) => {
    return (filePath.includes("Detail") || content.includes("Detail")) &&
           content.includes("current") &&
           content.includes("Store");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!context.scriptContent) {
      return result;
    }

    let fixed = content;

    // Pattern: const item = computed(() => store.currentItem)
    const currentItemPattern = getCachedRegex(
      "const\\s+(\\w+)\\s*=\\s*computed\\s*<[^>]*>\\s*\\(\\s*\\(\\)\\s*=>\\s*(\\w+Store)\\.current(\\w+)",
      "g"
    );
    
    let match;
    while ((match = currentItemPattern.exec(context.scriptContent)) !== null) {
      const itemVarName = match[1];
      const storeVar = match[2];
      
      // Find store name
      const storeNameMatch = context.scriptContent.match(
        new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`)
      );
      
      if (storeNameMatch) {
        const storeName = storeNameMatch[1].toLowerCase();
        
        // Find actual allItems property
        const allItemsPattern = new RegExp(`${storeVar}\\.(all\\w+)`, "g");
        const allItemsMatches = [...context.scriptContent.matchAll(allItemsPattern)];
        const actualAllItems = allItemsMatches.length > 0 
          ? allItemsMatches[0][1] 
          : `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
        
        // Get id source
        const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
        const userIdMatch = context.scriptContent.match(userIdPattern);
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
