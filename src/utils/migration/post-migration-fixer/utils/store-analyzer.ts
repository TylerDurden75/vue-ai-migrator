/**
 * Store analyzer utility for detecting store methods and properties
 * Provides generic store analysis for any Vue project
 */

import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";

/**
 * Derives the module name from a store file path.
 * For index.js/ts in a subfolder (e.g. store/modules/cart/index.js), returns the folder name (cart).
 * For flat files (e.g. store/modules/cart.js), returns the filename (cart).
 */
function getModuleNameFromPath(
  filePath: string,
  modulesBasePath: string
): string {
  const relativePath = path.relative(modulesBasePath, filePath);
  const parts = relativePath.replace(/\.(js|ts)$/, "").split(path.sep);
  const basename = parts[parts.length - 1] || "module";
  // index.js/ts in subfolder → use parent folder name (e.g. cart)
  if (basename === "index" && parts.length > 1) {
    return parts[parts.length - 2] || "module";
  }
  return basename;
}

/**
 * Recursively finds all store module files (supports store/modules/cart/index.js, store/modules/carts/, etc.)
 */
async function findStoreModuleFiles(projectRoot: string): Promise<string[]> {
  const patterns = [
    "src/store/modules/**/*.{js,ts}",
    "store/modules/**/*.{js,ts}",
  ];
  const allFiles: string[] = [];
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: projectRoot,
      absolute: true,
      ignore: ["node_modules/**", "dist/**"],
    });
    allFiles.push(...files);
  }
  return [...new Set(allFiles)];
}

/**
 * Analyzes Pinia stores in a project to build a dynamic map of methods/getters to store modules.
 * This enables generic store detection for any Vue project structure.
 * Supports:
 * - Flat modules: store/modules/cart.js, store/modules/products.js
 * - Nested modules: store/modules/cart/index.js, store/modules/carts/index.js
 *
 * @param projectRoot - The root directory of the Vue project
 * @returns A map of method/getter names to their corresponding store module names
 */
export async function analyzePiniaStores(
  projectRoot: string
): Promise<Map<string, string>> {
  const methodToStoreMap = new Map<string, string>();

  try {
    const storeModuleFiles = await findStoreModuleFiles(projectRoot);
    const modulesBasePath = path.join(projectRoot, "src", "store", "modules");
    const altModulesBasePath = path.join(projectRoot, "store", "modules");

    for (const storeFilePath of storeModuleFiles) {
      const modulesBase = storeFilePath.includes("/src/store/modules/")
        ? modulesBasePath
        : altModulesBasePath;
      const moduleName = getModuleNameFromPath(storeFilePath, modulesBase);

      let storeContent: string;
      try {
        storeContent = await fs.readFile(storeFilePath, "utf-8");
      } catch {
        continue;
      }
      const storeNameMatch = storeContent.match(
        /export\s+const\s+(use\w+Store)\s*=/
      );
      if (!storeNameMatch) continue;

      // Extract methods/getters from return statement (finds last 'return' before closing '});')
      const returnIndex = storeContent.lastIndexOf("return");
      if (returnIndex !== -1) {
        const afterReturn = storeContent.substring(returnIndex);
        const closingIndex = afterReturn.indexOf("});");
        if (closingIndex !== -1) {
          const returnSection = afterReturn.substring(0, closingIndex);
          const returnMatch = returnSection.match(
            /return\s*\{([\s\S]+?)\}\s*;/
          );
          if (returnMatch) {
            const returnContent = returnMatch[1];
            const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
            let propMatch;
            while (
              (propMatch = propertyPattern.exec(returnContent)) !== null
            ) {
              const exportedKey = propMatch[1];
              const exportedName = propMatch[2] || propMatch[1];
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
      const functionPattern = /function\s+(\w+)\s*\(/g;
      let funcMatch;
      while ((funcMatch = functionPattern.exec(storeContent)) !== null) {
        const funcName = funcMatch[1];
        if (!funcName.match(/^[A-Z_]+$/)) {
          methodToStoreMap.set(funcName, moduleName);
        }
      }

      const constMethodPattern =
        /const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
      let constMatch;
      while ((constMatch = constMethodPattern.exec(storeContent)) !== null) {
        methodToStoreMap.set(constMatch[1], moduleName);
      }

      const computedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
      let computedMatch;
      while ((computedMatch = computedPattern.exec(storeContent)) !== null) {
        methodToStoreMap.set(computedMatch[1], moduleName);
      }
    }

    // Fallback: src/stores/ (Pinia plural convention) when no store/modules
    if (storeModuleFiles.length === 0) {
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
      } catch {
        // src/stores doesn't exist, continue
      }
    }

    // Also analyze store/index so getters.property / dispatch('action') map to 'index'
    const indexPaths = [
      path.join(projectRoot, "src", "store", "index.ts"),
      path.join(projectRoot, "src", "store", "index.js"),
      path.join(projectRoot, "store", "index.ts"),
      path.join(projectRoot, "store", "index.js"),
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
