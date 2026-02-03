/**
 * Store analyzer utility for detecting store methods and properties
 * Provides generic store analysis for any Vue project
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Analyzes Pinia stores in a project to build a dynamic map of methods/getters to store modules.
 * This enables generic store detection for any Vue project structure.
 * 
 * @param projectRoot - The root directory of the Vue project
 * @returns A map of method/getter names to their corresponding store module names
 */
export async function analyzePiniaStores(
  projectRoot: string
): Promise<Map<string, string>> {
  const methodToStoreMap = new Map<string, string>();

  try {
    const storeModulesPath = path.join(projectRoot, "src", "store", "modules");

    try {
      const storeFiles = await fs.readdir(storeModulesPath);

      for (const storeFile of storeFiles) {
        if (!storeFile.endsWith(".js") && !storeFile.endsWith(".ts")) {
          continue;
        }

        const storeFilePath = path.join(storeModulesPath, storeFile);
        const storeContent = await fs.readFile(storeFilePath, "utf-8");
        const moduleName = storeFile.replace(/\.(js|ts)$/, "");
        const storeNameMatch = storeContent.match(
          /export\s+const\s+(use\w+Store)\s*=/
        );
        if (!storeNameMatch) continue;

        // Extract methods/getters from return statement (finds last 'return' before closing '});')
        const returnIndex = storeContent.lastIndexOf("return");
        if (returnIndex !== -1) {
          const afterReturn = storeContent.substring(returnIndex);
          // Find the closing }); of defineStore
          const closingIndex = afterReturn.indexOf("});");
          if (closingIndex !== -1) {
            // Extract content between return { and };
            const returnSection = afterReturn.substring(0, closingIndex);
            // Match return { ... };
            const returnMatch = returnSection.match(
              /return\s*\{([\s\S]+?)\}\s*;/
            );
            if (returnMatch) {
              const returnContent = returnMatch[1];

              // Extract property names from return object
              // Pattern 1: methodName, (shorthand)
              // Pattern 2: methodName: variableName, (with alias)
              // Pattern 3: methodName: computedValue, (computed property)
              const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
              let propMatch;
              while (
                (propMatch = propertyPattern.exec(returnContent)) !== null
              ) {
                const exportedKey = propMatch[1]; // key in return { key: value }
                const exportedName = propMatch[2] || propMatch[1]; // value identifier if alias, else key

                // Always map the exported key (what consumers use) to the module
                methodToStoreMap.set(exportedKey, moduleName);
                if (
                  ![
                    "ref",
                    "reactive",
                    "computed",
                    "watch",
                    "onMounted",
                    "onUnmounted",
                    "undefined",
                    "null",
                  ].includes(exportedName) &&
                  exportedKey !== exportedName
                ) {
                  methodToStoreMap.set(exportedName, moduleName);
                }
              }
            }
          }
        }

        // Also extract function declarations directly in the store
        // Pattern: function methodName(...) { ... }
        const functionPattern = /function\s+(\w+)\s*\(/g;
        let funcMatch;
        while ((funcMatch = functionPattern.exec(storeContent)) !== null) {
          const funcName = funcMatch[1];
          if (!funcName.match(/^[A-Z_]+$/)) {
            methodToStoreMap.set(funcName, moduleName);
          }
        }

        // Extract const declarations that are methods
        // Pattern: const methodName = (...) => { ... } or const methodName = async (...) => { ... }
        const constMethodPattern =
          /const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
        let constMatch;
        while ((constMatch = constMethodPattern.exec(storeContent)) !== null) {
          const methodName = constMatch[1];
          methodToStoreMap.set(methodName, moduleName);
        }

        // Extract computed properties
        // Pattern: const computedName = computed(() => ...)
        const computedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
        let computedMatch;
        while ((computedMatch = computedPattern.exec(storeContent)) !== null) {
          const computedName = computedMatch[1];
          methodToStoreMap.set(computedName, moduleName);
        }
      }
    } catch (error) {
      // If store/modules directory doesn't exist, try alternative paths
      // Try src/stores/ (Pinia plural convention)
      const storesPath = path.join(projectRoot, "src", "stores");
      try {
        const storeFiles = await fs.readdir(storesPath);
        for (const storeFile of storeFiles) {
          if (!storeFile.endsWith(".js") && !storeFile.endsWith(".ts")) {
            continue;
          }
          const storeFilePath = path.join(storesPath, storeFile);
          const storeContent = await fs.readFile(storeFilePath, "utf-8");
          const moduleName = storeFile
            .replace(/\.(js|ts)$/, "")
            .replace(/\.store$/, "");

          // Same extraction logic as above
          const returnMatch = storeContent.match(/return\s*\{([^}]+)\}/s);
          if (returnMatch) {
            const returnContent = returnMatch[1];
            const propertyPattern = /(\w+)(?:\s*:\s*\w+)?/g;
            let propMatch;
            while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
              const propName = propMatch[1];
              if (
                !["ref", "reactive", "computed", "watch"].includes(propName)
              ) {
                methodToStoreMap.set(propName, moduleName);
              }
            }
          }

          const functionPattern = /function\s+(\w+)\s*\(/g;
          let funcMatch;
          while ((funcMatch = functionPattern.exec(storeContent)) !== null) {
            const funcName = funcMatch[1];
            if (!funcName.match(/^[A-Z_]+$/)) {
              methodToStoreMap.set(funcName, moduleName);
            }
          }
        }
      } catch (altError) {
        // If both paths fail, return empty map
      }
    }

    // Also analyze store/index.ts (or index.js) so getters.property / dispatch('action') map to 'index'
    const indexPaths = [
      path.join(projectRoot, "src", "store", "index.ts"),
      path.join(projectRoot, "src", "store", "index.js")
    ];
    for (const indexPath of indexPaths) {
      try {
        const indexContent = await fs.readFile(indexPath, "utf-8");
        // Match return { ... }; or return { ... }\n});
        const returnMatch = indexContent.match(/return\s*\{([\s\S]+?)\}\s*;?\s*\n\s*\}\)/);
        if (returnMatch) {
          const returnContent = returnMatch[1];
          const propertyPattern = /(\w+)(?:\s*:\s*\w+)?/g;
          let propMatch;
          while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
            const propName = propMatch[1];
            if (!["ref", "reactive", "computed", "watch"].includes(propName)) {
              methodToStoreMap.set(propName, "index");
            }
          }
        }
        const functionPattern = /(?:function|const)\s+(\w+)\s*[=:(]/g;
        let funcMatch;
        while ((funcMatch = functionPattern.exec(indexContent)) !== null) {
          const name = funcMatch[1];
          if (!/^use\w+Store$/.test(name) && !["ref", "computed", "defineStore", "return", "export"].includes(name)) {
            methodToStoreMap.set(name, "index");
          }
        }
        break;
      } catch {
        // index file not found or not readable, continue
      }
    }
  } catch (error) {
    // If analysis fails, return empty map
  }

  return methodToStoreMap;
}
