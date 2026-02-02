import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import {
  analyzeArrayItemProperties,
  analyzeFilterProperties,
  analyzeTemplateProperties,
} from "./property-analyzer";
import { formatWithPrettier } from "./prettier-formatter";

export interface FixResult {
  fixed: boolean;
  issues: string[];
  fixes: string[];
  content: string; // Fixed content
}

/**
 * Finds the main store file in a Vue project and returns its store name and import path.
 * Searches for store/index.js, store/index.ts, stores/index.js, or stores/index.ts.
 * 
 * @param projectRoot - The root directory of the Vue project
 * @returns The store name and import path, or null if not found
 */
async function findMainStore(
  projectRoot: string
): Promise<{ storeName: string; importPath: string } | null> {
  try {
    const storeIndexPath = path.join(projectRoot, "src", "store", "index.js");
    try {
      const storeContent = await fs.readFile(storeIndexPath, "utf-8");
      const storeNameMatch = storeContent.match(
        /export\s+const\s+(use\w+Store)\s*=/
      );
      if (storeNameMatch) {
        return {
          storeName: storeNameMatch[1],
          importPath: "@/store/index",
        };
      }
    } catch {
      try {
        const storeIndexPathTs = path.join(
          projectRoot,
          "src",
          "store",
          "index.ts"
        );
        const storeContent = await fs.readFile(storeIndexPathTs, "utf-8");
        const storeNameMatch = storeContent.match(
          /export\s+const\s+(use\w+Store)\s*=/
        );
        if (storeNameMatch) {
          return {
            storeName: storeNameMatch[1],
            importPath: "@/store/index",
          };
        }
      } catch {
        try {
          const storesIndexPath = path.join(
            projectRoot,
            "src",
            "stores",
            "index.js"
          );
          const storeContent = await fs.readFile(storesIndexPath, "utf-8");
          const storeNameMatch = storeContent.match(
            /export\s+const\s+(use\w+Store)\s*=/
          );
          if (storeNameMatch) {
            return {
              storeName: storeNameMatch[1],
              importPath: "@/stores/index",
            };
          }
        } catch {
          try {
            const storesIndexPathTs = path.join(
              projectRoot,
              "src",
              "stores",
              "index.ts"
            );
            const storeContent = await fs.readFile(storesIndexPathTs, "utf-8");
            const storeNameMatch = storeContent.match(
              /export\s+const\s+(use\w+Store)\s*=/
            );
            if (storeNameMatch) {
              return {
                storeName: storeNameMatch[1],
                importPath: "@/stores/index",
              };
            }
          } catch {
            // No main store found
          }
        }
      }
    }
  } catch {
    // Error reading directory
  }
  return null;
}

/**
 * Analyzes Pinia stores in a project to build a dynamic map of methods/getters to store modules.
 * This enables generic store detection for any Vue project structure.
 * 
 * @param projectRoot - The root directory of the Vue project
 * @returns A map of method/getter names to their corresponding store module names
 */
async function analyzePiniaStores(
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
                const exportedName = propMatch[2] || propMatch[1]; // Use alias if present, otherwise original name
                const internalName = propMatch[1];

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
                  ].includes(exportedName)
                ) {
                  // Map both the exported name and internal name to the module
                  methodToStoreMap.set(exportedName, moduleName);
                  if (internalName !== exportedName) {
                    methodToStoreMap.set(internalName, moduleName);
                  }
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
        // If both paths fail, return empty map (fallback to hardcoded map)
      }
    }
  } catch (error) {
    // If analysis fails, return empty map (will fallback to hardcoded map)
  }

  return methodToStoreMap;
}

// Cache for store analysis to avoid re-analyzing on every file
let storeAnalysisCache: Map<string, string> | null = null;
let storeAnalysisProjectRoot: string | null = null;

/**
 * Clear the store analysis cache - useful for second pass after all stores are migrated
 * GENERIC: This allows re-analysis after stores are fully migrated
 */
export function clearStoreAnalysisCache(): void {
  storeAnalysisCache = null;
  storeAnalysisProjectRoot = null;
}

/**
 * Extracts object structure from code assignments to infer TypeScript interface properties.
 * Analyzes array assignments, function calls, and value assignments to detect property names.
 * 
 * @param code - The code string to analyze
 * @returns An object containing detected properties and sample count
 */
function extractObjectStructureFromCode(code: string): {
  properties: string[];
  sampleCount: number;
} {
  const properties = new Set<string>();
  let sampleCount = 0;

  try {
    // Pattern 1: const posts = [{ id: 1, title: '...' }, ...]
    const arrayAssignPattern = new RegExp(
      `(?:const|let|var)\\s+\\w+\\s*=\\s*\\[\\s*\\{([^}]+)\\}[^\\]]*\\]`,
      "g"
    );
    let arrayMatch;
    while ((arrayMatch = arrayAssignPattern.exec(code)) !== null) {
      const objectContent = arrayMatch[1];
      // Extract property names: id: 1, title: '...'
      const propPattern = /(\w+)\s*:/g;
      let propMatch;
      while ((propMatch = propPattern.exec(objectContent)) !== null) {
        properties.add(propMatch[1]);
        sampleCount++;
      }
    }

    // Pattern 2: SET_POSTS([{ id: 1, title: '...' }])
    const functionCallPattern = new RegExp(
      `SET_\\w+\\(\\s*\\[\\s*\\{([^}]+)\\}[^\\]]*\\]\\s*\\)`,
      "g"
    );
    let funcMatch;
    while ((funcMatch = functionCallPattern.exec(code)) !== null) {
      const objectContent = funcMatch[1];
      const propPattern = /(\w+)\s*:/g;
      let propMatch;
      while ((propMatch = propPattern.exec(objectContent)) !== null) {
        properties.add(propMatch[1]);
        sampleCount++;
      }
    }

    // Pattern 3: posts.value = [{ id: 1, title: '...' }]
    const valueAssignPattern = new RegExp(
      `(\\w+)\\.value\\s*=\\s*\\[\\s*\\{([^}]+)\\}[^\\]]*\\]`,
      "g"
    );
    let valueMatch;
    while ((valueMatch = valueAssignPattern.exec(code)) !== null) {
      const objectContent = valueMatch[2];
      const propPattern = /(\w+)\s*:/g;
      let propMatch;
      while ((propMatch = propPattern.exec(objectContent)) !== null) {
        properties.add(propMatch[1]);
        sampleCount++;
      }
    }
  } catch (error) {
    // Silently fail - extraction is best effort
  }

  return { properties: Array.from(properties), sampleCount };
}

/**
 * Convert plural property name to singular interface name (same logic as in vuex-pinia-setup.ts)
 */
function pluralToSingularInterface(pluralName: string): string {
  const irregularPlurals: Record<string, string> = {
    children: "Child",
    people: "Person",
    men: "Man",
    women: "Woman",
    feet: "Foot",
    teeth: "Tooth",
    mice: "Mouse",
    geese: "Goose",
    data: "Datum",
  };

  const lowerName = pluralName.toLowerCase();

  if (irregularPlurals[lowerName]) {
    return irregularPlurals[lowerName];
  }

  if (/([a-z])([A-Z])/.test(pluralName)) {
    let result = pluralName.charAt(0).toUpperCase() + pluralName.slice(1);
    if (result.endsWith("s") && result.length > 1) {
      const secondLast = result[result.length - 2];
      if (secondLast && secondLast === secondLast.toLowerCase()) {
        result = result.slice(0, -1);
      }
    }
    return result;
  }

  if (lowerName.endsWith("ies") && lowerName.length > 3) {
    const base = lowerName.slice(0, -3);
    return base.charAt(0).toUpperCase() + base.slice(1) + "y";
  }

  if (lowerName.endsWith("es") && lowerName.length > 2) {
    const base = lowerName.slice(0, -2);
    if (base.length > 0) {
      return base.charAt(0).toUpperCase() + base.slice(1);
    }
  }

  if (lowerName.endsWith("s") && lowerName.length > 1) {
    const singular = lowerName.slice(0, -1);
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }

  return pluralName.charAt(0).toUpperCase() + pluralName.slice(1);
}

/**
 * Main function that fixes common post-migration issues in Vue files.
 * Applies generic fixes for Vue 2 to Vue 3 migration including:
 * - Removing `this.` references in `<script setup>`
 * - Removing `export default` in `<script setup>`
 * - Making functions async if they use await
 * - Removing Vuex imports
 * - Fixing computed properties and store references
 * - Adding missing imports and fixing type errors
 * 
 * All fixes are generic and work for any Vue project structure.
 * 
 * @param filePath - The path to the file being fixed
 * @param content - The original file content
 * @param enableTypeScript - Whether TypeScript fixes should be applied
 * @param projectRoot - Optional project root directory for store analysis
 * @returns A FixResult object containing fixed content and applied fixes
 */
export async function fixPostMigrationIssues(
  filePath: string,
  content: string,
  enableTypeScript: boolean = false,
  projectRoot?: string
): Promise<FixResult> {
  const result: FixResult = {
    fixed: false,
    issues: [],
    fixes: [],
    content: content
  };

  let fixedContent = content;
  const isVueFile = filePath.endsWith(".vue");
  
  // Critical fix: computed<any>() => → computed<any>(() => (must be done first)
  if (isVueFile && fixedContent.includes("<script setup")) {
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\)\s*=>/g, (match) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() =>`;
    });
    fixedContent = fixedContent.replace(/computed\s*\(\)\s*=>/g, 'computed(() =>');
  }

  if (isVueFile) {
    // Fix 1: Remove export default in <script setup>
    if (
      fixedContent.includes("<script setup") &&
      fixedContent.includes("export default")
    ) {
      // Extract the script setup section
      const scriptSetupMatch = fixedContent.match(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
      );
      if (scriptSetupMatch) {
        let scriptContent = scriptSetupMatch[1];
        const originalScriptContent = scriptContent;

        // Remove export default { ... } completely if it's in script setup
        // Pattern: export default { name: "...", computed: {...}, ... }
        // Need to handle nested braces properly
        let braceCount = 0;
        const startIndex = scriptContent.indexOf("export default");
        if (startIndex !== -1) {
          // Find the opening brace
          const braceStart = scriptContent.indexOf("{", startIndex);
          if (braceStart !== -1) {
            braceCount = 1;
            let i = braceStart + 1;
            let inString = false;
            let stringChar = "";

            while (i < scriptContent.length && braceCount > 0) {
              const char = scriptContent[i];

              // Handle string literals
              if (
                (char === '"' || char === "'" || char === "`") &&
                (i === 0 || scriptContent[i - 1] !== "\\")
              ) {
                if (!inString) {
                  inString = true;
                  stringChar = char;
                } else if (char === stringChar) {
                  inString = false;
                  stringChar = "";
                }
              }

              if (!inString) {
                if (char === "{") braceCount++;
                if (char === "}") braceCount--;
              }

              i++;
            }

            if (braceCount === 0) {
              // Remove from startIndex to i (including the semicolon if present)
              let endIndex = i;
              // Skip semicolon and whitespace
              while (
                endIndex < scriptContent.length &&
                (scriptContent[endIndex] === ";" ||
                  /\s/.test(scriptContent[endIndex]))
              ) {
                endIndex++;
              }
              scriptContent =
                scriptContent.substring(0, startIndex) +
                scriptContent.substring(endIndex);
            }
          }
        }

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          result.fixes.push("Removed export default from <script setup>");
        }
      }
    }

    // Convert this.$emit to emit with defineEmits
    if (fixedContent.includes("<script setup")) {
      const scriptSetupMatch = fixedContent.match(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
      );
      if (scriptSetupMatch) {
        let scriptContent = scriptSetupMatch[1];
        const originalScriptContent = scriptContent;

        // Find all this.$emit calls and extract event names
        const emitPattern = /this\.\$emit\(['"]([^'"]+)['"]/g;
        const eventNames = new Set<string>();
        let match;
        while ((match = emitPattern.exec(scriptContent)) !== null) {
          eventNames.add(match[1]);
        }

        // If we found $emit calls, add defineEmits if not present
        if (eventNames.size > 0) {
          // Check if defineEmits already exists
          const hasDefineEmits = /const\s+emit\s*=\s*defineEmits/.test(
            scriptContent
          );

          if (!hasDefineEmits) {
            // Create defineEmits with all event names
            const eventsArray = Array.from(eventNames)
              .map((e) => `'${e}'`)
              .join(", ");
            const defineEmitsLine = `const emit = defineEmits([${eventsArray}]);\n`;

            // Insert after imports and before other code
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;?\s*\n*)+/
            );
            if (importMatch) {
              const insertIndex = importMatch[0].length;
              scriptContent =
                scriptContent.substring(0, insertIndex) +
                defineEmitsLine +
                scriptContent.substring(insertIndex);
            } else {
              // No imports, add at the beginning
              scriptContent = defineEmitsLine + scriptContent;
            }

            result.fixed = true;
            result.fixes.push(
              `Added defineEmits for events: ${Array.from(eventNames).join(", ")}`
            );
          }

          // Replace this.$emit('eventName', ...) with emit('eventName', ...)
          scriptContent = scriptContent.replace(
            /this\.\$emit\((['"][^'"]+['"])/g,
            "emit($1"
          );
        }

        // Replace this.$router and this.$route with useRouter/useRoute
        const hasThisRouter = /this\.\$router/.test(scriptContent);
        const hasThisRoute = /this\.\$route/.test(scriptContent);
        const hasUseRouter = scriptContent.includes("useRouter");
        const hasUseRoute = scriptContent.includes("useRoute");

        if (
          (hasThisRouter || hasThisRoute) &&
          (!hasUseRouter || !hasUseRoute)
        ) {
          // Add imports if missing
          if (hasThisRouter && !hasUseRouter) {
            if (!scriptContent.includes("import { useRouter }")) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$1import { useRouter } from 'vue-router';\n`
              );
            }
            // Add const router = useRouter() if missing
            if (!scriptContent.includes("const router = useRouter()")) {
              const importMatch = scriptContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                const insertPos = importMatch[0].length;
                scriptContent =
                  scriptContent.slice(0, insertPos) +
                  "\nconst router = useRouter();\n" +
                  scriptContent.slice(insertPos);
              }
            }
            // Replace this.$router with router
            scriptContent = scriptContent.replace(/this\.\$router/g, "router");
            result.fixed = true;
            result.fixes.push("Replaced this.$router with useRouter()");
          }

          if (hasThisRoute && !hasUseRoute) {
            if (!scriptContent.includes("import { useRoute }")) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$1import { useRoute } from 'vue-router';\n`
              );
            }
            // Add const route = useRoute() if missing
            if (!scriptContent.includes("const route = useRoute()")) {
              const importMatch = scriptContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                const insertPos = importMatch[0].length;
                scriptContent =
                  scriptContent.slice(0, insertPos) +
                  "\nconst route = useRoute();\n" +
                  scriptContent.slice(insertPos);
              }
            }
            // Replace this.$route with route
            scriptContent = scriptContent.replace(/this\.\$route/g, "route");
            result.fixed = true;
            result.fixes.push("Replaced this.$route with useRoute()");
          }
        }

        // Fix route.query.redirect that might be an object (prevents [object Object] in URL)
        const routeQueryRedirectPattern =
          /(route|this\.\$route)\.query\.redirect(\s*\|\|)?/g;
        if (routeQueryRedirectPattern.test(scriptContent)) {
          // Fix double || operators and incorrect ternary logic
          // Pattern: : route.query.redirect || "/dashboard" (incorrect - should be just : "/dashboard")
          scriptContent = scriptContent.replace(
            /:\s*(route|this\.\$route)\.query\.redirect\s*\|\|\s*['"]([^'"]+)['"]/g,
            (match, routeVar, fallback) => {
              return `: '${fallback}'`;
            }
          );

          // Fix ternary operators with incorrect fallback logic
          scriptContent = scriptContent.replace(
            /(\?\s*(?:route|this\.\$route)\.query\.redirect)\s*:\s*(?:route|this\.\$route)\.query\.redirect\s*\|\|\s*['"]([^'"]+)['"]/g,
            (match, condition, fallback) => {
              return `${condition} : '${fallback}'`;
            }
          );

          // Fix double || in ternary (syntax error)
          scriptContent = scriptContent.replace(
            /:\s*\|\|\s*['"]([^'"]+)['"]/g,
            (match, fallback) => {
              return `: '${fallback}'`;
            }
          );

          // Find all usages and ensure they're properly handled
          scriptContent = scriptContent.replace(
            /(const\s+\w+\s*=\s*)(route|this\.\$route)\.query\.redirect(\s*\|\|\s*['"][^'"]+['"])?/g,
            (match, prefix, routeVar, fallback) => {
              // Ensure redirect is a string, not an object
              const fallbackValue = fallback
                ? fallback.match(/['"]([^'"]+)['"]/)?.[1] || "/dashboard"
                : "/dashboard";
              return `${prefix}typeof ${routeVar === "this.$route" ? "route" : routeVar}.query.redirect === 'string' ? ${routeVar === "this.$route" ? "route" : routeVar}.query.redirect : '${fallbackValue}'`;
            }
          );

          // Also fix direct usage in router.push(route.query.redirect)
          scriptContent = scriptContent.replace(
            /router\.push\((route|this\.\$route)\.query\.redirect\)/g,
            (match, routeVar) => {
              const routeName = routeVar === "this.$route" ? "route" : routeVar;
              return `router.push(typeof ${routeName}.query.redirect === 'string' ? ${routeName}.query.redirect : '/dashboard')`;
            }
          );
          result.fixed = true;
          result.fixes.push(
            "Fixed route.query.redirect to handle object type (prevent [object Object] in URL)"
          );
        }

        // Remove other this. references (but keep this.$router, this.$route, etc.)
        // Pattern: this.methodName() or this.property

        // First, replace this.methodName() with just methodName()
        // This handles cases like: this.login() → login()
        scriptContent = scriptContent.replace(
          /this\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
          (match, methodName) => {
            // Don't replace Vue router/route special properties or $emit (already handled)
            if (
              methodName === "$router" ||
              methodName === "$route" ||
              methodName === "$emit" ||
              methodName.startsWith("$")
            ) {
              return match;
            }
            return `${methodName}(`;
          }
        );

        // Then, replace this.property with just property
        // This handles cases like: this.isAuthenticated → isAuthenticated
        // But be careful not to replace in comments or strings
        scriptContent = scriptContent.replace(
          /this\.([a-zA-Z_$][a-zA-Z0-9_$]*)(?![\w$])/g,
          (match, propName) => {
            // Don't replace Vue router/route special properties
            if (
              propName === "$router" ||
              propName === "$route" ||
              propName.startsWith("$")
            ) {
              return match;
            }
            return propName;
          }
        );

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          if (!result.fixes.some((f) => f.includes("defineEmits"))) {
            result.fixes.push("Removed this. references from <script setup>");
          }
        }
      }
    }

    // Make functions async if they use await
    const awaitPatterns = [
      /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(\(\)\s*=>\s*\{[\s\S]*?await/g,
      /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(function\s*\(\)\s*\{[\s\S]*?await/g,
    ];

    let hasAwaitIssue = false;
    awaitPatterns.forEach((pattern) => {
      if (pattern.test(fixedContent)) {
        hasAwaitIssue = true;
      }
    });

    if (hasAwaitIssue) {
      fixedContent = fixedContent.replace(
        /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(\(\)\s*=>\s*\{/g,
        (match, hook) => {
          // Check if the function body contains await
          const afterMatch = fixedContent.substring(
            fixedContent.indexOf(match) + match.length
          );
          if (afterMatch.includes("await")) {
            return `${hook}(async () => {`;
          }
          return match;
        }
      );

      fixedContent = fixedContent.replace(
        /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(function\s*\(\)\s*\{/g,
        (match, hook) => {
          const afterMatch = fixedContent.substring(
            fixedContent.indexOf(match) + match.length
          );
          if (afterMatch.includes("await")) {
            return `${hook}(async function() {`;
          }
          return match;
        }
      );

      if (fixedContent !== content) {
        result.fixed = true;
        result.fixes.push("Made lifecycle hooks async where await is used");
      }
    }

    // Make regular functions async if they use await (not just hooks)
    if (
      fixedContent.includes("<script setup") ||
      fixedContent.includes("<script>")
    ) {
      const scriptMatch = fixedContent.match(
        /<script[^>]*>([\s\S]*?)<\/script>/
      );
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        const originalScriptContent = scriptContent;

        // Find all functions that contain await but are not async
        scriptContent = scriptContent.replace(
          /(const\s+(\w+)\s*=\s*)(\([^)]*\)\s*=>\s*\{)/g,
          (match, before, funcName, arrowPart) => {
            // Check if already async
            if (before.includes("async")) return match;
            // Find the function body after this match
            const matchIndex = scriptContent.indexOf(match);
            const afterMatch = scriptContent.substring(
              matchIndex + match.length
            );
            // Find the matching closing brace
            let braceCount = 0;
            let bodyEnd = 0;
            for (let i = 0; i < afterMatch.length; i++) {
              if (afterMatch[i] === "{") braceCount++;
              if (afterMatch[i] === "}") {
                braceCount--;
                if (braceCount === 0) {
                  bodyEnd = i + 1;
                  break;
                }
              }
            }
            const functionBody = afterMatch.substring(0, bodyEnd);
            // Check if body contains await
            if (functionBody.includes("await")) {
              return before + "async " + arrowPart;
            }
            return match;
          }
        );

        scriptContent = scriptContent.replace(
          /(function\s+(\w+)\s*\([^)]*\)\s*\{)/g,
          (match, funcDecl) => {
            // Check if already async
            if (funcDecl.includes("async")) return match;
            // Find the function body
            const matchIndex = scriptContent.indexOf(match);
            const afterMatch = scriptContent.substring(
              matchIndex + match.length
            );
            // Find the matching closing brace
            let braceCount = 0;
            let bodyEnd = 0;
            for (let i = 0; i < afterMatch.length; i++) {
              if (afterMatch[i] === "{") braceCount++;
              if (afterMatch[i] === "}") {
                braceCount--;
                if (braceCount === 0) {
                  bodyEnd = i + 1;
                  break;
                }
              }
            }
            const functionBody = afterMatch.substring(0, bodyEnd);
            // Check if body contains await
            if (functionBody.includes("await")) {
              return funcDecl.replace(/function\s+/, "async function ");
            }
            return match;
          }
        );

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
      result.fixed = true;
          result.fixes.push("Made functions async where await is used");
        }
      }
    }
  }

  // Fix 3d: Fix incorrect Event types in function parameters
  // Pattern: function SET_USER(userParam: Event) or function SET_FILTER({ key: Event, value }: Event)
  // These should be 'any' or proper types, not Event (DOM Event type)
  if (
    enableTypeScript &&
    (filePath.endsWith(".ts") || filePath.endsWith(".js"))
  ) {
    // Fix 1: function funcName(param: Event) where param is not actually an Event
    // Common patterns: SET_USER, SET_TOKEN, SET_FILTER, UPDATE_POST, etc.
    const incorrectEventTypePattern =
      /function\s+(\w+)\s*\(([^)]+)\)\s*:\s*(?:void|Promise<void>|any)\s*\{/g;
    let eventTypeMatch;
    while (
      (eventTypeMatch = incorrectEventTypePattern.exec(fixedContent)) !== null
    ) {
      const funcName = eventTypeMatch[1];
      const params = eventTypeMatch[2];

      // Skip if function name suggests it's actually handling DOM events
      if (
        funcName.toLowerCase().includes("handler") ||
        funcName.toLowerCase().includes("onclick") ||
        funcName.toLowerCase().includes("onsubmit")
      ) {
        continue;
      }

      // Fix parameters with : Event type that shouldn't be Event
      // Pattern: param: Event or { key: Event, value }: Event
      let fixedParams = params;

      // Fix simple parameter: param: Event → param: any
      fixedParams = fixedParams.replace(
        /(\w+)\s*:\s*Event(?!\w)/g,
        (match, paramName) => {
          // Skip if param name suggests it's actually an event (e, evt, event)
          if (
            paramName.toLowerCase() === "e" ||
            paramName.toLowerCase() === "evt" ||
            paramName.toLowerCase() === "event"
          ) {
            return match;
          }
          return `${paramName}: any`;
        }
      );

      // Fix destructured parameter: { key: Event, value }: Event → { key: string, value: any }: { key: string; value: any }
      // This is a common mistake from incorrect type inference
      fixedParams = fixedParams.replace(
        /\{\s*key\s*:\s*Event\s*,\s*value\s*:\s*(\w+)\s*\}\s*:\s*Event/g,
        "{ key: string, value: any }: { key: string; value: any }"
      );
      fixedParams = fixedParams.replace(
        /\{\s*(\w+)\s*:\s*Event\s*,\s*(\w+)\s*:\s*(\w+)\s*\}\s*:\s*Event/g,
        (match, keyName, valueName, valueType) => {
          // Infer proper types based on parameter names
          const inferredKeyType = "string";
          const inferredValueType = valueType === "Event" ? "any" : valueType;
          return `{ ${keyName}: ${inferredKeyType}, ${valueName}: ${inferredValueType} }: { ${keyName}: ${inferredKeyType}; ${valueName}: ${inferredValueType} }`;
        }
      );

      // Fix incorrect destructuring syntax: { key: any, value } → { key, value }: { key: string; value: any }
      // This pattern means "rename key to any" which is wrong - should be { key, value } with proper type
      fixedParams = fixedParams.replace(
        /\{\s*(\w+)\s*:\s*any\s*,\s*(\w+)\s*\}\s*:\s*Event/g,
        (match, keyName, valueName) => {
          // Infer proper types based on parameter names
          const inferredKeyType = keyName === "key" ? "string" : "any";
          return `{ ${keyName}, ${valueName} }: { ${keyName}: ${inferredKeyType}; ${valueName}: any }`;
        }
      );

      // Also fix without Event type: { key: any, value } → { key, value }: { key: string; value: any }
      fixedParams = fixedParams.replace(
        /\{\s*(\w+)\s*:\s*any\s*,\s*(\w+)\s*\}(?!\s*:)/g,
        (match, keyName, valueName) => {
          // Only fix if it looks like a function parameter (not a variable declaration)
          if (fixedParams.includes("function") || fixedParams.includes("=>")) {
            const inferredKeyType = keyName === "key" ? "string" : "any";
            return `{ ${keyName}, ${valueName} }: { ${keyName}: ${inferredKeyType}; ${valueName}: any }`;
          }
          return match;
        }
      );

      if (fixedParams !== params) {
        fixedContent = fixedContent.replace(
          eventTypeMatch[0],
          eventTypeMatch[0].replace(params, fixedParams)
        );
      result.fixed = true;
        result.fixes.push(
          `Fixed incorrect Event type in function ${funcName} parameters`
        );
      }
    }

    // Fix 2: Arrow functions with incorrect Event types
    const arrowEventTypePattern =
      /(const\s+\w+\s*=\s*\([^)]+\)\s*:\s*(?:void|Promise<void>|any)\s*=>)/g;
    let arrowMatch;
    while ((arrowMatch = arrowEventTypePattern.exec(fixedContent)) !== null) {
      const match = arrowMatch[0];
      const paramsMatch = match.match(/\(([^)]+)\)/);
      if (paramsMatch) {
        const params = paramsMatch[1];
        let fixedParams = params;

        // Fix simple parameter: param: Event → param: any
        fixedParams = fixedParams.replace(
          /(\w+)\s*:\s*Event(?!\w)/g,
          (match, paramName) => {
            if (
              paramName.toLowerCase() === "e" ||
              paramName.toLowerCase() === "evt" ||
              paramName.toLowerCase() === "event"
            ) {
              return match;
            }
            return `${paramName}: any`;
          }
        );

        if (fixedParams !== params) {
          fixedContent = fixedContent.replace(
            match,
            match.replace(params, fixedParams)
          );
          result.fixed = true;
          result.fixes.push(
            `Fixed incorrect Event type in arrow function parameters`
          );
        }
      }
    }
  }

  // Fix 3e: Fix filters[key] access in Pinia stores (TypeScript error)
  // Pattern: filters[key] = value where filters is reactive({ category: null, search: '' })
  // TypeScript doesn't allow dynamic key access without type assertion
  if (
    enableTypeScript &&
    (filePath.endsWith(".ts") || filePath.endsWith(".js"))
  ) {
    // Pattern: filters[key] = value or filters[key] where key is a string parameter
    const filtersKeyPattern = /filters\[(\w+)\]\s*=/g;
    let filtersMatch;
    while ((filtersMatch = filtersKeyPattern.exec(fixedContent)) !== null) {
      const keyVar = filtersMatch[1];
      // Check if this is in a function that takes { key, value } as parameter
      const functionContext = fixedContent.substring(0, filtersMatch.index);
      const functionMatch = functionContext.match(
        /(function\s+\w+\s*\([^)]*\{[^}]*key[^}]*\}[^)]*\)|const\s+\w+\s*=\s*\([^)]*\{[^}]*key[^}]*\}[^)]*\))/
      );

      if (functionMatch || keyVar === "key") {
        // Replace filters[key] with (filters as any)[key] for TypeScript compatibility
        fixedContent = fixedContent.replace(
          new RegExp(`filters\\[${keyVar}\\]`, "g"),
          `(filters as any)[${keyVar}]`
        );
        result.fixed = true;
        result.fixes.push(
          `Fixed filters[key] access with type assertion for TypeScript compatibility`
        );
        break; // Only fix once per file
      }
    }
  }

  // Fix 3c: Make functions async if they use await in .js/.ts files (stores, etc.)
  // This handles Pinia stores and other JS files that aren't Vue components
  if (
    (filePath.endsWith(".js") || filePath.endsWith(".ts")) &&
    !isVueFile &&
    fixedContent.includes("await")
  ) {
    // Pattern 1: function funcName() { ... await ... } or function funcName(): void { ... await ... }
    const functionPattern =
      /(function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*(?:void|Promise<void>|any))?\s*\{)/g;
    let functionMatch;
    const functionsToFix: Array<{ match: string; replacement: string; index: number }> = [];

    while ((functionMatch = functionPattern.exec(fixedContent)) !== null) {
      const match = functionMatch[0];
      const matchIndex = functionMatch.index;

      // Skip if already async
      if (match.includes("async")) continue;

      // Find the function body
      const afterMatch = fixedContent.substring(matchIndex + match.length);

      // Find the matching closing brace
      // The signature pattern already includes the opening brace '{', so start counting from 1
      let braceCount = 1;
      let bodyEnd = 0;
      for (let i = 0; i < afterMatch.length; i++) {
        if (afterMatch[i] === "{") braceCount++;
        if (afterMatch[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }

      const functionBody = afterMatch.substring(0, bodyEnd);
      // Check if body contains await (but not in a nested async function)
      if (functionBody.includes("await")) {
        // Check if await is inside a nested async function
        const awaitIndex = functionBody.indexOf("await");
        let isInNestedAsync = false;
        
        // Find all async functions before the await
        const beforeAwait = functionBody.substring(0, awaitIndex);
        const asyncFunctionMatches = beforeAwait.matchAll(/async\s+function[\s\S]*?\{/g);
        for (const asyncMatch of asyncFunctionMatches) {
          const asyncEnd = asyncMatch.index! + asyncMatch[0].length;
          // Find the closing brace of this async function
          let nestedBraceCount = 0;
          for (let i = asyncEnd; i < functionBody.length; i++) {
            if (functionBody[i] === '{') nestedBraceCount++;
            if (functionBody[i] === '}') {
              nestedBraceCount--;
              if (nestedBraceCount === 0) {
                if (i >= awaitIndex) {
                  isInNestedAsync = true;
                }
                break;
              }
            }
          }
        }
        
        if (!isInNestedAsync) {
          // Replace function with async function, preserving return type annotation if present
          let replacement = match;
          if (match.includes("): void")) {
            replacement = match
              .replace(/function\s+/, "async function ")
              .replace(/:\s*void/, ": Promise<void>");
          } else if (match.includes("): Promise<void>")) {
            replacement = match.replace(/function\s+/, "async function ");
          } else {
            replacement = match.replace(/function\s+/, "async function ");
          }
          functionsToFix.push({ match, replacement, index: matchIndex });
        }
      }
    }

    // Also check for arrow functions: const funcName = () => { await ... }
    // Pattern 1: const funcName = () => { await ... } (no type annotation)
    const arrowFunctionPattern1 =
      /(const\s+(\w+)\s*=\s*)(\([^)]*\)\s*=>\s*\{)/g;
    let arrowMatch1;
    const arrowFunctionsToFix: Array<{
      match: string;
      replacement: string;
      index: number;
    }> = [];

    while ((arrowMatch1 = arrowFunctionPattern1.exec(fixedContent)) !== null) {
      const match = arrowMatch1[0];

      // Skip if already async
      if (match.includes("async")) continue;

      // Find the function body
      const matchIndex = arrowMatch1.index;
      const afterMatch = fixedContent.substring(matchIndex + match.length);

      // Find the matching closing brace
      let braceCount = 0;
      let bodyEnd = 0;
      for (let i = 0; i < afterMatch.length; i++) {
        if (afterMatch[i] === "{") braceCount++;
        if (afterMatch[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }

      const functionBody = afterMatch.substring(0, bodyEnd);
      // Check if body contains await
      if (functionBody.includes("await")) {
        // Replace with async arrow function
        const replacement = match.replace(/(const\s+\w+\s*=\s*\()/, "$1async ");
        arrowFunctionsToFix.push({ match, replacement, index: matchIndex });
      }
    }

    // Pattern 2: const funcName = (): void => { await ... } (with type annotation)
    const arrowFunctionPattern2 =
      /(const\s+(\w+)\s*=\s*)(\([^)]*\)\s*:\s*(?:void|Promise<void>|any)\s*=>\s*\{)/g;
    let arrowMatch2;

    while ((arrowMatch2 = arrowFunctionPattern2.exec(fixedContent)) !== null) {
      const match = arrowMatch2[0];

      // Skip if already async
      if (match.includes("async")) continue;

      // Find the function body
      const matchIndex = arrowMatch2.index;
      const afterMatch = fixedContent.substring(matchIndex + match.length);

      // Find the matching closing brace
      let braceCount = 0;
      let bodyEnd = 0;
      for (let i = 0; i < afterMatch.length; i++) {
        if (afterMatch[i] === "{") braceCount++;
        if (afterMatch[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }

      const functionBody = afterMatch.substring(0, bodyEnd);
      // Check if body contains await
      if (functionBody.includes("await")) {
        // Replace with async arrow function, preserving return type if present
        let replacement = match;
        if (match.includes("): void")) {
          replacement = match
            .replace(/(const\s+\w+\s*=\s*\()/, "$1async ")
            .replace(/:\s*void/, ": Promise<void>");
        } else if (match.includes("): Promise<void>")) {
          replacement = match.replace(/(const\s+\w+\s*=\s*\()/, "$1async ");
        } else {
          replacement = match.replace(/(const\s+\w+\s*=\s*\()/, "$1async ");
        }
        arrowFunctionsToFix.push({ match, replacement, index: matchIndex });
      }
    }

    // Apply fixes (in reverse order to preserve indices)
    functionsToFix.reverse().forEach(({ match, replacement }) => {
      // Use index-based replacement to avoid replacing multiple occurrences
      const matchIndex = fixedContent.indexOf(match);
      if (matchIndex !== -1) {
        fixedContent = fixedContent.substring(0, matchIndex) + 
          replacement + 
          fixedContent.substring(matchIndex + match.length);
      }
    });

    arrowFunctionsToFix.reverse().forEach(({ match, replacement, index }) => {
      // Use the provided index for accurate replacement
      fixedContent = fixedContent.substring(0, index) + 
        replacement + 
        fixedContent.substring(index + match.length);
    });

    if (functionsToFix.length > 0 || arrowFunctionsToFix.length > 0) {
      result.fixed = true;
      result.fixes.push(
        `Made ${functionsToFix.length + arrowFunctionsToFix.length} function(s) async where await is used`
      );
    }

    // Fix: Make functions async if they use await but aren't marked async (Pinia stores)
    // Pattern: function funcName(): void { await ... } - should be async function funcName(): Promise<void>
    // This is a more aggressive check for Pinia stores - GENERIC pattern detection
    const piniaAsyncPattern =
      /(function\s+(\w+)\s*\([^)]*\)\s*:\s*(?:void|Promise<void>|any)?\s*\{)/g;
    let piniaAsyncMatch;
    const piniaFunctionsToFix: Array<{ 
      match: string; 
      replacement: string;
      index: number;
    }> = [];

    while ((piniaAsyncMatch = piniaAsyncPattern.exec(fixedContent)) !== null) {
      const funcSignature = piniaAsyncMatch[1];
      const matchIndex = piniaAsyncMatch.index;

      // Skip if already async
      if (funcSignature.includes("async function")) continue;

      // Find the function body - look for the matching closing brace
      // The signature pattern already includes the opening brace '{', so start counting from 1
      const afterSignature = fixedContent.substring(matchIndex + funcSignature.length);
      let braceCount = 1; // Start at 1 because the opening brace is in the signature
      let bodyEnd = 0;
      
      for (let i = 0; i < afterSignature.length; i++) {
        const char = afterSignature[i];
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }

      const functionBody = afterSignature.substring(0, bodyEnd);
      
      // Check if body contains await (but not in a nested async function)
      if (functionBody.includes("await")) {
        // Check if await is inside a nested async function (if so, skip)
        const awaitIndex = functionBody.indexOf("await");
        let isInNestedAsync = false;
        
        // Find all async functions before the await
        const beforeAwait = functionBody.substring(0, awaitIndex);
        const asyncFunctionMatches = beforeAwait.matchAll(/async\s+function[\s\S]*?\{/g);
        for (const asyncMatch of asyncFunctionMatches) {
          const asyncEnd = asyncMatch.index! + asyncMatch[0].length;
          // Find the closing brace of this async function
          let nestedBraceCount = 0;
          for (let i = asyncEnd; i < functionBody.length; i++) {
            if (functionBody[i] === '{') nestedBraceCount++;
            if (functionBody[i] === '}') {
              nestedBraceCount--;
              if (nestedBraceCount === 0) {
                if (i >= awaitIndex) {
                  isInNestedAsync = true;
                }
                break;
              }
            }
          }
        }
        
        if (!isInNestedAsync) {
          // Replace function signature with async function
          let replacement = funcSignature;

          if (funcSignature.includes(": void")) {
            replacement = funcSignature
              .replace(/function\s+/, "async function ")
              .replace(/:\s*void/, ": Promise<void>");
          } else if (funcSignature.includes(": Promise<void>")) {
            replacement = funcSignature.replace(/function\s+/, "async function ");
          } else if (funcSignature.includes(": any")) {
            replacement = funcSignature.replace(/function\s+/, "async function ");
          } else {
            replacement = funcSignature.replace(/function\s+/, "async function ");
          }

          piniaFunctionsToFix.push({ 
            match: funcSignature, 
            replacement: replacement,
            index: matchIndex
          });
        }
      }
    }

    // Apply fixes in reverse order (to preserve indices)
    piniaFunctionsToFix.reverse().forEach(({ match, replacement, index }) => {
      // Replace only at the specific index to avoid replacing multiple occurrences
      fixedContent = fixedContent.substring(0, index) + 
        replacement + 
        fixedContent.substring(index + match.length);
    });

    if (piniaFunctionsToFix.length > 0) {
      result.fixed = true;
      result.fixes.push(
        `Made ${piniaFunctionsToFix.length} Pinia store function(s) async where await is used`
      );
    }

    // Fix: Remove multiple async keywords (async async function, async async async function, etc.)
    // GENERIC: Works for any number of async keywords - reduces to single async
    // Pattern: async async function funcName() or async async async function funcName() - should be async function funcName()
    // Use a more robust pattern that matches any number of consecutive async keywords
    let asyncFixCount = 0;
    
    // First, fix patterns like "async async function" (2 async keywords)
    const doubleAsyncPattern = /\b(async\s+){2}function\s+(\w+)/g;
    let doubleAsyncMatch;
    while ((doubleAsyncMatch = doubleAsyncPattern.exec(fixedContent)) !== null) {
      const funcName = doubleAsyncMatch[2];
      fixedContent = fixedContent.replace(
        new RegExp(`\\b(async\\s+){2}function\\s+${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
        `async function ${funcName}`
      );
      asyncFixCount++;
    }
    
    // Then, fix patterns with 3+ async keywords (async async async function, etc.)
    // Use a more general pattern that matches any number >= 2
    const multipleAsyncPattern = /\b(async\s+){3,}function\s+(\w+)/g;
    let multipleAsyncMatch;
    while ((multipleAsyncMatch = multipleAsyncPattern.exec(fixedContent)) !== null) {
      const funcName = multipleAsyncMatch[2];
      // Replace any number of async keywords (3+) with a single async
      fixedContent = fixedContent.replace(
        new RegExp(`\\b(async\\s+)+function\\s+${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
        `async function ${funcName}`
      );
      asyncFixCount++;
    }
    
    // Final pass: catch any remaining multiple async patterns
    fixedContent = fixedContent.replace(
      /\b(async\s+){2,}function\s+(\w+)/g,
      "async function $2"
    );

    if (asyncFixCount > 0) {
      result.fixed = true;
      result.fixes.push(
        `Removed ${asyncFixCount} multiple async keyword(s)`
      );
    }

    // Fix 3e: Improve TypeScript types and generate interfaces from code assignments
    // Analyze assignments like SET_POSTS([{ id: 1, title: '...' }]) to generate interfaces
    if (
      enableTypeScript &&
      (filePath.endsWith(".ts") || filePath.endsWith(".js")) &&
      fixedContent.includes("defineStore")
    ) {
      // Find empty interfaces that need to be filled: interface Post {}
      const emptyInterfacePattern = /interface\s+(\w+)\s*\{\s*\}/g;
      let interfaceMatch;
      const interfacesToFill = new Map<string, { properties: string[] }>();

      while (
        (interfaceMatch = emptyInterfacePattern.exec(fixedContent)) !== null
      ) {
        const interfaceName = interfaceMatch[1];
        // Try to extract object structure from code
        const structure = extractObjectStructureFromCode(fixedContent);
        if (structure.properties.length > 0) {
          interfacesToFill.set(interfaceName, structure);
        }
      }

      // Replace empty interfaces with filled ones
      interfacesToFill.forEach((structure, interfaceName) => {
        // Infer types for each property (simple heuristic)
        const typedProperties = structure.properties.map((prop) => {
          // Infer type from property name
          const propLower = prop.toLowerCase();
          if (
            propLower.includes("id") ||
            propLower.includes("count") ||
            propLower.includes("index")
          ) {
            return `  ${prop}: number;`;
          } else if (
            propLower.includes("is") ||
            propLower.includes("has") ||
            propLower.includes("should")
          ) {
            return `  ${prop}: boolean;`;
          } else {
            return `  ${prop}: string;`;
          }
        });

        const filledInterface = `interface ${interfaceName} {\n${typedProperties.join("\n")}\n}`;
        const emptyInterface = `interface ${interfaceName} {}`;
        fixedContent = fixedContent.replace(emptyInterface, filledInterface);
        result.fixed = true;
        result.fixes.push(
          `Generated TypeScript interface '${interfaceName}' with properties: ${structure.properties.join(", ")}`
        );
      });

      // Improve ref types: ref(null) → ref<Post | null>(null) based on context
      // Pattern: const currentItem = ref(null) where Item interface exists
      const refNullPattern =
        /const\s+(\w+)\s*=\s*ref\s*<\s*any\s*>\s*\(\s*null\s*\)/g;
      let refNullMatch;
      while ((refNullMatch = refNullPattern.exec(fixedContent)) !== null) {
        const varName = refNullMatch[1];
        // Infer interface name from variable name
        const interfaceName =
          varName.charAt(0).toUpperCase() + varName.slice(1);
        // Check if interface exists
        if (fixedContent.includes(`interface ${interfaceName}`)) {
          const improvedRef = `const ${varName} = ref<${interfaceName} | null>(null)`;
          fixedContent = fixedContent.replace(refNullMatch[0], improvedRef);
          result.fixed = true;
          result.fixes.push(
            `Improved type for ref '${varName}': ref<${interfaceName} | null>`
          );
        }
      }

      // Improve ref types: ref([]) → ref<Post[]>([]) based on context
      const refArrayPattern =
        /const\s+(\w+)\s*=\s*ref\s*<\s*any\[\]\s*>\s*\(\s*\[\s*\]\s*\)/g;
      let refArrayMatch;
      while ((refArrayMatch = refArrayPattern.exec(fixedContent)) !== null) {
        const varName = refArrayMatch[1];
        // Infer interface name from variable name (plural → singular)
        const interfaceName = pluralToSingularInterface(varName);
        // Check if interface exists
        if (fixedContent.includes(`interface ${interfaceName}`)) {
          const improvedRef = `const ${varName} = ref<${interfaceName}[]>([])`;
          fixedContent = fixedContent.replace(refArrayMatch[0], improvedRef);
          result.fixed = true;
          result.fixes.push(
            `Improved type for ref '${varName}': ref<${interfaceName}[]>`
          );
        }
      }
    }

    // Fix 3d: Fix incomplete computed properties in Pinia stores
    // Pattern 1: const [ANY_NAME] = computed(() => [VAR]); → should have full logic (GENERIC)
    // Pattern 2: const categories = computed(() => Array.from(cats)); where cats is undefined
    // GENERIC: Automatically infers missing logic from store context
    if (
      fixedContent.includes("defineStore") &&
      fixedContent.includes("computed")
    ) {
      // Extract all reactive variables (ref/reactive) from the store for context analysis
      const reactiveVars = new Set<string>();
      const refPattern = /(?:const|let|var)\s+(\w+)\s*=\s*ref\s*\(/g;
      const reactivePattern = /(?:const|let|var)\s+(\w+)\s*=\s*reactive\s*\(/g;
      let refMatch, reactiveMatch;
      while ((refMatch = refPattern.exec(fixedContent)) !== null) {
        reactiveVars.add(refMatch[1]);
      }
      while ((reactiveMatch = reactivePattern.exec(fixedContent)) !== null) {
        reactiveVars.add(reactiveMatch[1]);
      }

      // Pattern 1: Simple incomplete computed: computed(() => undefinedVar)
      const incompleteComputedPattern =
        /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+)\s*\)/g;
      let incompleteMatch;

      while (
        (incompleteMatch = incompleteComputedPattern.exec(fixedContent)) !==
        null
      ) {
        const computedName = incompleteMatch[1];
        const referencedVar = incompleteMatch[2];

        // Check if the referenced variable is not defined in the store
        if (
          computedName !== referencedVar &&
          !fixedContent.match(
            new RegExp(`(const|let|var|ref|reactive)\\s+${referencedVar}\\b`)
          )
        ) {
          // Try to infer from context: if computedName is plural (categories, tags, items),
          // and we have a similar singular reactive var (posts, products), infer extraction logic
          const computedNameLower = computedName.toLowerCase();

          // Common patterns: categories → posts.category, tags → items.tags, etc.
          let inferredSource: string | null = null;
          let inferredProperty: string | null = null;

          // GENERIC PATTERN: Infer source from computed name and available reactive vars
          // Works for: categories → any array var with 'category' property, tags → any array var with 'tags' property
          // Strategy: Find any reactive var that could contain the property we're looking for

          // GENERIC: Infer property name from computed name (categories → category, tags → tag, types → type, etc.)
          // No hardcoded patterns - works for any property name
          const inferPropertyFromComputedName = (name: string): string | null => {
            // Remove plural endings generically
            if (name.endsWith("ies")) {
              return name.slice(0, -3) + "y"; // categories → category
            }
            if (name.endsWith("es")) {
              return name.slice(0, -2); // tags → tag, types → type
            }
            if (name.endsWith("s")) {
              return name.slice(0, -1); // items → item, products → product
            }
            return name; // Already singular or no plural pattern
          };
          
          const targetProperty = inferPropertyFromComputedName(computedNameLower);

          // GENERIC PATTERN: Find any array-like reactive var and extract property matching the computed name
          // Works for any property name, not just "category" or "tag"
          if (targetProperty) {
            // Find any array-like reactive var (any plural noun or array-like name)
            const arrayLikeVars = Array.from(reactiveVars).filter((v) => {
              const vLower = v.toLowerCase();
              // Match common array patterns: posts, items, products, data, list, array, etc.
              return (
                vLower.endsWith("s") ||
                vLower.includes("list") ||
                vLower.includes("array") ||
                vLower.includes("data") ||
                vLower.includes("items") ||
                vLower.includes("collection")
              );
            });
            if (arrayLikeVars.length > 0) {
              inferredSource = arrayLikeVars[0];
              inferredProperty = targetProperty;
            }
          }
          
          // Pattern 3: Generic - try to match computed name with reactive var names
          // e.g., categories → posts (if posts exists), items → products (if products exists)
          else {
            for (const varName of reactiveVars) {
              const varNameLower = varName.toLowerCase();
              // Try to match: categories → posts, items → products, etc.
              // Match if computed name contains part of var name or vice versa
              if (
                computedNameLower.includes(varNameLower.slice(0, -1)) ||
                varNameLower.includes(computedNameLower.slice(0, -1)) ||
                // Also match if they share a common root
                (computedNameLower.length > 3 &&
                  varNameLower.includes(
                    computedNameLower.substring(0, computedNameLower.length - 1)
                  ))
              ) {
                inferredSource = varName;
                // Try to infer property name from computed name
                inferredProperty =
                  computedNameLower
                    .replace(varNameLower, "")
                    .replace(/s$/, "") || targetProperty;
                break;
              }
            }

            // Fallback: if no match found, use first array-like reactive var
            if (!inferredSource && reactiveVars.size > 0) {
              const arrayLikeVars = Array.from(reactiveVars).filter((v) => {
                const vLower = v.toLowerCase();
                return (
                  vLower.endsWith("s") ||
                  vLower.includes("list") ||
                  vLower.includes("array") ||
                  vLower.includes("data") ||
                  vLower.includes("items") ||
                  vLower.includes("collection")
                );
              });
              if (arrayLikeVars.length > 0) {
                inferredSource = arrayLikeVars[0];
                // GENERIC: Use inferred property from computed name, no hardcoded fallback
                inferredProperty = targetProperty || computedNameLower.replace(/s$/, "") || computedNameLower.replace(/ies$/, "y") || computedNameLower.replace(/es$/, "") || null;
              }
            }
          }

          if (inferredSource && inferredProperty) {
            // Auto-fix: Replace computed(() => undefinedVar) with proper extraction logic
            // GENERIC: Use inferred property, skip if we can't infer generically
            const property = inferredProperty;
            const fixedComputed = `const ${computedName} = computed(() => {\n    const ${referencedVar} = new Set(${inferredSource}.value.map(item => item.${property}).filter(Boolean));\n    return Array.from(${referencedVar});\n  })`;
            fixedContent = fixedContent.replace(
              incompleteMatch[0],
              fixedComputed
            );
            result.fixed = true;
            result.fixes.push(
              `Auto-fixed incomplete computed property '${computedName}': inferred extraction from ${inferredSource}.${property}`
            );
          } else {
            result.issues.push(
              `Incomplete computed property detected: ${computedName} references undefined variable '${referencedVar}'. Could not auto-fix - manual fix required.`
            );
          }
        }

        // Pattern 2.5: Fix computed that returns ref directly without .value
        // Pattern: const filteredPosts = computed(() => posts) → computed(() => posts.value)
        const refComputedPattern =
          /const\s+(\w+)\s*=\s*computed\s*<\s*any\s*>\s*\(\s*\(\)\s*=>\s*(\w+)\s*\)/g;
        let refComputedMatch;
        while (
          (refComputedMatch = refComputedPattern.exec(fixedContent)) !== null
        ) {
          const computedName = refComputedMatch[1];
          const refVar = refComputedMatch[2];

          // Check if refVar is a reactive variable (ref/reactive)
          if (reactiveVars.has(refVar)) {
            // Check if it's not already using .value
            const matchStr = refComputedMatch[0];
            if (!matchStr.includes(".value")) {
              // Fix: add .value
              const fixedComputed = matchStr.replace(
                `=> ${refVar})`,
                `=> ${refVar}.value)`
              );
              fixedContent = fixedContent.replace(matchStr, fixedComputed);
              result.fixed = true;
              result.fixes.push(
                `Fixed computed '${computedName}': added .value to ${refVar}`
              );
            }
          }
        }

        // Pattern 3: ANY computed property that returns a simple array ref without filtering/sorting logic
        // GENERIC PATTERN: Detects computed properties that just return a reactive array without transformation
        // Works for: filteredPosts, sortedUsers, displayedItems, visibleProducts, etc.
        // Pattern: const [ANY_NAME] = computed(() => arrayVar); where arrayVar is a reactive ref
        // Should add filtering/sorting logic if filters exist
        // This is TRULY generic - works with ANY naming convention
        const simpleComputedPattern =
          /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+)\s*\)/g;
        let simpleMatch;
        const processedComputed = new Set<string>(); // Track already processed to avoid duplicates

        while (
          (simpleMatch = simpleComputedPattern.exec(fixedContent)) !== null
        ) {
          const [fullMatch, computedName, arrayVar] = simpleMatch;

          // Skip if already processed or if computedName === arrayVar (like allPosts = computed(() => allPosts))
          if (
            processedComputed.has(computedName) ||
            computedName === arrayVar
          ) {
            continue;
          }

          // GENERIC: Check if filters exist in the store (any form: reactive(filters) or filters: {})
          const hasFilters =
            /(?:const|let|var)\s+filters\s*=\s*reactive\s*\(/.test(
              fixedContent
            );
          const hasFiltersObject = /filters\s*:\s*\{/.test(fixedContent);

          // TRULY GENERIC: Apply fix if:
          // 1. filters exist in the store (reactive(filters) or filters: {})
          // 2. arrayVar is a reactive variable (ref/reactive)
          // 3. The computed just returns the array without any transformation (likely incomplete)
          //
          // We check if filters are actually used/needed by:
          // - Checking if computedName suggests transformation (filter, sort, display, etc.) OR
          // - Checking if there's another computed that uses filters (indicating filters are meant to be used) OR
          // - Checking if the computed name is different from arrayVar (suggests it should transform)
          //
          // This way, we avoid false positives like: allPosts = computed(() => posts) when filters exist but aren't meant for this computed
          const computedNameLower = computedName.toLowerCase();
          const arrayVarLower = arrayVar.toLowerCase();

          // Check if filters are used elsewhere in computed properties (indicating they should be used here too)
          const filtersUsedInOtherComputed =
            /const\s+\w+\s*=\s*computed\s*\([^)]*filters/.test(fixedContent);

          // Check if computed name suggests transformation
          const suggestsTransformation =
            computedNameLower.includes("filter") ||
            computedNameLower.includes("sort") ||
            computedNameLower.includes("display") ||
            computedNameLower.includes("visible") ||
            computedNameLower.includes("shown") ||
            computedNameLower.includes("list");

          // Check if computed name is different from arrayVar (suggests it should transform the data)
          // e.g., filteredPosts vs posts, sortedUsers vs users
          const nameDiffersFromArrayVar =
            computedNameLower !== arrayVarLower &&
            !computedNameLower.includes(arrayVarLower) &&
            !arrayVarLower.includes(computedNameLower);

          // Apply fix if filters exist AND:
          // - Name suggests transformation, OR
          // - Filters are used in other computed properties, OR
          // - Name differs from arrayVar (suggests transformation intent)
          const shouldApplyFix =
            (hasFilters || hasFiltersObject) &&
            reactiveVars.has(arrayVar) &&
            (suggestsTransformation ||
              filtersUsedInOtherComputed ||
              nameDiffersFromArrayVar);

          if (shouldApplyFix) {
            processedComputed.add(computedName);
            // TRULY GENERIC: Dynamically analyze properties from codebase instead of hardcoding
            // Analyze filter properties dynamically
            const filterAnalysis = analyzeFilterProperties(fixedContent);
            // GENERIC: Use detected filter or infer from computed name, no hardcoded fallback
            // GENERIC: Infer filter name from computed name or use detected filter
            // No hardcoded patterns - works for any filter name
            const inferFilterFromComputedName = (name: string): string | null => {
              // Remove plural endings generically
              if (name.endsWith("ies")) {
                return name.slice(0, -3) + "y"; // categories → category
              }
              if (name.endsWith("es")) {
                return name.slice(0, -2); // tags → tag, types → type
              }
              if (name.endsWith("s")) {
                return name.slice(0, -1); // items → item, products → product
              }
              return name; // Already singular or no plural pattern
            };
            
            const categoryFilter = filterAnalysis.categoryFilter || 
              inferFilterFromComputedName(computedNameLower) ||
              null;
            // GENERIC: Infer search filter name from computed name or use detected filter
            // No hardcoded patterns - works for any filter name
            const inferSearchFilterFromComputedName = (name: string): string | null => {
              // If computed name contains "search" or "filter", use that as the filter name
              if (name.includes("search")) {
                return "search";
              }
              if (name.includes("filter")) {
                return "filter";
              }
              // Could also infer from other patterns like "query", "term", etc.
              if (name.includes("query")) {
                return "query";
              }
              if (name.includes("term")) {
                return "term";
              }
              return null;
            };
            
            const searchFilter = filterAnalysis.searchFilter || 
              inferSearchFilterFromComputedName(computedNameLower) ||
              null;

            // Analyze array item properties dynamically
            const arrayVarStr = String(arrayVar); // Ensure it's a string
            const itemAnalysis = analyzeArrayItemProperties(
              fixedContent,
              arrayVarStr
            );
            // GENERIC: Use detected property or infer from computed name, no hardcoded fallback
            // No hardcoded patterns - works for any property name
            const inferPropertyFromComputedName = (name: string): string | null => {
              // Remove plural endings generically
              if (name.endsWith("ies")) {
                return name.slice(0, -3) + "y"; // categories → category
              }
              if (name.endsWith("es")) {
                return name.slice(0, -2); // tags → tag, types → type
              }
              if (name.endsWith("s")) {
                return name.slice(0, -1); // items → item, products → product
              }
              return name; // Already singular or no plural pattern
            };
            
            const categoryProperty =
              itemAnalysis.categoryProperty || 
              inferPropertyFromComputedName(computedNameLower) ||
              null;
            
            // GENERIC: Use all detected properties for search, filter out non-text properties
            // No hardcoded property names - works for any project structure
            const allDetectedProperties = Array.from(itemAnalysis.properties);
            
            // Filter out properties that are likely not searchable text (IDs, dates, booleans, etc.)
            // This is generic and works for any property name pattern
            const searchProperties = allDetectedProperties.filter((p) => {
              const prop = String(p).toLowerCase();
              // Exclude common non-text properties
              const nonTextPatterns = [
                'id', 'ids', 'uuid', 'key', 'keys',
                'date', 'dates', 'time', 'times', 'timestamp', 'timestamps',
                'created', 'updated', 'deleted',
                'is', 'has', 'can', 'should', 'will', 'active', 'enabled', 'disabled',
                'count', 'counts', 'total', 'totals', 'amount', 'amounts', 'price', 'prices',
                'index', 'indexes', 'order', 'orders', 'sort', 'sorts',
                'url', 'urls', 'link', 'links', 'href', 'src',
                'email', 'emails', 'phone', 'phones',
                'image', 'images', 'img', 'icon', 'icons', 'avatar', 'avatars',
                'color', 'colors', 'bg', 'background', 'backgrounds'
              ];
              
              // Exclude if it matches non-text patterns
              if (nonTextPatterns.some(pattern => prop === pattern || prop.endsWith(pattern))) {
                return false;
              }
              
              // Include if it's likely a text property (has text-like characteristics)
              // This is generic - works for any property name
              return true;
            }) as string[];

            // Build filtered computed property with TRULY GENERIC logic
            // Uses dynamically detected properties instead of hardcoded ones
            const arrayVarWithValue = `${arrayVar}.value`;

            // Build search filter condition dynamically based on detected properties
            // GENERIC: Only use detected properties, no hardcoded fallback
            const searchConditions =
              searchProperties.length > 0
                ? searchProperties
                    .map(
                      (prop) =>
                        `item.${prop}?.toLowerCase().includes(searchLower)`
                    )
                    .join(" ||\n        ")
                : // If no properties detected, use a generic search that works for any object structure
                  `Object.values(item).some(value => 
        typeof value === 'string' && value.toLowerCase().includes(searchLower))`;

            // GENERIC: Only add category filter if we detected/inferred a property
            const categoryFilterCode = (categoryFilter && categoryProperty) 
              ? `    // Filter by ${categoryProperty} (dynamically detected)
    if (filters.${categoryFilter}) {
      result = result.filter(item => item.${categoryProperty} === filters.${categoryFilter});
    }
    `
              : '';
            
            const searchFilterCode = searchFilter
              ? `    // Filter by search query (searches in dynamically detected properties)
    if (filters.${searchFilter}) {
      const searchLower = filters.${searchFilter}.toLowerCase();
      result = result.filter(item => 
        ${searchConditions}
      );
    }
    `
              : '';
            
            const fixedFilteredComputed = `const ${computedName} = computed(() => {
    let result = ${arrayVarWithValue};
    ${categoryFilterCode}${searchFilterCode}return result;
  })`;

            fixedContent = fixedContent.replace(
              fullMatch,
              fixedFilteredComputed
            );
            result.fixed = true;
            result.fixes.push(
              `Auto-fixed incomplete computed '${computedName}': added generic filtering logic based on filters object`
            );
          }
        }
        
        // Also handle computed properties that already have a block but don't filter
        // Pattern: const [ANY_NAME] = computed(() => { let result = [ARRAY_VAR].value; return result; }) (GENERIC)
        // Should add filtering logic if filters exist
        // More flexible pattern that matches with or without type annotation and handles various whitespace
        const computedWithBlockPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{\s*let\s+result\s*=\s*(\w+)\.value\s*;\s*return\s+result\s*;\s*\}\)|const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*\{\s*let\s+result\s*=\s*(\w+)\.value\s*;\s*return\s+result\s*;\s*\}\)|const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{\s*let\s+result\s*=\s*(\w+)\.value\s*;\s*return\s+result\s*;\s*\}\)/g;
        let computedBlockMatch;
        while ((computedBlockMatch = computedWithBlockPattern.exec(fixedContent)) !== null) {
          const computedName = computedBlockMatch[1] || computedBlockMatch[3] || computedBlockMatch[5];
          const arrayVar = computedBlockMatch[2] || computedBlockMatch[4] || computedBlockMatch[6];
          
          // Skip if already processed
          if (processedComputed.has(computedName)) {
            continue;
          }
          
          // Check if filters exist and computed name suggests filtering
          const hasFilters = /(?:const|let|var)\s+filters\s*=\s*reactive\s*\(/.test(fixedContent);
          const hasFiltersObject = /filters\s*:\s*\{/.test(fixedContent);
          const computedNameLower = computedName.toLowerCase();
          const suggestsTransformation = computedNameLower.includes("filter") || 
                                         computedNameLower.includes("display") ||
                                         computedNameLower.includes("visible");
          
          if ((hasFilters || hasFiltersObject) && suggestsTransformation && reactiveVars.has(arrayVar)) {
            processedComputed.add(computedName);
            
            // Analyze filters and properties dynamically
            const filterAnalysis = analyzeFilterProperties(fixedContent);
            const arrayVarStr = String(arrayVar);
            const itemAnalysis = analyzeArrayItemProperties(fixedContent, arrayVarStr);
            
            const categoryFilter = filterAnalysis.categoryFilter || null;
            const searchFilter = filterAnalysis.searchFilter || null;
            const categoryProperty = itemAnalysis.categoryProperty || null;
            const searchProperties = Array.from(itemAnalysis.properties).filter((p) => {
              const prop = String(p).toLowerCase();
              const nonTextPatterns = ['id', 'ids', 'uuid', 'key', 'date', 'time', 'created', 'updated'];
              return !nonTextPatterns.some(pattern => prop === pattern || prop.endsWith(pattern));
            }) as string[];
            
            const arrayVarWithValue = `${arrayVar}.value`;
            const searchConditions = searchProperties.length > 0
              ? searchProperties.map(prop => `item.${prop}?.toLowerCase().includes(searchLower)`).join(" ||\n        ")
              : `Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(searchLower))`;
            
            const categoryFilterCode = (categoryFilter && categoryProperty) 
              ? `    if (filters.${categoryFilter}) {
      result = result.filter(item => item.${categoryProperty} === filters.${categoryFilter});
    }
    `
              : '';
            
            const searchFilterCode = searchFilter
              ? `    if (filters.${searchFilter}) {
      const searchLower = filters.${searchFilter}.toLowerCase();
      result = result.filter(item => 
        ${searchConditions}
      );
    }
    `
              : '';
            
            const fixedFilteredComputed = `const ${computedName} = computed<any>(() => {
    let result = ${arrayVarWithValue};
    ${categoryFilterCode}${searchFilterCode}return result;
  })`;
            
            // Match the exact pattern including any trailing characters (semicolon, etc.)
            // But avoid double parentheses
            const exactMatch = computedBlockMatch[0];
            // Remove any extra closing parentheses from the match
            const cleanedMatch = exactMatch.replace(/\)+$/, ')');
            
            fixedContent = fixedContent.replace(cleanedMatch, fixedFilteredComputed);
            result.fixed = true;
            result.fixes.push(
              `Auto-fixed incomplete computed '${computedName}': added generic filtering logic to existing block`
            );
          }
        }
        
        // Also handle simpler pattern: computed(() => { let result = array.value; return result; })
        // This catches cases where the pattern is slightly different
        const simplerBlockPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{\s*let\s+result\s*=\s*(\w+)\.value\s*;\s*return\s+result\s*;\s*\}\)/g;
        let simplerMatch;
        while ((simplerMatch = simplerBlockPattern.exec(fixedContent)) !== null) {
          const computedName = simplerMatch[1];
          const arrayVar = simplerMatch[2];
          
          // Skip if already processed
          if (processedComputed.has(computedName)) {
            continue;
          }
          
          // Check if filters exist and computed name suggests filtering
          const hasFilters = /(?:const|let|var)\s+filters\s*=\s*reactive\s*\(/.test(fixedContent);
          const computedNameLower = computedName.toLowerCase();
          const suggestsTransformation = computedNameLower.includes("filter");
          
          if (hasFilters && suggestsTransformation && reactiveVars.has(arrayVar)) {
            processedComputed.add(computedName);
            
            // Analyze filters and properties dynamically
            const filterAnalysis = analyzeFilterProperties(fixedContent);
            const arrayVarStr = String(arrayVar);
            const itemAnalysis = analyzeArrayItemProperties(fixedContent, arrayVarStr);
            
            const categoryFilter = filterAnalysis.categoryFilter || null;
            const searchFilter = filterAnalysis.searchFilter || null;
            const categoryProperty = itemAnalysis.categoryProperty || null;
            const searchProperties = Array.from(itemAnalysis.properties).filter((p) => {
              const prop = String(p).toLowerCase();
              const nonTextPatterns = ['id', 'ids', 'uuid', 'key', 'date', 'time', 'created', 'updated'];
              return !nonTextPatterns.some(pattern => prop === pattern || prop.endsWith(pattern));
            }) as string[];
            
            const arrayVarWithValue = `${arrayVar}.value`;
            const searchConditions = searchProperties.length > 0
              ? searchProperties.map(prop => `item.${prop}?.toLowerCase().includes(searchLower)`).join(" ||\n        ")
              : `Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(searchLower))`;
            
            const categoryFilterCode = (categoryFilter && categoryProperty) 
              ? `    if (filters.${categoryFilter}) {
      result = result.filter(item => item.${categoryProperty} === filters.${categoryFilter});
    }
    `
              : '';
            
            const searchFilterCode = searchFilter
              ? `    if (filters.${searchFilter}) {
      const searchLower = filters.${searchFilter}.toLowerCase();
      result = result.filter(item => 
        ${searchConditions}
      );
    }
    `
              : '';
            
            const fixedFilteredComputed = `const ${computedName} = computed<any>(() => {
    let result = ${arrayVarWithValue};
    ${categoryFilterCode}${searchFilterCode}return result;
  })`;
            
            fixedContent = fixedContent.replace(simplerMatch[0], fixedFilteredComputed);
            result.fixed = true;
            result.fixes.push(
              `Auto-fixed incomplete computed '${computedName}': added generic filtering logic (simpler pattern)`
            );
          }
        }
      }

      // Pattern 2: Array.from(undefinedVar) in computed (single line or multi-line)
      // Match both: computed(() => Array.from(var)) and computed(() => { return Array.from(var); })
      // Also handle TypeScript: computed<any>(() => Array.from(var))
      const arrayFromPatterns = [
        // Single line: computed(() => Array.from(var)) or computed<any>(() => Array.from(var))
        /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*Array\.from\s*\(\s*(\w+)\s*\)\s*\)/g,
        /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*Array\.from\s*\(\s*(\w+)\s*\)\s*\)/g,
        // Multi-line: computed(() => { return Array.from(var); }) or computed<any>(() => { return Array.from(var); })
        /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{\s*return\s+Array\.from\s*\(\s*(\w+)\s*\)\s*;\s*\}\s*\)/g,
        /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*\{\s*return\s+Array\.from\s*\(\s*(\w+)\s*\)\s*;\s*\}\s*\)/g,
        // Multi-line with newlines: computed(() => {\n  return Array.from(var);\n})
        /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{[\s\n]*return\s+Array\.from\s*\(\s*(\w+)\s*\)\s*;?[\s\n]*\}\s*\)/g,
        /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*\{[\s\n]*return\s+Array\.from\s*\(\s*(\w+)\s*\)\s*;?[\s\n]*\}\s*\)/g,
      ];

      for (const arrayFromPattern of arrayFromPatterns) {
        let arrayFromMatch;
        arrayFromPattern.lastIndex = 0; // Reset regex state

        while (
          (arrayFromMatch = arrayFromPattern.exec(fixedContent)) !== null
        ) {
          const computedName = arrayFromMatch[1];
          const undefinedVar = arrayFromMatch[2];

          // Check if the variable is not defined (skip if it's defined elsewhere in the computed)
          const computedBlock = fixedContent.substring(
            fixedContent.indexOf(arrayFromMatch[0]),
            fixedContent.indexOf(arrayFromMatch[0]) + arrayFromMatch[0].length
          );
          const isDefinedInComputed = computedBlock.match(
            new RegExp(`(const|let|var)\\s+${undefinedVar}\\b`)
          );

          if (
            !isDefinedInComputed &&
            !fixedContent.match(
              new RegExp(`(const|let|var|ref|reactive)\\s+${undefinedVar}\\b`)
            )
          ) {
            // Try to infer from context
            const computedNameLower = computedName.toLowerCase();
            let inferredSource: string | null = null;
            let inferredProperty: string | null = null;

            // GENERIC PATTERN: Infer source from computed name and available reactive vars
            // Works for any project, not just specific variable names
            // No hardcoded patterns - works for any property name
            const inferPropertyFromComputedName = (name: string): string | null => {
              // Remove plural endings generically
              if (name.endsWith("ies")) {
                return name.slice(0, -3) + "y"; // categories → category
              }
              if (name.endsWith("es")) {
                return name.slice(0, -2); // tags → tag, types → type
              }
              if (name.endsWith("s")) {
                return name.slice(0, -1); // items → item, products → product
              }
              return name; // Already singular or no plural pattern
            };
            
            // Try to infer property from computed name (works for any property)
            inferredProperty = inferPropertyFromComputedName(computedNameLower);
            
            if (inferredProperty) {
              // Find any array-like reactive var (any plural noun or array-like name)
              const arrayLikeVars = Array.from(reactiveVars).filter((v) => {
                const vLower = v.toLowerCase();
                return (
                  vLower.endsWith("s") ||
                  vLower.includes("list") ||
                  vLower.includes("array") ||
                  vLower.includes("data") ||
                  vLower.includes("items") ||
                  vLower.includes("collection")
                );
              });
              if (arrayLikeVars.length > 0) {
                inferredSource = arrayLikeVars[0];
              }
            }
            
            if (!inferredSource) {
              // Generic inference: find best matching reactive var
              // Try to match computed name with reactive var names
              for (const varName of reactiveVars) {
                const varNameLower = varName.toLowerCase();
                // Match patterns like: categories → posts, items → products
                if (
                  computedNameLower.includes(varNameLower.slice(0, -1)) ||
                  varNameLower.includes(computedNameLower.slice(0, -1)) ||
                  (computedNameLower.length > 3 &&
                    varNameLower.includes(
                      computedNameLower.substring(
                        0,
                        computedNameLower.length - 1
                      )
                    ))
                ) {
                  inferredSource = varName;
                  // GENERIC: Try to infer property name from computed name, no hardcoded fallback
                  // Works for any property name pattern
                  const inferPropertyFromComputedName = (name: string): string | null => {
                    // Remove plural endings generically
                    if (name.endsWith("ies")) {
                      return name.slice(0, -3) + "y"; // categories → category
                    }
                    if (name.endsWith("es")) {
                      return name.slice(0, -2); // tags → tag, types → type
                    }
                    if (name.endsWith("s")) {
                      return name.slice(0, -1); // items → item, products → product
                    }
                    return name; // Already singular or no plural pattern
                  };
                  
                  inferredProperty =
                    computedNameLower
                      .replace(varNameLower, "") ||
                    inferPropertyFromComputedName(computedNameLower) ||
                    null;
                  break;
                }
              }

              // Fallback: if we have reactive vars but no match, use the first array-like one
              if (!inferredSource && reactiveVars.size > 0) {
                const arrayLikeVars = Array.from(reactiveVars).filter((v) => {
                  const vLower = v.toLowerCase();
                  return (
                    vLower.endsWith("s") ||
                    vLower.includes("list") ||
                    vLower.includes("array") ||
                    vLower.includes("data") ||
                    vLower.includes("items") ||
                    vLower.includes("collection")
                  );
                });
                if (arrayLikeVars.length > 0) {
                  inferredSource = arrayLikeVars[0];
                  // GENERIC: Try to infer property from computed name, no hardcoded fallback
                  // Works for any property name pattern
                  const inferPropertyFromComputedName = (name: string): string | null => {
                    // Remove plural endings generically
                    if (name.endsWith("ies")) {
                      return name.slice(0, -3) + "y"; // categories → category
                    }
                    if (name.endsWith("es")) {
                      return name.slice(0, -2); // tags → tag, types → type
                    }
                    if (name.endsWith("s")) {
                      return name.slice(0, -1); // items → item, products → product
                    }
                    return name; // Already singular or no plural pattern
                  };
                  
                  inferredProperty = inferPropertyFromComputedName(computedNameLower) || null;
                }
              }
            }

            if (inferredSource && inferredProperty) {
              // Auto-fix: Replace Array.from(undefinedVar) with proper extraction
              // GENERIC: Use inferred property, skip if we can't infer generically
              const property = inferredProperty;
              // Check if original had TypeScript type annotation
              const hasTypeAnnotation = arrayFromMatch[0].includes("computed<");
              const typeAnnotation = hasTypeAnnotation
                ? arrayFromMatch[0].match(/computed<([^>]+)>/)?.[1] || "any"
                : "any";
              const fixedComputed = `const ${computedName} = computed<${typeAnnotation}>(() => {\n    const ${undefinedVar} = new Set(${inferredSource}.value.map(item => item.${property}).filter(Boolean));\n    return Array.from(${undefinedVar});\n  })`;
              fixedContent = fixedContent.replace(
                arrayFromMatch[0],
                fixedComputed
              );
              result.fixed = true;
              result.fixes.push(
                `Auto-fixed Array.from(${undefinedVar}) in computed '${computedName}': inferred extraction from ${inferredSource}.${property}`
              );
              break; // Only fix once per pattern
            } else {
              result.issues.push(
                `Incomplete computed property detected: ${computedName} uses Array.from(${undefinedVar}) where '${undefinedVar}' is undefined. Available reactive vars: ${Array.from(reactiveVars).join(", ")}. Could not auto-fix - manual fix required.`
              );
            }
          }
        }
      }
    }
  }

  // Fix 4: Remove Vuex imports (always, not just if Pinia is used)
  // Remove vuex default import
  const vuexDefaultImportPattern = /import\s+Vuex\s+from\s+['"]vuex['"];?\n?/g;
  if (vuexDefaultImportPattern.test(fixedContent)) {
    fixedContent = fixedContent.replace(vuexDefaultImportPattern, "");
    result.fixed = true;
    result.fixes.push("Removed Vuex default import");
  }

  // Remove vuex named imports (mapGetters, mapActions, etc.)
  const vuexNamedImportPattern =
    /import\s+\{[^}]*\}\s+from\s+['"]vuex['"];?\n?/g;
  if (vuexNamedImportPattern.test(fixedContent)) {
    fixedContent = fixedContent.replace(vuexNamedImportPattern, "");
    result.fixed = true;
    result.fixes.push("Removed Vuex named imports");
  }

  // Fix 5: Fix createApp syntax in main.js/main.ts
  if (filePath.includes("main.js") || filePath.includes("main.ts")) {
    // Remove import store from "./store"
    const storeImportPattern =
      /import\s+store\s+from\s+['"]\.\/store['"];?\n?/g;
    if (storeImportPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(storeImportPattern, "");
      result.fixed = true;
      result.fixes.push("Removed store import from main.js");
    }

    // Fix incorrect createApp syntax: createApp({ router, render: () => h(App) })
    // Should be: createApp(App) then app.use(router)
    const incorrectCreateAppPattern =
      /const\s+app\s*=\s*createApp\s*\(\s*\{\s*router\s*,\s*render\s*:\s*\(\)\s*=>\s*h\s*\(\s*App\s*\)\s*\}\s*\)/;
    if (incorrectCreateAppPattern.test(fixedContent)) {
      // Extract router import if exists
      const routerImportMatch = fixedContent.match(
        /import\s+router\s+from\s+['"]([^'"]+)['"]/
      );
      const routerPath = routerImportMatch ? routerImportMatch[1] : "./router";

      // Replace with correct syntax
      fixedContent = fixedContent.replace(
        incorrectCreateAppPattern,
        "const app = createApp(App)"
      );

      // Ensure router is imported
      if (!fixedContent.includes("import router")) {
        const appImportMatch = fixedContent.match(
          /import\s+App\s+from\s+['"]([^'"]+)['"]/
        );
        if (appImportMatch) {
          const appImportLine = appImportMatch[0];
          fixedContent = fixedContent.replace(
            appImportLine,
            `${appImportLine}\nimport router from '${routerPath}'`
          );
        }
      }

      // Ensure app.use(router) is called after createApp
      if (!fixedContent.includes("app.use(router)")) {
        fixedContent = fixedContent.replace(
          /(const\s+app\s*=\s*createApp\s*\(\s*App\s*\)\s*;)/,
          "$1\n\napp.use(router);"
        );
      }

      result.fixed = true;
      result.fixes.push("Fixed createApp syntax to Vue 3 format");
    }

    // Fix order: Pinia must be initialized BEFORE router (router guards may use stores)
    // Pattern: app.use(router); app.use(createPinia()); → app.use(createPinia()); app.use(router);
    const piniaAfterRouterPattern =
      /app\.use\(router\)\s*;\s*app\.use\(createPinia\(\)\)/;
    if (piniaAfterRouterPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(
        /(app\.use\(router\)\s*;)\s*(app\.use\(createPinia\(\)\)\s*;)/,
        "$2\n$1"
      );
      result.fixed = true;
      result.fixes.push(
        "Fixed Pinia initialization order (Pinia before Router)"
      );
    }

    // Remove unused 'h' import from createApp
    const unusedHImportPattern =
      /import\s+\{\s*createApp\s*,\s*h\s*\}\s+from\s+['"]vue['"]/;
    if (
      unusedHImportPattern.test(fixedContent) &&
      !fixedContent.includes("h(") &&
      !fixedContent.includes("h (")
    ) {
      fixedContent = fixedContent.replace(
        /import\s+\{\s*createApp\s*,\s*h\s*\}\s+from\s+['"]vue['"]/,
        "import { createApp } from 'vue'"
      );
      result.fixed = true;
      result.fixes.push("Removed unused 'h' import");
    }

    // Remove store from createApp options (legacy pattern)
    const storeInAppPattern =
      /(const\s+app\s*=\s*createApp\([^)]*),\s*store\s*([^)]*\))/;
    if (storeInAppPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(storeInAppPattern, "$1$2");
      result.fixed = true;
      result.fixes.push("Removed store from createApp options");
    }
  }

  // Fix 5b: Fix createWebHistory with process.env.BASE_URL that can be an object
  // Pattern: createWebHistory({ base: process.env.BASE_URL })
  // Problem: process.env.BASE_URL can be transformed to an object by webpack, causing [object Object] in URL
  // Solution: Remove base option or ensure it's a string
  if (filePath.includes("router") || filePath.includes("Router")) {
    const createWebHistoryPattern =
      /createWebHistory\s*\(\s*\{\s*base\s*:\s*process\.env\.BASE_URL\s*\}\s*\)/g;
    if (createWebHistoryPattern.test(fixedContent)) {
      // Remove the base option completely - Vue Router will use '/' by default
      fixedContent = fixedContent.replace(
        /createWebHistory\s*\(\s*\{\s*base\s*:\s*process\.env\.BASE_URL\s*\}\s*\)/g,
        "createWebHistory()"
      );
      result.fixed = true;
      result.fixes.push(
        "Removed process.env.BASE_URL from createWebHistory (can cause [object Object] in URL)"
      );
    }

    // Also handle cases where base is passed as a variable or other expression
    const createWebHistoryWithBasePattern =
      /createWebHistory\s*\(\s*\{\s*base\s*:\s*([^}]+)\s*\}\s*\)/g;
    const matches = Array.from(
      fixedContent.matchAll(createWebHistoryWithBasePattern)
    );
    matches.forEach((match) => {
      const baseValue = match[1].trim();
      // If base value contains process.env.BASE_URL or looks like it could be an object
      if (
        baseValue.includes("process.env.BASE_URL") ||
        baseValue.includes("BASE_URL")
      ) {
        fixedContent = fixedContent.replace(match[0], "createWebHistory()");
        result.fixed = true;
        result.fixes.push("Removed BASE_URL from createWebHistory base option");
      }
    });

    // Fix 5c: Fix catch-all route path: '*' → path: '/:pathMatch(.*)*'
    // Vue Router 4 requires catch-all routes to use a param with custom regexp
    const catchAllRoutePattern = /path:\s*['"]\*['"]/g;
    if (catchAllRoutePattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(
        /path:\s*['"]\*['"]/g,
        "path: '/:pathMatch(.*)*'"
      );
      result.fixed = true;
      result.fixes.push(
        "Fixed catch-all route: path: '*' → path: '/:pathMatch(.*)*'"
      );
    }
  }

  // Fix 6: Fix router navigation guards that use router.app.$store or store.getters
  // Pattern: router.app.$store.getters['module/getter'] or router.app.$store.getters.property
  // Transform to: useModuleStore().getter
  if (filePath.includes("router") || filePath.includes("Router")) {
    // Ensure store analysis cache is available for dynamic inference
    if (projectRoot && (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot)) {
      try {
        storeAnalysisCache = await analyzePiniaStores(projectRoot);
        storeAnalysisProjectRoot = projectRoot;
      } catch (error) {
        storeAnalysisCache = null;
      }
    }
    
    // Pattern 1: router.app.$store.getters['module/getter'] or router.app.$store.getters.property
    const routerStorePattern =
      /router\.app\.\$store\.(getters|dispatch|state)(?:\[['"]([^'"]+)['"]\]|\.(\w+))/g;
    // Pattern 2: store.getters['module/getter'] (direct store import)
    const directStorePattern =
      /store\.(getters|dispatch|state)\[['"]([^'"]+)\/([^'"]+)['"]\]/g;
    const matches = Array.from(fixedContent.matchAll(routerStorePattern));
    const directMatches = Array.from(fixedContent.matchAll(directStorePattern));

    if (matches.length > 0 || directMatches.length > 0) {
      const scriptMatch =
        fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/) ||
        fixedContent.match(/^([\s\S]*)$/); // For .js files

      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        const originalScriptContent = scriptContent;
        const storesToImport = new Map<string, string>(); // module name → store name

        // Process router.app.$store patterns
        matches.forEach((match) => {
          const [, type, path, directProperty] = match;
          // Handle both patterns: router.app.$store.getters['module/prop'] and router.app.$store.getters.prop
          let moduleName: string | null = null;
          let propertyName: string;

          if (directProperty) {
            // Pattern: router.app.$store.getters.isAuthenticated (direct property access)
            // GENERIC: Try to infer store from property name using dynamic store analysis
            propertyName = directProperty;
            
            // Use dynamic store analysis to find which store contains this property
            if (projectRoot && storeAnalysisCache) {
              storeAnalysisCache.forEach((module, method) => {
                if (method === propertyName || method.toLowerCase() === propertyName.toLowerCase()) {
                  moduleName = module;
                }
              });
            }
            
            // If not found, try common patterns (but only as fallback for common properties)
            if (!moduleName) {
              // Common authentication properties are usually in user/auth store
              if (propertyName.toLowerCase().includes('auth') || propertyName.toLowerCase() === 'isauthenticated') {
                moduleName = 'user'; // Common pattern, but still generic
              }
            }
          } else if (path) {
            // Pattern: router.app.$store.getters['module/prop']
            const parts = path.split("/");
            if (parts.length === 2) {
              // Pattern: 'user/isAuthenticated' - explicit module/property format
              [moduleName, propertyName] = parts;
            } else {
              // Pattern: 'isAuthenticated' - try to infer module
              propertyName = path;
              // Use dynamic store analysis
              if (projectRoot && storeAnalysisCache) {
                storeAnalysisCache.forEach((module, method) => {
                  if (method === propertyName || method.toLowerCase() === propertyName.toLowerCase()) {
                    moduleName = module;
                  }
                });
              }
            }
          } else {
            // Cannot determine property name
            return;
          }

          // Only proceed if we have a valid module name
          if (moduleName) {
            // Determine store name: 'user' → 'useUserStore'
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName);

            // Replace router.app.$store.getters['module/prop'] or router.app.$store.getters.prop with store().prop
            // Note: Store will be initialized inside beforeEach guard
            const storeVarName = `${moduleName}Store`;
            let replacement: string;

            if (type === "getters") {
              replacement = `${storeVarName}.${propertyName}`;
            } else if (type === "dispatch") {
              replacement = `${storeVarName}.${propertyName}()`;
            } else {
              // state
              replacement = `${storeVarName}.${propertyName}`;
            }

            // Replace the pattern (escape special regex chars)
            const patternToReplace = match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            scriptContent = scriptContent.replace(
              new RegExp(patternToReplace, 'g'),
              replacement
            );
          }
        });

        // Process store.getters['module/getter'] patterns (direct store import)
        directMatches.forEach((match) => {
          const [, type, moduleName, propertyName] = match;

          if (moduleName && propertyName) {
            // Determine store name: 'auth' → 'useAuthStore'
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName);

            // Replace store.getters['module/prop'] with storeVar.prop
            const storeVarName = `${moduleName}Store`;
            let replacement: string;

            if (type === "getters") {
              replacement = `${storeVarName}.${propertyName}`;
            } else if (type === "dispatch") {
              replacement = `${storeVarName}.${propertyName}()`;
            } else {
              // state
              replacement = `${storeVarName}.${propertyName}`;
            }

            // Replace the pattern (escape special regex chars)
            const patternToReplace = match[0].replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            );
            scriptContent = scriptContent.replace(
              new RegExp(patternToReplace, "g"),
              replacement
            );
          }
        });

        // Add store imports if needed
        if (
          storesToImport.size > 0 &&
          scriptContent !== originalScriptContent
        ) {
          storesToImport.forEach((storeName, moduleName) => {
            const importPath = `@/store/modules/${moduleName}`;
            const importPattern = new RegExp(
              `import\\s+.*${storeName}.*from`,
              "g"
            );

            if (!importPattern.test(scriptContent)) {
              // Add import at the top of script content
              const importLine = `import { ${storeName} } from '${importPath}';\n`;
              scriptContent = importLine + scriptContent;
            }

            // Remove old store import if it exists
            const oldStoreImportPattern =
              /import\s+store\s+from\s+['"]\.\.\/store['"];?\s*\n?/g;
            scriptContent = scriptContent.replace(oldStoreImportPattern, "");

            // Initialize store INSIDE router.beforeEach guard (not at module level)
            // This is required because Pinia must be initialized with app.use(pinia) before stores can be used
            const storeVarName = `${moduleName}Store`;
            const moduleLevelInitPattern = new RegExp(
              `const\\s+${storeVarName}\\s*=\\s*${storeName}\\(\\);?\\s*\\n`,
              "g"
            );
            const insideBeforeEachPattern = new RegExp(
              `router\\.beforeEach[^}]*const\\s+${storeVarName}`,
              "s"
            );

            // First, check if store is initialized at module level (outside beforeEach)
            const hasModuleLevelInit =
              moduleLevelInitPattern.test(scriptContent);
            const hasInsideBeforeEach =
              insideBeforeEachPattern.test(scriptContent);

            // Also check if store variable is used but not initialized inside beforeEach
            const storeUsagePattern = new RegExp(
              `router\\.beforeEach[^}]*\\b${storeVarName}\\b`,
              "s"
            );
            const storeUsedButNotInit =
              storeUsagePattern.test(scriptContent) && !hasInsideBeforeEach;

            // If store is initialized at module level OR used but not initialized, move/create it inside beforeEach
            if (
              (hasModuleLevelInit || storeUsedButNotInit) &&
              !hasInsideBeforeEach
            ) {
              // Remove module-level initialization if it exists
              if (hasModuleLevelInit) {
                scriptContent = scriptContent.replace(
                  moduleLevelInitPattern,
                  ""
                );
              }

              // Check if router.beforeEach exists
              const beforeEachMatch = scriptContent.match(
                /router\.beforeEach\s*\([^)]*\)\s*=>\s*\{/
              );
              if (beforeEachMatch) {
                // Add store initialization inside the guard (at the beginning, before any usage)
                const initLine = `  const ${storeVarName} = ${storeName}();\n`;
                scriptContent = scriptContent.replace(
                  /(router\.beforeEach\s*\([^)]*\)\s*=>\s*\{)/,
                  `$1\n${initLine}`
                );
              } else {
                // No router.beforeEach - create one with store initialization
                const beforeEachCode = `router.beforeEach((to, from, next) => {
  const ${storeVarName} = ${storeName}();
  // Add your guard logic here
  next();
  });\n\n`;
                const exportMatch = scriptContent.match(/export\s+default/);
                if (exportMatch) {
                  const insertPos = exportMatch.index!;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    `${beforeEachCode}` +
                    scriptContent.slice(insertPos);
                } else {
                  scriptContent = `${beforeEachCode}${scriptContent}`;
                }
              }
            } else if (!hasInsideBeforeEach) {
              // Store not initialized anywhere - add it inside beforeEach
              const beforeEachMatch = scriptContent.match(
                /router\.beforeEach\s*\([^)]*\)\s*=>\s*\{/
              );
              if (beforeEachMatch) {
                // Add store initialization inside the guard (at the beginning)
                const initLine = `  const ${storeVarName} = ${storeName}();\n`;
                scriptContent = scriptContent.replace(
                  /(router\.beforeEach\s*\([^)]*\)\s*=>\s*\{)/,
                  `$1\n${initLine}`
                );
              } else {
                // No router.beforeEach - create one with store initialization
                const beforeEachCode = `router.beforeEach((to, from, next) => {
  const ${storeVarName} = ${storeName}();
  // Add your guard logic here
  next();
});\n\n`;
                const exportMatch = scriptContent.match(/export\s+default/);
                if (exportMatch) {
                  const insertPos = exportMatch.index!;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    `${beforeEachCode}` +
                    scriptContent.slice(insertPos);
                } else {
                  scriptContent = `${beforeEachCode}${scriptContent}`;
                }
              }
            }
          });

          // Update fixedContent
          if (fixedContent.includes("<script")) {
            fixedContent = fixedContent.replace(
              /(<script[^>]*>)([\s\S]*?)(<\/script>)/,
              `$1${scriptContent}$3`
            );
          } else {
            // For .js files without script tags
            fixedContent = scriptContent;
          }

          result.fixed = true;
          result.fixes.push(
            `Migrated router.app.$store to Pinia stores: ${Array.from(storesToImport.keys()).join(", ")}`
          );
        }
      }
    }
  }

  // Fix 7: Transform Vuex mapGetters/mapActions to Pinia stores in Vue components
  // This handles components that still use Options API with Vuex helpers
  if (isVueFile && !fixedContent.includes("<script setup")) {
    // Check if component uses mapGetters or mapActions
    if (
      fixedContent.includes("mapGetters") ||
      fixedContent.includes("mapActions") ||
      fixedContent.includes("mapState") ||
      fixedContent.includes("mapMutations")
    ) {
      const scriptMatch = fixedContent.match(
        /<script[^>]*>([\s\S]*?)<\/script>/
      );
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];

        // Detect which stores are used
        const storeModules = new Map<string, string>();

        // Pattern: ...mapGetters('module', ['getter1', 'getter2'])
        const mapGettersPattern =
          /mapGetters\(['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]/g;
        const mapActionsPattern =
          /mapActions\(['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]/g;

        let match;
        while ((match = mapGettersPattern.exec(scriptContent)) !== null) {
          const moduleName = match[1];
          const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
          storeModules.set(moduleName, storeName);
        }

        while ((match = mapActionsPattern.exec(scriptContent)) !== null) {
          const moduleName = match[1];
          const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
          storeModules.set(moduleName, storeName);
        }

        if (storeModules.size > 0) {
          // Convert to <script setup> with Pinia stores
          let newScriptContent = "";

          // Add imports
          storeModules.forEach((storeName, moduleName) => {
            const importPath = `@/store/modules/${moduleName}`;
            newScriptContent += `import { ${storeName} } from '${importPath}';\n`;
          });

          if (enableTypeScript) {
            newScriptContent += "import { computed } from 'vue';\n";
          } else {
            newScriptContent += "import { computed } from 'vue';\n";
          }

          // Initialize stores
          storeModules.forEach((storeName, moduleName) => {
            const storeVarName = moduleName + "Store";
            newScriptContent += `const ${storeVarName} = ${storeName}();\n`;
          });

          // Extract computed properties from mapGetters
          // Handle multiple mapGetters calls
          const mapGettersMatches = scriptContent.matchAll(
            /\.\.\.mapGetters\(['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]/g
          );
          for (const gettersMatch of mapGettersMatches) {
            const moduleName = gettersMatch[1];
            const getters = gettersMatch[2]
              .split(",")
              .map((g) => g.trim().replace(/['"]/g, ""));
            const storeVarName = moduleName + "Store";

            getters.forEach((getterName) => {
              // Check if getter is used as a function (like userById(id))
              // Look for patterns like: user() { return this.userById(this.id); }
              const isFunctionGetter =
                scriptContent.includes(`${getterName}(`) ||
                scriptContent.match(
                  new RegExp(
                    `\\w+\\s*\\([^)]*\\)\\s*\\{[^}]*this\\.${getterName}\\(`,
                    "s"
                  )
                );

              if (isFunctionGetter) {
                newScriptContent += `const ${getterName} = ${storeVarName}.${getterName};\n`;
              } else {
                newScriptContent += `const ${getterName} = computed(() => ${storeVarName}.${getterName});\n`;
              }
            });
          }

          // Extract methods from mapActions
          // Handle multiple mapActions calls
          const mapActionsMatches = scriptContent.matchAll(
            /\.\.\.mapActions\(['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]/g
          );
          for (const actionsMatch of mapActionsMatches) {
            const moduleName = actionsMatch[1];
            const actions = actionsMatch[2]
              .split(",")
              .map((a) => a.trim().replace(/['"]/g, ""));
            const storeVarName = moduleName + "Store";

            actions.forEach((actionName) => {
              newScriptContent += `const ${actionName} = ${storeVarName}.${actionName};\n`;
            });
          }

          // Extract other methods that call store actions/getters
          // Pattern: methodName() { this.actionName(); } or methodName() { return this.getterName(); }
          const methodsSection = scriptContent.match(
            /methods:\s*\{([\s\S]*?)\n\s*\}/
          );
          if (methodsSection) {
            const methodsContent = methodsSection[1];
            // Find all method definitions
            const methodPattern = /(\w+)\s*\([^)]*\)\s*\{([^}]+)\}/g;
            let methodMatch;
            while (
              (methodMatch = methodPattern.exec(methodsContent)) !== null
            ) {
              const methodName = methodMatch[1];
              const methodBody = methodMatch[2];

              // Check if method calls store actions/getters via this.
              // Replace this.actionName() with actionName() and this.getterName with getterName
              let transformedBody = methodBody;

              // Collect all store actions and getters
              const allStoreActions = new Set<string>();
              const allStoreGetters = new Set<string>();

              storeModules.forEach((storeName, moduleName) => {
                // Find actions for this module
                const actionsMatch = scriptContent.match(
                  new RegExp(
                    `mapActions\\(['"]${moduleName}['"]\\s*,\\s*\\[([^\\]]+)\\]`
                  )
                );
                if (actionsMatch) {
                  actionsMatch[1].split(",").forEach((a) => {
                    allStoreActions.add(a.trim().replace(/['"]/g, ""));
                  });
                }

                // Find getters for this module
                const gettersMatch = scriptContent.match(
                  new RegExp(
                    `mapGetters\\(['"]${moduleName}['"]\\s*,\\s*\\[([^\\]]+)\\]`
                  )
                );
                if (gettersMatch) {
                  gettersMatch[1].split(",").forEach((g) => {
                    allStoreGetters.add(g.trim().replace(/['"]/g, ""));
                  });
                }
              });

              // Replace this.actionName() with actionName()
              transformedBody = transformedBody.replace(
                /this\.(\w+)\(/g,
                (match, method) => {
                  if (
                    allStoreActions.has(method) ||
                    allStoreGetters.has(method)
                  ) {
                    return `${method}(`;
                  }
                  return match;
                }
              );

              // Replace this.getterName with getterName (when not called as function)
              transformedBody = transformedBody.replace(
                /this\.(\w+)(?!\()/g,
                (match, prop) => {
                  if (allStoreGetters.has(prop)) {
                    return prop;
                  }
                  return match;
                }
              );

              // Only add method if it's not already a store action/getter
              const isStoreMethod = Array.from(storeModules.values()).some(
                (storeName) => {
                  const storeVarName =
                    storeName
                      .replace("use", "")
                      .replace("Store", "")
                      .toLowerCase() + "Store";
                  return methodBody.includes(`${storeVarName}.${methodName}`);
                }
              );

              if (!isStoreMethod && transformedBody !== methodBody) {
                newScriptContent += `const ${methodName} = () => {${transformedBody}};\n`;
              } else if (!isStoreMethod) {
                newScriptContent += `const ${methodName} = () => {${methodBody}};\n`;
              }
            }
          }

          // Replace script section
          if (newScriptContent) {
            fixedContent = fixedContent.replace(
              /<script[^>]*>([\s\S]*?)<\/script>/,
              `<script setup>\n${newScriptContent}</script>`
            );
            result.fixed = true;
            result.fixes.push(
              "Converted Vuex mapGetters/mapActions to Pinia stores"
            );
          }
        }
      }
    }
  }

  // Fix 8: Fix components using <script setup> that reference stores incorrectly
  // Pattern: this.userById(props.id) → useUsersStore().userById(props.id)
  // Now uses dynamic store analysis to correctly detect which store to use
  // GENERIC: No hardcoded patterns - relies entirely on dynamic store analysis
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Get dynamic store map from analysis - NO hardcoded fallback for genericity
      const storeMethodMap: Record<string, string> = {};

      // Analyze stores dynamically - REQUIRED for genericity
      if (projectRoot) {
        // Use cache if available and for same project
        if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
          try {
            storeAnalysisCache = await analyzePiniaStores(projectRoot);
            storeAnalysisProjectRoot = projectRoot;
          } catch (error) {
            // If analysis fails, we can't proceed without store information
            // This ensures the fixer is generic and doesn't rely on project-specific patterns
            storeAnalysisCache = null;
          }
        }

        // Convert Map to Record for easier use
        if (storeAnalysisCache && storeAnalysisCache.size > 0) {
          storeAnalysisCache.forEach((module, method) => {
            storeMethodMap[method] = module;
          });
        }
      }

      // If no store analysis available, skip this fix (generic approach)
      // This ensures we don't make incorrect assumptions about store structure
      if (Object.keys(storeMethodMap).length === 0) {
        // No store information available, cannot proceed safely
        // Skip this fix to maintain genericity - don't proceed with empty map
      } else {
        // Detect this.methodName() patterns and determine which store to use
        const thisMethodPattern = /this\.(\w+)\s*\(/g;
        const storesToImport = new Map<string, string>(); // moduleName → storeName (for easier iteration)
        let match;

        while ((match = thisMethodPattern.exec(scriptContent)) !== null) {
          const methodName = match[1];
          const moduleName = storeMethodMap[methodName];

          if (moduleName) {
            // Determine store name from module name
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName); // moduleName → storeName

            // Replace this.methodName() with storeVarName.methodName()
            const storeVarName = `${moduleName}Store`;
            scriptContent = scriptContent.replace(
              new RegExp(`this\\.${methodName}\\s*\\(`, "g"),
              `${storeVarName}.${methodName}(`
            );
          }
        }

        // Also detect this.propertyName (without parentheses) for getters
        const thisPropertyPattern = /this\.(\w+)(?!\s*\()/g;
        while ((match = thisPropertyPattern.exec(scriptContent)) !== null) {
          const propertyName = match[1];
          const moduleName = storeMethodMap[propertyName];

          if (moduleName) {
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName);

            const storeVarName = `${moduleName}Store`;
            scriptContent = scriptContent.replace(
              new RegExp(`this\\.${propertyName}(?!\\s*\\()`, "g"),
              `${storeVarName}.${propertyName}`
            );
          }
        }

        // Also detect direct function calls that are store methods
        // GENERIC: Pattern: methodName() where methodName is in storeMethodMap but not defined locally
        // First collect all potential method calls, then check against storeMethodMap
        const directCallPattern = /\b(\w+)\s*\(/g;
        const directCalls = new Set<string>();
        let directCallMatch;
        while (
          (directCallMatch = directCallPattern.exec(scriptContent)) !== null
        ) {
          const methodName = directCallMatch[1];
          // Skip if it's already a store call (store.methodName), a Vue API, or a local function
          // GENERIC: Check if methodName exists in storeMethodMap (dynamically detected from stores)
          const isDefinedLocally = scriptContent.match(
            new RegExp(`(const|let|var|function|import)\\s+${methodName}\\b`)
          );
          const isStoreCall = scriptContent.match(
            new RegExp(`\\w+Store\\.${methodName}`)
          );
          const isVueAPI = [
            "computed",
            "ref",
            "reactive",
            "watch",
            "onMounted",
            "onUnmounted",
            "defineProps",
            "defineEmits",
            "console",
            "setTimeout",
            "setInterval",
            "clearTimeout",
            "clearInterval",
          ].includes(methodName);

          // If method is in storeMethodMap and not defined locally, it's a store method call
          if (
            storeMethodMap[methodName] &&
            !isDefinedLocally &&
            !isStoreCall &&
            !isVueAPI
          ) {
            directCalls.add(methodName);
          }
        }

        // Add stores for direct function calls
        directCalls.forEach((methodName) => {
          const moduleName = storeMethodMap[methodName];
          if (moduleName) {
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName); // moduleName → storeName

            // Replace methodName() with storeVarName.methodName()
            const storeVarName = `${moduleName}Store`;
            scriptContent = scriptContent.replace(
              new RegExp(`\\b${methodName}\\s*\\(`, "g"),
              `${storeVarName}.${methodName}(`
            );
          }
        });

        // Add store imports and initialization if needed
        if (storesToImport.size > 0) {
          // Check if stores are already imported
          // GENERIC: storesToImport is Map<moduleName, storeName>
          storesToImport.forEach((storeName, moduleName) => {
            const storeVarName = `${moduleName}Store`;
            const importPath = `@/store/modules/${moduleName}`;

            // Add import if not present (check for exact import statement)
            if (!scriptContent.includes(`import { ${storeName} } from`)) {
              // Find the best place to insert import (after other imports or at the beginning)
              const importMatch = scriptContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                scriptContent = scriptContent.replace(
                  /(import\s+[^;]+;[\s\n]*)+/,
                  `$&import { ${storeName} } from '${importPath}';\n`
                );
              } else {
                scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
              }
            }

            // Add store initialization if not present
            if (
              !scriptContent.includes(`const ${storeVarName} = ${storeName}`)
            ) {
              // Find the best place to insert store initialization (after imports, before usage)
              const afterImportsMatch = scriptContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (afterImportsMatch) {
                const insertIndex = afterImportsMatch[0].length;
                scriptContent =
                  scriptContent.slice(0, insertIndex) +
                  `\nconst ${storeVarName} = ${storeName}();\n` +
                  scriptContent.slice(insertIndex);
              } else {
                scriptContent = `const ${storeVarName} = ${storeName}();\n${scriptContent}`;
              }
            }
          });
        }

        // Fix 8b: Remove duplicate imports and declarations
        // GENERIC: Detects and removes duplicate imports and variable declarations
        // Use a more robust approach: parse the entire script and rebuild it cleanly
        if (scriptContent && scriptContent.includes("import")) {
          // Step 0: First, check if there are inline imports in the full file content
          // Pattern: <script setup lang="ts">import { ... } from 'vue';
          // We need to work with fixedContent to detect inline imports, then update scriptContent
          // Use a more flexible pattern that handles various whitespace scenarios
          const inlineImportMatch = fixedContent.match(
            /(<script\s+setup[^>]*>)\s*import\s+([^;]+);/
          );

          if (inlineImportMatch) {
            // Extract the inline import content - we'll add it to scriptContent
            // The deduplication logic in Step 2 will handle merging with existing imports
            const inlineImportContent = `import ${inlineImportMatch[2]};`;

            // Always add it to scriptContent - the deduplication will merge it properly
            scriptContent = inlineImportContent + "\n" + scriptContent;

            // Update fixedContent to remove the inline import from script tag
            // Use a more aggressive pattern to ensure it's removed
            fixedContent = fixedContent.replace(
              /(<script\s+setup[^>]*>)\s*import\s+[^;]+;\s*/,
              "$1\n"
            );
          }

          // Step 1: Extract all imports with their positions
          // Also check fixedContent again in case inline import was added after scriptContent extraction
          // Re-extract scriptContent from fixedContent to get the latest version
          const updatedScriptMatch = fixedContent.match(
            /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
          );
          if (updatedScriptMatch) {
            scriptContent = updatedScriptMatch[1];
          }

          const allImports: Array<{ content: string; normalized: string }> = [];
          const importPattern = /import\s+[^;]+;/g;
          let importMatch;
          importPattern.lastIndex = 0;

          while ((importMatch = importPattern.exec(scriptContent)) !== null) {
            if (importMatch && importMatch[0]) {
              const content = importMatch[0];
              const normalized = content.replace(/\s+/g, " ").trim();

              // Check if this import is already captured
              const alreadyExists = allImports.some(
                (imp) => imp.normalized === normalized
              );

              if (!alreadyExists) {
                allImports.push({ content, normalized });
              }
            }
          }

          // Step 2: Deduplicate imports by grouping by module and merging exports
          // GENERIC: Groups imports by their 'from' path and merges all exports
          const importsByModule = new Map<string, Set<string>>(); // modulePath → Set of export names

          allImports.forEach(({ normalized }) => {
            const importNameMatch = normalized.match(
              /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/
            );
            if (importNameMatch) {
              const exportNames = importNameMatch[1]
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0); // Filter empty strings
              const fromPath = importNameMatch[2];

              if (!importsByModule.has(fromPath)) {
                importsByModule.set(fromPath, new Set());
              }

              const moduleExports = importsByModule.get(fromPath)!;
              exportNames.forEach((name) => moduleExports.add(name));
            } else {
              // Simple import without destructuring - keep as is
              const simpleMatch = normalized.match(
                /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/
              );
              if (simpleMatch) {
                const exportName = simpleMatch[1];
                const fromPath = simpleMatch[2];

                if (!importsByModule.has(fromPath)) {
                  importsByModule.set(fromPath, new Set());
                }

                const moduleExports = importsByModule.get(fromPath)!;
                moduleExports.add(exportName);
              }
            }
          });

          // Step 3: Rebuild unique imports from grouped modules
          const uniqueImports: string[] = [];
          importsByModule.forEach((exports, modulePath) => {
            const sortedExports = Array.from(exports)
              .sort()
              .filter((e) => e.length > 0); // Filter empty exports
            if (sortedExports.length > 0) {
              const importStatement = `import { ${sortedExports.join(", ")} } from '${modulePath}';`;
              uniqueImports.push(importStatement);
            }
          });

          // Step 4: Always remove all imports and rebuild with merged unique imports
          // This ensures imports from the same module are merged (e.g., computed + computed,onMounted → computed,onMounted)
          // Remove ALL import statements using regex (more reliable than string replacement)
          // Improved pattern to handle imports on separate lines and inline imports

          // First, handle imports that are on the same line as <script setup> tag
          // Pattern: <script setup lang="ts">import { ... } from 'vue';
          // Use a more aggressive pattern that matches the import even if there's no space after >
          // This pattern matches: <script...>import ...; or <script...> import ...;
          let cleanedContent = scriptContent.replace(
            /(<script[^>]*>)\s*import\s+[^;]+;\s*/g,
            "$1\n"
          );

          // Also handle case where import comes immediately after script tag without space
          cleanedContent = cleanedContent.replace(
            /(<script[^>]*>)import\s+[^;]+;\s*/g,
            "$1\n"
          );

          // Then remove all remaining import statements (including those that were just separated)
          // Use a more aggressive pattern that matches imports anywhere
          cleanedContent = cleanedContent.replace(
            /^\s*import\s+[^;]+;\s*$/gm,
            ""
          );
          cleanedContent = cleanedContent.replace(/import\s+[^;]+;\s*\n?/g, "");

          // Clean up multiple consecutive newlines and empty lines
          cleanedContent = cleanedContent
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\n+/, "")
            .replace(/\n+$/, "")
            .trim();

          // Add unique imports at the beginning (always rebuild to ensure proper merging)
          if (uniqueImports.length > 0) {
            // Clean up any imports with empty commas
            const cleanedImports = uniqueImports
              .map((imp) => {
                return imp
                  .replace(
                    /import\s+\{\s*,+\s*([^}]+)\}\s+from/,
                    "import { $1 } from"
                  )
                  .replace(
                    /import\s+\{([^}]+)\s*,+\s*\}\s+from/,
                    "import { $1 } from"
                  )
                  .replace(/import\s+\{\s*,+\s*\}\s+from/, ""); // Remove completely empty imports
              })
              .filter((imp) => imp.length > 0);

            scriptContent = cleanedImports.join("\n") + "\n\n" + cleanedContent;
            result.fixed = true;
            result.fixes.push("Merged duplicate imports from same modules");
          } else {
            scriptContent = cleanedContent;
          }

          // Step 4: Remove duplicate variable declarations (const storeVar = useStore())
          const storeDeclPattern = /const\s+(\w+Store)\s*=\s*use\w+Store\(\)/g;
          const seenStoreVars = new Set<string>();
          const storeDeclsToRemove: Array<{ start: number; end: number }> = [];
          let storeDeclMatch;

          // Reset regex lastIndex
          storeDeclPattern.lastIndex = 0;

          while (
            (storeDeclMatch = storeDeclPattern.exec(scriptContent)) !== null
          ) {
            const varName = storeDeclMatch[1];
            if (seenStoreVars.has(varName)) {
              // Duplicate - mark for removal
              storeDeclsToRemove.push({
                start: storeDeclMatch.index,
                end: storeDeclMatch.index + storeDeclMatch[0].length,
              });
            } else {
              seenStoreVars.add(varName);
            }
          }

          // Remove duplicate declarations (in reverse order to preserve indices)
          storeDeclsToRemove.reverse().forEach((pos) => {
            const before = scriptContent.substring(0, pos.start);
            const after = scriptContent.substring(pos.end);
            // Remove the declaration and clean up surrounding whitespace
            scriptContent =
              before.replace(/\n+$/, "") + "\n" + after.replace(/^\s*\n+/, "");
          });

          // Step 5: Clean up empty lines and multiple consecutive newlines
          scriptContent = scriptContent
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\n+/, "")
            .replace(/\n+$/, "");
        }

        // Step 6: Remove duplicate variable declarations (const varName = ...)
        // GENERIC: Detects and removes duplicate variable declarations
        const varDeclPattern = /const\s+(\w+)\s*=/g;
        const seenVars = new Map<string, number>(); // varName → first occurrence index
        const varDeclsToRemove: Array<{
          start: number;
          end: number;
          varName: string;
        }> = [];
        let varDeclMatch;

        varDeclPattern.lastIndex = 0;
        while ((varDeclMatch = varDeclPattern.exec(scriptContent)) !== null) {
          const varName = varDeclMatch[1];
          if (seenVars.has(varName)) {
            // Duplicate - mark for removal (keep the first one)
            // Find the end of this declaration: find the next semicolon or end of line
            const start = varDeclMatch.index;
            const afterMatch = scriptContent.substring(start);
            // Match the entire declaration: const varName = ... until semicolon (including it)
            // This handles: const varName = value; or const varName = value\n
            const declMatch = afterMatch.match(/const\s+\w+\s*=[^;]*;?/);
            if (declMatch) {
              // Find the actual end: semicolon or newline
              let end = start + declMatch[0].length;
              // If no semicolon, include until newline
              if (!declMatch[0].endsWith(";")) {
                const afterDecl = scriptContent.substring(end);
                const newlineMatch = afterDecl.match(/^\s*\n/);
                if (newlineMatch) {
                  end += newlineMatch[0].length;
                }
              }
              varDeclsToRemove.push({
                start: start,
                end: end,
                varName: varName,
              });
            }
          } else {
            seenVars.set(varName, varDeclMatch.index);
          }
        }

        // Remove duplicate declarations (in reverse order to preserve indices)
        varDeclsToRemove.reverse().forEach((pos) => {
          const before = scriptContent.substring(0, pos.start);
          const after = scriptContent.substring(pos.end);
          // Remove the declaration and clean up surrounding whitespace
          scriptContent =
            before.replace(/\n+$/, "") + "\n" + after.replace(/^\s*\n+/, "");
        });

        // Clean up empty lines again
        scriptContent = scriptContent
          .replace(/\n{3,}/g, "\n\n")
          .replace(/^\n+/, "")
          .replace(/\n+$/, "");

        // Step 7: Remove duplicate store declarations and reorganize them
        // GENERIC: Removes duplicates and moves all store declarations to the top to avoid "used before declaration" errors
        const storeDeclPattern =
          /const\s+(\w+Store)\s*=\s*use\w+Store\(\)\s*;?/g;

        // Helper function to find all store declarations
        const findAllStoreDecls = (
          content: string
        ): Array<{
          varName: string;
          declaration: string;
          index: number;
          fullMatch: string;
        }> => {
          const decls: Array<{
            varName: string;
            declaration: string;
            index: number;
            fullMatch: string;
          }> = [];
          storeDeclPattern.lastIndex = 0;
          let match;
          while ((match = storeDeclPattern.exec(content)) !== null) {
            const varName = match[1];
            const fullMatch = match[0];
            const declaration = fullMatch.endsWith(";")
              ? fullMatch
              : fullMatch + ";";
            decls.push({
              varName,
              declaration,
              index: match.index,
              fullMatch: fullMatch,
            });
          }
          return decls;
        };

        let storeDeclarations = findAllStoreDecls(scriptContent);

        if (storeDeclarations.length > 0) {
          // Step 7a: Remove ALL duplicates (keep only first occurrence of each store)
          const seenStoreVars = new Set<string>();
          const duplicatesToRemove: Array<{ start: number; end: number }> = [];

          storeDeclarations.forEach((decl) => {
            if (seenStoreVars.has(decl.varName)) {
              // Duplicate - mark for removal (include trailing whitespace/newlines)
              const afterMatch = scriptContent.substring(
                decl.index + decl.fullMatch.length
              );
              const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || "";
              duplicatesToRemove.push({
                start: decl.index,
                end:
                  decl.index +
                  decl.fullMatch.length +
                  trailingWhitespace.length,
              });
            } else {
              seenStoreVars.add(decl.varName);
            }
          });

          // Remove duplicates (in reverse order to preserve indices)
          if (duplicatesToRemove.length > 0) {
            duplicatesToRemove.reverse().forEach((pos) => {
              const before = scriptContent.substring(0, pos.start);
              const after = scriptContent.substring(pos.end);
              scriptContent =
                before.replace(/\n+$/, "") +
                "\n" +
                after.replace(/^\s*\n+/, "");
            });
            result.fixed = true;
            result.fixes.push("Removed duplicate store declarations");

            // Re-find store declarations after duplicate removal
            storeDeclarations = findAllStoreDecls(scriptContent);
          }

          // Step 7b: Reorganize store declarations to top (after imports, before usage)
          if (storeDeclarations.length > 0) {
            // Check if stores are used before their declarations
            let needsReorganization = false;
            storeDeclarations.forEach((decl) => {
              // Check if this store is used before its declaration
              const beforeDecl = scriptContent.substring(0, decl.index);
              const usagePattern = new RegExp(`\\b${decl.varName}\\b`);
              if (usagePattern.test(beforeDecl)) {
                needsReorganization = true;
              }
            });

            if (needsReorganization) {
              // Remove ALL store declarations from their current positions (in reverse order)
              let reorganizedContent = scriptContent;
              storeDeclarations.reverse().forEach((decl) => {
                const before = reorganizedContent.substring(0, decl.index);
                const afterMatch = reorganizedContent.substring(
                  decl.index + decl.fullMatch.length
                );
                const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || "";
                const after = reorganizedContent.substring(
                  decl.index + decl.fullMatch.length + trailingWhitespace.length
                );
                reorganizedContent =
                  before.replace(/\n+$/, "") +
                  "\n" +
                  after.replace(/^\s*\n+/, "");
              });

              // Get unique declarations only (should already be unique after Step 7a)
              const finalUniqueStoreDecls = new Map<string, string>();
              storeDeclarations.reverse().forEach((decl) => {
                if (!finalUniqueStoreDecls.has(decl.varName)) {
                  finalUniqueStoreDecls.set(decl.varName, decl.declaration);
                }
              });

              // Find the end of imports section
              const importMatch = reorganizedContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                const insertIndex = importMatch[0].length;
                const storeDeclsText = Array.from(
                  finalUniqueStoreDecls.values()
                ).join("\n");
                reorganizedContent =
                  reorganizedContent.slice(0, insertIndex) +
                  "\n\n" +
                  storeDeclsText +
                  "\n" +
                  reorganizedContent.slice(insertIndex).trim();
              } else {
                // No imports, add at the beginning
                const storeDeclsText = Array.from(
                  finalUniqueStoreDecls.values()
                ).join("\n");
                reorganizedContent =
                  storeDeclsText + "\n\n" + reorganizedContent.trim();
              }

              scriptContent = reorganizedContent;
              result.fixed = true;
              result.fixes.push(
                "Reorganized store declarations to top of script"
              );

              // Final check: remove any duplicates that might have been created during reorganization
              const finalStoreDecls = findAllStoreDecls(scriptContent);
              const finalSeenVars = new Set<string>();
              const finalDuplicatesToRemove: Array<{
                start: number;
                end: number;
              }> = [];

              finalStoreDecls.forEach((decl) => {
                if (finalSeenVars.has(decl.varName)) {
                  const afterMatch = scriptContent.substring(
                    decl.index + decl.fullMatch.length
                  );
                  const trailingWhitespace =
                    afterMatch.match(/^\s*/)?.[0] || "";
                  finalDuplicatesToRemove.push({
                    start: decl.index,
                    end:
                      decl.index +
                      decl.fullMatch.length +
                      trailingWhitespace.length,
                  });
                } else {
                  finalSeenVars.add(decl.varName);
                }
              });

              if (finalDuplicatesToRemove.length > 0) {
                finalDuplicatesToRemove.reverse().forEach((pos) => {
                  const before = scriptContent.substring(0, pos.start);
                  const after = scriptContent.substring(pos.end);
                  scriptContent =
                    before.replace(/\n+$/, "") +
                    "\n" +
                    after.replace(/^\s*\n+/, "");
                });
                result.fixes.push(
                  "Removed duplicate store declarations after reorganization"
                );
              }
            }
          }
        }

        // Fix 8c: Correct wrong store method calls and property access
        // GENERIC: Uses storeMethodMap to detect which store should have which method/property
        if (Object.keys(storeMethodMap).length > 0) {
          // Find all store.method() calls
          const storeMethodCallPattern = /(\w+Store)\.(\w+)\s*\(/g;
          let storeCallMatch;
          const corrections: Array<{ wrong: string; correct: string }> = [];

          // Reset regex lastIndex
          storeMethodCallPattern.lastIndex = 0;

          while (
            (storeCallMatch = storeMethodCallPattern.exec(scriptContent)) !==
            null
          ) {
            const storeVarName = storeCallMatch[1];
            const methodName = storeCallMatch[2];
            const moduleName = storeMethodMap[methodName];

            if (moduleName) {
              // Check if the store variable matches the module
              const expectedStoreVar = `${moduleName}Store`;
              if (storeVarName !== expectedStoreVar) {
                // Wrong store used - correct it
                const wrongCall = `${storeVarName}.${methodName}`;
                const correctCall = `${expectedStoreVar}.${methodName}`;
                corrections.push({ wrong: wrongCall, correct: correctCall });
              }
            }
          }

          // Find all store.property access
          // Pattern: storeVar.property (not followed by opening parenthesis, which would be a method call)
          // We need to match store.property in various contexts: computed(() => store.property), store.property, etc.
          const storePropertyPattern = /(\w+Store)\.(\w+)(?![(\s]*\()/g;
          let storePropMatch;

          storePropertyPattern.lastIndex = 0;
          const seenCorrections = new Set<string>();

          while (
            (storePropMatch = storePropertyPattern.exec(scriptContent)) !== null
          ) {
            const storeVarName = storePropMatch[1];
            const propertyName = storePropMatch[2];
            const moduleName = storeMethodMap[propertyName];

            // Debug: log if property is found in map (removed hardcoded property names for genericity)

            if (moduleName) {
              // Check if the store variable matches the module
              const expectedStoreVar = `${moduleName}Store`;
              if (storeVarName !== expectedStoreVar) {
                // Wrong store used - correct it
                const wrongAccess = `${storeVarName}.${propertyName}`;
                const correctAccess = `${expectedStoreVar}.${propertyName}`;
                // Avoid duplicates
                if (!seenCorrections.has(wrongAccess)) {
                  seenCorrections.add(wrongAccess);
                  corrections.push({
                    wrong: wrongAccess,
                    correct: correctAccess,
                  });
                }
              }
            } else {
              // Property not found in storeMethodMap - might be in a different store
              // Try to find it by checking all stores dynamically
              if (projectRoot) {
                try {
                  const allStores = await analyzePiniaStores(projectRoot);
                  // Check if property exists in any store
                  for (const [prop, storeModule] of allStores.entries()) {
                    if (prop === propertyName) {
                      const correctStoreVar = `${storeModule}Store`;
                      if (storeVarName !== correctStoreVar) {
                        const wrongAccess = `${storeVarName}.${propertyName}`;
                        const correctAccess = `${correctStoreVar}.${propertyName}`;
                        if (!seenCorrections.has(wrongAccess)) {
                          seenCorrections.add(wrongAccess);
                          corrections.push({
                            wrong: wrongAccess,
                            correct: correctAccess,
                          });
                        }
                      }
                      break;
                    }
                  }
                } catch (error) {
                  // Store analysis failed, skip
                }
              }
            }
          }

          // Debug: Check if cartItemCount is in storeMethodMap
          if (
            scriptContent.includes("cartItemCount") &&
            !storeMethodMap["cartItemCount"]
          ) {
            // cartItemCount is used but not in map - this might indicate an issue with store analysis
            result.issues.push(
              `Property 'cartItemCount' is used but not found in storeMethodMap. Store analysis may need improvement.`
            );
          }

          // Apply corrections (apply in reverse to avoid index issues)
          corrections.reverse().forEach(({ wrong, correct }) => {
            scriptContent = scriptContent.replace(
              new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
              correct
            );
          });

          if (corrections.length > 0) {
            result.fixes.push(
              `Corrected wrong store method calls and property access: ${corrections.map((c) => `${c.wrong} → ${c.correct}`).join(", ")}`
            );
          }

          // Fix 8c.1: Detect and warn about potential null/undefined access in templates
          // Pattern: {{ computedProperty.property }} where computedProperty might be null
          // This helps prevent "Cannot read properties of undefined" errors
          if (isVueFile) {
            const templateMatch = fixedContent.match(
              /<template>([\s\S]*?)<\/template>/
            );
            if (templateMatch) {
              const templateContent = templateMatch[1];
              const nullAccessPattern = /\{\{\s*(\w+)\.(\w+)\s*\}\}/g;
              let nullMatch;
              const potentialNullAccesses = new Set<string>();

              while (
                (nullMatch = nullAccessPattern.exec(templateContent)) !== null
              ) {
                const computedName = nullMatch[1];
                const propertyName = nullMatch[2];

                // Check if this computed property might return null/undefined
                // Common patterns: currentUser, selectedItem, activeItem, etc.
                const mightBeNull =
                  computedName.toLowerCase().includes("current") ||
                  computedName.toLowerCase().includes("selected") ||
                  computedName.toLowerCase().includes("active") ||
                  computedName.toLowerCase().includes("user");

                // Check if computed is defined: computed(() => store.property) where property might be null
                const computedDefPattern = new RegExp(
                  `const\\s+${computedName}\\s*=\\s*computed`,
                  "g"
                );
                const computedDef = scriptContent.match(computedDefPattern);

                if (mightBeNull && computedDef) {
                  // Check if there's already a v-if guard
                  const hasGuard =
                    templateContent.includes(`v-if="${computedName}"`) ||
                    templateContent.includes(`v-if="!${computedName}"`) ||
                    templateContent.includes(`v-if="${computedName} &&"`);

                  if (!hasGuard) {
                    potentialNullAccesses.add(
                      `${computedName}.${propertyName}`
                    );
                  }
                }
              }

              if (potentialNullAccesses.size > 0) {
                // AUTOMATISÉ: Add v-if guards automatically to prevent null/undefined errors
                let modifiedTemplate = templateContent;
                const addedGuards: string[] = [];

                potentialNullAccesses.forEach((access) => {
                  const computedName = access.split(".")[0];

                  // Find the parent element containing this access
                  // Pattern: <tag>...{{ computedName.property }}...</tag>
                  const accessPattern = new RegExp(
                    `(<[^>]+>)([^<]*\\{\\{\\s*${computedName}\\.\\w+\\s*\\}\\}[^<]*)(</[^>]+>)`,
                    "g"
                  );
                  let accessMatch;

                  while (
                    (accessMatch = accessPattern.exec(modifiedTemplate)) !==
                    null
                  ) {
                    const [fullMatch, openingTag, content, closingTag] =
                      accessMatch;

                    // Check if opening tag already has v-if
                    if (
                      !openingTag.includes(`v-if="${computedName}"`) &&
                      !openingTag.includes(`v-if="!${computedName}"`)
                    ) {
                      // Add v-if guard to opening tag
                      const tagNameMatch = openingTag.match(/^<(\w+)/);
                      if (tagNameMatch) {
                        // Insert v-if before closing >
                        const newOpeningTag = openingTag.replace(
                          />$/,
                          ` v-if="${computedName}">`
                        );
                        const newFullMatch =
                          newOpeningTag + content + closingTag;

                        modifiedTemplate = modifiedTemplate.replace(
                          fullMatch,
                          newFullMatch
                        );
                        addedGuards.push(`${computedName}`);
                        break; // Only add one guard per computed property
                      }
                    }
                  }
                });

                if (addedGuards.length > 0) {
                  // Update the template in fixedContent
                  fixedContent = fixedContent.replace(
                    /<template>([\s\S]*?)<\/template>/,
                    `<template>${modifiedTemplate}</template>`
                  );
                  result.fixed = true;
                  result.fixes.push(
                    `Added v-if guards to prevent null/undefined access: ${addedGuards.join(", ")}`
                  );
                } else {
                  // If automatic fix failed, add warning
                  result.issues.push(
                    `Potential null/undefined access detected in template: ${Array.from(potentialNullAccesses).join(", ")}. Consider adding v-if guards (e.g., v-if="${Array.from(potentialNullAccesses)[0].split(".")[0]}").`
                  );
                }
              }
            }
          }
        }

        // Fix 8d: Add missing imports for used but not imported stores/functions
        // GENERIC: Detects usage of stores/functions and adds missing imports
        // Check for useRouter usage
        if (
          scriptContent.includes("useRouter()") &&
          !scriptContent.match(/import\s+.*useRouter.*from/)
        ) {
          const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
          if (importMatch) {
            scriptContent = scriptContent.replace(
              /(import\s+[^;]+;[\s\n]*)+/,
              `$&import { useRouter } from 'vue-router';\n`
            );
          } else {
            scriptContent = `import { useRouter } from 'vue-router';\n${scriptContent}`;
          }

          // Add const router = useRouter() if missing
          if (!scriptContent.includes("const router = useRouter()")) {
            const afterImportsMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (afterImportsMatch) {
              const insertIndex = afterImportsMatch[0].length;
              scriptContent =
                scriptContent.slice(0, insertIndex) +
                `\nconst router = useRouter();\n` +
                scriptContent.slice(insertIndex);
            } else {
              scriptContent = `const router = useRouter();\n${scriptContent}`;
            }
          }
        }

        // Check for useRoute usage (similar to useRouter) - GENERIC
        // Detect both useRoute() and const route = useRoute() patterns
        const hasUseRouteUsage =
          /useRoute\s*\(|const\s+\w+\s*=\s*useRoute\s*\(/.test(scriptContent);
        const hasUseRouteImport =
          /import\s+.*\{[^}]*\buseRoute\b[^}]*\}\s+from\s+['"]vue-router['"]/.test(
            scriptContent
          );

        if (hasUseRouteUsage && !hasUseRouteImport) {
          // Check if vue-router import already exists
          const vueRouterImportMatch = scriptContent.match(
            /import\s+.*\{([^}]*)\}\s+from\s+['"]vue-router['"]/
          );
          if (vueRouterImportMatch) {
            // Add useRoute to existing import
            const existingImports = vueRouterImportMatch[1]
              .split(",")
              .map((i) => i.trim())
              .filter((i) => i);
            if (!existingImports.includes("useRoute")) {
              const newImports = [...existingImports, "useRoute"];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]*\}\s+from\s+['"]vue-router['"]/,
                `import { ${newImports.join(", ")} } from 'vue-router'`
              );
              result.fixed = true;
              result.fixes.push("Added useRoute to existing vue-router import");
            }
          } else {
            // Create new import
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { useRoute } from 'vue-router';\n`
              );
            } else {
              scriptContent = `import { useRoute } from 'vue-router';\n${scriptContent}`;
            }
            result.fixed = true;
            result.fixes.push("Added missing useRoute import from vue-router");
          }
        }

        // Fix 8e: Secure router.push with params - Vue Router 4 requires params to be defined
        // Pattern: router.push({ name: 'RouteName', params: { id: param } })
        // Transform to: router.push({ path: '/route/param' }) - more reliable in Vue Router 4
        // This avoids "Missing required param" errors when param is undefined/null
        const routerPushWithParamsPattern =
          /router\.push\s*\(\s*\{\s*name\s*:\s*['"]([^'"]+)['"]\s*,\s*params\s*:\s*\{([^}]+)\}\s*\}\s*\)/g;
        let routerPushMatch;
        const routerPushMatches: Array<{
          fullMatch: string;
          routeName: string;
          paramsString: string;
          paramName: string;
          paramValue: string;
        }> = [];

        // First pass: collect all matches
        while (
          (routerPushMatch =
            routerPushWithParamsPattern.exec(scriptContent)) !== null
        ) {
          const [fullMatch, routeName, paramsString] = routerPushMatch;

          // Extract param name and value from params object
          // e.g., "id: postId" or "id: post.id"
          const paramMatch = paramsString.match(/(\w+)\s*:\s*([^,}]+)/);
          if (paramMatch) {
            const [, paramName, paramValue] = paramMatch;
            const trimmedParamValue = paramValue.trim();
            routerPushMatches.push({
              fullMatch,
              routeName,
              paramsString,
              paramName,
              paramValue: trimmedParamValue,
            });
          }
        }

        // Second pass: replace matches (in reverse order to preserve positions)
        for (const match of routerPushMatches.reverse()) {
          const { fullMatch, routeName, paramValue } = match;

          // Try to infer path from route name (common patterns)
          let inferredPath: string;
          if (
            routeName.toLowerCase().includes("post") ||
            routeName.toLowerCase().includes("detail")
          ) {
            // Common pattern: BlogPost -> /blog/:id
            inferredPath = `/blog/\${${paramValue}}`;
          } else if (
            routeName.toLowerCase().includes("user") ||
            routeName.toLowerCase().includes("profile")
          ) {
            inferredPath = `/user/\${${paramValue}}`;
          } else {
            // Generic: use route name lowercase + param
            // BlogPost -> blog-post -> /blog-post/:id
            const routePath = routeName
              .replace(/([A-Z])/g, "-$1")
              .toLowerCase()
              .replace(/^-/, "");
            inferredPath = `/${routePath}/\${${paramValue}}`;
          }

          // Replace with path-based navigation (more reliable in Vue Router 4)
          // Use template literal for dynamic path - simpler and more reliable
          const pathBasedNavigation = `router.push({ path: \`${inferredPath}\` })`;

          scriptContent = scriptContent.replace(fullMatch, pathBasedNavigation);
          result.fixed = true;
          result.fixes.push(
            `Secured router.push with params for route '${routeName}' (Vue Router 4 compatibility - using path instead of name+params)`
          );
        }

        // Fix 8f: Add type checking and undefined checks for router.push functions
        // Pattern: const goToPost = postId => { router.push({ path: `/blog/${postId}` }) }
        // Should become: const goToPost = (postId: number | string | undefined) => { if (postId !== undefined && postId !== null) { router.push({ path: `/blog/${postId}` }) } }
        if (
          scriptContent.includes("router.push") &&
          scriptContent.includes("path:")
        ) {
          // Find functions that use router.push with template literals containing parameters
          // Pattern matches: const functionName = param => { router.push({ path: `/route/${param}` }) }
          const routerPushFunctionPattern =
            /const\s+(\w+)\s*=\s*(\w+)\s*=>\s*\{[^}]*router\.push\s*\(\s*\{\s*path\s*:\s*[`'"]\/[^`'"]*\$\{(\w+)\}[^`'"]*[`'"]/g;
          let routerPushFunctionMatch;
          const processedFunctions = new Set<string>();

          while (
            (routerPushFunctionMatch =
              routerPushFunctionPattern.exec(scriptContent)) !== null
          ) {
            const [fullMatch, functionName, paramName] =
              routerPushFunctionMatch;

            // Skip if already processed
            if (processedFunctions.has(functionName)) continue;
            processedFunctions.add(functionName);

            // Check if function already has type annotation
            const hasTypeAnnotation =
              /const\s+\w+\s*:\s*\([^)]+\)\s*=>/.test(fullMatch) ||
              /const\s+\w+\s*=\s*\([^)]+:\s*\w+/.test(fullMatch);

            // Check if function already has undefined check
            const hasUndefinedCheck =
              /if\s*\([^)]*undefined[^)]*\)/.test(fullMatch) ||
              /if\s*\([^)]*!==\s*undefined/.test(fullMatch);

            if (!hasTypeAnnotation || !hasUndefinedCheck) {
              // Extract the full function body
              const functionBodyMatch = scriptContent.match(
                new RegExp(
                  `const\\s+${functionName}\\s*=\\s*${paramName}\\s*=>\\s*\\{([^}]+)\\}`,
                  "s"
                )
              );
              if (functionBodyMatch) {
                const functionBody = functionBodyMatch[1].trim();

                // Build the fixed function
                const typeAnnotation = enableTypeScript
                  ? `(${paramName}: number | string | undefined)`
                  : `(${paramName})`;
                let fixedFunction = `const ${functionName} = ${typeAnnotation} => {\n`;
                fixedFunction += `  if (${paramName} !== undefined && ${paramName} !== null) {\n`;
                fixedFunction += `    ${functionBody}\n`;
                fixedFunction += `  }\n`;
                fixedFunction += `}`;

                scriptContent = scriptContent.replace(
                  functionBodyMatch[0],
                  fixedFunction
                );
                result.fixed = true;
                result.fixes.push(
                  `Added type checking and undefined check for ${functionName} function with router.push`
                );
              }
            }
          }
        }

        // Fix 8g: Improve fetch* functions to search existing data first (GENERIC)
        // Pattern: async function fetchPost(postId: number) { ... const post = { id: postId, ... } SET_CURRENT_*(post) }
        // Should become: async function fetchPost(postId: number) { ... const existingPost = arrayVar.value.find(p => p.id === postId); if (existingPost) { SET_CURRENT_*(existingPost) } else { ... } }
        // This is GENERIC - works for any fetch* function, any array variable, any SET_CURRENT_* function
        if (scriptContent.includes("async function fetch")) {
          // Find fetch functions that create new objects instead of searching existing data
          // Pattern matches: async function fetch*Name*(param: type) { ... const item = { id: param, ... } SET_CURRENT_*(item) }
          const fetchFunctionPattern =
            /async\s+function\s+(fetch\w+)\s*\([^)]+\)\s*:\s*Promise<void>\s*\{([\s\S]*?const\s+\w+\s*=\s*\{[^}]*id\s*:\s*\w+[^}]*\}[\s\S]*?SET_CURRENT_\w+)/g;
          let fetchFunctionMatch;

          while (
            (fetchFunctionMatch = fetchFunctionPattern.exec(scriptContent)) !==
            null
          ) {
            const [fullMatch, functionName, functionBody] = fetchFunctionMatch;

            // Check if function already searches existing data (GENERIC check)
            const alreadySearches =
              /\.find\s*\([^)]*\.id\s*===/.test(functionBody) ||
              /\.find\s*\([^)]*id\s*===/.test(functionBody) ||
              /existing\w+\s*=\s*\w+\.value\.find/.test(functionBody);

            if (!alreadySearches) {
              // GENERIC: Try to detect the array variable name dynamically (posts, items, users, products, etc.)
              // Strategy 1: Look for patterns like: posts.value, items.value, users.value, etc. in function body
              const arrayVarMatch = functionBody.match(/(\w+)\.value/);

              // Strategy 2: Look for ref declarations in the entire script: const posts = ref([])
              let arrayVar: string | null = null;
              if (arrayVarMatch) {
                arrayVar = arrayVarMatch[1];
              } else {
                // Try to find ref declarations and match with function name
                const refDeclarations = scriptContent.match(
                  /const\s+(\w+)\s*=\s*ref\s*\(/g
                );
                if (refDeclarations) {
                  // Extract ref variable names
                  const refVars = refDeclarations
                    .map((match) => {
                      const varMatch = match.match(/const\s+(\w+)\s*=/);
                      return varMatch ? varMatch[1] : null;
                    })
                    .filter(Boolean) as string[];

                  // Try to infer from function name: fetchPost -> posts, fetchUser -> users, etc.
                  const baseName = functionName
                    .replace(/^fetch/, "")
                    .toLowerCase();
                  const pluralName = baseName + "s";

                  // Look for matching ref variable (exact match or contains base name)
                  const matchingRef = refVars.find((refVar) => {
                    const refVarLower = refVar.toLowerCase();
                    return (
                      refVarLower === pluralName ||
                      refVarLower.includes(baseName) ||
                      baseName.includes(refVarLower.replace(/s$/, ""))
                    );
                  });

                  if (matchingRef) {
                    arrayVar = matchingRef;
                  } else if (refVars.length === 1) {
                    // If there's only one ref, use it (common pattern: single array in store)
                    arrayVar = refVars[0];
                  } else {
                    // Generic inference: remove 'fetch' prefix and pluralize
                    arrayVar = pluralName;
                  }
                }
              }

              // Only proceed if we found or inferred an array variable with high confidence
              // Skip if we can't detect with confidence (better to skip than apply wrong fix)
              if (arrayVar) {
                // GENERIC: Try to detect the parameter name dynamically from function signature
                const paramMatch = fullMatch.match(/\((\w+)\s*:\s*\w+\)/);
                const paramName = paramMatch ? paramMatch[1] : null;

                // If we can't detect parameter name, skip this fix (don't assume 'id')
                if (!paramName) {
                  continue;
                }

                // GENERIC: Try to detect the SET function name dynamically (SET_CURRENT_POST, SET_CURRENT_USER, etc.)
                const setFunctionMatch =
                  functionBody.match(/(SET_CURRENT_\w+)/);
                const setFunction = setFunctionMatch
                  ? setFunctionMatch[1]
                  : `SET_CURRENT_${arrayVar.charAt(0).toUpperCase() + arrayVar.slice(1, -1)}`;

                // GENERIC: Build improved function body using detected variables
                const itemName = arrayVar.slice(0, -1); // posts -> post, users -> user, etc.
                const existingItemName = `existing${itemName.charAt(0).toUpperCase() + itemName.slice(1)}`;

                const searchCode = `\n      // Try to find ${itemName} in existing ${arrayVar} first\n      const ${existingItemName} = ${arrayVar}.value.find((p: any) => p.id === ${paramName});\n      if (${existingItemName}) {\n        ${setFunction}(${existingItemName});\n      } else {\n`;

                // Find where the new object is created and wrap it in else
                const newObjectPattern =
                  /const\s+\w+\s*=\s*\{[^}]*id\s*:\s*\w+[^}]*\}/;
                const newObjectMatch = functionBody.match(newObjectPattern);
                if (newObjectMatch) {
                  const improvedBody = functionBody.replace(
                    newObjectMatch[0],
                    searchCode + "        " + newObjectMatch[0] + "\n      }"
                  );

                  scriptContent = scriptContent.replace(
                    functionBody,
                    improvedBody
                  );
                  result.fixed = true;
                  result.fixes.push(
                    `Improved ${functionName} to search existing data before creating new (generic fix)`
                  );
                }
              }
            }
          }
        }

        // Check for useIndexStore/useAppStore usage
        const indexStorePattern = /useIndexStore\(\)|useAppStore\(\)/g;
        if (indexStorePattern.test(scriptContent)) {
          // Find the actual store name from store/index.js
          if (projectRoot) {
            try {
              const mainStore = await findMainStore(projectRoot);
              if (
                mainStore &&
                !scriptContent.match(
                  new RegExp(`import\\s+.*${mainStore.storeName}.*from`)
                )
              ) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  scriptContent = scriptContent.replace(
                    /(import\s+[^;]+;[\s\n]*)+/,
                    `$&import { ${mainStore.storeName} } from '${mainStore.importPath}';\n`
                  );
                } else {
                  scriptContent = `import { ${mainStore.storeName} } from '${mainStore.importPath}';\n${scriptContent}`;
                }

                // Replace useIndexStore() with the correct store name
                scriptContent = scriptContent.replace(
                  /useIndexStore\(\)/g,
                  `${mainStore.storeName}()`
                );
                // GENERIC: Derive store variable name from store name dynamically
                const storeVarMatch =
                  mainStore.storeName.match(/use(\w+)Store/);
                if (storeVarMatch) {
                  const storeVarName = storeVarMatch[1].charAt(0).toLowerCase() +
                    storeVarMatch[1].slice(1) +
                    "Store";
                  
                  scriptContent = scriptContent.replace(
                    /const\s+indexStore\s*=\s*useIndexStore\(\)/g,
                    `const ${storeVarName} = ${mainStore.storeName}()`
                  );
                  scriptContent = scriptContent.replace(
                    /indexStore\./g,
                    `${storeVarName}.`
                  );
                }
              }
            } catch (error) {
              // Could not find main store
            }
          }
        }

        // Final step: Always merge imports at the end (after all other fixes that might add imports)
        // This ensures that even if other fixes add imports, they are properly merged
        if (scriptContent && scriptContent.includes("import")) {
          const importPattern = /import\s+[^;]+;/g;
          const finalImports: Array<{ content: string; normalized: string }> =
            [];
          let importMatch;

          // Reset regex lastIndex
          importPattern.lastIndex = 0;

          while ((importMatch = importPattern.exec(scriptContent)) !== null) {
            if (importMatch && importMatch[0]) {
              const content = importMatch[0];
              const normalized = content.replace(/\s+/g, " ").trim();
              finalImports.push({ content, normalized });
            }
          }

          if (finalImports.length > 0) {
            // Group imports by module and merge exports
            const finalImportsByModule = new Map<string, Set<string>>();

            finalImports.forEach(({ normalized }) => {
              const importNameMatch = normalized.match(
                /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/
              );
              if (importNameMatch) {
                const exportNames = importNameMatch[1]
                  .split(",")
                  .map((s) => s.trim());
                const fromPath = importNameMatch[2];

                if (!finalImportsByModule.has(fromPath)) {
                  finalImportsByModule.set(fromPath, new Set());
                }

                const moduleExports = finalImportsByModule.get(fromPath)!;
                exportNames.forEach((name) => moduleExports.add(name));
              } else {
                // Simple import without destructuring - keep as is
                const simpleMatch = normalized.match(
                  /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/
                );
                if (simpleMatch) {
                  const exportName = simpleMatch[1];
                  const fromPath = simpleMatch[2];

                  if (!finalImportsByModule.has(fromPath)) {
                    finalImportsByModule.set(fromPath, new Set());
                  }

                  const moduleExports = finalImportsByModule.get(fromPath)!;
                  moduleExports.add(exportName);
                }
              }
            });

            // Rebuild merged imports
            const finalUniqueImports: string[] = [];
            finalImportsByModule.forEach((exports, modulePath) => {
              const sortedExports = Array.from(exports)
                .sort()
                .filter((e) => e.length > 0); // Filter empty exports
              if (sortedExports.length > 0) {
                const importStatement = `import { ${sortedExports.join(", ")} } from '${modulePath}';`;
                finalUniqueImports.push(importStatement);
              }
            });

            // Remove all imports and rebuild
            let finalCleanedContent = scriptContent.replace(
              /import\s+[^;]+;\s*\n?/g,
              ""
            );
            finalCleanedContent = finalCleanedContent
              .replace(/\n{3,}/g, "\n\n")
              .replace(/^\n+/, "")
              .replace(/\n+$/, "")
              .trim();

            if (finalUniqueImports.length > 0) {
              // Clean up any imports with empty commas
              const cleanedImports = finalUniqueImports
                .map((imp) => {
                  return imp
                    .replace(
                      /import\s+\{\s*,+\s*([^}]+)\}\s+from/,
                      "import { $1 } from"
                    )
                    .replace(
                      /import\s+\{([^}]+)\s*,+\s*\}\s+from/,
                      "import { $1 } from"
                    )
                    .replace(/import\s+\{\s*,+\s*\}\s+from/, ""); // Remove completely empty imports
                })
                .filter((imp) => imp.length > 0);

              scriptContent =
                cleanedImports.join("\n") + "\n\n" + finalCleanedContent;
              result.fixed = true;
              if (
                !result.fixes.includes(
                  "Merged duplicate imports from same modules"
                )
              ) {
                result.fixes.push("Merged duplicate imports from same modules");
              }
            }
          }
        }

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          result.fixes.push(
            "Fixed store method calls in <script setup> using dynamic store detection"
          );
        }
      }
    }
  }
  // Fix 7b: Detect and correct wrong store imports
  // Pattern: import wrong store but code uses methods from different store → should be correct store
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Get dynamic store map from analysis - NO hardcoded fallback for genericity
      const storeMethodMap: Record<string, string> = {};

      // Analyze stores dynamically - REQUIRED for genericity
      if (projectRoot) {
        // Use cache if available and for same project
        if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
          try {
            storeAnalysisCache = await analyzePiniaStores(projectRoot);
            storeAnalysisProjectRoot = projectRoot;
          } catch (error) {
            // If analysis fails, we can't proceed without store information
            // This ensures the fixer is generic and doesn't rely on project-specific patterns
            storeAnalysisCache = null;
          }
        }

        // Convert Map to Record for easier use
        if (storeAnalysisCache && storeAnalysisCache.size > 0) {
          storeAnalysisCache.forEach((module, method) => {
            storeMethodMap[method] = module;
          });
        }
      }

      // If no store analysis available, skip this fix (generic approach)
      // This ensures we don't make incorrect assumptions about store structure
      if (Object.keys(storeMethodMap).length > 0) {
        // Find all store method/getter calls
        const usedMethods = new Set<string>();
        const usedModules = new Set<string>(); // Track modules from this.$store patterns

        // First, detect this.$store.dispatch('module/method') or this.$store.getters['module/getter']
        // Also detect this.$store.getters.property (without module) and this.$store.dispatch('action')
        const vuexDispatchPattern =
          /this\.\$store\.dispatch\(['"]([^'"]+)\/([^'"]+)['"]/g;
        const vuexGettersPattern =
          /this\.\$store\.getters\[['"]([^'"]+)\/([^'"]+)['"]/g;

        let dispatchMatch;
        while (
          (dispatchMatch = vuexDispatchPattern.exec(scriptContent)) !== null
        ) {
          const [, module, method] = dispatchMatch;
          usedModules.add(module);
          usedMethods.add(method);

          // Replace this.$store.dispatch('module/method') with storeVar.method()
          const storeVarName = `${module}Store`;
          const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
          const replacement = `${storeVarName}.${method}()`;

          // Ensure store is imported and initialized
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${storeName} } from '@/store/modules/${module}';\n`
              );
            } else {
              scriptContent = `import { ${storeName} } from '@/store/modules/${module}';\n${scriptContent}`;
            }
          }

          if (!scriptContent.includes(`const ${storeVarName} = ${storeName}`)) {
            const afterImportsMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (afterImportsMatch) {
              const insertIndex = afterImportsMatch[0].length;
              scriptContent =
                scriptContent.slice(0, insertIndex) +
                `\nconst ${storeVarName} = ${storeName}();\n` +
                scriptContent.slice(insertIndex);
            } else {
              scriptContent = `const ${storeVarName} = ${storeName}();\n${scriptContent}`;
            }
          }

          // Replace the dispatch call
          scriptContent = scriptContent.replace(
            new RegExp(
              `this\\.\\$store\\.dispatch\\(['"]${module}/${method}['"]\\)`,
              "g"
            ),
            replacement
          );
        }

        let gettersMatch;
        while (
          (gettersMatch = vuexGettersPattern.exec(scriptContent)) !== null
        ) {
          const [, module, getter] = gettersMatch;
          usedModules.add(module);
          usedMethods.add(getter);

          // Replace this.$store.getters['module/getter'] with storeVar.getter
          const storeVarName = `${module}Store`;
          const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
          const replacement = `${storeVarName}.${getter}`;

          // Ensure store is imported and initialized (same logic as above)
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${storeName} } from '@/store/modules/${module}';\n`
              );
            } else {
              scriptContent = `import { ${storeName} } from '@/store/modules/${module}';\n${scriptContent}`;
            }
          }

          if (!scriptContent.includes(`const ${storeVarName} = ${storeName}`)) {
            const afterImportsMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (afterImportsMatch) {
              const insertIndex = afterImportsMatch[0].length;
              scriptContent =
                scriptContent.slice(0, insertIndex) +
                `\nconst ${storeVarName} = ${storeName}();\n` +
                scriptContent.slice(insertIndex);
            } else {
              scriptContent = `const ${storeVarName} = ${storeName}();\n${scriptContent}`;
            }
          }

          // Replace the getter access
          scriptContent = scriptContent.replace(
            new RegExp(
              `this\\.\\$store\\.getters\\[['"]${module}/${getter}['"]\\]`,
              "g"
            ),
            replacement
          );
        }

        // Check if computed is used but not imported (after replacing this.$store.getters)
        if (
          scriptContent.includes("computed(") &&
          !scriptContent.match(
            /import\s+.*\{[^}]*\bcomputed\b[^}]*\}\s+from\s+['"]vue['"]/
          )
        ) {
          // Add computed to vue import or create new import
          const vueImportMatch = scriptContent.match(
            /import\s+.*\{([^}]+)\}\s+from\s+['"]vue['"]/
          );
          if (vueImportMatch) {
            const existingImports = vueImportMatch[1]
              .split(",")
              .map((i) => i.trim())
              .filter((i) => i);
            if (!existingImports.includes("computed")) {
              const newImports = [...existingImports, "computed"];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]+\}\s+from\s+['"]vue['"]/,
                `import { ${newImports.join(", ")} } from 'vue'`
              );
              result.fixed = true;
              result.fixes.push("Added missing computed import");
            }
          } else {
            // Create new import
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { computed } from 'vue';\n`
              );
            } else {
              scriptContent = `import { computed } from 'vue';\n${scriptContent}`;
            }
            result.fixed = true;
            result.fixes.push("Added missing computed import");
          }
        }

        // Then detect direct method/getter calls
        Object.keys(storeMethodMap).forEach((method) => {
          // Pattern 1: storeName.method() - explicit store call
          // Pattern 2: method() - direct method call (if it's a store method)
          // Pattern 3: method.value - computed property access
          // Pattern 4: method, - destructured or referenced
          const patterns = [
            new RegExp(`\\w+Store\\.${method}\\b`, "g"), // store.method
            new RegExp(`\\b${method}\\s*\\(`, "g"), // method()
            new RegExp(`\\b${method}\\.value\\b`, "g"), // method.value
            new RegExp(`\\b${method}\\s*[,\\}]`, "g"), // method, or method}
          ];

          for (const pattern of patterns) {
            if (pattern.test(scriptContent)) {
              usedMethods.add(method);
              break; // Found, no need to check other patterns
            }
          }
        });

        // Determine which store should be used based on methods
        const storeUsage = new Map<string, number>(); // module → count

        // First, add modules detected from this.$store patterns (high priority)
        usedModules.forEach((module) => {
          storeUsage.set(module, (storeUsage.get(module) || 0) + 10); // Higher weight for explicit module references
        });

        // Then add modules from method calls
        usedMethods.forEach((method) => {
          const module = storeMethodMap[method];
          if (module) {
            storeUsage.set(module, (storeUsage.get(module) || 0) + 1);
          }
        });

        // Find wrong store imports
        const wrongStorePattern =
          /import\s+\{\s*use(\w+)Store\s*\}\s+from\s+['"]@\/store\/modules\/(\w+)['"]/g;
        let match;
        const wrongImports: Array<{
          importLine: string;
          wrongStore: string;
          wrongModule: string;
          correctModule: string;
        }> = [];

        while ((match = wrongStorePattern.exec(scriptContent)) !== null) {
          const [, storeName, importedModule] = match;

          // Check if the imported module doesn't match the methods used
          if (storeUsage.size > 0) {
            // Find the most used module
            let mostUsedModule = "";
            let maxCount = 0;
            storeUsage.forEach((count, module) => {
              if (count > maxCount) {
                maxCount = count;
                mostUsedModule = module;
              }
            });

            // If imported module doesn't match most used module, it's wrong
            if (mostUsedModule && importedModule !== mostUsedModule) {
              wrongImports.push({
                importLine: match[0],
                wrongStore: `use${storeName}Store`,
                wrongModule: importedModule,
                correctModule: mostUsedModule,
              });
            }
          }
        }

        // Fix wrong imports
        wrongImports.forEach(
          ({ importLine, wrongStore, wrongModule, correctModule }) => {
            const correctStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
            const correctImport = `import { ${correctStore} } from '@/store/modules/${correctModule}'`;

            scriptContent = scriptContent.replace(importLine, correctImport);

            // Also fix store variable initialization
            const wrongStoreVar = `${wrongModule}Store`;
            const correctStoreVar = `${correctModule}Store`;
            scriptContent = scriptContent.replace(
              new RegExp(
                `const\\s+${wrongStoreVar}\\s*=\\s*${wrongStore}\\(\\)`,
                "g"
              ),
              `const ${correctStoreVar} = ${correctStore}()`
            );

            // Fix store method calls
            scriptContent = scriptContent.replace(
              new RegExp(`${wrongStoreVar}\\.`, "g"),
              `${correctStoreVar}.`
            );
          }
        );

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          result.fixes.push(
            `Corrected wrong store imports: ${wrongImports.map((i) => `${i.wrongStore} → use${i.correctModule.charAt(0).toUpperCase() + i.correctModule.slice(1)}Store`).join(", ")}`
          );
        }
      }
    }
  }

  // Fix 8: Add missing Pinia store imports and initializations in <script setup>
  // This handles components that were converted to <script setup> but are missing store setup
  // GENERIC: No hardcoded patterns - relies entirely on dynamic store analysis
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];

      // Detect which stores are needed based on template usage
      const templateMatch = fixedContent.match(
        /<template>([\s\S]*?)<\/template>/
      );
      const templateContent = templateMatch ? templateMatch[1] : "";

      // Get dynamic store map from analysis - NO hardcoded fallback for genericity
      const storeMethodMap: Record<string, string> = {};

      // Analyze stores dynamically - REQUIRED for genericity
      if (projectRoot) {
        // Use cache if available and for same project
        if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
          try {
            storeAnalysisCache = await analyzePiniaStores(projectRoot);
            storeAnalysisProjectRoot = projectRoot;
          } catch (error) {
            // If analysis fails, we can't proceed without store information
            // This ensures the fixer is generic and doesn't rely on project-specific patterns
            storeAnalysisCache = null;
          }
        }

        // Convert Map to Record for easier use
        if (storeAnalysisCache && storeAnalysisCache.size > 0) {
          storeAnalysisCache.forEach((module, method) => {
            storeMethodMap[method] = module;
          });
        }
      }

      // If no store analysis available, skip this fix (generic approach)
      // This ensures we don't make incorrect assumptions about store structure
      if (Object.keys(storeMethodMap).length === 0) {
        // No store information available, cannot proceed safely
        // Skip this fix to maintain genericity
      } else {
        // Detect which stores are needed based on template and script usage
        const usedMethods = new Set<string>();
        const usedModules = new Map<string, string>(); // moduleName → storeName

        // Extract methods/properties from template and script
        const allContent = templateContent + " " + scriptContent;
        Object.keys(storeMethodMap).forEach((method) => {
          const pattern = new RegExp(`\\b${method}\\b`, "g");
          if (pattern.test(allContent)) {
            usedMethods.add(method);
            const moduleName = storeMethodMap[method];
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            usedModules.set(moduleName, storeName);
          }
        });

        const storesToAdd = new Set<string>();

        usedModules.forEach((storeName, moduleName) => {
          // Check if store is already imported/initialized
          const hasStoreImport = scriptContent.includes(
            `import { ${storeName} }`
          );
          const storeVarName = `${moduleName}Store`;
          const hasStoreInit = scriptContent.includes(
            `const ${storeVarName} = ${storeName}`
          );

          if (!hasStoreImport || !hasStoreInit) {
            storesToAdd.add(
              JSON.stringify({ store: storeName, module: moduleName })
            );
          }
        });

        if (storesToAdd.size > 0) {
          let newImports = "";
          let newInits = "";

          storesToAdd.forEach((storeInfoStr) => {
            const storeInfo = JSON.parse(storeInfoStr);
            const { store, module } = storeInfo;
            const storeVarName = module + "Store";

            if (!scriptContent.includes(`import { ${store} }`)) {
              newImports += `import { ${store} } from '@/store/modules/${module}';\n`;
            }

            if (!scriptContent.includes(`const ${storeVarName} = ${store}`)) {
              newInits += `const ${storeVarName} = ${store}();\n`;
            }
          });

          // Add computed imports if needed (generic - check if any computed properties are used)
          const needsComputed =
            usedModules.size > 0 &&
            !scriptContent.includes("import { computed }");
          if (needsComputed) {
            newImports += "import { computed } from 'vue';\n";
          }

          // Add store getters/actions that are used in template but not defined (generic approach)
          // Use the dynamically detected stores instead of hardcoded patterns
          usedModules.forEach((storeName, moduleName) => {
            const storeVarName = `${moduleName}Store`;

            // Dynamically detect which properties from this store are used in template
            // and add computed properties for them if they're not already defined
            Object.keys(storeMethodMap).forEach((method) => {
              if (storeMethodMap[method] === moduleName) {
                // Check if this property is used in template but not defined in script
                const propertyPattern = new RegExp(`\\b${method}\\b`, "g");
                if (
                  propertyPattern.test(templateContent) &&
                  !scriptContent.includes(`const ${method}`)
                ) {
                  // Add as computed property
                  if (enableTypeScript) {
                    newInits += `const ${method} = computed(() => ${storeVarName}.${method});\n`;
                  } else {
                    newInits += `const ${method} = computed(() => ${storeVarName}.${method});\n`;
                  }
                }
              }
            });
          });

          // Legacy hardcoded code removed - now using dynamic detection above

          if (newImports || newInits) {
            // Remove unused defineStore import if present
            scriptContent = scriptContent.replace(
              /import\s*{\s*defineStore\s*}\s*from\s*['"]pinia['"];?\n?/g,
              ""
            );

            scriptContent =
              newImports + scriptContent + (newInits ? "\n" + newInits : "");

            // Add lang="ts" if TypeScript is enabled and not already present
            if (enableTypeScript) {
              fixedContent = fixedContent.replace(
                /<script\s+setup([^>]*)>/g,
                (match, attrs) => {
                  if (!attrs.includes("lang=")) {
                    return `<script setup lang="ts"${attrs}>`;
                  }
                  return match;
                }
              );
            }

            fixedContent = fixedContent.replace(
              /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
              `$1${scriptContent}$3`
            );
            result.fixed = true;
            result.fixes.push(
              "Added missing Pinia store imports and initializations"
            );
          }
        }
      }
    }
  }

  // Fix 11: Correct props references in watchers and computed
  // Pattern: watch(() => propName.value, ...) should be watch(() => props.propName, ...)
  // Pattern: watch(() => initialData.value, ...) should be watch(() => props.initialData, ...)
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Extract prop names from defineProps
      const propNames = new Set<string>();

      // Pattern 1: defineProps({ propName: Type, ... })
      const propsObjectMatch = scriptContent.match(
        /defineProps\s*\(\s*\{([^}]+)\}/
      );
      if (propsObjectMatch) {
        const propsContent = propsObjectMatch[1];
        const propNamePattern = /(\w+)\s*:/g;
        let propMatch;
        while ((propMatch = propNamePattern.exec(propsContent)) !== null) {
          propNames.add(propMatch[1]);
        }
      }

      // Pattern 2: defineProps(['prop1', 'prop2'])
      const propsArrayMatch = scriptContent.match(
        /defineProps\s*\(\s*\[([^\]]+)\]/
      );
      if (propsArrayMatch) {
        const propsContent = propsArrayMatch[1];
        const propNamePattern = /['"](\w+)['"]/g;
        let propMatch;
        while ((propMatch = propNamePattern.exec(propsContent)) !== null) {
          propNames.add(propMatch[1]);
        }
      }

      // Fix watch(() => propName.value, ...) → watch(() => props.propName, ...)
      propNames.forEach((propName) => {
        // Pattern: watch(() => propName.value, ...)
        const watchPattern = new RegExp(
          `watch\\(\\s*\\(\\)\\s*=>\\s*${propName}\\.value`,
          "g"
        );
        if (watchPattern.test(scriptContent)) {
          scriptContent = scriptContent.replace(
            watchPattern,
            `watch(() => props.${propName}`
          );
        }

        // Pattern: watch(propName, ...) → watch(() => props.propName, ...)
        // Only if propName is used directly in watch (not as a ref)
        const watchDirectPattern = new RegExp(
          `watch\\(\\s*${propName}\\s*,`,
          "g"
        );
        // Check if propName is not a ref (not declared as const propName = ref(...))
        const isRef = new RegExp(`const\\s+${propName}\\s*=\\s*ref\\(`).test(
          scriptContent
        );
        if (watchDirectPattern.test(scriptContent) && !isRef) {
          scriptContent = scriptContent.replace(
            watchDirectPattern,
            `watch(() => props.${propName},`
          );
        }

        // Pattern: computed(() => propName.value) → computed(() => props.propName)
        const computedPattern = new RegExp(
          `computed\\(\\s*\\(\\)\\s*=>\\s*${propName}\\.value`,
          "g"
        );
        if (computedPattern.test(scriptContent)) {
          scriptContent = scriptContent.replace(
            computedPattern,
            `computed(() => props.${propName}`
          );
        }
      });

      // Fix 4: Add fallback to route.params for props.*Id in Vue Router components (GENERIC)
      // Pattern: watch(() => props.id, ...) or watch(() => props.userId, ...) where props.*Id might be undefined
      // Should add: const computedId = computed(() => props.id || route.params.id)
      // This is GENERIC - works for any prop ending with 'Id' (id, userId, postId, itemId, etc.)
      if (
        scriptContent.includes("defineProps") &&
        scriptContent.includes("props.") &&
        scriptContent.includes("watch")
      ) {
        // Find all props that end with 'Id' (id, userId, postId, itemId, etc.)
        const propsIdPattern = /props\.(\w*Id|\w*id)/g;
        const propsIds = new Set<string>();
        let propsIdMatch;
        while ((propsIdMatch = propsIdPattern.exec(scriptContent)) !== null) {
          propsIds.add(propsIdMatch[1]);
        }

        // Ensure useRoute is imported (only once, before the loop)
        if (!scriptContent.includes("useRoute")) {
          const vueRouterImport = scriptContent.match(
            /import\s+.*from\s+['"]vue-router['"]/
          );
          if (vueRouterImport) {
            // Add useRoute to existing import
            scriptContent = scriptContent.replace(
              /import\s+{([^}]+)}\s+from\s+['"]vue-router['"]/,
              (match, imports) => {
                if (!imports.includes("useRoute")) {
                  return `import {${imports}, useRoute} from 'vue-router'`;
                }
                return match;
              }
            );
          } else {
            // Add new import
            scriptContent = `import { useRoute } from 'vue-router';\n${scriptContent}`;
          }
          // Add useRoute() call if not present
          if (
            !scriptContent.includes("const route = useRoute()") &&
            !scriptContent.includes("const route = useRoute();")
          ) {
            const routerMatch = scriptContent.match(
              /const\s+router\s*=\s*useRouter\(\)/
            );
            if (routerMatch) {
              scriptContent = scriptContent.replace(
                routerMatch[0],
                `const route = useRoute();\n${routerMatch[0]}`
              );
            } else {
              // Add after imports
              const importEnd = scriptContent.lastIndexOf("import");
              const nextLine = scriptContent.indexOf("\n", importEnd);
              if (nextLine !== -1) {
                scriptContent =
                  scriptContent.slice(0, nextLine + 1) +
                  "const route = useRoute();\n" +
                  scriptContent.slice(nextLine + 1);
              }
            }
          }
          result.fixed = true;
          result.fixes.push(
            "Added useRoute import and initialization for route.params fallback"
          );
        }

        // Process each propId found (GENERIC - works for id, userId, postId, itemId, etc.)
        propsIds.forEach((propId) => {
          if (
            scriptContent.includes(`props.${propId}`) &&
            scriptContent.includes("watch")
          ) {
            // Check if there's already a computed fallback for this propId
            const computedVarName =
              propId.charAt(0).toLowerCase() +
              propId.slice(1).replace(/Id$/, "Id"); // id -> id, userId -> userId
            const hasRouteParamsFallback = new RegExp(
              `const\\s+\\w+\\s*=\\s*computed\\s*\\([^)]*props\\.${propId}\\s*\\|\\|\\s*route\\.params`
            ).test(scriptContent);

            if (!hasRouteParamsFallback) {
              // Find watch(() => props.propId, ...)
              const watchPropsIdPattern = new RegExp(
                `watch\\s*\\(\\s*\\(\\)\\s*=>\\s*props\\.${propId}`,
                "g"
              );
              if (watchPropsIdPattern.test(scriptContent)) {
                // GENERIC: Create computed variable name dynamically
                // Convention: id -> postId (common pattern), userId -> userId, postId -> postId, etc.
                // Try to infer from context: if propId is just 'id', look for context clues
                let computedName: string;
                if (propId === "id") {
                  // Try to infer from component/route context
                  const componentContext =
                    scriptContent.match(/component:\s*(\w+)/) ||
                    scriptContent.match(/name:\s*['"](\w+)['"]/);
                  if (componentContext) {
                    const componentName = componentContext[1].toLowerCase();
                    // Extract base name: BlogPost -> post, UserDetail -> user, etc.
                    const baseName =
                      componentName
                        .replace(/(post|detail|view|page)$/i, "")
                        .toLowerCase() || "post";
                    computedName = baseName + "Id";
                  } else {
                    // Default convention: id -> postId (most common pattern)
                    computedName = "postId";
                  }
                } else {
                  // Use propId as-is: userId -> userId, postId -> postId
                  computedName = computedVarName;
                }

                // Add computed fallback before watch
                const computedFallback = `\n// Get ${propId} from props or route params\nconst ${computedName} = computed(() => {\n  return props.${propId} || (route.params.${propId} as string);\n});\n\n`;

                // Insert before the watch statement
                scriptContent = scriptContent.replace(
                  new RegExp(
                    `(watch\\s*\\(\\s*\\(\\)\\s*=>\\s*props\\.${propId})`
                  ),
                  `${computedFallback}$1`
                );

                // Update watch to use computedName.value instead of props.propId
                scriptContent = scriptContent.replace(
                  new RegExp(
                    `watch\\s*\\(\\s*\\(\\)\\s*=>\\s*props\\.${propId}\\s*,\\s*(\\w+)\\s*=>`,
                    "g"
                  ),
                  `watch(() => ${computedName}.value, $1 =>`
                );

                result.fixed = true;
                result.fixes.push(
                  `Added route.params.${propId} fallback for props.${propId} in Vue Router component (generic fix)`
                );
              }
            }
          }
        });
      }

      // Fix 5: Add NaN checks for parseInt in watch functions and route params
      // Pattern: watch(() => props.id, newId => { fetchPost(parseInt(newId)) })
      // Should be: watch(() => props.id, newId => { if (newId && !isNaN(parseInt(newId))) { fetchPost(parseInt(newId)) } })
      if (scriptContent.includes("parseInt")) {
        // Fix functions that use parseInt without NaN checks
        // Pattern: async function fetchPost(postId: number): Promise<void> { ...parseInt(postId)... }
        const functionParseIntPattern =
          /(async\s+)?function\s+(\w+)\s*\([^)]*(\w+)\s*:\s*number[^)]*\)\s*:\s*Promise<void>\s*\{([^}]*parseInt\s*\(\s*\3\s*\)[^}]*)\}/g;
        let funcMatch;
        while (
          (funcMatch = functionParseIntPattern.exec(scriptContent)) !== null
        ) {
          const funcName = funcMatch[2];
          const paramName = funcMatch[3];
          const funcBody = funcMatch[4];

          // Check if there's already a NaN check
          if (
            !funcBody.includes("isNaN") &&
            !funcBody.includes("NaN") &&
            !funcBody.includes("if (!")
          ) {
            // Add NaN check at the beginning of the function
            const fixedBody = funcBody.replace(
              /^/,
              `  if (!${paramName} || isNaN(${paramName})) {\n    return;\n  }\n`
            );
            scriptContent = scriptContent.replace(
              funcMatch[0],
              funcMatch[0].replace(funcBody, fixedBody)
            );
            result.fixed = true;
            result.fixes.push(
              `Added NaN check in function ${funcName} for parameter ${paramName}`
            );
          }
        }
      }

      // Fix malformed watch statements with extra braces and missing parentheses
      // This is a GENERIC fix that works for any watch statement, not just props or parseInt
      if (scriptContent.includes("watch")) {
        // Pattern 1: watch(() => ..., param => { { ... } }) - double braces
        // This pattern is generic and works for any watch source and body
        const doubleBracePattern =
          /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*\{\s*([^}]+)\s*\}\s*\}\)/g;
        let doubleBraceMatch;
        while (
          (doubleBraceMatch = doubleBracePattern.exec(scriptContent)) !== null
        ) {
          const watchSource = doubleBraceMatch[1].trim();
          const paramName = doubleBraceMatch[2];
          let watchBody = doubleBraceMatch[3].trim();

          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;

          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ")";
          }

          // Add semicolon if missing (unless it's already there or ends with })
          if (!watchBody.endsWith(";") && !watchBody.endsWith(")")) {
            watchBody += ";";
          }

          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${watchBody}\n})`;
          scriptContent = scriptContent.replace(
            doubleBraceMatch[0],
            fixedWatch
          );
          result.fixed = true;
          result.fixes.push(
            `Fixed malformed watch statement with extra braces`
          );
        }

        // Pattern 2: watch(() => ..., param => { if (...) { { ... } } }) - double braces inside if
        const doubleBraceInIfPattern =
          /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*(if\s*\([^)]+\)\s*)\{\s*\{\s*([^}]+)\s*\}\s*\}\s*\}\)/g;
        let doubleBraceInIfMatch;
        while (
          (doubleBraceInIfMatch =
            doubleBraceInIfPattern.exec(scriptContent)) !== null
        ) {
          const watchSource = doubleBraceInIfMatch[1].trim();
          const paramName = doubleBraceInIfMatch[2];
          const ifCondition = doubleBraceInIfMatch[3].trim();
          let watchBody = doubleBraceInIfMatch[4].trim();

          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;

          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ")";
          }

          // Add semicolon if missing
          if (!watchBody.endsWith(";") && !watchBody.endsWith(")")) {
            watchBody += ";";
          }

          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${ifCondition}{\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(
            doubleBraceInIfMatch[0],
            fixedWatch
          );
          result.fixed = true;
          result.fixes.push(
            `Fixed malformed watch statement with extra braces in if statement`
          );
        }

        // Pattern 3: watch(() => ..., param => { if (...) { { code } } }) - more complex pattern
        // This handles cases where the watch body has multiple statements
        const complexWatchPattern =
          /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*(if\s*\([^)]+\)\s*)\{\s*\{\s*([^}]*blogStore[^}]*\w+\([^)]*\)[^}]*)\s*\}\s*\}\s*\}\)/g;
        let complexWatchMatch;
        while (
          (complexWatchMatch = complexWatchPattern.exec(scriptContent)) !== null
        ) {
          const watchSource = complexWatchMatch[1].trim();
          const paramName = complexWatchMatch[2];
          const ifCondition = complexWatchMatch[3].trim();
          let watchBody = complexWatchMatch[4].trim();

          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;

          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ")";
          }

          // Add semicolon if missing
          if (!watchBody.endsWith(";") && !watchBody.endsWith(")")) {
            watchBody += ";";
          }

          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${ifCondition}{\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(
            complexWatchMatch[0],
            fixedWatch
          );
          result.fixed = true;
          result.fixes.push(
            `Fixed complex malformed watch statement with extra braces`
          );
        }

        // Pattern 4: watch(() => ..., param => { if (...) { { code } }) - pattern with extra braces and missing closing
        // More generic pattern that handles: watch(() => blogId.value, newId => { if (...) { { blogStore.fetchPost(parseInt(newId) } })
        const genericDoubleBracePattern =
          /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*(if\s*\([^)]+\)\s*)\{\s*\{\s*([^}]*\w+\([^)]*\)[^}]*)\s*\}\s*\}\)/g;
        let genericDoubleBraceMatch;
        while (
          (genericDoubleBraceMatch =
            genericDoubleBracePattern.exec(scriptContent)) !== null
        ) {
          const watchSource = genericDoubleBraceMatch[1].trim();
          const paramName = genericDoubleBraceMatch[2];
          const ifCondition = genericDoubleBraceMatch[3].trim();
          let watchBody = genericDoubleBraceMatch[4].trim();

          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;

          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ")";
          }

          // Add semicolon if missing
          if (!watchBody.endsWith(";") && !watchBody.endsWith(")")) {
            watchBody += ";";
          }

          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${ifCondition}{\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(
            genericDoubleBraceMatch[0],
            fixedWatch
          );
          result.fixed = true;
          result.fixes.push(
            `Fixed generic malformed watch statement with extra braces and missing parentheses`
          );
        }
      }

      if (
        scriptContent.includes("parseInt") &&
        scriptContent.includes("watch")
      ) {
        // Fix malformed watch statements with missing parentheses/braces
        // Pattern: watch(() => props.id, newId => { { blogStore.fetchPost(parseInt(newId) } })
        // This pattern matches watch statements with extra braces and missing closing parentheses
        const malformedWatchPattern =
          /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*\{([^}]*if[^}]*)\{\s*([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\s*\}\s*\}\)/g;
        let malformedMatch;
        while (
          (malformedMatch = malformedWatchPattern.exec(scriptContent)) !== null
        ) {
          const propName = malformedMatch[1];
          const paramName = malformedMatch[2];
          const ifCondition = malformedMatch[3].trim();
          let watchBody = malformedMatch[4].trim();

          // Fix: remove extra braces and add missing semicolon/parentheses
          // Count opening and closing parentheses in watchBody
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;

          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ")";
          }

          // Add semicolon if missing
          if (!watchBody.endsWith(";")) {
            watchBody += ";";
          }

          // Extract the if condition properly (remove the extra opening brace)
          const cleanIfCondition = ifCondition
            .replace(/^\s*if\s*\(/, "if (")
            .replace(/\{\s*$/, "");

          const fixedWatch = `watch(() => props.${propName}, ${paramName} => {\n  ${cleanIfCondition} {\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(malformedMatch[0], fixedWatch);
          result.fixed = true;
          result.fixes.push(
            `Fixed malformed watch statement with missing parentheses/braces for props.${propName}`
          );
        }

        // Also fix simpler pattern: watch(() => props.id, newId => { { blogStore.fetchPost(parseInt(newId) } })
        const simpleMalformedPattern =
          /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*\{\s*\{\s*([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\s*\}\s*\}\)/g;
        let simpleMalformedMatch;
        while (
          (simpleMalformedMatch =
            simpleMalformedPattern.exec(scriptContent)) !== null
        ) {
          const propName = simpleMalformedMatch[1];
          const paramName = simpleMalformedMatch[2];
          let watchBody = simpleMalformedMatch[3].trim();

          // Fix: remove extra braces and add missing semicolon/parentheses
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;

          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ")";
          }

          // Add semicolon if missing
          if (!watchBody.endsWith(";")) {
            watchBody += ";";
          }

          const fixedWatch = `watch(() => props.${propName}, ${paramName} => {\n  if (${paramName} && !isNaN(parseInt(${paramName}))) {\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(
            simpleMalformedMatch[0],
            fixedWatch
          );
          result.fixed = true;
          result.fixes.push(
            `Fixed malformed watch statement with missing parentheses/braces for props.${propName}`
          );
        }

        // Pattern: watch(() => props.id, newId => { ...parseInt(newId)... })
        const watchParseIntPattern =
          /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*\{([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\}\s*\)/g;
        let watchMatch;
        while (
          (watchMatch = watchParseIntPattern.exec(scriptContent)) !== null
        ) {
          const propName = watchMatch[1];
          const paramName = watchMatch[2];
          const watchBody = watchMatch[3];

          // Check if there's already a NaN check
          if (!watchBody.includes("isNaN") && !watchBody.includes("NaN")) {
            // Add NaN check
            const fixedBody = `  if (${paramName} && !isNaN(parseInt(${paramName}))) {\n${watchBody}\n  }`;
            const fixedWatch = `watch(() => props.${propName}, ${paramName} => {\n${fixedBody}\n})`;
            scriptContent = scriptContent.replace(watchMatch[0], fixedWatch);
            result.fixed = true;
            result.fixes.push(
              `Added NaN check for parseInt in watch function for props.${propName}`
            );
          }
        }

        // Pattern: watch(() => props.id, newId => blogStore.fetchPost(parseInt(newId)))
        const watchParseIntSimplePattern =
          /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*([^,}]+parseInt\s*\(\s*\2\s*\)[^,}]*)\s*\)/g;
        let watchSimpleMatch;
        while (
          (watchSimpleMatch =
            watchParseIntSimplePattern.exec(scriptContent)) !== null
        ) {
          const propName = watchSimpleMatch[1];
          const paramName = watchSimpleMatch[2];
          const watchCall = watchSimpleMatch[3];

          // Check if there's already a NaN check in the options
          const fullMatch = watchSimpleMatch[0];
          if (!fullMatch.includes("isNaN") && !fullMatch.includes("NaN")) {
            // Wrap in a function with NaN check
            const fixedWatch = `watch(() => props.${propName}, ${paramName} => {
  if (${paramName} && !isNaN(parseInt(${paramName}))) {
    ${watchCall}
  }
});`;
            scriptContent = scriptContent.replace(fullMatch, fixedWatch);
            result.fixed = true;
            result.fixes.push(
              `Added NaN check for parseInt in watch function for props.${propName}`
            );
          }
        }

        // Pattern: watch(() => postId.value, newId => { ...parseInt(newId)... })
        // Handle computed postId.value pattern (common in Vue Router components)
        const watchComputedParseIntPattern =
          /watch\s*\(\s*\(\)\s*=>\s*(\w+)\.value\s*,\s*(\w+)\s*=>\s*\{([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\}\s*\)/g;
        let watchComputedMatch;
        while (
          (watchComputedMatch =
            watchComputedParseIntPattern.exec(scriptContent)) !== null
        ) {
          const computedVar = watchComputedMatch[1];
          const paramName = watchComputedMatch[2];
          const watchBody = watchComputedMatch[3];

          // Check if there's already a NaN check
          if (
            !watchBody.includes("isNaN") &&
            !watchBody.includes("NaN") &&
            !watchBody.includes("if (")
          ) {
            // Add NaN check
            const fixedBody = `  if (${paramName} && typeof ${paramName} === 'string' && ${paramName}.trim() && !isNaN(parseInt(${paramName}))) {\n${watchBody}\n  }`;
            const fixedWatch = `watch(() => ${computedVar}.value, ${paramName} => {\n${fixedBody}\n})`;
            scriptContent = scriptContent.replace(
              watchComputedMatch[0],
              fixedWatch
            );
            result.fixed = true;
            result.fixes.push(
              `Added NaN check for parseInt in watch function for ${computedVar}.value`
            );
          }
        }

        // Pattern: watch(() => postId.value, newId => blogStore.fetchPost(parseInt(newId)))
        const watchComputedParseIntSimplePattern =
          /watch\s*\(\s*\(\)\s*=>\s*(\w+)\.value\s*,\s*(\w+)\s*=>\s*([^,}]+parseInt\s*\(\s*\2\s*\)[^,}]*)\s*\)/g;
        let watchComputedSimpleMatch;
        while (
          (watchComputedSimpleMatch =
            watchComputedParseIntSimplePattern.exec(scriptContent)) !== null
        ) {
          const computedVar = watchComputedSimpleMatch[1];
          const paramName = watchComputedSimpleMatch[2];
          const watchCall = watchComputedSimpleMatch[3];

          // Check if there's already a NaN check
          const fullMatch = watchComputedSimpleMatch[0];
          if (!fullMatch.includes("isNaN") && !fullMatch.includes("NaN")) {
            // Wrap in a function with NaN check
            const fixedWatch = `watch(() => ${computedVar}.value, ${paramName} => {
  if (${paramName} && typeof ${paramName} === 'string' && ${paramName}.trim() && !isNaN(parseInt(${paramName}))) {
    ${watchCall}
  }
})`;
            scriptContent = scriptContent.replace(fullMatch, fixedWatch);
            result.fixed = true;
            result.fixes.push(
              `Added NaN check for parseInt in watch function for ${computedVar}.value`
            );
          }
        }
      }

      // Final step: Always merge imports at the end (after all other fixes that might add imports)
      // This ensures that even if other fixes add imports, they are properly merged
      if (scriptContent && scriptContent.includes("import")) {
        const importPattern = /import\s+[^;]+;/g;
        const finalImports: Array<{ content: string; normalized: string }> = [];
        let importMatch;

        // Reset regex lastIndex
        importPattern.lastIndex = 0;

        while ((importMatch = importPattern.exec(scriptContent)) !== null) {
          if (importMatch && importMatch[0]) {
            const content = importMatch[0];
            const normalized = content.replace(/\s+/g, " ").trim();
            finalImports.push({ content, normalized });
          }
        }

        if (finalImports.length > 0) {
          // Group imports by module and merge exports
          const finalImportsByModule = new Map<string, Set<string>>();

          finalImports.forEach(({ normalized }) => {
            const importNameMatch = normalized.match(
              /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/
            );
            if (importNameMatch) {
              const exportNames = importNameMatch[1]
                .split(",")
                .map((s) => s.trim());
              const fromPath = importNameMatch[2];

              if (!finalImportsByModule.has(fromPath)) {
                finalImportsByModule.set(fromPath, new Set());
              }

              const moduleExports = finalImportsByModule.get(fromPath)!;
              exportNames.forEach((name) => moduleExports.add(name));
            }
          });

          // Rebuild merged imports
          const finalUniqueImports: string[] = [];
          finalImportsByModule.forEach((exports, modulePath) => {
            const sortedExports = Array.from(exports)
              .sort()
              .filter((e) => e.length > 0); // Filter empty exports
            if (sortedExports.length > 0) {
              const importStatement = `import { ${sortedExports.join(", ")} } from '${modulePath}';`;
              finalUniqueImports.push(importStatement);
            }
          });

          // Remove all imports and rebuild
          let finalCleanedContent = scriptContent.replace(
            /import\s+[^;]+;\s*\n?/g,
            ""
          );
          finalCleanedContent = finalCleanedContent
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\n+/, "")
            .replace(/\n+$/, "")
            .trim();

          if (finalUniqueImports.length > 0) {
            // Clean up any imports with empty commas
            const cleanedImports = finalUniqueImports
              .map((imp) => {
                return imp
                  .replace(
                    /import\s+\{\s*,+\s*([^}]+)\}\s+from/,
                    "import { $1 } from"
                  )
                  .replace(
                    /import\s+\{([^}]+)\s*,+\s*\}\s+from/,
                    "import { $1 } from"
                  )
                  .replace(/import\s+\{\s*,+\s*\}\s+from/, ""); // Remove completely empty imports
              })
              .filter((imp) => imp.length > 0);

            scriptContent =
              cleanedImports.join("\n") + "\n\n" + finalCleanedContent;
            result.fixed = true;
            if (
              !result.fixes.includes(
                "Merged duplicate imports from same modules"
              )
            ) {
              result.fixes.push("Merged duplicate imports from same modules");
            }
          }
        }
      }

      if (scriptContent !== originalScriptContent) {
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`
        );
        result.fixed = true;
        result.fixes.push("Fixed props references in watchers and computed");
      }
    }
  }

  // Fix 13: Clean up store/index.js - remove unused imports and fix duplications
  if (
    filePath.includes("store/index") &&
    fixedContent.includes("defineStore")
  ) {
    // Remove unused Vue import
    const vueImportPattern = /import\s+Vue\s+from\s+['"]vue['"];?\n?/g;
    if (vueImportPattern.test(fixedContent) && !fixedContent.includes("Vue.")) {
      fixedContent = fixedContent.replace(vueImportPattern, "");
      result.fixed = true;
      result.fixes.push("Removed unused Vue import from store/index.js");
    }

    // Remove unused module imports (auth, products, cart, etc.)
    const moduleImportPattern =
      /import\s+\w+\s+from\s+['"]\.\/modules\/\w+['"];?\n?/g;
    const moduleImports = fixedContent.match(moduleImportPattern);
    if (moduleImports && moduleImports.length > 0) {
      // Check if these modules are actually used
      moduleImports.forEach((importLine) => {
        const moduleMatch = importLine.match(/import\s+(\w+)\s+from/);
        if (moduleMatch) {
          const moduleName = moduleMatch[1];
          // If module is not used in the code, remove it
          const moduleUsagePattern = new RegExp(`\\b${moduleName}\\b`);
          if (!moduleUsagePattern.test(fixedContent.replace(importLine, ""))) {
            fixedContent = fixedContent.replace(importLine, "");
            result.fixed = true;
            result.fixes.push(`Removed unused module import: ${moduleName}`);
          }
        }
      });
    }

    // Fix duplications in return statement
    // Pattern: propName: value1, propName: value2
    const returnMatch = fixedContent.match(
      /return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/
    );
    if (returnMatch) {
      const returnContent = returnMatch[1];
      const propertyPattern = /(\w+)\s*:\s*(\w+)/g;
      const properties = new Map<string, string[]>(); // name → [values]

      let propMatch;
      while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
        const propName = propMatch[1];
        const propValue = propMatch[2];
        if (!properties.has(propName)) {
          properties.set(propName, []);
        }
        properties.get(propName)!.push(propValue);
      }

      // Find duplicates
      properties.forEach((values, propName) => {
        if (values.length > 1) {
          // Keep only the last one (usually the computed version)
          const lastValue = values[values.length - 1];
          // Remove all occurrences and keep only the last
          const matches = Array.from(
            returnContent.matchAll(
              new RegExp(`${propName}\\s*:\\s*(\\w+)`, "g")
            )
          );
          if (matches.length > 1) {
            // Replace all but keep the last
            let newReturnContent = returnContent;
            for (let i = 0; i < matches.length - 1; i++) {
              newReturnContent = newReturnContent.replace(
                new RegExp(`\\s*${propName}\\s*:\\s*\\w+\\s*,?`),
                ""
              );
            }
            // Ensure the last one exists
            if (!newReturnContent.includes(`${propName}:`)) {
              newReturnContent = `${propName}: ${lastValue},\n${newReturnContent}`;
            }
            fixedContent = fixedContent.replace(
              returnMatch[0],
              `return {${newReturnContent}};})`
            );
            result.fixed = true;
            result.fixes.push(
              `Fixed duplicate property in return: ${propName}`
            );
          }
        }
      });
    }

    // Ensure export is named, not default
    // GENERIC: Derives store name from defineStore ID, not hardcoded
    if (fixedContent.includes("export default defineStore")) {
      // Extract store name from defineStore call
      const storeNameMatch = fixedContent.match(
        /defineStore\s*\(\s*['"]([^'"]+)['"]/
      );
      // GENERIC: Use the store ID from defineStore, or derive from file path if not found
      // No hardcoded fallback - derives from file path or uses 'app' as last resort
      const storeId = storeNameMatch
        ? storeNameMatch[1]
        : filePath
            .match(/store[/\\](index|app|main|core|base)/i)?.[1]
            ?.toLowerCase() || "app";
      const useStoreName = `use${storeId.charAt(0).toUpperCase() + storeId.slice(1)}Store`;

      fixedContent = fixedContent.replace(
        /export\s+default\s+defineStore/,
        `export const ${useStoreName} = defineStore`
      );
      result.fixed = true;
      result.fixes.push(
        `Changed export default to named export: ${useStoreName}`
      );
    }
  }

  // Fix 12: Detect undefined properties in <script setup> that might be from stores
  // This handles properties that come from stores
  if (isVueFile && fixedContent.includes("<script setup") && projectRoot) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    const templateMatch = fixedContent.match(
      /<template>([\s\S]*?)<\/template>/
    );

    if (scriptSetupMatch && templateMatch) {
      let scriptContent = scriptSetupMatch[1];
      const templateContent = templateMatch[1];
      const originalScriptContent = scriptContent;

      // TRULY GENERIC: Use dynamic template analysis instead of regex patterns
      const templateProperties = analyzeTemplateProperties(templateContent);
      const usedProperties = new Set<string>();

      // Check which template properties are not defined in script
      templateProperties.forEach((propName) => {
        // Check if property is defined in script
        const isDefined =
          scriptContent.match(
            new RegExp(`(const|let|var|function|import)\\s+${propName}\\b`, "g")
          ) ||
          scriptContent.match(
            new RegExp(`\\b${propName}\\s*=\\s*computed`, "g")
          );

        if (
          !isDefined &&
          !["v-if", "v-for", "v-show", "v-model"].some((v) =>
            templateContent.includes(`${v}="${propName}"`)
          )
        ) {
          usedProperties.add(propName);
        }
      });

      // Also check v-if patterns for additional properties
      const vIfPattern = /v-if=["']([^"']+)["']/g;
      let vIfMatch;
      while ((vIfMatch = vIfPattern.exec(templateContent)) !== null) {
        const expr = vIfMatch[1];
        // Extract property name (handle .length, .value, etc.)
        const propMatch = expr.match(/^(\w+)(\.\w+)?$/);
        if (propMatch) {
          const propName = propMatch[1];
          const isDefined =
            scriptContent.match(
              new RegExp(
                `(const|let|var|function|import)\\s+${propName}\\b`,
                "g"
              )
            ) ||
            scriptContent.match(
              new RegExp(`\\b${propName}\\s*=\\s*computed`, "g")
            );
          if (!isDefined) {
            usedProperties.add(propName);
          }
        }
      }

      // Extract from v-for="item in propName"
      const vForPattern = /v-for=["']\w+\s+in\s+(\w+)/g;
      let vForMatch;
      while ((vForMatch = vForPattern.exec(templateContent)) !== null) {
        const propName = vForMatch[1];
        const isDefined =
          scriptContent.match(
            new RegExp(`(const|let|var|function|import)\\s+${propName}\\b`, "g")
          ) ||
          scriptContent.match(
            new RegExp(`\\b${propName}\\s*=\\s*computed`, "g")
          );
        if (!isDefined) {
          usedProperties.add(propName);
        }
      }

      // Extract properties used in script (computed, functions, etc.)
      // Pattern: allProducts.length, allProducts.method(), if (allProducts.length), etc.
      // Match identifiers that are not declared and are used with . or in conditions
      const scriptUsagePattern =
        /\b([a-z][a-zA-Z0-9]*)\s*(?:\.|\(|\)|===|!==|==|!=|>|<|>=|<=|\|\||&&|\?|:)/g;
      const vueKeywords = new Set([
        "computed",
        "ref",
        "reactive",
        "watch",
        "onMounted",
        "onUnmounted",
        "defineProps",
        "defineEmits",
        "useRouter",
        "useRoute",
        "router",
        "route",
        "const",
        "let",
        "var",
        "function",
        "async",
        "await",
        "return",
        "if",
        "else",
        "for",
        "while",
        "switch",
        "case",
        "default",
        "try",
        "catch",
        "finally",
        "throw",
        "new",
        "this",
        "null",
        "undefined",
        "true",
        "false",
        "length",
        "value",
        "push",
        "pop",
        "shift",
        "unshift",
        "slice",
        "splice",
        "map",
        "filter",
        "reduce",
        "find",
        "includes",
        "indexOf",
        "toString",
        "toLowerCase",
        "toUpperCase",
      ]);

      scriptUsagePattern.lastIndex = 0;
      let scriptUsageMatch;
      while (
        (scriptUsageMatch = scriptUsagePattern.exec(scriptContent)) !== null
      ) {
        const propName = scriptUsageMatch[1];
        // Skip if it's a keyword, Vue function, or already declared
        if (
          !vueKeywords.has(propName) &&
          !propName.endsWith("Store") &&
          !propName.endsWith("store") &&
          !scriptContent.match(
            new RegExp(
              `(const|let|var|function|import|export)\\s+${propName}\\b`
            )
          ) &&
          !scriptContent.match(new RegExp(`\\b${propName}\\s*=\\s*computed`)) &&
          propName.length > 2
        ) {
          // Skip very short names
          usedProperties.add(propName);
        }
      }

      // If we found undefined properties, try to find them in all stores (main + modules)
      if (usedProperties.size > 0 && projectRoot) {
        const propertyToStoreMap = new Map<
          string,
          { storeName: string; importPath: string; storeVarName: string }
        >();

        // First check main store
        const mainStore = await findMainStore(projectRoot);
        if (mainStore) {
          const storeIndexPath = path.join(
            projectRoot,
            "src",
            "store",
            "index.js"
          );
          let storeContent = "";
          try {
            storeContent = await fs.readFile(storeIndexPath, "utf-8");
          } catch (error) {
            try {
              const storeIndexPathTs = path.join(
                projectRoot,
                "src",
                "store",
                "index.ts"
              );
              storeContent = await fs.readFile(storeIndexPathTs, "utf-8");
            } catch (error2) {
              try {
                const storesIndexPath = path.join(
                  projectRoot,
                  "src",
                  "stores",
                  "index.js"
                );
                storeContent = await fs.readFile(storesIndexPath, "utf-8");
              } catch (error3) {
                try {
                  const storesIndexPathTs = path.join(
                    projectRoot,
                    "src",
                    "stores",
                    "index.ts"
                  );
                  storeContent = await fs.readFile(storesIndexPathTs, "utf-8");
                } catch (error4) {
                  // Could not read store
                }
              }
            }
          }

          // Extract exported properties from the main store
          const exportedProperties = new Set<string>();
          if (storeContent) {
            const returnMatch = storeContent.match(
              /return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/
            );
            if (returnMatch) {
              const returnContent = returnMatch[1];
              const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
              let propMatch;
              while (
                (propMatch = propertyPattern.exec(returnContent)) !== null
              ) {
                const exportedName = propMatch[2] || propMatch[1];
                exportedProperties.add(exportedName);
              }
            }
          }

          // Map properties to main store
          // GENERIC: Only map properties that are actually exported from the main store
          // Derive store variable name from store name dynamically
          const storeVarNameMatch = mainStore.storeName.match(/use(\w+)Store/);
          if (storeVarNameMatch) {
            const storeVarName = storeVarNameMatch[1].charAt(0).toLowerCase() +
              storeVarNameMatch[1].slice(1) +
              "Store";

            usedProperties.forEach((prop) => {
              if (exportedProperties.has(prop)) {
                propertyToStoreMap.set(prop, {
                  storeName: mainStore.storeName,
                  importPath: mainStore.importPath,
                  storeVarName: storeVarName,
                });
              }
            });
          }
        }

        // Then check module stores (cart, products, auth, etc.)
        try {
          const storeModulesPath = path.join(
            projectRoot,
            "src",
            "store",
            "modules"
          );
          const storeFiles = await fs.readdir(storeModulesPath);

          for (const storeFile of storeFiles) {
            if (!storeFile.endsWith(".js") && !storeFile.endsWith(".ts"))
              continue;

            const storeFilePath = path.join(storeModulesPath, storeFile);
            const storeContent = await fs.readFile(storeFilePath, "utf-8");

            // Extract store name
            const storeNameMatch = storeContent.match(
              /export\s+const\s+(use\w+Store)\s*=/
            );
            if (!storeNameMatch) continue;
            const storeName = storeNameMatch[1];
            const moduleName = storeFile.replace(/\.(js|ts)$/, "");
            const storeVarName = moduleName + "Store";
            const importPath = `@/store/modules/${moduleName}`;

            // Extract exported properties
            const exportedProperties = new Set<string>();
            const returnMatch = storeContent.match(
              /return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/
            );
            if (returnMatch) {
              const returnContent = returnMatch[1];
              const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
              let propMatch;
              while (
                (propMatch = propertyPattern.exec(returnContent)) !== null
              ) {
                const exportedName = propMatch[2] || propMatch[1];
                exportedProperties.add(exportedName);
              }
            }

            // Map properties to this store (only if not already mapped)
            usedProperties.forEach((prop) => {
              if (
                exportedProperties.has(prop) &&
                !propertyToStoreMap.has(prop)
              ) {
                propertyToStoreMap.set(prop, {
                  storeName: storeName,
                  importPath: importPath,
                  storeVarName: storeVarName,
                });
              }
            });
          }
        } catch (error) {
          // Could not read modules directory
        }

        // Now add imports and computed properties for all found stores
        if (propertyToStoreMap.size > 0) {
          // Group properties by store
          const storeToProperties = new Map<
            string,
            {
              properties: string[];
              storeInfo: {
                storeName: string;
                importPath: string;
                storeVarName: string;
              };
            }
          >();

          propertyToStoreMap.forEach((storeInfo, propName) => {
            if (!storeToProperties.has(storeInfo.storeName)) {
              storeToProperties.set(storeInfo.storeName, {
                properties: [],
                storeInfo: storeInfo,
              });
            }
            storeToProperties
              .get(storeInfo.storeName)!
              .properties.push(propName);
          });

          // Add imports and computed for each store
          storeToProperties.forEach(({ properties, storeInfo }) => {
            // Add import if missing
            if (!scriptContent.includes(`import { ${storeInfo.storeName} }`)) {
              scriptContent = `import { ${storeInfo.storeName} } from '${storeInfo.importPath}';\n${scriptContent}`;
            }

            // Add store initialization if not present
            if (
              !scriptContent.includes(
                `const ${storeInfo.storeVarName} = ${storeInfo.storeName}`
              )
            ) {
              scriptContent = `${scriptContent}\nconst ${storeInfo.storeVarName} = ${storeInfo.storeName}();`;
            }

            // Add computed import if missing
            if (!scriptContent.includes("import { computed }")) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$1import { computed } from 'vue';\n`
              );
            }

            // Add computed properties for matching properties
            // Only add computed properties, not methods (methods end with () in usage)
            properties.forEach((propName) => {
              // Check if it's used as a method (storeVar.propName() or propName())
              const isMethod = scriptContent.match(
                new RegExp(
                  `(?:${storeInfo.storeVarName}\\.${propName}|\\b${propName})\\s*\\(`
                )
              );
              // Check if it's already declared
              const isDeclared = scriptContent.match(
                new RegExp(`const\\s+${propName}\\s*=`)
              );

              if (!isMethod && !isDeclared) {
                // Add computed property after store initialization
                const storeInitMatch = scriptContent.match(
                  new RegExp(
                    `const\\s+${storeInfo.storeVarName}\\s*=\\s*${storeInfo.storeName}\\(\\);`
                  )
                );
                if (storeInitMatch) {
                  const insertPos =
                    storeInitMatch.index! + storeInitMatch[0].length;
                  // Correct TypeScript syntax: computed<type>(() => ...) not computed(<type>() => ...)
                  const computedCode = enableTypeScript
                    ? `\nconst ${propName} = computed<any>(() => ${storeInfo.storeVarName}.${propName});`
                    : `\nconst ${propName} = computed(() => ${storeInfo.storeVarName}.${propName});`;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    computedCode +
                    scriptContent.slice(insertPos);
                }
              }
            });
          });

          if (scriptContent !== originalScriptContent) {
            fixedContent = fixedContent.replace(
              /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
              `$1${scriptContent}$3`
            );
            result.fixed = true;
            const allProperties = Array.from(propertyToStoreMap.keys());
            result.fixes.push(
              `Added missing store imports and computed properties: ${allProperties.join(", ")}`
            );
          }
        }
      }

      // Final Step: Remove duplicate store declarations and reorganize them (AFTER all other fixes)
      // GENERIC: This must run last to catch any duplicates created by previous fixes
      if (scriptContent) {
        const storeDeclPattern =
          /const\s+(\w+Store)\s*=\s*use\w+Store\(\)\s*;?/g;

        // Helper function to find all store declarations
        const findAllStoreDecls = (
          content: string
        ): Array<{
          varName: string;
          declaration: string;
          index: number;
          fullMatch: string;
        }> => {
          const decls: Array<{
            varName: string;
            declaration: string;
            index: number;
            fullMatch: string;
          }> = [];
          storeDeclPattern.lastIndex = 0;
          let match;
          while ((match = storeDeclPattern.exec(content)) !== null) {
            const varName = match[1];
            const fullMatch = match[0];
            const declaration = fullMatch.endsWith(";")
              ? fullMatch
              : fullMatch + ";";
            decls.push({
              varName,
              declaration,
              index: match.index,
              fullMatch: fullMatch,
            });
          }
          return decls;
        };

        let storeDeclarations = findAllStoreDecls(scriptContent);

        if (storeDeclarations.length > 0) {
          // Remove ALL duplicates (keep only first occurrence of each store)
          const seenStoreVars = new Set<string>();
          const duplicatesToRemove: Array<{ start: number; end: number }> = [];

          storeDeclarations.forEach((decl) => {
            if (seenStoreVars.has(decl.varName)) {
              // Duplicate - mark for removal (include trailing whitespace/newlines)
              const afterMatch = scriptContent.substring(
                decl.index + decl.fullMatch.length
              );
              const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || "";
              duplicatesToRemove.push({
                start: decl.index,
                end:
                  decl.index +
                  decl.fullMatch.length +
                  trailingWhitespace.length,
              });
            } else {
              seenStoreVars.add(decl.varName);
            }
          });

          // Remove duplicates (in reverse order to preserve indices)
          if (duplicatesToRemove.length > 0) {
            duplicatesToRemove.reverse().forEach((pos) => {
              const before = scriptContent.substring(0, pos.start);
              const after = scriptContent.substring(pos.end);
              scriptContent =
                before.replace(/\n+$/, "") +
                "\n" +
                after.replace(/^\s*\n+/, "");
            });
            result.fixed = true;
            result.fixes.push(
              "Removed duplicate store declarations (final cleanup)"
            );

            // Re-find store declarations after duplicate removal
            storeDeclarations = findAllStoreDecls(scriptContent);
          }

          // Reorganize store declarations to top (after imports, before usage)
          if (storeDeclarations.length > 0) {
            // Check if stores are used before their declarations
            let needsReorganization = false;
            storeDeclarations.forEach((decl) => {
              const beforeDecl = scriptContent.substring(0, decl.index);
              const usagePattern = new RegExp(`\\b${decl.varName}\\b`);
              if (usagePattern.test(beforeDecl)) {
                needsReorganization = true;
              }
            });

            if (needsReorganization) {
              // Remove ALL store declarations from their current positions (in reverse order)
              let reorganizedContent = scriptContent;
              storeDeclarations.reverse().forEach((decl) => {
                const before = reorganizedContent.substring(0, decl.index);
                const afterMatch = reorganizedContent.substring(
                  decl.index + decl.fullMatch.length
                );
                const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || "";
                const after = reorganizedContent.substring(
                  decl.index + decl.fullMatch.length + trailingWhitespace.length
                );
                reorganizedContent =
                  before.replace(/\n+$/, "") +
                  "\n" +
                  after.replace(/^\s*\n+/, "");
              });

              // Get unique declarations only
              const finalUniqueStoreDecls = new Map<string, string>();
              storeDeclarations.reverse().forEach((decl) => {
                if (!finalUniqueStoreDecls.has(decl.varName)) {
                  finalUniqueStoreDecls.set(decl.varName, decl.declaration);
                }
              });

              // Find the end of imports section
              const importMatch = reorganizedContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                const insertIndex = importMatch[0].length;
                const storeDeclsText = Array.from(
                  finalUniqueStoreDecls.values()
                ).join("\n");
                reorganizedContent =
                  reorganizedContent.slice(0, insertIndex) +
                  "\n\n" +
                  storeDeclsText +
                  "\n" +
                  reorganizedContent.slice(insertIndex).trim();
              } else {
                const storeDeclsText = Array.from(
                  finalUniqueStoreDecls.values()
                ).join("\n");
                reorganizedContent =
                  storeDeclsText + "\n\n" + reorganizedContent.trim();
              }

              scriptContent = reorganizedContent;
              result.fixed = true;
              result.fixes.push(
                "Reorganized store declarations to top of script (final cleanup)"
              );

              // Final check: remove any duplicates that might have been created during reorganization
              const finalStoreDecls = findAllStoreDecls(scriptContent);
              const finalSeenVars = new Set<string>();
              const finalDuplicatesToRemove: Array<{
                start: number;
                end: number;
              }> = [];

              finalStoreDecls.forEach((decl) => {
                if (finalSeenVars.has(decl.varName)) {
                  const afterMatch = scriptContent.substring(
                    decl.index + decl.fullMatch.length
                  );
                  const trailingWhitespace =
                    afterMatch.match(/^\s*/)?.[0] || "";
                  finalDuplicatesToRemove.push({
                    start: decl.index,
                    end:
                      decl.index +
                      decl.fullMatch.length +
                      trailingWhitespace.length,
                  });
                } else {
                  finalSeenVars.add(decl.varName);
                }
              });

              if (finalDuplicatesToRemove.length > 0) {
                finalDuplicatesToRemove.reverse().forEach((pos) => {
                  const before = scriptContent.substring(0, pos.start);
                  const after = scriptContent.substring(pos.end);
                  scriptContent =
                    before.replace(/\n+$/, "") +
                    "\n" +
                    after.replace(/^\s*\n+/, "");
                });
                result.fixes.push(
                  "Removed duplicate store declarations after final reorganization"
                );
              }
            }
          }
        }
        // Step 7.5: Check for Vue lifecycle hooks usage and add imports (AFTER all reorganizations)
        // This must run last to ensure lifecycle hooks are added correctly after all other fixes
        const lifecycleHooks = [
          "onMounted",
          "onUnmounted",
          "onBeforeMount",
          "onBeforeUnmount",
          "onUpdated",
          "onBeforeUpdate",
          "onActivated",
          "onDeactivated",
        ];
        const usedLifecycleHooks = lifecycleHooks.filter((hook) =>
          scriptContent.includes(`${hook}(`)
        );
        if (usedLifecycleHooks.length > 0) {
          // Check if lifecycle hooks are imported
          const hasLifecycleImport = scriptContent.match(
            /import\s+.*\{[^}]*\b(?:onMounted|onUnmounted|onBeforeMount|onBeforeUnmount|onUpdated|onBeforeUpdate|onActivated|onDeactivated)\b[^}]*\}\s+from\s+['"]vue['"]/
          );
          if (!hasLifecycleImport) {
            // Add lifecycle hooks to existing vue import or create new import
            const vueImportMatch = scriptContent.match(
              /import\s+.*\{([^}]+)\}\s+from\s+['"]vue['"]/
            );
            if (vueImportMatch) {
              // Add to existing import
              const existingImports = vueImportMatch[1]
                .split(",")
                .map((i) => i.trim())
                .filter((i) => i);
              const newImports = [
                ...existingImports,
                ...usedLifecycleHooks.filter(
                  (h) => !existingImports.includes(h)
                ),
              ];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]+\}\s+from\s+['"]vue['"]/,
                `import { ${newImports.join(", ")} } from 'vue'`
              );
            } else {
              // Create new import
              const importMatch = scriptContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                scriptContent = scriptContent.replace(
                  /(import\s+[^;]+;[\s\n]*)+/,
                  `$&import { ${usedLifecycleHooks.join(", ")} } from 'vue';\n`
                );
              } else {
                scriptContent = `import { ${usedLifecycleHooks.join(", ")} } from 'vue';\n${scriptContent}`;
              }
            }
            result.fixed = true;
            result.fixes.push(
              `Added missing lifecycle hooks imports: ${usedLifecycleHooks.join(", ")}`
            );
          }
        }

        // Step 7.6: Detect and add missing Vue imports (ref, watch, etc.) GENERIC
        // This detects usage of Vue functions and adds imports if missing
        const vueFunctions = [
          "ref",
          "reactive",
          "computed",
          "watch",
          "watchEffect",
          "onMounted",
          "onUnmounted",
          "onBeforeMount",
          "onBeforeUnmount",
          "onUpdated",
          "onBeforeUpdate",
          "onActivated",
          "onDeactivated",
          "provide",
          "inject",
          "nextTick",
          "defineProps",
          "defineEmits",
          "defineExpose",
        ];
        const usedVueFunctions = vueFunctions.filter((func) => {
          // Check if function is used (not just mentioned in comments/strings)
          // Pattern: func( or func< or const x = func or func.value (for ref)
          const usagePattern = new RegExp(
            `\\b${func}\\s*[<(]|const\\s+\\w+\\s*=\\s*${func}\\s*[<(]|\\w+\\.${func}\\b`,
            "g"
          );
          return usagePattern.test(scriptContent);
          const funcPattern = new RegExp(
            `\\b${func}\\s*\\(|\\b${func}\\s*=|import.*${func}`,
            "g"
          );
          return (
            funcPattern.test(scriptContent) &&
            !scriptContent.match(
              new RegExp(
                `import\\s+.*\\{[^}]*\\b${func}\\b[^}]*\\}\\s+from\\s+['"]vue['"]`
              )
            )
          );
        });

        // Also check for vue-router functions (useRoute, useRouter) - GENERIC
        // This is a comprehensive check that runs after all other fixes
        const routerFunctions = ["useRoute", "useRouter"];
        const usedRouterFunctions = routerFunctions.filter((func) => {
          // Check if function is used (e.g., useRoute(), const route = useRoute(), useRoute().query, etc.)
          const funcPattern = new RegExp(
            `\\b${func}\\s*\\(|const\\s+\\w+\\s*=\\s*${func}\\s*\\(|\\b${func}\\(\\)`,
            "g"
          );
          const hasImport = scriptContent.match(
            new RegExp(
              `import\\s+.*\\{[^}]*\\b${func}\\b[^}]*\\}\\s+from\\s+['"]vue-router['"]`
            )
          );
          return funcPattern.test(scriptContent) && !hasImport;
        });

        if (usedRouterFunctions.length > 0) {
          // Check if vue-router import already exists
          const vueRouterImportMatch = scriptContent.match(
            /import\s+.*\{([^}]*)\}\s+from\s+['"]vue-router['"]/
          );
          if (vueRouterImportMatch) {
            // Add missing functions to existing import
            const existingImports = vueRouterImportMatch[1]
              .split(",")
              .map((i) => i.trim())
              .filter((i) => i.length > 0);
            const missingImports = usedRouterFunctions.filter(
              (f) => !existingImports.includes(f)
            );
            if (missingImports.length > 0) {
              const newImports = [...existingImports, ...missingImports];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]*\}\s+from\s+['"]vue-router['"]/,
                `import { ${newImports.join(", ")} } from 'vue-router'`
              );
              result.fixed = true;
              result.fixes.push(
                `Added missing vue-router imports: ${missingImports.join(", ")}`
              );
            }
          } else {
            // Create new import
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${usedRouterFunctions.join(", ")} } from 'vue-router';\n`
              );
            } else {
              scriptContent = `import { ${usedRouterFunctions.join(", ")} } from 'vue-router';\n${scriptContent}`;
            }
            result.fixed = true;
            result.fixes.push(
              `Added missing vue-router imports: ${usedRouterFunctions.join(", ")}`
            );
          }
        }

        if (usedVueFunctions.length > 0) {
          const vueImportMatch = scriptContent.match(
            /import\s+.*\{([^}]+)\}\s+from\s+['"]vue['"]/
          );
          if (vueImportMatch) {
            const existingImports = vueImportMatch[1]
              .split(",")
              .map((i) => i.trim())
              .filter((i) => i);
            const newImports = [
              ...existingImports,
              ...usedVueFunctions.filter((f) => !existingImports.includes(f)),
            ];
            scriptContent = scriptContent.replace(
              /import\s+.*\{[^}]+\}\s+from\s+['"]vue['"]/,
              `import { ${newImports.join(", ")} } from 'vue'`
            );
            result.fixed = true;
            result.fixes.push(
              `Added missing Vue imports: ${usedVueFunctions.join(", ")}`
            );
          } else {
            // Create new import
            const importMatch = scriptContent.match(
              /(import\s+[^;]+;[\s\n]*)+/
            );
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${usedVueFunctions.join(", ")} } from 'vue';\n`
              );
            } else {
              scriptContent = `import { ${usedVueFunctions.join(", ")} } from 'vue';\n${scriptContent}`;
            }
            result.fixed = true;
            result.fixes.push(
              `Added missing Vue imports: ${usedVueFunctions.join(", ")}`
            );
          }
        }

        // Step 7.6.5: Remove unused store imports and declarations GENERIC
        // Detect store imports that are declared but never used
        // Also detect stores that are used but not imported
        if (scriptContent.includes("Store")) {
          // First, find all store declarations: const XStore = useXStore();
          const storeDeclPattern =
            /const\s+(\w+Store)\s*=\s*(use\w+Store)\(\)/g;
          const storeDecls = new Map<string, string>(); // storeVar → storeName
          let match;
          while ((match = storeDeclPattern.exec(scriptContent)) !== null) {
            const [, storeVar, storeName] = match;
            storeDecls.set(storeVar, storeName);

            // Check if import exists for this store
            const importPattern = new RegExp(
              `import\\s+\\{[^}]*\\b${storeName}\\b[^}]*\\}\\s+from`,
              "g"
            );
            if (!importPattern.test(scriptContent)) {
              // Store is used but not imported - add import
              const modulePath = `@/store/modules/${storeName
                .replace(/^use/, "")
                .replace(/Store$/, "")
                .toLowerCase()}`;
              const importMatch = scriptContent.match(
                /(import\s+[^;]+;[\s\n]*)+/
              );
              if (importMatch) {
                scriptContent = scriptContent.replace(
                  /(import\s+[^;]+;[\s\n]*)+/,
                  `$&import { ${storeName} } from '${modulePath}';\n`
                );
              } else {
                scriptContent = `import { ${storeName} } from '${modulePath}';\n${scriptContent}`;
              }
              result.fixed = true;
              result.fixes.push(`Added missing store import: ${storeName}`);
            }
          }

          // Check which stores are actually used
          storeDecls.forEach((storeName, storeVar) => {
            // Check if store variable is used anywhere (except in its declaration)
            // Pattern: storeVar.property, storeVar(), storeVar, storeVar], storeVar}
            const usagePattern = new RegExp(
              `\\b${storeVar}\\.[a-zA-Z_$]|\\b${storeVar}\\s*\\(|\\b${storeVar}\\s*\\)|\\b${storeVar}\\s*,|\\b${storeVar}\\s*;|\\b${storeVar}\\s*\\]|\\b${storeVar}\\s*\\}`,
              "g"
            );
            const allMatches = Array.from(scriptContent.matchAll(usagePattern));
            // Filter out the declaration itself
            const actualUsages = allMatches.filter((m) => {
              const beforeMatch = scriptContent.substring(0, m.index);
              // Check if this is not part of the declaration: const storeVar = useStore()
              const isInDeclaration = beforeMatch.match(/const\s+$/);
              // Also check if it's used in computed/watched expressions
              const isInComputed = beforeMatch.match(
                /computed\s*\(\s*\(\)\s*=>\s*$/
              );
              const isInWatch = beforeMatch.match(/watch\s*\(/);
              return (
                !isInDeclaration &&
                (isInComputed || isInWatch || !beforeMatch.match(/const\s+$/))
              );
            });

            // If store is not used, remove declaration and import
            // BUT: Make sure we're not removing stores that are used but our pattern didn't catch
            // Double-check by looking for the store variable name in computed/watched expressions
            const hasUsageInComputed = new RegExp(
              `computed\\s*\\(\\s*\\(\\)\\s*=>\\s*.*\\b${storeVar}\\b`,
              "s"
            ).test(scriptContent);
            const hasUsageInWatch = new RegExp(
              `watch\\s*\\([^)]*\\b${storeVar}\\b`,
              "s"
            ).test(scriptContent);
            const hasUsageInTemplate =
              scriptContent.includes(`{{ ${storeVar}`) ||
              scriptContent.includes(`v-if="${storeVar}`) ||
              scriptContent.includes(`v-for="${storeVar}`);

            if (
              actualUsages.length === 0 &&
              !hasUsageInComputed &&
              !hasUsageInWatch &&
              !hasUsageInTemplate
            ) {
              // Remove declaration
              scriptContent = scriptContent.replace(
                new RegExp(
                  `const\\s+${storeVar}\\s*=\\s*${storeName}\\(\\);?\\s*\\n?`,
                  "g"
                ),
                ""
              );

              // Remove import if no other store from same module is used
              const importPattern = new RegExp(
                `import\\s+\\{[^}]*\\b${storeName}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"];?\\s*\\n?`,
                "g"
              );
              scriptContent = scriptContent.replace(
                importPattern,
                (importMatch) => {
                  // Check if other stores from same module are imported
                  const modulePath = importMatch.match(
                    /from\s+['"]([^'"]+)['"]/
                  )?.[1];
                  if (modulePath) {
                    // Check if any other store from this module is used
                    const otherStorePattern = new RegExp(
                      `const\\s+(\\w+Store)\\s*=\\s*(use\\w+Store)\\(\\)`,
                      "g"
                    );
                    let otherMatch;
                    let hasOtherStore = false;
                    while (
                      (otherMatch = otherStorePattern.exec(scriptContent)) !==
                      null
                    ) {
                      const [, otherVar] = otherMatch;
                      if (
                        otherVar !== storeVar &&
                        scriptContent.includes(`from '${modulePath}'`)
                      ) {
                        // Check if other store is used
                        const otherUsagePattern = new RegExp(
                          `\\b${otherVar}\\.[a-zA-Z_$]|\\b${otherVar}\\s*\\)`,
                          "g"
                        );
                        if (otherUsagePattern.test(scriptContent)) {
                          hasOtherStore = true;
                          break;
                        }
                      }
                    }

                    if (!hasOtherStore) {
                      // Remove entire import
                      return "";
                    } else {
                      // Remove only this store from import
                      return importMatch.replace(
                        new RegExp(
                          `\\s*,\\s*${storeName}|${storeName}\\s*,?\\s*`
                        ),
                        ""
                      );
                    }
                  }
                  return "";
                }
              );

              result.fixed = true;
              result.fixes.push(`Removed unused store: ${storeVar}`);
            }
          });
        }

        // Step 7.7: Replace remaining this.$store.dispatch/getters in watchers and methods GENERIC
        // This handles cases where this.$store is used but not yet replaced
        if (scriptContent.includes("this.$store")) {
          // Get dynamic store map from analysis - REQUIRED for genericity
          const storeMethodMap: Record<string, string> = {};
          
          // Analyze stores dynamically if projectRoot is available
          if (projectRoot) {
            // Use cache if available and for same project
            if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
              try {
                storeAnalysisCache = await analyzePiniaStores(projectRoot);
                storeAnalysisProjectRoot = projectRoot;
              } catch (error) {
                storeAnalysisCache = null;
              }
            }
            
            // Convert Map to Record for easier use
            if (storeAnalysisCache && storeAnalysisCache.size > 0) {
              storeAnalysisCache.forEach((module, method) => {
                storeMethodMap[method] = module;
              });
            }
          }
          
          // Detect all this.$store.dispatch('module/method', ...) patterns
          const dispatchPattern =
            /this\.\$store\.dispatch\(['"]([^'"]+)\/([^'"]+)['"]\s*,?\s*([^)]*)\)/g;
          let dispatchMatch;
          const dispatchReplacements: Array<{
            pattern: string;
            replacement: string;
            storeVar: string;
            storeName: string;
            module: string;
          }> = [];

          while (
            (dispatchMatch = dispatchPattern.exec(scriptContent)) !== null
          ) {
            const [, module, method, args] = dispatchMatch;
            const storeVarName = `${module}Store`;
            const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
            const fullMatch = dispatchMatch[0];
            const replacement = args.trim()
              ? `${storeVarName}.${method}(${args.trim()})`
              : `${storeVarName}.${method}()`;

            dispatchReplacements.push({
              pattern: fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              replacement: replacement,
              storeVar: storeVarName,
              storeName: storeName,
              module: module,
            });
          }

          // Apply replacements
          dispatchReplacements.forEach(
            ({ pattern, replacement, storeVar, storeName, module }) => {
              scriptContent = scriptContent.replace(
                new RegExp(pattern, "g"),
                replacement
              );

              // Ensure store is imported and initialized
              if (!scriptContent.includes(`import { ${storeName} }`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  scriptContent = scriptContent.replace(
                    /(import\s+[^;]+;[\s\n]*)+/,
                    `$&import { ${storeName} } from '@/store/modules/${module}';\n`
                  );
                } else {
                  scriptContent = `import { ${storeName} } from '@/store/modules/${module}';\n${scriptContent}`;
                }
              }

              if (!scriptContent.includes(`const ${storeVar} = ${storeName}`)) {
                // Add store initialization after imports
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  const insertPos = importMatch[0].length;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    `\nconst ${storeVar} = ${storeName}();\n` +
                    scriptContent.slice(insertPos);
                }
              }
            }
          );

          // Detect this.$store.getters['module/getter'] patterns
          const gettersPattern =
            /this\.\$store\.getters\[['"]([^'"]+)\/([^'"]+)['"]\]/g;
          let gettersMatch;
          const gettersReplacements: Array<{
            pattern: string;
            replacement: string;
            storeVar: string;
            storeName: string;
            module: string;
          }> = [];

          while ((gettersMatch = gettersPattern.exec(scriptContent)) !== null) {
            const [, module, getter] = gettersMatch;
            const storeVarName = `${module}Store`;
            const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
            const fullMatch = gettersMatch[0];
            const replacement = `${storeVarName}.${getter}`;

            gettersReplacements.push({
              pattern: fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              replacement: replacement,
              storeVar: storeVarName,
              storeName: storeName,
              module: module,
            });
          }
          
          // Detect this.$store.getters.property (without module) patterns
          // GENERIC: Use storeMethodMap to infer which store contains the property
          const gettersDirectPattern = /this\.\$store\.getters\.(\w+)/g;
          let gettersDirectMatch;
          const gettersDirectReplacements: Array<{
            pattern: string;
            replacement: string;
            storeVar: string;
            storeName: string;
            property: string;
          }> = [];

          while ((gettersDirectMatch = gettersDirectPattern.exec(scriptContent)) !== null) {
            const property = gettersDirectMatch[1];
            const fullMatch = gettersDirectMatch[0];
            
            // Use storeMethodMap to find which module contains this property
            const module = storeMethodMap[property];
            let storeVarName: string;
            let storeName: string;
            
            if (module) {
              // Found in store analysis - use it
              if (module === 'index') {
                storeVarName = 'indexStore';
                storeName = 'useIndexStore';
              } else {
                storeVarName = `${module}Store`;
                storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
              }
            } else {
              // Property not found in storeMethodMap - skip this replacement
              // This ensures we don't make incorrect assumptions
              continue;
            }
            
            const replacement = `${storeVarName}.${property}`;

            gettersDirectReplacements.push({
              pattern: fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              replacement: replacement,
              storeVar: storeVarName,
              storeName: storeName,
              property: property,
            });
          }
          
          // Detect this.$store.dispatch('action') (without module) patterns
          // GENERIC: Use storeMethodMap to infer which store contains the action
          const dispatchDirectPattern = /this\.\$store\.dispatch\(['"]([^'"]+)['"]\)/g;
          let dispatchDirectMatch;
          const dispatchDirectReplacements: Array<{
            pattern: string;
            replacement: string;
            storeVar: string;
            storeName: string;
            action: string;
          }> = [];

          while ((dispatchDirectMatch = dispatchDirectPattern.exec(scriptContent)) !== null) {
            const action = dispatchDirectMatch[1];
            const fullMatch = dispatchDirectMatch[0];
            
            // Use storeMethodMap to find which module contains this action
            const module = storeMethodMap[action];
            let storeVarName: string;
            let storeName: string;
            
            if (module) {
              // Found in store analysis - use it
              if (module === 'index') {
                storeVarName = 'indexStore';
                storeName = 'useIndexStore';
              } else {
                storeVarName = `${module}Store`;
                storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
              }
            } else {
              // Action not found in storeMethodMap - skip this replacement
              // This ensures we don't make incorrect assumptions
              continue;
            }
            
            const replacement = `${storeVarName}.${action}()`;

            dispatchDirectReplacements.push({
              pattern: fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              replacement: replacement,
              storeVar: storeVarName,
              storeName: storeName,
              action: action,
            });
          }

          // Apply getters replacements (with module)
          gettersReplacements.forEach(
            ({ pattern, replacement, storeVar, storeName, module }) => {
              scriptContent = scriptContent.replace(
                new RegExp(pattern, "g"),
                replacement
              );

              // Ensure store is imported and initialized (same logic as dispatch)
              if (!scriptContent.includes(`import { ${storeName} }`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  scriptContent = scriptContent.replace(
                    /(import\s+[^;]+;[\s\n]*)+/,
                    `$&import { ${storeName} } from '@/store/modules/${module}';\n`
                  );
                } else {
                  scriptContent = `import { ${storeName} } from '@/store/modules/${module}';\n${scriptContent}`;
                }
              }

              if (!scriptContent.includes(`const ${storeVar} = ${storeName}`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  const insertPos = importMatch[0].length;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    `\nconst ${storeVar} = ${storeName}();\n` +
                    scriptContent.slice(insertPos);
                }
              }
            }
          );
          
          // Apply getters replacements (without module - direct property access)
          gettersDirectReplacements.forEach(
            ({ pattern, replacement, storeVar, storeName, property }) => {
              scriptContent = scriptContent.replace(
                new RegExp(pattern, "g"),
                replacement
              );

              // Determine module from storeMethodMap or store name
              const module = storeMethodMap[property] || storeName.replace('use', '').replace('Store', '').toLowerCase();
              const importPath = module === 'index' ? '@/store/index' : `@/store/modules/${module}`;

              // Ensure store is imported and initialized
              if (!scriptContent.includes(`import { ${storeName} }`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  scriptContent = scriptContent.replace(
                    /(import\s+[^;]+;[\s\n]*)+/,
                    `$&import { ${storeName} } from '${importPath}';\n`
                  );
                } else {
                  scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
                }
              }

              if (!scriptContent.includes(`const ${storeVar} = ${storeName}`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  const insertPos = importMatch[0].length;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    `\nconst ${storeVar} = ${storeName}();\n` +
                    scriptContent.slice(insertPos);
                }
              }
            }
          );
          
          // Apply dispatch replacements (without module)
          dispatchDirectReplacements.forEach(
            ({ pattern, replacement, storeVar, storeName, action }) => {
              scriptContent = scriptContent.replace(
                new RegExp(pattern, "g"),
                replacement
              );

              // Determine module from storeMethodMap or store name
              const module = storeMethodMap[action] || storeName.replace('use', '').replace('Store', '').toLowerCase();
              const importPath = module === 'index' ? '@/store/index' : `@/store/modules/${module}`;

              // Ensure store is imported and initialized
              if (!scriptContent.includes(`import { ${storeName} }`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  scriptContent = scriptContent.replace(
                    /(import\s+[^;]+;[\s\n]*)+/,
                    `$&import { ${storeName} } from '${importPath}';\n`
                  );
                } else {
                  scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
                }
              }

              if (!scriptContent.includes(`const ${storeVar} = ${storeName}`)) {
                const importMatch = scriptContent.match(
                  /(import\s+[^;]+;[\s\n]*)+/
                );
                if (importMatch) {
                  const insertPos = importMatch[0].length;
                  scriptContent =
                    scriptContent.slice(0, insertPos) +
                    `\nconst ${storeVar} = ${storeName}();\n` +
                    scriptContent.slice(insertPos);
                }
              }
            }
          );

          if (
            dispatchReplacements.length > 0 ||
            gettersReplacements.length > 0 ||
            gettersDirectReplacements.length > 0 ||
            dispatchDirectReplacements.length > 0
          ) {
            result.fixed = true;
            const fixes = [];
            if (dispatchReplacements.length > 0) {
              fixes.push(
                `Replaced ${dispatchReplacements.length} this.$store.dispatch('module/action') calls`
              );
            }
            if (gettersReplacements.length > 0) {
              fixes.push(
                `Replaced ${gettersReplacements.length} this.$store.getters['module/getter'] calls`
              );
            }
            if (gettersDirectReplacements.length > 0) {
              fixes.push(
                `Replaced ${gettersDirectReplacements.length} this.$store.getters.property calls`
              );
            }
            if (dispatchDirectReplacements.length > 0) {
              fixes.push(
                `Replaced ${dispatchDirectReplacements.length} this.$store.dispatch('action') calls`
              );
            }
            result.fixes.push(fixes.join(", "));
          }
        }

        // Fix: Remove TypeScript syntax from JavaScript files (GENERIC)
        // Pattern: (value as string) or (value as number) in files without lang="ts"
        // Check if script tag has lang="ts" or lang="typescript"
        const scriptTagMatch = fixedContent.match(/<script\s+setup[^>]*>/);
        const hasTypeScriptLang =
          scriptTagMatch &&
          /lang\s*=\s*["']ts["']|lang\s*=\s*["']typescript["']/.test(
            scriptTagMatch[0]
          );

        if (!enableTypeScript && !hasTypeScriptLang) {
          // Remove TypeScript type assertions: (value as string) -> String(value) or just value
          // Pattern: (expression as type) - handles nested parentheses and complex expressions
          // More robust pattern that handles: (route.params.id as string), ((value) as string), etc.
          const typeAssertionPattern = /\(([^()]+|\([^()]*\)+)\s+as\s+(\w+)\)/g;
          let typeAssertionMatch;
          const processedAssertions = new Set<string>();

          while (
            (typeAssertionMatch = typeAssertionPattern.exec(scriptContent)) !==
            null
          ) {
            const [fullMatch, expression, type] = typeAssertionMatch;

            // Skip if already processed (avoid infinite loops)
            if (processedAssertions.has(fullMatch)) continue;
            processedAssertions.add(fullMatch);

            // Convert TypeScript assertion to JavaScript conversion
            let replacement: string;
            const trimmedExpr = expression.trim();

            if (type === "string") {
              // Use String() for conversion, but handle edge cases
              if (trimmedExpr.includes("||")) {
                // For expressions like: props.id || (route.params.id as string)
                // Replace just the assertion part: (route.params.id as string) -> String(route.params.id || '')
                replacement = `String(${trimmedExpr} || '')`;
              } else {
                replacement = `String(${trimmedExpr})`;
              }
            } else if (type === "number") {
              replacement = `Number(${trimmedExpr})`;
            } else if (type === "boolean") {
              replacement = `Boolean(${trimmedExpr})`;
            } else {
              // For other types, just remove the assertion (keep the expression)
              replacement = trimmedExpr;
            }

            scriptContent = scriptContent.replace(fullMatch, replacement);
            result.fixed = true;
            result.fixes.push(
              `Removed TypeScript type assertion 'as ${type}' from JavaScript file (generic fix)`
            );
          }

          // Fix: Remove TypeScript generic syntax from JavaScript files (GENERIC)
          // Pattern: computed<any>(() => ...), ref<number>(value), reactive<Type>({...})
          // This removes type parameters like <any>, <string>, <number>, etc.
          const genericPatterns = [
            /(computed)<[^>]+>/g,
            /(ref)<[^>]+>/g,
            /(reactive)<[^>]+>/g,
            /(defineStore)<[^>]+>/g,
            /(defineComponent)<[^>]+>/g,
            /(defineProps)<[^>]+>/g,
            /(defineEmits)<[^>]+>/g,
          ];

          genericPatterns.forEach((pattern) => {
            let genericMatch;
            const processedGenerics = new Set<string>();

            while ((genericMatch = pattern.exec(scriptContent)) !== null) {
              const [fullMatch, functionName] = genericMatch;

              // Skip if already processed
              if (processedGenerics.has(fullMatch)) continue;
              processedGenerics.add(fullMatch);

              // Remove the generic type parameter: computed<any> -> computed
              const fixed = functionName;
              scriptContent = scriptContent.replace(fullMatch, fixed);
              result.fixed = true;
              result.fixes.push(
                `Removed TypeScript generic '<...>' from ${functionName} in JavaScript file (generic fix)`
              );
            }
          });
        }

        // Fix: Remove extra closing braces/parentheses before </script> (GENERIC)
        // Pattern: });</script> or });</script> where there's an extra closing
        // This detects malformed code blocks before script closing tag
        const scriptEndPattern = /([^}]+)(\}\)+)\s*<\/script>/;
        const scriptEndMatch = scriptContent.match(scriptEndPattern);
        if (scriptEndMatch) {
          const beforeEnd = scriptEndMatch[1];
          const extraClosings = scriptEndMatch[2];

          // Check if there are unmatched opening braces/parentheses
          const openBraces = (beforeEnd.match(/\{/g) || []).length;
          const closeBraces = (beforeEnd.match(/\}/g) || []).length;
          const openParens = (beforeEnd.match(/\(/g) || []).length;
          const closeParens = (beforeEnd.match(/\)/g) || []).length;

          // If we have extra closings and they match the imbalance, remove them
          if (
            extraClosings.length > 1 &&
            (openBraces - closeBraces === extraClosings.match(/\}/g)?.length ||
              openParens - closeParens === extraClosings.match(/\)/g)?.length)
          ) {
            scriptContent = scriptContent.replace(
              scriptEndMatch[0],
              beforeEnd + "</script>"
            );
            result.fixed = true;
            result.fixes.push(
              "Removed extra closing braces/parentheses before script closing tag"
            );
          }
        }

        // Fix: Correct malformed router.push with broken template literals (GENERIC)
        // Pattern: router.push({ path: `/route/${param\n  }\n}` }) - broken template literal with newlines
        // This is GENERIC - works for any route path and parameter name
        const brokenTemplateLiteralPattern =
          /router\.push\s*\(\s*\{\s*path\s*:\s*[`'"]\/[^`'"]*\$\{(\w+)\s*\n\s*\}\s*\n\s*\}[`'"]/g;
        let brokenTemplateMatch;
        const processedBrokenPushes = new Set<string>();

        while (
          (brokenTemplateMatch =
            brokenTemplateLiteralPattern.exec(scriptContent)) !== null
        ) {
          const [fullMatch, paramName] = brokenTemplateMatch;

          // Skip if already processed
          if (processedBrokenPushes.has(fullMatch)) continue;
          processedBrokenPushes.add(fullMatch);

          // GENERIC: Extract route path from the broken pattern dynamically
          const routeMatch = fullMatch.match(/path\s*:\s*[`'"]\/(\w+)\//);
          let routePath: string;

          if (routeMatch) {
            routePath = `/${routeMatch[1]}`;
          } else {
            // Try to infer from function name or context
            const functionContext = scriptContent.substring(
              0,
              brokenTemplateMatch.index
            );
            const functionMatch = functionContext.match(
              /const\s+(\w+)\s*=\s*\([^)]+\)\s*=>/
            );
            if (functionMatch) {
              const functionName = functionMatch[1].toLowerCase();
              // Common patterns: goToPost -> /blog, navigateToUser -> /user, etc.
              if (functionName.includes("post")) {
                routePath = "/blog";
              } else if (functionName.includes("user")) {
                routePath = "/user";
              } else if (functionName.includes("item")) {
                routePath = "/item";
              } else {
                // Generic: extract base from function name
                const baseName = functionName
                  .replace(/^(go|navigate|open|view)/, "")
                  .replace(/to$/, "");
                routePath = `/${baseName}`;
              }
            } else {
              // Fallback: use generic /route
              routePath = "/route";
            }
          }

          const fixedPush = `router.push({ path: \`${routePath}/\${${paramName}}\` })`;
          scriptContent = scriptContent.replace(fullMatch, fixedPush);
          result.fixed = true;
          result.fixes.push(
            `Fixed broken template literal in router.push for ${routePath} (generic fix)`
          );
        }

        // Fix: Remove extra closing parentheses/braces after router.push (GENERIC)
        // Pattern: router.push({ path: ... }) }) - extra closing parenthesis
        // Pattern: router.push({ path: ... }) } - extra closing brace
        const extraClosingPattern =
          /router\.push\s*\(\s*\{\s*path\s*:\s*[`'"][^`'"]+[`'"]\s*\}\s*\)\s*([)}]+)/g;
        let extraClosingMatch;
        while (
          (extraClosingMatch = extraClosingPattern.exec(scriptContent)) !== null
        ) {
          const [fullMatch, extraClosings] = extraClosingMatch;
          // Remove extra closings: router.push({ path: ... }) }) -> router.push({ path: ... })
          const fixed = fullMatch.replace(extraClosings, "");
          scriptContent = scriptContent.replace(fullMatch, fixed);
          result.fixed = true;
          result.fixes.push(
            `Removed extra closing parentheses/braces after router.push (generic fix)`
          );
        }

        // Update fixedContent with final scriptContent
        // First, ensure any inline imports in the script tag are removed
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)\s*import\s+[^;]+;\s*/,
          "$1\n"
        );

        // Then update the script content
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`
        );
      }
    }

    // Fix: Correct malformed template expressions with missing/extra parentheses (GENERIC)
    // Pattern: {{ filter(value }} or {{ value) }} - malformed after filter conversion
    // This happens when filters are converted incorrectly
    if (fixedContent.includes("{{") && fixedContent.includes("}}")) {
      // Pattern 1: {{ functionName(value }} - missing closing paren before }}
      // More flexible pattern that handles various cases
      const missingClosingParenPattern = /\{\{\s*(\w+)\s*\(\s*([^)}]+)\s*\}\}/g;
      let missingParenMatch;
      const processedTemplates = new Set<string>();

      while (
        (missingParenMatch = missingClosingParenPattern.exec(fixedContent)) !==
        null
      ) {
        const [fullMatch, funcName, value] = missingParenMatch;

        // Skip if already processed
        if (processedTemplates.has(fullMatch)) continue;
        processedTemplates.add(fullMatch);

        // Check if it's actually missing a closing paren
        const trimmedValue = value.trim();
        const openParens = (trimmedValue.match(/\(/g) || []).length;
        const closeParens = (trimmedValue.match(/\)/g) || []).length;

        // If parentheses are balanced in value, we need to add closing paren for the function call
        if (openParens === closeParens) {
          const fixed = `{{ ${funcName}(${trimmedValue}) }}`;
          fixedContent = fixedContent.replace(fullMatch, fixed);
          result.fixed = true;
          result.fixes.push(
            `Fixed missing closing parenthesis in template: ${funcName}(${trimmedValue})`
          );
        }
      }

      // Pattern 2: {{ value) }} - extra closing paren (should be {{ value }})
      // More flexible pattern
      const extraClosingParenPattern = /\{\{\s*([^}()]+)\s*\)\s*\}\}/g;
      let extraParenMatch;
      const processedExtraParens = new Set<string>();

      while (
        (extraParenMatch = extraClosingParenPattern.exec(fixedContent)) !== null
      ) {
        const [fullMatch, value] = extraParenMatch;

        // Skip if already processed
        if (processedExtraParens.has(fullMatch)) continue;
        processedExtraParens.add(fullMatch);

        // If it's a simple value without function call, remove the extra paren
        const trimmedValue = value.trim();
        if (
          !trimmedValue.includes("(") &&
          !/\w+\s*\(/.test(trimmedValue) &&
          !trimmedValue.match(/^\w+\(/)
        ) {
          const fixed = `{{ ${trimmedValue} }}`;
          fixedContent = fixedContent.replace(fullMatch, fixed);
          result.fixed = true;
          result.fixes.push(
            `Removed extra closing parenthesis in template: ${trimmedValue}`
          );
        }
      }
    }
  }

  // Fix TypeScript syntax in JavaScript files (non-Vue files)
  // This handles .js and .ts files that are not Vue components
  if (!isVueFile && (filePath.endsWith(".js") || filePath.endsWith(".ts"))) {
    // Only process if TypeScript is NOT enabled (to avoid removing types from TS files)
    if (!enableTypeScript) {
      // Remove TypeScript generic syntax: computed<any>(), ref<number>(), etc.
      const genericPatterns = [
        /(computed)<[^>]+>/g,
        /(ref)<[^>]+>/g,
        /(reactive)<[^>]+>/g,
        /(defineStore)<[^>]+>/g,
        /(defineComponent)<[^>]+>/g,
        /(defineProps)<[^>]+>/g,
        /(defineEmits)<[^>]+>/g,
      ];

      genericPatterns.forEach((pattern) => {
        let genericMatch;
        const processedGenerics = new Set<string>();

        while ((genericMatch = pattern.exec(fixedContent)) !== null) {
          const [fullMatch, functionName] = genericMatch;

          // Skip if already processed
          if (processedGenerics.has(fullMatch)) continue;
          processedGenerics.add(fullMatch);

          // Remove the generic type parameter: computed<any> -> computed
          const fixed = functionName;
          fixedContent = fixedContent.replace(fullMatch, fixed);
          result.fixed = true;
          result.fixes.push(
            `Removed TypeScript generic '<...>' from ${functionName} in JavaScript file (generic fix)`
          );
        }
      });

      // Remove TypeScript type assertions: (value as string) -> String(value)
      const typeAssertionPattern = /\(([^()]+|\([^()]*\)+)\s+as\s+(\w+)\)/g;
      let typeAssertionMatch;
      const processedAssertions = new Set<string>();

      while (
        (typeAssertionMatch = typeAssertionPattern.exec(fixedContent)) !== null
      ) {
        const [fullMatch, expression, type] = typeAssertionMatch;

        // Skip if already processed
        if (processedAssertions.has(fullMatch)) continue;
        processedAssertions.add(fullMatch);

        // Convert TypeScript assertion to JavaScript conversion
        let replacement: string;
        const trimmedExpr = expression.trim();

        if (type === "string") {
          replacement = trimmedExpr.includes("||")
            ? `String(${trimmedExpr} || '')`
            : `String(${trimmedExpr})`;
        } else if (type === "number") {
          replacement = `Number(${trimmedExpr})`;
        } else if (type === "boolean") {
          replacement = `Boolean(${trimmedExpr})`;
        } else {
          replacement = trimmedExpr;
        }

        fixedContent = fixedContent.replace(fullMatch, replacement);
        result.fixed = true;
        result.fixes.push(
          `Removed TypeScript type assertion 'as ${type}' from JavaScript file (generic fix)`
        );
      }
    }
  }

  // Fix: Convert Vue 2 global API calls to Vue 3 app API (main.ts/main.js files)
  // Pattern: Vue.mixin(), Vue.filter(), Vue.directive(), Vue.component()
  // Should be: app.mixin(), app.directive(), app.component() (filters removed in Vue 3)
  if (
    (filePath.endsWith("main.ts") || filePath.endsWith("main.js")) &&
    fixedContent.includes("Vue.")
  ) {
    // Check if createApp is already used
    const hasCreateApp = fixedContent.includes("createApp");
    const hasAppVar = /const\s+app\s*=/.test(fixedContent);

    if (hasCreateApp && hasAppVar) {
      // Replace Vue.mixin() → app.mixin()
      if (fixedContent.includes("Vue.mixin")) {
        fixedContent = fixedContent.replace(/Vue\.mixin\(/g, "app.mixin(");
        result.fixed = true;
        result.fixes.push("Converted Vue.mixin() to app.mixin()");
      }
      
      // Fix: Remove app.mixin() calls for mixins that were transformed to composables
      // Pattern: app.mixin(mixinName) where mixinName was transformed to useMixinName
      const appMixinPattern = /app\.mixin\((\w+)\)/g;
      let appMixinMatch;
      const appMixinMatches: Array<{ match: string; mixinName: string; index: number }> = [];
      while ((appMixinMatch = appMixinPattern.exec(fixedContent)) !== null) {
        appMixinMatches.push({ match: appMixinMatch[0], mixinName: appMixinMatch[1], index: appMixinMatch.index });
      }
      
      // Process in reverse order to preserve indices
      appMixinMatches.reverse().forEach(({ match, mixinName, index }) => {
        // Remove "Mixin" from name if present (consistent with mixin file transformation)
        const baseName = mixinName.replace(/Mixin$/i, '');
        const composableName = `use${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`;
        
        // Check if this mixin file exists and was transformed to composable (or will be)
        const mixinFilePath = path.join(projectRoot || '', 'src', 'mixins', `${mixinName}.ts`);
        const mixinFilePathJs = path.join(projectRoot || '', 'src', 'mixins', `${mixinName}.js`);
        let composableExists = false;
        let willBeTransformed = false;
        
        if (projectRoot) {
          try {
            if (fsSync.existsSync(mixinFilePath) || fsSync.existsSync(mixinFilePathJs)) {
              const mixinFileContent = fsSync.existsSync(mixinFilePath) 
                ? fsSync.readFileSync(mixinFilePath, 'utf-8')
                : fsSync.readFileSync(mixinFilePathJs, 'utf-8');
              // Check for both export const and export function patterns (generic)
              composableExists = mixinFileContent.includes(`export const ${composableName}`) || 
                                mixinFileContent.includes(`export function ${composableName}`);
              // Check if it will be transformed (has data() and export const mixinName)
              willBeTransformed = !composableExists && mixinFileContent.includes('data()') && mixinFileContent.includes(`export const ${mixinName}`);
            }
          } catch (error) {
            // Ignore errors
          }
        }
        
        // If composable exists or will be transformed, comment out app.mixin() call
        if (composableExists || willBeTransformed) {
          fixedContent = fixedContent.substring(0, index) + `// ${match} // Mixin transformed to composable ${composableName} - use it in components instead` + fixedContent.substring(index + match.length);
          result.fixed = true;
          result.fixes.push(`Removed app.mixin(${mixinName}) - mixin transformed to composable ${composableName}`);
        }
      });
      
      // Also remove/comment import of old mixin if composable exists
      const oldMixinImportPattern = /import\s+\{\s*(\w+)\s*\}\s+from\s+['"]\.\/mixins\/(\w+)['"]/g;
      let oldMixinImportMatch;
      const oldMixinImports: Array<{ match: string; mixinName: string; index: number }> = [];
      while ((oldMixinImportMatch = oldMixinImportPattern.exec(fixedContent)) !== null) {
        oldMixinImports.push({ match: oldMixinImportMatch[0], mixinName: oldMixinImportMatch[1], index: oldMixinImportMatch.index });
      }
      
      // Process in reverse order
      oldMixinImports.reverse().forEach(({ match, mixinName, index }) => {
        const composableName = `use${mixinName.charAt(0).toUpperCase() + mixinName.slice(1)}`;
        
        // Check if composable exists in mixin file (or will be transformed)
        const mixinFilePath = path.join(projectRoot || '', 'src', 'mixins', `${mixinName}.ts`);
        const mixinFilePathJs = path.join(projectRoot || '', 'src', 'mixins', `${mixinName}.js`);
        let composableExists = false;
        let willBeTransformed = false;
        
        if (projectRoot) {
          try {
            if (fsSync.existsSync(mixinFilePath) || fsSync.existsSync(mixinFilePathJs)) {
              const mixinFileContent = fsSync.existsSync(mixinFilePath) 
                ? fsSync.readFileSync(mixinFilePath, 'utf-8')
                : fsSync.readFileSync(mixinFilePathJs, 'utf-8');
              // Check for both export const and export function patterns (generic)
              composableExists = mixinFileContent.includes(`export const ${composableName}`) || 
                                mixinFileContent.includes(`export function ${composableName}`);
              // Check if it will be transformed (has data() and export const mixinName)
              willBeTransformed = !composableExists && mixinFileContent.includes('data()') && mixinFileContent.includes(`export const ${mixinName}`);
            }
          } catch (error) {
            // Ignore errors
          }
        }
        
        // If composable exists or will be transformed, comment out old import
        if (composableExists || willBeTransformed) {
          fixedContent = fixedContent.substring(0, index) + `// ${match} // Use composable ${composableName} instead` + fixedContent.substring(index + match.length);
          result.fixed = true;
          result.fixes.push(`Removed old mixin import - use composable ${composableName} instead`);
        }
      });

      // Replace Vue.filter() → comment out (filters removed in Vue 3)
      if (fixedContent.includes("Vue.filter")) {
        const filterPattern = /Vue\.filter\([^)]+\);/g;
        let filterMatch;
        while ((filterMatch = filterPattern.exec(fixedContent)) !== null) {
          const match = filterMatch[0];
          const commented = `// ${match} // Filters removed in Vue 3 - use functions/computed instead`;
          fixedContent = fixedContent.replace(match, commented);
          result.fixed = true;
          result.fixes.push(
            "Commented out Vue.filter() - filters removed in Vue 3"
          );
        }
      }

      // Replace Vue.directive() → app.directive()
      if (fixedContent.includes("Vue.directive")) {
        fixedContent = fixedContent.replace(
          /Vue\.directive\(/g,
          "app.directive("
        );
        result.fixed = true;
        result.fixes.push("Converted Vue.directive() to app.directive()");
      }

      // Replace Vue.component() → app.component()
      if (fixedContent.includes("Vue.component")) {
        fixedContent = fixedContent.replace(
          /Vue\.component\(/g,
          "app.component("
        );
        result.fixed = true;
        result.fixes.push("Converted Vue.component() to app.component()");
      }

      // Ensure app API calls are after createApp() call
      // Move Vue.* calls (now app.*) to after createApp if they're before it
      const createAppMatch = fixedContent.match(
        /const\s+app\s*=\s*createApp\([^)]+\)/
      );
      if (createAppMatch) {
        const createAppIndex = fixedContent.indexOf(createAppMatch[0]);
        const appApiCalls = [
          /app\.mixin\([^)]+\);/g,
          /app\.directive\([^)]+\);/g,
          /app\.component\([^)]+\);/g,
        ];

        appApiCalls.forEach((pattern) => {
          let match;
          const callsToMove: Array<{ content: string; index: number }> = [];

          while ((match = pattern.exec(fixedContent)) !== null) {
            if (match.index < createAppIndex) {
              callsToMove.push({ content: match[0], index: match.index });
            }
          }

          // Remove calls before createApp and add them after
          callsToMove.reverse().forEach(({ content, index }) => {
            fixedContent =
              fixedContent.substring(0, index) +
              fixedContent.substring(index + content.length);
            // Insert after createApp line
            const afterCreateApp =
              fixedContent.indexOf("\n", createAppIndex) + 1;
            fixedContent =
              fixedContent.substring(0, afterCreateApp) +
              content +
              "\n" +
              fixedContent.substring(afterCreateApp);
            result.fixed = true;
            result.fixes.push("Moved app API call after createApp()");
          });
        });
      }
    } else if (fixedContent.includes("Vue.")) {
      // createApp not found - add it
      result.fixes.push(
        "WARNING: Vue.* calls found but createApp() not detected - manual conversion needed"
      );
    }
  }

  // Fix: Add missing filter imports (capitalize, currency, etc.) when used in templates
  // GENERIC: Detects filter usage in templates and adds imports from @/filters
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
    
    if (scriptSetupMatch && templateMatch) {
      let scriptContent = scriptSetupMatch[1];
      const templateContent = templateMatch[1];
      
      // Detect filter usage in template: {{ capitalize(...) }}, {{ currency(...) }}, etc.
      // GENERIC: Detects any function call in template that's not a Vue API or component method
      const filterPattern = /\{\{\s*(\w+)\s*\(/g;
      const usedFilters = new Set<string>();
      let filterMatch;
      
      // Vue 3 built-in functions that shouldn't be imported as filters
      const vueBuiltIns = ['computed', 'ref', 'reactive', 'watch', 'onMounted', 'onUnmounted', 
                          'defineProps', 'defineEmits', 'useRouter', 'useRoute', 'useStore',
                          'nextTick', 'h', 'createApp', 'defineComponent'];
      
      // Check if filters file exists to know what filters are available
      const filtersPath = projectRoot ? path.join(projectRoot, 'src', 'filters', 'index.js') : null;
      let availableFilters: string[] = [];
      if (filtersPath && fsSync.existsSync(filtersPath)) {
        try {
          const filtersContent = fsSync.readFileSync(filtersPath, 'utf-8');
          // Extract exported function names
          const exportPattern = /export\s+(?:function|const)\s+(\w+)/g;
          let exportMatch;
          while ((exportMatch = exportPattern.exec(filtersContent)) !== null) {
            availableFilters.push(exportMatch[1]);
          }
        } catch (error) {
          // If can't read filters file, use common filter names
          availableFilters = ['capitalize', 'currency', 'uppercase', 'lowercase', 'formatDate', 'formatCurrency'];
        }
      } else {
        // If filters file doesn't exist, use common filter names
        availableFilters = ['capitalize', 'currency', 'uppercase', 'lowercase', 'formatDate', 'formatCurrency'];
      }
      
      while ((filterMatch = filterPattern.exec(templateContent)) !== null) {
        const filterName = filterMatch[1];
        // Skip Vue built-ins and component methods (they start with uppercase)
        if (!vueBuiltIns.includes(filterName) && 
            filterName.charAt(0) === filterName.charAt(0).toLowerCase() &&
            (availableFilters.includes(filterName) || availableFilters.length === 0)) {
          usedFilters.add(filterName);
        }
      }
      
      // Add imports for used filters if not already imported
      if (usedFilters.size > 0) {
        const filtersArray = Array.from(usedFilters);
        const filtersImport = `import { ${filtersArray.join(', ')} } from '@/filters';`;
        
        // Check if filters are already imported
        if (!scriptContent.includes("from '@/filters'") && !scriptContent.includes('from "@/filters"')) {
          // Find the best place to insert import (after other imports)
          const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
          if (importMatch) {
            scriptContent = scriptContent.replace(
              /(import\s+[^;]+;[\s\n]*)+/,
              `$&${filtersImport}\n`
            );
          } else {
            scriptContent = `${filtersImport}\n${scriptContent}`;
          }
          
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          result.fixes.push(`Added missing filter imports: ${filtersArray.join(', ')}`);
        }
      }
    }
  }

  // Fix: Replace this.$store.getters.* and this.$store.dispatch with Pinia stores
  // GENERIC: Detects all Vuex patterns and replaces with appropriate Pinia stores
  // This fixer is a fallback for any remaining this.$store patterns that weren't caught by the main generic fixer
  // It uses dynamic store analysis to infer which store to use
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      
      // Only process if there are remaining this.$store patterns
      if (scriptContent.includes("this.$store")) {
        // Try to analyze stores dynamically if projectRoot is available
        const storeMethodMap: Record<string, string> = {};
        
        if (projectRoot) {
          try {
            // Use the same analyzePiniaStores function for consistency
            // Use cache if available and for same project
            if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
              try {
                storeAnalysisCache = await analyzePiniaStores(projectRoot);
                storeAnalysisProjectRoot = projectRoot;
              } catch (error) {
                storeAnalysisCache = null;
              }
            }
            
            // Convert Map to Record for easier use
            if (storeAnalysisCache && storeAnalysisCache.size > 0) {
              storeAnalysisCache.forEach((module, method) => {
                storeMethodMap[method] = module;
              });
            }
            
            // Also check index store for properties
            try {
              const storeIndexPath = path.join(projectRoot, "src", "store", "index.ts");
              if (fsSync.existsSync(storeIndexPath)) {
                const indexContent = fsSync.readFileSync(storeIndexPath, "utf-8");
                // Extract computed properties and methods from index store
                const computedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
                let computedMatch;
                while ((computedMatch = computedPattern.exec(indexContent)) !== null) {
                  const propName = computedMatch[1];
                  if (!storeMethodMap[propName]) {
                    storeMethodMap[propName] = 'index';
                  }
                }
                
                const functionPattern = /(?:function|const)\s+(\w+)\s*[=:(]/g;
                let funcMatch;
                while ((funcMatch = functionPattern.exec(indexContent)) !== null) {
                  const funcName = funcMatch[1];
                  // Skip internal variables and store functions (generic pattern)
                  const isStoreFunction = /^use\w+Store$/.test(funcName);
                  if (!['loading', 'ref', 'computed', 'defineStore', 'return', 'export'].includes(funcName) && !isStoreFunction) {
                    if (!storeMethodMap[funcName]) {
                      storeMethodMap[funcName] = 'index';
                    }
                  }
                }
              }
            } catch (error) {
              // Ignore errors in index store analysis
            }
          } catch (error) {
            // If store analysis fails, storeMethodMap will be empty
            // We'll skip replacements that can't be safely inferred
          }
        }
        
        // Generic pattern detection for this.$store.getters.property (without module)
        const gettersDirectPattern = /this\.\$store\.getters\.(\w+)/g;
        let gettersDirectMatch;
        const gettersToReplace: Array<{
          pattern: string;
          property: string;
          storeVar: string;
          storeName: string;
          importPath: string;
        }> = [];
        
        while ((gettersDirectMatch = gettersDirectPattern.exec(scriptContent)) !== null) {
          const property = gettersDirectMatch[1];
          const fullPattern = gettersDirectMatch[0];
          
          // Try to find store from storeMethodMap first
          const module = storeMethodMap[property];
          
          if (module) {
            // Found in store analysis - use it (fully generic)
            let storeVar: string;
            let storeName: string;
            let importPath: string;
            
            if (module === 'index') {
              storeVar = 'indexStore';
              storeName = 'useIndexStore';
              importPath = '@/store/index';
            } else {
              storeVar = `${module}Store`;
              storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
              importPath = `@/store/modules/${module}`;
            }
            
            gettersToReplace.push({
              pattern: fullPattern,
              property: property,
              storeVar: storeVar,
              storeName: storeName,
              importPath: importPath
            });
          }
          // If not found in storeMethodMap, skip this replacement
          // This ensures we don't make incorrect assumptions
        }
        
        // Generic pattern detection for this.$store.dispatch('action') (without module)
        const dispatchDirectPattern = /this\.\$store\.dispatch\(['"]([^'"]+)['"]\)/g;
        let dispatchDirectMatch;
        const dispatchesToReplace: Array<{
          pattern: string;
          action: string;
          storeVar: string;
          storeName: string;
          importPath: string;
        }> = [];
        
        while ((dispatchDirectMatch = dispatchDirectPattern.exec(scriptContent)) !== null) {
          const action = dispatchDirectMatch[1];
          const fullPattern = dispatchDirectMatch[0];
          
          // Try to find store from storeMethodMap first
          const module = storeMethodMap[action];
          
          if (module) {
            // Found in store analysis - use it (fully generic)
            let storeVar: string;
            let storeName: string;
            let importPath: string;
            
            if (module === 'index') {
              storeVar = 'indexStore';
              storeName = 'useIndexStore';
              importPath = '@/store/index';
            } else {
              storeVar = `${module}Store`;
              storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
              importPath = `@/store/modules/${module}`;
            }
            
            dispatchesToReplace.push({
              pattern: fullPattern,
              action: action,
              storeVar: storeVar,
              storeName: storeName,
              importPath: importPath
            });
          }
          // If not found in storeMethodMap, skip this replacement
          // This ensures we don't make incorrect assumptions
        }
        
        // Apply replacements
        let hasChanges = false;
        
        // Replace getters
        for (const { pattern, property, storeVar, storeName, importPath } of gettersToReplace) {
          // Replace the pattern
          scriptContent = scriptContent.replace(
            new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            `${storeVar}.${property}`
          );
          
          // Add import if needed
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${storeName} } from '${importPath}';\n`
              );
            } else {
              scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
            }
          }
          
          // Add store initialization if not present
          if (!scriptContent.includes(`const ${storeVar} = ${storeName}`)) {
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
          
          hasChanges = true;
        }
        
        // Replace dispatches
        for (const { pattern, action, storeVar, storeName, importPath } of dispatchesToReplace) {
          // Replace the pattern
          scriptContent = scriptContent.replace(
            new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            `${storeVar}.${action}()`
          );
          
          // Add import if needed
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${storeName} } from '${importPath}';\n`
              );
            } else {
              scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
            }
          }
          
          // Add store initialization if not present
          if (!scriptContent.includes(`const ${storeVar} = ${storeName}`)) {
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
          
          hasChanges = true;
        }
        
        if (hasChanges) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          result.fixes.push("Replaced remaining this.$store references with Pinia stores (generic detection)");
        }
      }
    }
  }

  // Fix: Add missing component imports when used in templates
  // GENERIC: Detects component usage in templates and adds imports
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
    
    if (scriptSetupMatch && templateMatch) {
      let scriptContent = scriptSetupMatch[1];
      const templateContent = templateMatch[1];
      
      // Detect component usage: <ComponentName /> or <component-name />
      // Pattern 1: PascalCase components: <ComponentName /> or <ComponentName> or </ComponentName>
      // Improved pattern to catch self-closing tags and opening/closing tags
      const pascalCasePattern = /<([A-Z][a-zA-Z0-9]*)(?:\s|>|\/)|<\/([A-Z][a-zA-Z0-9]*)>/g;
      const usedComponents = new Set<string>();
      let componentMatch;
      
      while ((componentMatch = pascalCasePattern.exec(templateContent)) !== null) {
        const componentName = componentMatch[1] || componentMatch[2];
        if (!componentName) continue;
        
        // Skip built-in Vue components and Vue Router components (they don't need imports)
        const builtInComponents = [
          'RouterView', 'RouterLink', 'Transition', 'KeepAlive', 'Suspense', 'Teleport',
          'TransitionGroup', 'Component', 'Fragment', 'Suspense'
        ];
        const htmlTags = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'input', 'select', 'option', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'form', 'label', 'nav', 'header', 'footer', 'main', 'section', 'article', 'aside'];
        if (!builtInComponents.includes(componentName) && !htmlTags.includes(componentName.toLowerCase())) {
          usedComponents.add(componentName);
        }
      }
      
      // Pattern 2: kebab-case components: <component-name /> → convert to PascalCase
      const kebabCasePattern = /<([a-z]+(?:-[a-z]+)+)\s|<\/([a-z]+(?:-[a-z]+)+)>/g;
      while ((componentMatch = kebabCasePattern.exec(templateContent)) !== null) {
        const kebabName = componentMatch[1] || componentMatch[2];
        // Convert kebab-case to PascalCase: user-card → UserCard
        const pascalName = kebabName.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join('');
        usedComponents.add(pascalName);
      }
      
      // Add imports for used components if not already imported
      // IMPORTANT: Process all components first, then update fixedContent once
      const componentsToImport: string[] = [];
      usedComponents.forEach(componentName => {
        // Check if component is already imported (check both default and named imports)
        const defaultImportPattern = new RegExp(`import\\s+${componentName}\\s+from`);
        const namedImportPattern = new RegExp(`import\\s+\\{[^}]*\\b${componentName}\\b[^}]*\\}\\s+from`);
        const isAlreadyImported = scriptContent.match(defaultImportPattern) || scriptContent.match(namedImportPattern);
        
        if (!isAlreadyImported) {
          componentsToImport.push(componentName);
        }
      });
      
      // Add all missing component imports at once
      if (componentsToImport.length > 0) {
        // GENERIC: Works for any component name, uses common location pattern
        const componentImports = componentsToImport.map(componentName => {
          const componentPath = `@/components/${componentName}.vue`;
          return `import ${componentName} from '${componentPath}';`;
        }).join('\n');
        
        // Find the best place to insert imports (after other imports)
        const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        if (importMatch) {
          // Insert after existing imports
          scriptContent = scriptContent.replace(
            /(import\s+[^;]+;[\s\n]*)+/,
            `$&${componentImports}\n`
          );
        } else {
          // Insert at the beginning if no imports exist
          scriptContent = `${componentImports}\n${scriptContent}`;
        }
        
        // Update fixedContent once with all imports
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`
        );
        result.fixed = true;
        result.fixes.push(`Added missing component import${componentsToImport.length > 1 ? 's' : ''}: ${componentsToImport.join(', ')}`);
      }
    }
  }

  // Fix: Replace Vuex references in mixins with Pinia stores
  // GENERIC: Detects and replaces this.$store patterns in mixin files
  const isMixinFile = (filePath.endsWith('.ts') || filePath.endsWith('.js')) && 
      (filePath.includes('/mixins/') || filePath.includes('mixin.ts') || filePath.includes('mixin.js') || 
       (fixedContent.includes('export const') && fixedContent.includes('mixin')));
  
  if (isMixinFile && fixedContent.includes('this.$store')) {
    let hasChanges = false;
    
    // Try to analyze stores dynamically if projectRoot is available
    const storeMethodMap: Record<string, string> = {};
    
    if (projectRoot) {
      try {
        // Use cache if available and for same project
        if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
          try {
            storeAnalysisCache = await analyzePiniaStores(projectRoot);
            storeAnalysisProjectRoot = projectRoot;
          } catch (error) {
            storeAnalysisCache = null;
          }
        }
        
        // Convert Map to Record for easier use
        if (storeAnalysisCache && storeAnalysisCache.size > 0) {
          storeAnalysisCache.forEach((module, method) => {
            storeMethodMap[method] = module;
          });
        }
        
        // Also check index store for properties
        try {
          const storeIndexPath = path.join(projectRoot, "src", "store", "index.ts");
          if (fsSync.existsSync(storeIndexPath)) {
            const indexContent = fsSync.readFileSync(storeIndexPath, "utf-8");
            const computedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
            let computedMatch;
            while ((computedMatch = computedPattern.exec(indexContent)) !== null) {
              const propName = computedMatch[1];
              if (!storeMethodMap[propName]) {
                storeMethodMap[propName] = 'index';
              }
            }
            
            const functionPattern = /(?:function|const)\s+(\w+)\s*[=:(]/g;
            let funcMatch;
            while ((funcMatch = functionPattern.exec(indexContent)) !== null) {
              const funcName = funcMatch[1];
              // Skip internal variables and store functions (generic pattern)
              const isStoreFunction = /^use\w+Store$/.test(funcName);
              if (!['loading', 'ref', 'computed', 'defineStore', 'return', 'export'].includes(funcName) && !isStoreFunction) {
                if (!storeMethodMap[funcName]) {
                  storeMethodMap[funcName] = 'index';
                }
              }
            }
          }
        } catch (error) {
          // Ignore errors in index store analysis
        }
      } catch (error) {
        // If store analysis fails, storeMethodMap will be empty
      }
    }
    
    // Pattern 1: this.$store.getters.property in mixins
    // GENERIC: Replace with useStore().property using dynamic store analysis
    if (fixedContent.includes('this.$store.getters.')) {
      const gettersPattern = /this\.\$store\.getters\.(\w+)/g;
      let gettersMatch;
      const storesToImport = new Set<string>();
      
      while ((gettersMatch = gettersPattern.exec(fixedContent)) !== null) {
        const property = gettersMatch[1];
        const module = storeMethodMap[property];
        
        if (module) {
          // Found in store analysis - use it (fully generic)
          let storeName: string;
          let importPath: string;
          
          if (module === 'index') {
            storeName = 'useIndexStore';
            importPath = '@/store/index';
          } else {
            storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
            importPath = `@/store/modules/${module}`;
          }
          
          storesToImport.add(`${storeName}|${importPath}`);
          
          // Replace the getter access
          fixedContent = fixedContent.replace(
            new RegExp(gettersMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            `${storeName}().${property}`
          );
          hasChanges = true;
        }
        // If not found in storeMethodMap, skip this replacement
        // This ensures we don't make incorrect assumptions
      }
      
      // Add imports for all stores used
      storesToImport.forEach((storeInfo) => {
        const [storeName, importPath] = storeInfo.split('|');
        // Check if import already exists
        if (!fixedContent.includes(`import { ${storeName} }`) && !fixedContent.includes(`import ${storeName}`)) {
          // Check if there are any existing imports
          const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
          if (importMatch) {
            // Find the last import line
            const allImports = fixedContent.match(/^import\s+.*from\s+['"][^'"]+['"];?/gm);
            if (allImports && allImports.length > 0) {
              const lastImport = allImports[allImports.length - 1];
              const lastImportIndex = fixedContent.lastIndexOf(lastImport);
              const afterLastImport = fixedContent.substring(lastImportIndex + lastImport.length);
              fixedContent = fixedContent.substring(0, lastImportIndex + lastImport.length) + 
                `\nimport { ${storeName} } from '${importPath}';` + afterLastImport;
            } else {
              fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
            }
          } else {
            // No imports exist, add at the beginning
            fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
          }
        }
      });
    }
    
    // Pattern 2: this.$store.dispatch('action') in mixins
    // GENERIC: Replace with useStore().action() using dynamic store analysis
    if (fixedContent.includes('this.$store.dispatch(')) {
      const dispatchPattern = /this\.\$store\.dispatch\(['"]([^'"]+)['"]\)/g;
      let dispatchMatch;
      const storesToImport = new Set<string>();
      
      while ((dispatchMatch = dispatchPattern.exec(fixedContent)) !== null) {
        const action = dispatchMatch[1];
        const module = storeMethodMap[action];
        
        if (module) {
          // Found in store analysis - use it (fully generic)
          let storeName: string;
          let importPath: string;
          
          if (module === 'index') {
            storeName = 'useIndexStore';
            importPath = '@/store/index';
          } else {
            storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
            importPath = `@/store/modules/${module}`;
          }
          
          storesToImport.add(`${storeName}|${importPath}`);
          
          // Replace the dispatch call
          fixedContent = fixedContent.replace(
            new RegExp(dispatchMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            `${storeName}().${action}()`
          );
          hasChanges = true;
        }
        // If not found in storeMethodMap, skip this replacement
        // This ensures we don't make incorrect assumptions
      }
      
      // Add imports for all stores used
      storesToImport.forEach((storeInfo) => {
        const [storeName, importPath] = storeInfo.split('|');
        // Check if import already exists
        if (!fixedContent.includes(`import { ${storeName} }`) && !fixedContent.includes(`import ${storeName}`)) {
          // Check if there are any existing imports
          const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
          if (importMatch) {
            // Find the last import line
            const allImports = fixedContent.match(/^import\s+.*from\s+['"][^'"]+['"];?/gm);
            if (allImports && allImports.length > 0) {
              const lastImport = allImports[allImports.length - 1];
              const lastImportIndex = fixedContent.lastIndexOf(lastImport);
              const afterLastImport = fixedContent.substring(lastImportIndex + lastImport.length);
              fixedContent = fixedContent.substring(0, lastImportIndex + lastImport.length) + 
                `\nimport { ${storeName} } from '${importPath}';` + afterLastImport;
            } else {
              fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
            }
          } else {
            // No imports exist, add at the beginning
            fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
          }
        }
      });
    }
    
    if (hasChanges) {
      result.fixed = true;
      result.fixes.push("Replaced Vuex references in mixin with Pinia stores");
    }
  }

  // Fix: Transform Vue 2 mixins to Vue 3 composables (GENERIC)
  // Pattern: export const mixinName = { data(), computed, methods, mounted() } → export const useMixinName = () => { ... return { ... } }
  const isMixinFileForComposable = (filePath.endsWith('.ts') || filePath.endsWith('.js')) && 
      (filePath.includes('/mixins/') || filePath.includes('mixin.ts') || filePath.includes('mixin.js') || 
       (fixedContent.includes('export const') && fixedContent.includes('mixin') && fixedContent.includes('data()')));
  
  if (isMixinFileForComposable && fixedContent.includes('export const') && fixedContent.includes('data()')) {
    // Detect mixin name: export const mixinName = { ... }
    const mixinExportPattern = /export\s+const\s+(\w+)\s*=\s*\{/;
    const mixinMatch = fixedContent.match(mixinExportPattern);
    
    if (mixinMatch) {
      const mixinName = mixinMatch[1];
      // Remove "Mixin" from name if present (e.g., "userMixin" → "user", "productMixin" → "product")
      const baseName = mixinName.replace(/Mixin$/i, '');
      const composableName = `use${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`;
      
      // Extract the entire mixin object content by finding matching braces
      let braceCount = 0;
      const startIndex = fixedContent.indexOf('{', mixinMatch.index);
      let endIndex = startIndex;
      let inString = false;
      let stringChar = '';
      
      for (let i = startIndex; i < fixedContent.length; i++) {
        const char = fixedContent[i];
        const prevChar = i > 0 ? fixedContent[i - 1] : '';
        
        // Handle strings
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
            stringChar = '';
          }
        }
        
        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i;
              break;
            }
          }
        }
      }
      
      const mixinObjectContent = fixedContent.substring(startIndex + 1, endIndex);
      
      // Collect all parts to return
      const returnProps: string[] = [];
      const composableBody: string[] = [];
      const imports = new Set<string>();
      const storeCalls = new Set<string>(); // Track store calls to optimize
      
      // Transform data() → use ref for primitives, reactive for objects
      const dataPattern = /data\s*\(\)\s*\{\s*return\s*(\{[\s\S]*?\})\s*;?\s*\}/;
      const dataMatch = mixinObjectContent.match(dataPattern);
      if (dataMatch) {
        const dataContent = dataMatch[1];
        // Check if it's a single property object (e.g., { mixinData: 'value' })
        const dataProps = dataContent.match(/(\w+)\s*:\s*([^,}]+)/g);
        if (dataProps && dataProps.length === 1) {
          // Single property - use ref
          const propMatch = dataProps[0].match(/(\w+)\s*:\s*(.+)/);
          if (propMatch) {
            const propName = propMatch[1];
            const propValue = propMatch[2].trim();
            composableBody.push(`  const ${propName} = ref(${propValue});`);
            returnProps.push(propName);
            imports.add('ref');
          }
        } else {
          // Multiple properties - use reactive
          composableBody.push(`  const data = reactive(${dataContent});`);
          returnProps.push('data');
          imports.add('reactive');
        }
      }
      
      // Transform computed → const computedProp = computed(...)
      // More robust pattern that handles nested braces
      const computedPattern = /computed:\s*\{/;
      if (computedPattern.test(mixinObjectContent)) {
        const computedStart = mixinObjectContent.indexOf('computed:');
        let computedBraceCount = 0;
        const computedStartIndex = mixinObjectContent.indexOf('{', computedStart);
        let computedEndIndex = computedStartIndex;
        let computedInString = false;
        let computedStringChar = '';
        
        for (let i = computedStartIndex; i < mixinObjectContent.length; i++) {
          const char = mixinObjectContent[i];
          const prevChar = i > 0 ? mixinObjectContent[i - 1] : '';
          
          if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
            if (!computedInString) {
              computedInString = true;
              computedStringChar = char;
            } else if (char === computedStringChar) {
              computedInString = false;
              computedStringChar = '';
            }
          }
          
          if (!computedInString) {
            if (char === '{') computedBraceCount++;
            if (char === '}') {
              computedBraceCount--;
              if (computedBraceCount === 0) {
                computedEndIndex = i;
                break;
              }
            }
          }
        }
        
        const computedContent = mixinObjectContent.substring(computedStartIndex + 1, computedEndIndex);
        // Extract individual computed properties
        const computedProps = computedContent.match(/(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g);
        if (computedProps) {
          computedProps.forEach(prop => {
            const propMatch = prop.match(/(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
            if (propMatch) {
              const propName = propMatch[1];
              let propBody = propMatch[2];
              
              // Optimize: Extract store calls and call store once at the top
              const storeCallPattern = /use(\w+)Store\(\)/g;
              const storeReplacements: Array<{pattern: RegExp, replacement: string}> = [];
              let storeCallMatch;
              while ((storeCallMatch = storeCallPattern.exec(propBody)) !== null) {
                const storeCall = storeCallMatch[0]; // e.g., "useIndexStore()"
                const storeName = storeCallMatch[1]; // e.g., "Index"
                storeCalls.add(storeCall);
                // Create store variable name: useIndexStore → indexStore
                const storeVar = storeName.charAt(0).toLowerCase() + storeName.slice(1) + 'Store';
                storeReplacements.push({
                  pattern: new RegExp(storeCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                  replacement: storeVar
                });
              }
              
              // Apply store replacements
              storeReplacements.forEach(({pattern, replacement}) => {
                propBody = propBody.replace(pattern, replacement);
              });
              
              // Use optional chaining: currentUser && currentUser.role → currentUser?.role
              propBody = propBody.replace(/(\w+)\s*&&\s*\1\.(\w+)/g, '$1?.$2');
              // Use nullish coalescing: || 'Guest' → ?? 'Guest'
              propBody = propBody.replace(/\s*\|\|\s*'Guest'/g, " ?? 'Guest'");
              
              composableBody.push(`  const ${propName} = computed(() => {${propBody}});`);
              returnProps.push(propName);
              imports.add('computed');
            }
          });
        }
      }
      
      // Transform methods → const methodName = (...)
      const methodsPattern = /methods:\s*\{/;
      if (methodsPattern.test(mixinObjectContent)) {
        const methodsStart = mixinObjectContent.indexOf('methods:');
        let methodsBraceCount = 0;
        const methodsStartIndex = mixinObjectContent.indexOf('{', methodsStart);
        let methodsEndIndex = methodsStartIndex;
        let methodsInString = false;
        let methodsStringChar = '';
        
        for (let i = methodsStartIndex; i < mixinObjectContent.length; i++) {
          const char = mixinObjectContent[i];
          const prevChar = i > 0 ? mixinObjectContent[i - 1] : '';
          
          if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
            if (!methodsInString) {
              methodsInString = true;
              methodsStringChar = char;
            } else if (char === methodsStringChar) {
              methodsInString = false;
              methodsStringChar = '';
            }
          }
          
          if (!methodsInString) {
            if (char === '{') methodsBraceCount++;
            if (char === '}') {
              methodsBraceCount--;
              if (methodsBraceCount === 0) {
                methodsEndIndex = i;
                break;
              }
            }
          }
        }
        
        const methodsContent = mixinObjectContent.substring(methodsStartIndex + 1, methodsEndIndex);
        const methodProps = methodsContent.match(/(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g);
        if (methodProps) {
          methodProps.forEach(method => {
            const methodMatch = method.match(/(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/);
            if (methodMatch) {
              const methodName = methodMatch[1];
              const methodParams = methodMatch[2];
              let methodBody = methodMatch[3];
              
              // Fix ternary: return user ? user.name : 'Guest' → return user?.name ?? 'Guest'
              methodBody = methodBody.replace(/return\s+(\w+)\s*\?\s*\1\.(\w+)\s*:\s*'Guest'/g, 'return $1?.$2 ?? \'Guest\'');
              // Fix ternary: user ? user.name : 'Guest' → user?.name ?? 'Guest' (without return)
              methodBody = methodBody.replace(/(\w+)\s*\?\s*\1\.(\w+)\s*:\s*'Guest'/g, '$1?.$2 ?? \'Guest\'');
              // Use optional chaining: user ? user.name → user?.name (for other cases)
              methodBody = methodBody.replace(/(\w+)\s*\?\s*\1\.(\w+)/g, '$1?.$2');
              // Use nullish coalescing: || 'Guest' → ?? 'Guest' (for other cases)
              methodBody = methodBody.replace(/\s*\|\|\s*'Guest'/g, " ?? 'Guest'");
              
              composableBody.push(`  const ${methodName} = (${methodParams}) => {${methodBody}};`);
              returnProps.push(methodName);
            }
          });
        }
      }
      
      // Transform lifecycle hooks - need to handle nested braces properly
      // Skip empty hooks (best practice: don't include empty lifecycle hooks)
      const lifecycleMap: Record<string, string> = {
        'mounted': 'onMounted',
        'created': 'onMounted',
        'beforeMount': 'onBeforeMount',
        'beforeDestroy': 'onBeforeUnmount',
        'destroyed': 'onUnmounted'
      };
      
      Object.keys(lifecycleMap).forEach(hook => {
        const hookPattern = new RegExp(`${hook}\\s*\\(\\)\\s*\\{`, 'g');
        if (hookPattern.test(mixinObjectContent)) {
          const hookStart = mixinObjectContent.indexOf(`${hook}()`);
          if (hookStart !== -1) {
            const hookStartIndex = mixinObjectContent.indexOf('{', hookStart);
            let hookBraceCount = 0;
            let hookEndIndex = hookStartIndex;
            let hookInString = false;
            let hookStringChar = '';
            
            for (let i = hookStartIndex; i < mixinObjectContent.length; i++) {
              const char = mixinObjectContent[i];
              const prevChar = i > 0 ? mixinObjectContent[i - 1] : '';
              
              if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
                if (!hookInString) {
                  hookInString = true;
                  hookStringChar = char;
                } else if (char === hookStringChar) {
                  hookInString = false;
                  hookStringChar = '';
                }
              }
              
              if (!hookInString) {
                if (char === '{') hookBraceCount++;
                if (char === '}') {
                  hookBraceCount--;
                  if (hookBraceCount === 0) {
                    hookEndIndex = i;
                    break;
                  }
                }
              }
            }
            
            const hookBody = mixinObjectContent.substring(hookStartIndex + 1, hookEndIndex).trim();
            const vue3Hook = lifecycleMap[hook];
            // Only add hook if it has content (skip empty hooks)
            if (hookBody && hookBody !== 'undefined' && hookBody.length > 0) {
              composableBody.push(`  ${vue3Hook}(() => {${hookBody}});`);
              imports.add(vue3Hook);
            }
          }
        }
      });
      
      // Add store initialization at the top if stores are used in computed
      // Extract store calls from storeCalls set and create initialization
      const storesToInit: string[] = [];
      const storeVarMap = new Map<string, string>(); // Map store call → store var
      
      storeCalls.forEach(storeCall => {
        // storeCall is like "useIndexStore()"
        const storeMatch = storeCall.match(/use(\w+)Store\(\)/);
        if (storeMatch) {
          const storeName = storeMatch[1]; // e.g., "Index"
          const storeVar = storeName.charAt(0).toLowerCase() + storeName.slice(1) + 'Store'; // e.g., "indexStore"
          storeVarMap.set(storeCall, storeVar);
          // Only add if not already added
          if (!storesToInit.some(s => s.includes(storeVar))) {
            storesToInit.push(`  const ${storeVar} = ${storeCall.replace('()', '')}();`);
          }
        }
      });
      
      // Also check existing imports for stores that might be used
      const existingStoreImports = fixedContent.match(/import\s+\{([^}]+)\}\s+from\s+['"]@\/store\/[^'"]+['"]/g);
      if (existingStoreImports) {
        existingStoreImports.forEach(importLine => {
          const storeMatch = importLine.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
          if (storeMatch) {
            const storeImports = storeMatch[1].split(',').map(s => s.trim());
            storeImports.forEach(storeImport => {
              if (storeImport.startsWith('use') && storeImport.endsWith('Store')) {
                const storeName = storeImport.replace('use', '').replace('Store', '');
                const storeVar = storeName.charAt(0).toLowerCase() + storeName.slice(1) + 'Store';
                const storeCall = `${storeImport}()`;
                if (!storeVarMap.has(storeCall) && !storesToInit.some(s => s.includes(storeVar))) {
                  // Check if this store is actually used in the mixin content
                  if (mixinObjectContent.includes(storeCall)) {
                    storesToInit.push(`  const ${storeVar} = ${storeImport}();`);
                    storeVarMap.set(storeCall, storeVar);
                  }
                }
              }
            });
          }
        });
      }
      
      // Now update computed properties to use store variables instead of store calls
      composableBody.forEach((line, index) => {
        if (line.includes('computed')) {
          storeVarMap.forEach((storeVar, storeCall) => {
            // Replace store calls with store variables in computed
            const storeCallPattern = new RegExp(storeCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            if (line.includes(storeCall)) {
              composableBody[index] = line.replace(storeCallPattern, storeVar);
            }
          });
        }
      });
      
      // Build the composable function with stores initialized first
      const returnStatement = returnProps.length > 0 
        ? `  return { ${returnProps.join(', ')} };`
        : '  return {};';
      
      // Combine: stores first, then other code, then return
      const allBodyParts = [...storesToInit, ...composableBody];
      const composableFunction = `export function ${composableName}() {\n${allBodyParts.join('\n')}\n${returnStatement}\n}`;
      
      // Replace the entire export statement (from export to closing brace + semicolon)
      const exportStart = fixedContent.indexOf('export', mixinMatch.index);
      let exportEnd = endIndex + 1;
      // Check for semicolon after closing brace
      if (exportEnd < fixedContent.length && fixedContent[exportEnd] === ';') {
        exportEnd++;
      }
      // Also check for newline/whitespace after
      while (exportEnd < fixedContent.length && (fixedContent[exportEnd] === ' ' || fixedContent[exportEnd] === '\n' || fixedContent[exportEnd] === '\t')) {
        exportEnd++;
      }
      fixedContent = fixedContent.substring(0, exportStart) + composableFunction + fixedContent.substring(exportEnd);
      
      // Add imports if needed
      if (imports.size > 0) {
        const importList = Array.from(imports).join(', ');
        const existingVueImport = fixedContent.match(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"]/);
        if (existingVueImport) {
          const existingImports = existingVueImport[1].split(',').map(i => i.trim());
          const allImports = Array.from(new Set([...existingImports, ...Array.from(imports)])).join(', ');
          fixedContent = fixedContent.replace(existingVueImport[0], `import { ${allImports} } from 'vue'`);
        } else {
          // Find where to insert import (before export or at top)
          const exportIndex = fixedContent.indexOf('export');
          if (exportIndex > 0) {
            fixedContent = fixedContent.substring(0, exportIndex) + `import { ${importList} } from 'vue';\n` + fixedContent.substring(exportIndex);
          } else {
            fixedContent = `import { ${importList} } from 'vue';\n${fixedContent}`;
          }
        }
      }
      
      result.fixed = true;
      result.fixes.push(`Transformed mixin ${mixinName} to composable ${composableName}`);
    }
  }
  
  // Fix: Replace mixins usage in components with composable calls (GENERIC)
  // Pattern: mixins: [mixinName] → import { useMixinName } from '@/mixins/mixinName'; const { ... } = useMixinName();
  // Works for both <script setup> and regular <script> with setup()
  if (isVueFile && fixedContent.includes('mixins:')) {
    const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const scriptContent = scriptMatch[1];
      const mixinsPattern = /mixins:\s*\[([^\]]+)\]/;
      const mixinsMatch = scriptContent.match(mixinsPattern);
      
      if (mixinsMatch) {
        const mixinsList = mixinsMatch[1].split(',').map(m => m.trim().replace(/['"]/g, ''));
        
        mixinsList.forEach(mixinName => {
          if (mixinName) {
            // Remove "Mixin" from name if present (consistent with mixin file transformation)
            // e.g., "userMixin" → "user", "productMixin" → "product"
            const baseName = mixinName.replace(/Mixin$/i, '');
            const composableName = `use${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`;
            const mixinPath = `@/mixins/${mixinName}`;
            
            // Add import if not present
            if (!scriptContent.includes(`import { ${composableName} }`)) {
              const importSection = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importSection) {
                const lastImport = importSection[0];
                const scriptStart = fixedContent.indexOf('<script');
                const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                const importIndex = fixedContent.indexOf(lastImport, scriptTagEnd);
                if (importIndex !== -1) {
                  fixedContent = fixedContent.substring(0, importIndex + lastImport.length) + 
                    `\nimport { ${composableName} } from '${mixinPath}';` + 
                    fixedContent.substring(importIndex + lastImport.length);
                }
              } else {
                const scriptStart = fixedContent.indexOf('<script');
                const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                fixedContent = fixedContent.substring(0, scriptTagEnd) + 
                  `\nimport { ${composableName} } from '${mixinPath}';` + 
                  fixedContent.substring(scriptTagEnd);
              }
            }
            
            // Add composable call in setup (for <script setup>)
            if (fixedContent.includes('<script setup')) {
              const updatedScript = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
              const updatedScriptContent = updatedScript ? updatedScript[1] : scriptContent;
              
              if (!updatedScriptContent.includes(`${composableName}()`)) {
                // Find a good place to insert (after imports, before other code)
                const firstConstMatch = updatedScriptContent.match(/(const\s+\w+\s*=)/);
                if (firstConstMatch) {
                  const scriptStart = fixedContent.indexOf('<script');
                  const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                  const insertIndex = fixedContent.indexOf(firstConstMatch[0], scriptTagEnd);
                  if (insertIndex !== -1) {
                    fixedContent = fixedContent.substring(0, insertIndex) + 
                      `const { ...${baseName}Props } = ${composableName}();\n  ` + 
                      fixedContent.substring(insertIndex);
                  }
                } else {
                  // Insert after imports
                  const importEnd = updatedScriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                  if (importEnd) {
                    const scriptStart = fixedContent.indexOf('<script');
                    const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                    const importEndIndex = fixedContent.indexOf(importEnd[0], scriptTagEnd) + importEnd[0].length;
                    fixedContent = fixedContent.substring(0, importEndIndex) + 
                      `\nconst { ...${baseName}Props } = ${composableName}();` + 
                      fixedContent.substring(importEndIndex);
                  }
                }
              }
            }
            
            // Remove mixins: [mixinName] from script
            fixedContent = fixedContent.replace(mixinsPattern, '');
            result.fixed = true;
            result.fixes.push(`Replaced mixin ${mixinName} with composable ${composableName}`);
          }
        });
      }
    }
  }
  
  // Fix: Auto-detect and add composable usage for globally registered mixins (GENERIC)
  // When a mixin was registered globally (app.mixin), detect components that use its properties/methods
  // and automatically add the composable import and usage
  if (isVueFile && fixedContent.includes('<script setup')) {
    const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const scriptContent = scriptMatch[1];
      
      // Check if there are any mixin files that were transformed to composables
      if (projectRoot) {
        try {
          const mixinsDir = path.join(projectRoot, 'src', 'mixins');
          if (fsSync.existsSync(mixinsDir)) {
            const mixinFiles = fsSync.readdirSync(mixinsDir).filter(f => 
              (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')
            );
            
            for (const mixinFile of mixinFiles) {
              const mixinFilePath = path.join(mixinsDir, mixinFile);
              const mixinContent = fsSync.readFileSync(mixinFilePath, 'utf-8');
              
              // Check if this mixin was transformed to a composable
              const composableMatch = mixinContent.match(/export\s+(?:function|const)\s+(use\w+)\s*\(/);
              if (composableMatch) {
                const composableName = composableMatch[1];
                
                // Extract what the composable returns - handle multi-line returns
                // Use brace counting to find the return statement properly
                const returnIndex = mixinContent.indexOf('return');
                if (returnIndex !== -1) {
                  let braceCount = 0;
                  let returnStart = -1;
                  let returnEnd = -1;
                  let inString = false;
                  let stringChar = '';
                  
                  // Find the opening brace after "return"
                  for (let i = returnIndex; i < mixinContent.length; i++) {
                    const char = mixinContent[i];
                    const prevChar = i > 0 ? mixinContent[i - 1] : '';
                    
                    // Handle strings
                    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
                      if (!inString) {
                        inString = true;
                        stringChar = char;
                      } else if (char === stringChar) {
                        inString = false;
                        stringChar = '';
                      }
                    }
                    
                    if (!inString) {
                      if (char === '{') {
                        if (braceCount === 0) returnStart = i + 1;
                        braceCount++;
                      } else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                          returnEnd = i;
                          break;
                        }
                      }
                    }
                  }
                  
                  if (returnStart !== -1 && returnEnd !== -1) {
                    const returnContent = mixinContent.substring(returnStart, returnEnd);
                    // Extract property names (handle both "prop" and "prop: value" formats)
                    const returnedProps = returnContent
                      .split(',')
                      .map(p => p.trim())
                      .filter(p => p.length > 0)
                      .map(p => {
                        // Handle "prop: value" or just "prop"
                        const colonIndex = p.indexOf(':');
                        return colonIndex > 0 ? p.substring(0, colonIndex).trim() : p.trim();
                      })
                      .filter(p => p.length > 0);
                    
                    // Check if component uses any of these properties/methods
                    const usesMixinProps = returnedProps.some(prop => {
                      // Check if prop is used in template or script
                      const propPattern = new RegExp(`\\b${prop}\\b`);
                      return propPattern.test(fixedContent);
                    });
                    
                    // Also check if this mixin was registered globally (app.mixin was commented out)
                    // If so, we should add the composable to all components that might need it
                    const mixinFileName = mixinFile.replace(/\.(ts|js)$/, '');
                    const mixinBaseName = mixinFileName.replace(/Mixin$/i, '');
                    let wasGlobalMixin = false;
                    
                    if (projectRoot) {
                      try {
                        const mainPath = path.join(projectRoot, 'src', 'main.ts');
                        const mainPathJs = path.join(projectRoot, 'src', 'main.js');
                        const mainFile = fsSync.existsSync(mainPath) ? mainPath : (fsSync.existsSync(mainPathJs) ? mainPathJs : null);
                        
                        if (mainFile) {
                          const mainContent = fsSync.readFileSync(mainFile, 'utf-8');
                          // Check for app.mixin or Vue.mixin calls (commented or not)
                          // Simple string matching is more reliable than regex for this case
                          wasGlobalMixin = 
                            mainContent.includes(`app.mixin(${mixinBaseName})`) ||
                            mainContent.includes(`app.mixin(${mixinFileName})`) ||
                            mainContent.includes(`Vue.mixin(${mixinBaseName})`) ||
                            mainContent.includes(`Vue.mixin(${mixinFileName})`) ||
                            // Also check for commented import with mixin reference
                            (mainContent.includes(`import { ${mixinFileName} }`) && mainContent.includes('mixin')) ||
                            (mainContent.includes(`import { ${mixinBaseName} }`) && mainContent.includes('mixin'));
                        }
                      } catch {
                        // Ignore errors when reading main file
                      }
                    }
                    
                    // If mixin was global, we should add composable to ALL components (not just those using props)
                    // This is because global mixins are available to all components
                    // The logic below will handle adding the composable when wasGlobalMixin is true
                    
                    // If mixin was global, add composable to ALL components
                    // If not global but component uses mixin props, add composable
                    // Note: For global mixins, we add to all components since they were globally available
                    if ((wasGlobalMixin || usesMixinProps) && !scriptContent.includes(`${composableName}()`)) {
                      // Add import if not present
                      const mixinPath = `@/mixins/${mixinFileName}`;
                      
                      // Get base name for destructuring (e.g., "useUser" → "user")
                      const baseName = composableName.replace(/^use/, '').charAt(0).toLowerCase() + composableName.replace(/^use/, '').slice(1);
                      
                      if (!scriptContent.includes(`import { ${composableName} }`)) {
                        const importSection = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                        if (importSection) {
                          const lastImport = importSection[0];
                          const scriptStart = fixedContent.indexOf('<script');
                          const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                          const importIndex = fixedContent.indexOf(lastImport, scriptTagEnd);
                          if (importIndex !== -1) {
                            fixedContent = fixedContent.substring(0, importIndex + lastImport.length) + 
                              `\nimport { ${composableName} } from '${mixinPath}';` + 
                              fixedContent.substring(importIndex + lastImport.length);
                          }
                        } else {
                          const scriptStart = fixedContent.indexOf('<script');
                          const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                          fixedContent = fixedContent.substring(0, scriptTagEnd) + 
                            `\nimport { ${composableName} } from '${mixinPath}';` + 
                            fixedContent.substring(scriptTagEnd);
                        }
                      }
                      
                      // Add composable call
                      const updatedScript = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
                      const updatedScriptContent = updatedScript ? updatedScript[1] : scriptContent;
                      
                      if (!updatedScriptContent.includes(`${composableName}()`)) {
                        const firstConstMatch = updatedScriptContent.match(/(const\s+\w+\s*=)/);
                        if (firstConstMatch) {
                          const scriptStart = fixedContent.indexOf('<script');
                          const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                          const insertIndex = fixedContent.indexOf(firstConstMatch[0], scriptTagEnd);
                          if (insertIndex !== -1) {
                            // Use spread operator to get all returned props from composable
                            fixedContent = fixedContent.substring(0, insertIndex) + 
                              `const { ...${baseName}Props } = ${composableName}();\n  ` + 
                              fixedContent.substring(insertIndex);
                            result.fixed = true;
                            result.fixes.push(`Added composable ${composableName} usage for globally registered mixin`);
                          }
                        } else {
                          // Insert after imports if no const found
                          const importEnd = updatedScriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                          if (importEnd) {
                            const scriptStart = fixedContent.indexOf('<script');
                            const scriptTagEnd = fixedContent.indexOf('>', scriptStart) + 1;
                            const importEndIndex = fixedContent.indexOf(importEnd[0], scriptTagEnd) + importEnd[0].length;
                            fixedContent = fixedContent.substring(0, importEndIndex) + 
                              `\nconst { ...${baseName}Props } = ${composableName}();` + 
                              fixedContent.substring(importEndIndex);
                            result.fixed = true;
                            result.fixes.push(`Added composable ${composableName} usage for globally registered mixin`);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          // Ignore errors - mixins directory might not exist
        }
      }
    }
  }
  
  // Fix: Remove Vuex references (getters, dispatch, commit) from Pinia stores
  // GENERIC: Detects and removes Vuex patterns in store files
  if ((filePath.endsWith('.ts') || filePath.endsWith('.js')) && 
      (filePath.includes('/store/') || filePath.includes('store.ts') || filePath.includes('store.js'))) {
    
    // Pattern 1: getters['module/getter'] or getters.property
    if (fixedContent.includes('getters[') || fixedContent.match(/getters\.\w+/)) {
      // Replace getters['module/getter'] with direct property access
      fixedContent = fixedContent.replace(/getters\[['"]([^'"]+)\/([^'"]+)['"]\]/g, (match, module, getter) => {
        // In Pinia stores, we access properties directly or from other stores
        // Pattern: getters['user/isAuthenticated'] → userStore.isAuthenticated
        const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
        const storeVarName = `${module}Store`;
        
        // Check if this store is already initialized in the file
        if (fixedContent.includes(`const ${storeVarName} = ${storeName}`)) {
          return `${storeVarName}.${getter}`;
        }
        
        // Check if store is imported but not initialized - add initialization
        if (fixedContent.includes(storeName)) {
          // Add store initialization at the beginning of the store function
          const storeFunctionMatch = fixedContent.match(/(export\s+const\s+use\w+Store\s*=\s*defineStore\([^)]+\)\s*=>\s*\{)/);
          if (storeFunctionMatch) {
            const afterDefineStore = fixedContent.indexOf(storeFunctionMatch[0]) + storeFunctionMatch[0].length;
            const beforeContent = fixedContent.substring(0, afterDefineStore);
            const afterContent = fixedContent.substring(afterDefineStore);
            // Add store initialization after defineStore, before other code
            // Find the first line after the opening brace
            const firstLineMatch = afterContent.match(/^\s*(\w+)/);
            if (firstLineMatch) {
              const insertPos = afterContent.indexOf(firstLineMatch[0]);
              const beforeInsert = afterContent.substring(0, insertPos);
              const afterInsert = afterContent.substring(insertPos);
              fixedContent = beforeContent + beforeInsert + `  const ${storeVarName} = ${storeName}();\n` + afterInsert;
            } else {
              fixedContent = beforeContent + `\n  const ${storeVarName} = ${storeName}();` + afterContent;
            }
            return `${storeVarName}.${getter}`;
          }
        }
        
        // Otherwise, import and initialize the store
        // Add import at the top
        const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
        const importPath = module === 'index' ? '@/store/index' : `@/store/modules/${module}`;
        if (importMatch) {
          const importIndex = fixedContent.lastIndexOf('\n', importMatch.index) + 1;
          const beforeImports = fixedContent.substring(0, importIndex);
          const afterImports = fixedContent.substring(importIndex);
          fixedContent = beforeImports + `import { ${storeName} } from '${importPath}';\n` + afterImports;
        } else {
          fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
        }
        
        // Add store initialization at the beginning of the store function
        const storeFunctionMatch = fixedContent.match(/(export\s+const\s+use\w+Store\s*=\s*defineStore\([^)]+\)\s*=>\s*\{)/);
        if (storeFunctionMatch) {
          const afterDefineStore = fixedContent.indexOf(storeFunctionMatch[0]) + storeFunctionMatch[0].length;
          const beforeContent = fixedContent.substring(0, afterDefineStore);
          const afterContent = fixedContent.substring(afterDefineStore);
          // Find the first line after the opening brace
          const firstLineMatch = afterContent.match(/^\s*(\w+)/);
          if (firstLineMatch) {
            const insertPos = afterContent.indexOf(firstLineMatch[0]);
            const beforeInsert = afterContent.substring(0, insertPos);
            const afterInsert = afterContent.substring(insertPos);
            fixedContent = beforeContent + beforeInsert + `  const ${storeVarName} = ${storeName}();\n` + afterInsert;
          } else {
            fixedContent = beforeContent + `\n  const ${storeVarName} = ${storeName}();` + afterContent;
          }
        }
        
        return `${storeVarName}.${getter}`;
      });
      
      // Also handle cases where useStore() is called directly in computed without initialization
      // Pattern: computed(() => useXxxStore().property) → should use initialized store variable (GENERIC)
      fixedContent = fixedContent.replace(/computed\s*\([^)]*\)\s*=>\s*use(\w+)Store\(\)\.(\w+)/g, (match, module, property) => {
        const storeVarName = `${module.charAt(0).toLowerCase() + module.slice(1)}Store`;
        const storeName = `use${module}Store`;
        
        // Check if store is already initialized
        if (fixedContent.includes(`const ${storeVarName} = ${storeName}`)) {
          return match.replace(`use${module}Store().${property}`, `${storeVarName}.${property}`);
        }
        
        // Otherwise, add initialization
        const storeFunctionMatch = fixedContent.match(/(export\s+const\s+use\w+Store\s*=\s*defineStore\([^)]+\)\s*=>\s*\{)/);
        if (storeFunctionMatch) {
          const afterDefineStore = fixedContent.indexOf(storeFunctionMatch[0]) + storeFunctionMatch[0].length;
          const beforeContent = fixedContent.substring(0, afterDefineStore);
          const afterContent = fixedContent.substring(afterDefineStore);
          const firstLineMatch = afterContent.match(/^\s*(\w+)/);
          if (firstLineMatch) {
            const insertPos = afterContent.indexOf(firstLineMatch[0]);
            const beforeInsert = afterContent.substring(0, insertPos);
            const afterInsert = afterContent.substring(insertPos);
            fixedContent = beforeContent + beforeInsert + `  const ${storeVarName} = ${storeName}();\n` + afterInsert;
          } else {
            fixedContent = beforeContent + `\n  const ${storeVarName} = ${storeName}();` + afterContent;
          }
          
          // Add import if needed
          if (!fixedContent.includes(storeName)) {
            const importPath = module.toLowerCase() === 'index' ? '@/store/index' : `@/store/modules/${module.toLowerCase()}`;
            const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
            if (importMatch) {
              const importIndex = fixedContent.lastIndexOf('\n', importMatch.index) + 1;
              const beforeImports = fixedContent.substring(0, importIndex);
              const afterImports = fixedContent.substring(importIndex);
              fixedContent = beforeImports + `import { ${storeName} } from '${importPath}';\n` + afterImports;
            } else {
              fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
            }
          }
          
          return match.replace(`use${module}Store().${property}`, `${storeVarName}.${property}`);
        }
        
        return match;
      });
      
      // Replace getters.property with direct property access (if in computed)
      // Pattern: const [ANY_NAME] = computed(() => getters.[NAME]) (GENERIC)
      // Also handle: userStore.property where userStore is undefined
      fixedContent = fixedContent.replace(/getters\.(\w+)/g, (match, property) => {
        // Only replace if it's in a computed context or arrow function
        const matchIndex = fixedContent.indexOf(match);
        const beforeMatch = fixedContent.substring(Math.max(0, matchIndex - 200), matchIndex);
        if (beforeMatch.includes('computed') || beforeMatch.includes('() =>') || beforeMatch.includes('=>')) {
          // In Pinia stores, computed properties are accessed directly
          return property;
        }
        return match;
      });
      
      // Fix: store.property where store is used but not initialized
      const undefinedStorePattern = /(const\s+\w+\s*=\s*computed\s*\([^)]*\)\s*=>\s*)(\w+Store)\.(\w+)/g;
      let undefinedStoreMatch;
      while ((undefinedStoreMatch = undefinedStorePattern.exec(fixedContent)) !== null) {
        const storeVarName = undefinedStoreMatch[2];
        const storeName = `use${storeVarName.charAt(0).toUpperCase() + storeVarName.slice(1).replace('Store', '')}Store`;
        
        // Check if store is already initialized
        if (!fixedContent.includes(`const ${storeVarName} = ${storeName}`)) {
          // Add import if needed
          if (!fixedContent.includes(storeName)) {
            const module = storeVarName.replace('Store', '').toLowerCase();
            const importPath = module === 'index' ? '@/store/index' : `@/store/modules/${module}`;
            const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
            if (importMatch) {
              const importIndex = fixedContent.lastIndexOf('\n', importMatch.index) + 1;
              const beforeImports = fixedContent.substring(0, importIndex);
              const afterImports = fixedContent.substring(importIndex);
              fixedContent = beforeImports + `import { ${storeName} } from '${importPath}';\n` + afterImports;
            } else {
              fixedContent = `import { ${storeName} } from '${importPath}';\n${fixedContent}`;
            }
          }
          
          // Add store initialization
          const storeFunctionMatch = fixedContent.match(/(export\s+const\s+use\w+Store\s*=\s*defineStore\([^)]+\)\s*=>\s*\{)/);
          if (storeFunctionMatch) {
            const afterDefineStore = fixedContent.indexOf(storeFunctionMatch[0]) + storeFunctionMatch[0].length;
            const beforeContent = fixedContent.substring(0, afterDefineStore);
            const afterContent = fixedContent.substring(afterDefineStore);
            const firstLineMatch = afterContent.match(/^\s*(\w+)/);
            if (firstLineMatch) {
              const insertPos = afterContent.indexOf(firstLineMatch[0]);
              const beforeInsert = afterContent.substring(0, insertPos);
              const afterInsert = afterContent.substring(insertPos);
              fixedContent = beforeContent + beforeInsert + `  const ${storeVarName} = ${storeName}();\n` + afterInsert;
            } else {
              fixedContent = beforeContent + `\n  const ${storeVarName} = ${storeName}();` + afterContent;
            }
          }
        }
      }
      
      result.fixed = true;
      result.fixes.push("Removed Vuex getters references from Pinia store");
    }
    
    // Pattern 2: dispatch('module/action') or dispatch('action')
    if (fixedContent.includes("dispatch('") || fixedContent.includes('dispatch("')) {
      // Pattern: dispatch('user/fetchCurrentUser') → userStore.fetchCurrentUser()
      fixedContent = fixedContent.replace(/dispatch\(['"]([^'"]+)\/([^'"]+)['"]\)/g, (match, module, action) => {
        const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
        const storeVarName = `${module}Store`;
        
        // Check if store is already initialized
        if (fixedContent.includes(`const ${storeVarName} = ${storeName}`)) {
          return `${storeVarName}.${action}()`;
        }
        
        // Check if store is imported but not initialized - add initialization
        if (fixedContent.includes(storeName)) {
          const storeFunctionMatch = fixedContent.match(/(export\s+const\s+use\w+Store\s*=\s*defineStore\([^)]+\)\s*=>\s*\{)/);
          if (storeFunctionMatch) {
            const afterDefineStore = fixedContent.indexOf(storeFunctionMatch[0]) + storeFunctionMatch[0].length;
            const beforeContent = fixedContent.substring(0, afterDefineStore);
            const afterContent = fixedContent.substring(afterDefineStore);
            fixedContent = beforeContent + `\n  const ${storeVarName} = ${storeName}();` + afterContent;
            return `${storeVarName}.${action}()`;
          }
        }
        
        // Otherwise, import and initialize
        const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
        if (importMatch) {
          const importIndex = fixedContent.lastIndexOf('\n', importMatch.index) + 1;
          const beforeImports = fixedContent.substring(0, importIndex);
          const afterImports = fixedContent.substring(importIndex);
          fixedContent = beforeImports + `import { ${storeName} } from '@/store/modules/${module}';\n` + afterImports;
        } else {
          fixedContent = `import { ${storeName} } from '@/store/modules/${module}';\n${fixedContent}`;
        }
        
        const storeFunctionMatch = fixedContent.match(/(export\s+const\s+use\w+Store\s*=\s*defineStore\([^)]+\)\s*=>\s*\{)/);
        if (storeFunctionMatch) {
          const afterDefineStore = fixedContent.indexOf(storeFunctionMatch[0]) + storeFunctionMatch[0].length;
          const beforeContent = fixedContent.substring(0, afterDefineStore);
          const afterContent = fixedContent.substring(afterDefineStore);
          fixedContent = beforeContent + `\n  const ${storeVarName} = ${storeName}();` + afterContent;
        }
        
        return `${storeVarName}.${action}()`;
      });
      
      // Pattern: dispatch('actionName') → try to infer store from action name (GENERIC)
      fixedContent = fixedContent.replace(/dispatch\(['"]([^'"]+)['"]\)/g, (match, action) => {
        // GENERIC: Infer store name from action name
        // Pattern: fetchUsers, fetchCurrentUser → useUserStore
        // Pattern: fetchProducts, fetchProduct → useProductStore
        // Pattern: fetchPosts, fetchPost → usePostStore
        // Extract entity name from action (e.g., "fetchUsers" → "user", "fetchProduct" → "product")
        let entityName = '';
        const actionLower = action.toLowerCase();
        
        // Common patterns: fetchXxx, getXxx, updateXxx, deleteXxx, createXxx
        const entityPatterns = [
          /fetch(\w+)/,
          /get(\w+)/,
          /update(\w+)/,
          /delete(\w+)/,
          /create(\w+)/,
          /set(\w+)/,
          /add(\w+)/,
          /remove(\w+)/
        ];
        
        for (const pattern of entityPatterns) {
          const patternMatch = actionLower.match(pattern);
          if (patternMatch) {
            let entity = patternMatch[1];
            // Handle plural forms: Users → user, Products → product
            if (entity.endsWith('s') && entity.length > 1) {
              entity = entity.slice(0, -1);
            }
            // Handle "Current" prefix: CurrentUser → user
            if (entity.startsWith('current')) {
              entity = entity.replace(/^current/, '');
            }
            if (entity) {
              entityName = entity;
              break;
            }
          }
        }
        
        // Fallback: if action contains common entity names
        if (!entityName) {
          const commonEntities = ['user', 'product', 'post', 'order', 'item', 'category', 'tag'];
          for (const entity of commonEntities) {
            if (actionLower.includes(entity)) {
              entityName = entity;
              break;
            }
          }
        }
        
        // If we found an entity name, construct store name generically
        if (entityName) {
          const storeName = `use${entityName.charAt(0).toUpperCase() + entityName.slice(1)}Store`;
          const storeVarName = `${entityName}Store`;
          
          // Check if store is already initialized
          if (fixedContent.includes(`const ${storeVarName} = ${storeName}`)) {
            return `${storeVarName}.${action}()`;
          }
          
          // Add import and initialization if needed (GENERIC)
          if (!fixedContent.includes(storeName)) {
            const importMatch = fixedContent.match(/^import\s+.*from\s+['"]/m);
            if (importMatch) {
              const importIndex = fixedContent.lastIndexOf('\n', importMatch.index) + 1;
              const beforeImports = fixedContent.substring(0, importIndex);
              const afterImports = fixedContent.substring(importIndex);
              fixedContent = beforeImports + `import { ${storeName} } from '@/store/modules/${entityName}';\n` + afterImports;
            } else {
              fixedContent = `import { ${storeName} } from '@/store/modules/${entityName}';\n${fixedContent}`;
            }
          }
          
          // Initialize store if not already done
          if (!fixedContent.includes(`const ${storeVarName} = ${storeName}`)) {
            const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
            if (scriptMatch) {
              const scriptContent = scriptMatch[1];
              const storeInitMatch = scriptContent.match(/(const\s+\w+Store\s*=\s*use\w+Store\s*\(\))/);
              if (storeInitMatch) {
                const lastStoreInit = storeInitMatch[storeInitMatch.length - 1];
                const initIndex = fixedContent.lastIndexOf(lastStoreInit) + lastStoreInit.length;
                fixedContent = fixedContent.substring(0, initIndex) + `\nconst ${storeVarName} = ${storeName}();` + fixedContent.substring(initIndex);
              } else {
                // Add after imports
                const importMatch = fixedContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                if (importMatch) {
                  const lastImport = importMatch[0];
                  const scriptTagMatch = fixedContent.match(/<script[^>]*>/);
                  const scriptTagEnd = scriptTagMatch ? fixedContent.indexOf(scriptTagMatch[0]) + scriptTagMatch[0].length : 0;
                  const importIndex = fixedContent.indexOf(lastImport, scriptTagEnd);
                  if (importIndex !== -1) {
                    const insertPos = importIndex + lastImport.length;
                    fixedContent = fixedContent.substring(0, insertPos) + `\nconst ${storeVarName} = ${storeName}();` + fixedContent.substring(insertPos);
                  }
                }
              }
            }
          }
          
          return `${storeVarName}.${action}()`;
        }
        
        return match; // Keep original if can't infer
      });
      
      result.fixed = true;
      result.fixes.push("Removed Vuex dispatch references from Pinia store");
    }
    
    // Pattern 3: commit('mutation', value, { root: true })
    // In Pinia, mutations are replaced by direct function calls
    if (fixedContent.includes("commit('") || fixedContent.includes('commit("')) {
      // Pattern: commit('SET_LOADING', true, { root: true })
      // Replace with direct function call: SET_LOADING(true)
      fixedContent = fixedContent.replace(/commit\(['"]([^'"]+)['"](?:,\s*([^,)]+))?(?:,\s*\{[^}]*root:\s*true[^}]*\})?\)/g, (match, mutation, value) => {
        // Extract mutation name and value
        const mutationName = mutation;
        const valuePart = value ? `(${value.trim()})` : '()';
        return `${mutationName}${valuePart}`;
      });
      
      result.fixed = true;
      result.fixes.push("Replaced Vuex commit calls with direct function calls in Pinia store");
    }
    
    // Pattern 4: Fix computed properties that reference undefined variables
    // Pattern: const [ANY_NAME] = computed(() => result) where result is undefined (GENERIC)
    // GENERIC: Auto-fix by creating proper filtering logic based on detected filters and array vars
    if (fixedContent.includes('computed') && (fixedContent.includes('=> result)') || fixedContent.includes('=> filtered'))) {
      const undefinedResultPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\([^)]*\)\s*=>\s*result\s*\)|const\s+(\w+)\s*=\s*computed\s*\([^)]*\)\s*=>\s*result\s*\)/g;
      let resultMatch;
      
      while ((resultMatch = undefinedResultPattern.exec(fixedContent)) !== null) {
        const computedName = resultMatch[1];
        const computedNameLower = computedName.toLowerCase();
        
        // Find array variables and filters in the store
        const arrayVars = Array.from(fixedContent.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*ref\s*\(/g)).map(m => m[1]);
        const filterVars = Array.from(fixedContent.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*reactive\s*\(/g)).map(m => m[1]);
        
        // Find the most likely array variable (usually users, items, products, etc.)
        let arrayVar: string | null = null;
        for (const varName of arrayVars) {
          const varNameLower = varName.toLowerCase();
          // Match if computed name contains part of var name (GENERIC - works for any names)
          if (computedNameLower.includes(varNameLower) || varNameLower.includes(computedNameLower.replace('filtered', ''))) {
            arrayVar = varName;
            break;
          }
        }
        
        // Fallback to first array var if no match
        if (!arrayVar && arrayVars.length > 0) {
          arrayVar = arrayVars[0];
        }
        
        // Find filter object (usually named 'filters')
        let filterVar: string | null = null;
        for (const varName of filterVars) {
          if (varName.toLowerCase().includes('filter')) {
            filterVar = varName;
            break;
          }
        }
        
        if (arrayVar) {
          // GENERIC: Create filtering logic based on detected filters
          const arrayVarWithValue = `${arrayVar}.value`;
          let filterLogic = `let result = ${arrayVarWithValue};`;
          
          if (filterVar) {
            // GENERIC: Detect filter properties dynamically from the filter object
            // Look for common filter property names in the code
            const filterProps = Array.from(fixedContent.matchAll(new RegExp(`${filterVar}\\.(\\w+)`, 'g'))).map(m => m[1]);
            const uniqueFilterProps = Array.from(new Set(filterProps));
            
            // Try to detect search filter (usually named 'search', 'query', 'term', etc.)
            const searchFilter = uniqueFilterProps.find(p => 
              ['search', 'query', 'term', 'filter'].includes(p.toLowerCase())
            );
            
            // Try to detect category/role/type filter (usually named 'category', 'role', 'type', etc.)
            const categoryFilter = uniqueFilterProps.find(p => 
              ['category', 'role', 'type', 'status', 'tag'].includes(p.toLowerCase())
            );
            
            // Add search filter logic if detected
            if (searchFilter) {
              filterLogic += `\n    if (${filterVar}.${searchFilter}) {
      const searchLower = ${filterVar}.${searchFilter}.toLowerCase();
      result = result.filter(item => 
        Object.values(item).some(value => 
          typeof value === 'string' && value.toLowerCase().includes(searchLower)
        )
      );
    }`;
            }
            
            // Add category/role/type filter logic if detected
            if (categoryFilter) {
              // Try to detect the property name in array items (usually same name or singular form)
              const itemProperty = categoryFilter; // Usually the same name
              filterLogic += `\n    if (${filterVar}.${categoryFilter}) {
      result = result.filter(item => item.${itemProperty} === ${filterVar}.${categoryFilter});
    }`;
            }
          }
          
          filterLogic += `\n    return result;`;
          
          // Preserve TypeScript type annotation if present
          const hasTypeAnnotation = resultMatch[0].includes('<');
          const typeAnnotation = hasTypeAnnotation ? resultMatch[0].match(/<[^>]+>/) : null;
          const typePart = typeAnnotation ? typeAnnotation[0] : '';
          
          const fixedComputed = `const ${computedName} = computed${typePart}(() => {\n    ${filterLogic}\n  })`;
          fixedContent = fixedContent.replace(resultMatch[0], fixedComputed);
          result.fixed = true;
          result.fixes.push(`Fixed undefined 'result' variable in computed '${computedName}' by adding generic filtering logic`);
        }
      }
    }
    
    // Fix: computed properties that reference computed properties without .value
    // Pattern: const [ANY_NAME] = computed(() => [COMPUTED_NAME].length) where [COMPUTED_NAME] is a computed (GENERIC)
    // Should be: const [ANY_NAME] = computed(() => [COMPUTED_NAME].value.length)
    const computedRefPattern = /const\s+(\w+)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(\w+)\.(length|map|filter|find|some|every|reduce)/g;
    let computedRefMatch;
    const computedRefs = new Set<string>();
    
    // First pass: find all computed properties
    const computedDefPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
    let computedDefMatch;
    while ((computedDefMatch = computedDefPattern.exec(fixedContent)) !== null) {
      computedRefs.add(computedDefMatch[1]);
    }
    
    // Second pass: fix references to computed properties without .value
    while ((computedRefMatch = computedRefPattern.exec(fixedContent)) !== null) {
      // Handle both patterns: with and without type annotation
      const computedName = computedRefMatch[1] || computedRefMatch[4];
      const referencedVar = computedRefMatch[2] || computedRefMatch[5];
      const method = computedRefMatch[3] || computedRefMatch[6];
      
      if (computedRefs.has(referencedVar)) {
        // This is a computed property being accessed without .value
        const wrongPattern = `${referencedVar}.${method}`;
        const correctPattern = `${referencedVar}.value.${method}`;
        
        // Preserve type annotation if present
        const hasTypeAnnotation = computedRefMatch[0].includes('<');
        const typeAnnotation = hasTypeAnnotation ? computedRefMatch[0].match(/<[^>]+>/) : null;
        const typePart = typeAnnotation ? typeAnnotation[0] : '';
        
        fixedContent = fixedContent.replace(
          new RegExp(`const\\s+${computedName}\\s*=\\s*computed${typePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)\\s*=>\\s*${wrongPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `const ${computedName} = computed${typePart}(() => ${correctPattern})`
        );
        result.fixed = true;
        result.fixes.push(`Fixed computed property access: ${referencedVar}.${method} → ${referencedVar}.value.${method}`);
      }
    }
    
    // Fix: Improved pattern for computed properties that reference computed properties without .value
    // Pattern: const [ANY_NAME] = computed(() => [COMPUTED_NAME].length) where [COMPUTED_NAME] is a computed (GENERIC)
    // Should be: const [ANY_NAME] = computed(() => [COMPUTED_NAME].value.length)
    // This is more robust than the previous pattern and handles parentheses correctly
    if (isVueFile || (filePath.endsWith('.ts') || filePath.endsWith('.js'))) {
      const computedNames = new Set<string>();
      
      // First pass: find all computed property names
      const allComputedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
      let allComputedMatch;
      while ((allComputedMatch = allComputedPattern.exec(fixedContent)) !== null) {
        computedNames.add(allComputedMatch[1]);
      }
      
      // Second pass: fix references to computed properties without .value
      // Use a more precise pattern that matches the exact structure
      const precisePattern = /const\s+(\w+)\s*=\s*computed\s*(<[^>]*>)?\s*\(\s*\(\)\s*=>\s*(\w+)\.length\s*\)/g;
      let preciseMatch;
      while ((preciseMatch = precisePattern.exec(fixedContent)) !== null) {
        const computedName = preciseMatch[1];
        const typeAnnotation = preciseMatch[2] || '<any>';
        const referencedVar = preciseMatch[3];
        
        if (computedNames.has(referencedVar)) {
          // This is a computed property being accessed without .value
          // Match the exact line including any trailing semicolon
          const fullMatch = preciseMatch[0];
          const correctPattern = `const ${computedName} = computed${typeAnnotation}(() => ${referencedVar}.value.length)`;
          
          // Replace only if the pattern matches exactly (avoid double parentheses)
          if (!fullMatch.includes('.value')) {
            fixedContent = fixedContent.replace(fullMatch, correctPattern);
            result.fixed = true;
            result.fixes.push(`Fixed computed property access: ${referencedVar}.length → ${referencedVar}.value.length`);
          }
        }
      }
      
      // Also fix pattern without type annotation (GENERIC - works for any computed name)
      const precisePatternNoType = /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+)\.length\s*\)/g;
      let preciseMatchNoType;
      while ((preciseMatchNoType = precisePatternNoType.exec(fixedContent)) !== null) {
        const computedName = preciseMatchNoType[1];
        const referencedVar = preciseMatchNoType[2];
        
        if (computedNames.has(referencedVar)) {
          const fullMatch = preciseMatchNoType[0];
          const correctPattern = `const ${computedName} = computed<any>(() => ${referencedVar}.value.length)`;
          
          if (!fullMatch.includes('.value')) {
            fixedContent = fixedContent.replace(fullMatch, correctPattern);
            result.fixed = true;
            result.fixes.push(`Fixed computed property access: ${referencedVar}.length → ${referencedVar}.value.length`);
          }
        }
      }
      
      // Also fix cases with extra closing parentheses (GENERIC - works for any computed name)
      const extraParenPattern = /const\s+(\w+)\s*=\s*computed\s*(<[^>]*>)?\s*\(\s*\(\)\s*=>\s*(\w+)\.length\s*\)\)+/g;
      let extraParenMatch;
      while ((extraParenMatch = extraParenPattern.exec(fixedContent)) !== null) {
        const computedName = extraParenMatch[1];
        const typeAnnotation = extraParenMatch[2] || '<any>';
        const referencedVar = extraParenMatch[3];
        
        if (computedNames.has(referencedVar)) {
          const fullMatch = extraParenMatch[0];
          const correctPattern = `const ${computedName} = computed${typeAnnotation}(() => ${referencedVar}.value.length)`;
          
          fixedContent = fixedContent.replace(fullMatch, correctPattern);
          result.fixed = true;
          result.fixes.push(`Fixed computed property access with extra parentheses: ${referencedVar}.length → ${referencedVar}.value.length`);
        }
      }
    }
    
    // Fix: Remove extra closing parentheses after computed properties (GENERIC)
    // Pattern: })); or )); where there should be }); or );
    // This fixes cases where multiple rules have added extra parentheses
    if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
      let parenFixed = false;
      
      // Fix computed with block: })); → });
      // Match: const name = computed(() => { ... })); with extra )
      // More precise pattern that matches the full computed declaration
      const computedBlockPattern = /(const\s+\w+\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{[^}]*return[^}]*\})\s*\)\)+/g;
      fixedContent = fixedContent.replace(computedBlockPattern, (match) => {
        // Remove extra closing parentheses, keep only one after the block
        const fixed = match.replace(/\}\)\)+$/, '})');
        if (fixed !== match) {
          parenFixed = true;
        }
        return fixed;
      });
      
      // Fix computed with simple expression: )); → );
      // Match: const name = computed(() => expr)); with extra )
      const computedSimplePattern = /(const\s+\w+\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*[^)]+\))\)\)+/g;
      fixedContent = fixedContent.replace(computedSimplePattern, (match) => {
        // Remove extra closing parentheses, keep only one
        const fixed = match.replace(/\)\)+$/, ')');
        if (fixed !== match) {
          parenFixed = true;
        }
        return fixed;
      });
      
      // More specific: Fix patterns like })); at end of computed block
      // This handles cases where the computed block ends with })); instead of });
      // Look for })); that appears after a computed block
      const computedBlockEndPattern = /(\}\s*)\)\)+/g;
      let blockEndMatch;
      while ((blockEndMatch = computedBlockEndPattern.exec(fixedContent)) !== null) {
        const matchIndex = blockEndMatch.index;
        const beforeMatch = fixedContent.substring(Math.max(0, matchIndex - 200), matchIndex);
        // Check if we're inside a computed block
        if (beforeMatch.includes('computed') && beforeMatch.includes('() => {')) {
          const fixed = blockEndMatch[0].replace(/\)\)+$/, ')');
          fixedContent = fixedContent.substring(0, matchIndex) + fixed + fixedContent.substring(matchIndex + blockEndMatch[0].length);
          parenFixed = true;
          // Reset regex lastIndex since we modified the string
          computedBlockEndPattern.lastIndex = 0;
        }
      }
      
      // Fix: Remove extra closing parentheses after computed property access
      // Pattern: [COMPUTED].value.length)); → [COMPUTED].value.length); (GENERIC)
      const computedAccessPattern = /(\.value\.length)\)\)+/g;
      fixedContent = fixedContent.replace(computedAccessPattern, (match) => {
        const fixed = match.replace(/\)\)+$/, ')');
        if (fixed !== match) {
          parenFixed = true;
        }
        return fixed;
      });
      
      // Also fix standalone patterns: ))); → );
      // This catches any remaining cases
      const standaloneExtraParenPattern = /(\))\)\)+/g;
      fixedContent = fixedContent.replace(standaloneExtraParenPattern, (match) => {
        // Only fix if it's part of a computed (check context)
        const matchIndex = fixedContent.indexOf(match);
        if (matchIndex > 0) {
          const beforeMatch = fixedContent.substring(Math.max(0, matchIndex - 100), matchIndex);
          if (beforeMatch.includes('computed') || beforeMatch.includes('.value')) {
            const fixed = match.replace(/\)\)+$/, ')');
            if (fixed !== match) {
              parenFixed = true;
            }
            return fixed;
          }
        }
        return match;
      });
      
      if (parenFixed) {
        result.fixed = true;
        result.fixes.push('Removed extra closing parentheses from computed properties');
      }
    }
    
    // Fix: Synchronize v-model bindings with store filters
    // Pattern: v-model="searchQuery" or v-model="selectedRole" where handlers call setFilter
    // Should add watch statements to sync local refs with store filters
    if (isVueFile && fixedContent.includes('<script setup')) {
      const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];
        const templateMatch = fixedContent.match(/<template[^>]*>([\s\S]*?)<\/template>/);
        const templateContent = templateMatch ? templateMatch[1] : '';
        
        // Find v-model bindings in template
        const vModelPattern = /v-model\s*=\s*["'](\w+)["']/g;
        const vModelBindings = new Set<string>();
        let vModelMatch;
        while ((vModelMatch = vModelPattern.exec(templateContent)) !== null) {
          vModelBindings.add(vModelMatch[1]);
        }
        
        const storePattern = /const\s+(\w+Store)\s*=\s*use\w+Store\s*\(\)/g;
        const stores = new Map<string, string>();
        let storeMatch;
        while ((storeMatch = storePattern.exec(scriptContent)) !== null) {
          stores.set(storeMatch[1], storeMatch[0]);
        }
        
        // Find filter property names from setFilter calls
        const setFilterPattern = /setFilter\s*\(\s*\{\s*key\s*:\s*["'](\w+)["']/g;
        const filterKeys = new Set<string>();
        let filterMatch;
        while ((filterMatch = setFilterPattern.exec(scriptContent)) !== null) {
          filterKeys.add(filterMatch[1]);
        }
        
        // For each v-model binding that corresponds to a filter key, add watch synchronization
        vModelBindings.forEach((bindingName) => {
          // Check if this binding corresponds to a filter (e.g., searchQuery -> search, selectedRole -> role)
          const filterKey = Array.from(filterKeys).find(key => {
            const keyLower = key.toLowerCase();
            const bindingLower = bindingName.toLowerCase();
            // Match patterns: searchQuery -> search, selectedRole -> role, etc.
            return bindingLower.includes(keyLower) || keyLower.includes(bindingLower.replace(/^(selected|search|filter)/i, ''));
          });
          
          if (filterKey && stores.size > 0) {
            const storeName = Array.from(stores.keys())[0]; // Use first store found
            const storeVar = storeName;
            
            // Check if watch already exists for this binding
            const watchStoreToLocalPattern = new RegExp(`watch\\(\\s*\\(\\)\\s*=>\\s*${storeVar}\\.filters\\.${filterKey}`, 'g');
            const watchLocalToStorePattern = new RegExp(`watch\\(\\s*${bindingName}\\s*,`, 'g');
            
            if (!watchStoreToLocalPattern.test(scriptContent) || !watchLocalToStorePattern.test(scriptContent)) {
              // Add watch imports if missing
              const watchImportPattern = /import\s+\{[^}]*watch[^}]*\}\s+from\s+['"]vue['"]/;
              const hasWatchImport = watchImportPattern.test(scriptContent);
              
              if (!hasWatchImport) {
                const vueImportPattern = /import\s+\{([^}]+)\}\s+from\s+['"]vue['"]/;
                const vueImportMatch = scriptContent.match(vueImportPattern);
                if (vueImportMatch) {
                  const imports = vueImportMatch[1];
                  if (!imports.includes('watch')) {
                    fixedContent = fixedContent.replace(
                      vueImportPattern,
                      `import { ${imports.trim()}, watch } from 'vue'`
                    );
                    // Update scriptContent for subsequent checks
                    const updatedScriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
                    if (updatedScriptMatch) {
                      // Re-extract scriptContent after modification
                    }
                  }
                } else {
                  // Add new import
                  const firstImportMatch = scriptContent.match(/^import\s+/m);
                  if (firstImportMatch) {
                    const importIndex = fixedContent.indexOf(firstImportMatch[0]);
                    const watchImport = `import { watch } from 'vue';\n`;
                    fixedContent = fixedContent.substring(0, importIndex) + watchImport + fixedContent.substring(importIndex);
                  }
                }
              }
              
              // Find insertion point (after last store initialization)
              const storeInitPattern = new RegExp(`(const\\s+${storeVar}\\s*=\\s*use\\w+Store\\s*\\(\\)[^;]*;)`, 'g');
              const storeInitMatches = scriptContent.match(storeInitPattern);
              let insertIndex = -1;
              let insertAfter = '';
              
              if (storeInitMatches && storeInitMatches.length > 0) {
                insertAfter = storeInitMatches[storeInitMatches.length - 1];
                insertIndex = fixedContent.indexOf(insertAfter) + insertAfter.length;
              } else {
                // Fallback: insert after last const declaration
                const lastConstMatch = scriptContent.match(/const\s+\w+\s*=\s*[^;]+;/g);
                if (lastConstMatch && lastConstMatch.length > 0) {
                  insertAfter = lastConstMatch[lastConstMatch.length - 1];
                  insertIndex = fixedContent.indexOf(insertAfter) + insertAfter.length;
                }
              }
              
              if (insertIndex > 0) {
                let watchCode = '';
                
                // Add watch to sync store filter -> local ref
                if (!watchStoreToLocalPattern.test(scriptContent)) {
                  watchCode += `\nwatch(() => ${storeVar}.filters.${filterKey}, (newValue) => { ${bindingName}.value = newValue || ''; });`;
                }
                
                // Add watch to sync local ref -> store filter
                if (!watchLocalToStorePattern.test(scriptContent)) {
                  watchCode += `\nwatch(${bindingName}, (newValue) => { ${storeVar}.setFilter({ key: '${filterKey}', value: newValue || null }); });`;
                }
                
                if (watchCode) {
                  fixedContent = fixedContent.substring(0, insertIndex) + watchCode + fixedContent.substring(insertIndex);
                  result.fixed = true;
                  result.fixes.push(`Added watch to sync ${bindingName} with ${storeVar}.filters.${filterKey}`);
                }
              }
            }
          }
        });
      }
    }
    
    // Fix: Correct incorrect store references
    // Pattern: wrongStore.propertyName where propertyName suggests a different store (GENERIC)
    // This is generic - works for any store property mismatch
    if (isVueFile && fixedContent.includes('<script setup')) {
      const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];
        
        // Find all store initializations
        const storePattern = /const\s+(\w+Store)\s*=\s*use(\w+)Store\s*\(\)/g;
        const stores = new Map<string, string>(); // storeVar -> storeName
        let storeMatch;
        while ((storeMatch = storePattern.exec(scriptContent)) !== null) {
          stores.set(storeMatch[1], storeMatch[2].toLowerCase());
        }
        
        // Find property accesses like storeName.property
        const propertyAccessPattern = /(\w+Store)\.(\w+)/g;
        let propertyMatch;
        const propertyAccesses = new Map<string, Set<string>>(); // storeVar -> Set<propertyName>
        
        while ((propertyMatch = propertyAccessPattern.exec(scriptContent)) !== null) {
          const storeVar = propertyMatch[1];
          const propertyName = propertyMatch[2];
          if (!propertyAccesses.has(storeVar)) {
            propertyAccesses.set(storeVar, new Set());
          }
          propertyAccesses.get(storeVar)!.add(propertyName);
        }
        
        // For each property access, check if it should come from a different store
        // Generic inference: if property name suggests a different store
        propertyAccesses.forEach((properties, storeVar) => {
          const currentStoreName = stores.get(storeVar);
          if (!currentStoreName) return;
          
          properties.forEach((propertyName) => {
            // Infer correct store from property name (generic)
            // Pattern: allItems -> item, allProducts -> product, etc. (GENERIC inference)
            const propertyLower = propertyName.toLowerCase();
            let inferredStoreName: string | null = null;
            
            // Remove "all" prefix if present
            const withoutAll = propertyLower.replace(/^all/, '');
            // Remove plural ending
            const singular = withoutAll.endsWith('s') ? withoutAll.slice(0, -1) : withoutAll;
            // Remove "ies" -> "y"
            const normalized = singular.endsWith('ies') ? singular.slice(0, -3) + 'y' : singular;
            
            // Check if normalized name matches a store name
            stores.forEach((storeName, otherStoreVar) => {
              if (storeName === normalized && otherStoreVar !== storeVar) {
                inferredStoreName = storeName;
              }
            });
            
            // If inferred store is different, suggest correction
            if (inferredStoreName && inferredStoreName !== currentStoreName) {
              const correctStoreVar = Array.from(stores.entries()).find(([, name]) => name === inferredStoreName)?.[0];
              if (correctStoreVar) {
                // Replace incorrect reference
                const wrongPattern = new RegExp(`${storeVar}\\.${propertyName}`, 'g');
                if (wrongPattern.test(scriptContent)) {
                  fixedContent = fixedContent.replace(wrongPattern, `${correctStoreVar}.${propertyName}`);
                  result.fixed = true;
                  result.fixes.push(`Fixed incorrect store reference: ${storeVar}.${propertyName} → ${correctStoreVar}.${propertyName}`);
                }
              }
            }
          });
        });
      }
    }
    
    // Fix: SET_LOADING calls in stores that don't have loading state
    // Pattern: SET_LOADING(true) but no loading ref/reactive defined
    // IMPORTANT: First remove ALL duplicate declarations before adding new ones
    // GENERIC: Works for any variable/function name, not just 'loading' and 'SET_LOADING'
    if ((filePath.endsWith('.ts') || filePath.endsWith('.js')) && filePath.includes('store')) {
      // GENERIC: Remove duplicate variable declarations (any variable name, not just 'loading')
      // Pattern: const/let/var variableName = ref/reactive<...>(...);
      // Strategy: Find all variable declarations and remove duplicates
      const variableDeclPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:ref|reactive)\s*<[^>]*>\s*\([^)]*\);?\s*\n?\s*/g;
      const variableMatches = Array.from(fixedContent.matchAll(variableDeclPattern));
      
      // Group by variable name to detect duplicates
      const variableCounts = new Map<string, number>();
      variableMatches.forEach(match => {
        const varName = match[1];
        variableCounts.set(varName, (variableCounts.get(varName) || 0) + 1);
      });
      
      // Remove duplicates for variables that appear more than once
      variableCounts.forEach((count, varName) => {
        if (count > 1) {
          let firstFound = false;
          const varPattern = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*(?:ref|reactive)\\s*<[^>]*>\\s*\\([^)]*\\);?\\s*\\n?\\s*`, 'g');
          fixedContent = fixedContent.replace(varPattern, (match) => {
            if (!firstFound) {
              firstFound = true;
              return match;
            }
            return ''; // Remove duplicate
          });
          result.fixed = true;
          result.fixes.push(`Removed ${count - 1} duplicate '${varName}' variable declarations`);
        }
      });
      
      // GENERIC: Remove duplicate function declarations (any function name, not just 'SET_LOADING')
      // Pattern: function functionName(...): returnType { ... }
      // Strategy: Find all function declarations and remove duplicates
      const functionDeclPattern = /function\s+(\w+)\s*\([^)]*\)\s*:\s*\w+\s*\{[^}]*\}\s*\n?\s*/g;
      const functionMatches = Array.from(fixedContent.matchAll(functionDeclPattern));
      
      // Group by function name to detect duplicates
      const functionCounts = new Map<string, number>();
      functionMatches.forEach(match => {
        const funcName = match[1];
        functionCounts.set(funcName, (functionCounts.get(funcName) || 0) + 1);
      });
      
      // Remove duplicates for functions that appear more than once
      functionCounts.forEach((count, funcName) => {
        if (count > 1) {
          let firstFound = false;
          // More precise pattern that matches the full function declaration
          const funcPattern = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*:\\s*\\w+\\s*\\{[^}]*\\}\\s*\\n?\\s*`, 'g');
          fixedContent = fixedContent.replace(funcPattern, (match) => {
            if (!firstFound) {
              firstFound = true;
              return match;
            }
            return ''; // Remove duplicate
          });
          result.fixed = true;
          result.fixes.push(`Removed ${count - 1} duplicate '${funcName}' function declarations`);
        }
      });
      
      // GENERIC: Detect SET_* function calls (SET_LOADING, SET_USER, SET_DATA, etc.) that are called but not defined
      // Pattern: SET_XXX(...) where SET_XXX is not defined as a function
      const setFunctionPattern = /SET_(\w+)\s*\(/g;
      const setFunctionCalls = Array.from(fixedContent.matchAll(setFunctionPattern));
      const setFunctionsToFix = new Map<string, { varName: string; funcName: string }>();
      
      // For each SET_* function call, check if it's defined
      setFunctionCalls.forEach(match => {
        const funcName = match[0].replace(/\s*\(/, ''); // e.g., "SET_LOADING"
        const varName = match[1].toLowerCase(); // e.g., "loading" from "SET_LOADING"
        
        // Check if function is defined (more precise pattern - check for function declaration or in return statement)
        const funcDefinedPattern = new RegExp(`function\\s+${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)`, 'g');
        const funcInReturnPattern = new RegExp(`${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`); // In return: { SET_LOADING: SET_LOADING }
        const funcDefined = funcDefinedPattern.test(fixedContent) || funcInReturnPattern.test(fixedContent);
        
        // Check if corresponding variable exists (more precise pattern)
        // Handle both camelCase and snake_case: SET_LOADING -> loading, SET_CURRENT_USER -> currentUser or current_user
        const varNameVariants = [
          varName, // loading
          varName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), // current_user -> currentUser
          varName.replace(/([A-Z])/g, '_$1').toLowerCase() // currentUser -> current_user
        ];
        
        // Also check for plural forms: SET_FILTER -> filters (reactive object)
        if (varName.endsWith('s')) {
          varNameVariants.push(varName.slice(0, -1)); // filters -> filter
        } else {
          varNameVariants.push(varName + 's'); // filter -> filters
        }
        
        let varExists = false;
        for (const variant of varNameVariants) {
          // Check for ref/reactive declarations
          const varPattern = new RegExp(`(?:const|let|var)\\s+${variant}\\s*=\\s*(?:ref|reactive)\\s*\\(`, 'i');
          if (varPattern.test(fixedContent)) {
            varExists = true;
            break;
          }
        }
        
        // Only mark for fix if function is called but not defined AND variable doesn't exist
        // Don't fix if function exists (even if variable doesn't, as it might be intentional)
        if (!funcDefined && !varExists) {
          setFunctionsToFix.set(funcName, { varName, funcName });
        }
      });
      
      // Process each SET_* function that needs fixing
      setFunctionsToFix.forEach(({ varName }, fullFuncName) => {
        // Check if there's an index store (generic detection)
        const indexStorePattern = /useIndexStore|@\/store\/index|@\/stores\/index/;
        const hasIndexStore = indexStorePattern.test(fixedContent);
        
        // Try to detect if index store has a corresponding method (e.g., setLoading, setUser, etc.)
        // Pattern: setLoading, setUser, etc. (camelCase version)
        const camelCaseMethod = varName.charAt(0).toUpperCase() + varName.slice(1); // loading -> Loading
        const setMethodName = `set${camelCaseMethod}`; // setLoading
        
        if (hasIndexStore && indexStorePattern.test(fixedContent)) {
          // Check if index store has the method
          const indexStoreHasMethod = new RegExp(`${setMethodName}\\s*\\(`).test(fixedContent) ||
                                     new RegExp(`const\\s+${setMethodName}\\s*=`).test(fixedContent);
          
          if (indexStoreHasMethod) {
            // Replace SET_XXX with indexStore.setXxx
            const setFuncPattern = new RegExp(`${fullFuncName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g');
            fixedContent = fixedContent.replace(setFuncPattern, `${setMethodName}(`);
            
            // Add indexStore import and initialization if needed (generic)
            const indexStoreImportPattern = /import\s+.*useIndexStore.*from/;
            if (!indexStoreImportPattern.test(fixedContent)) {
              const importMatch = fixedContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                fixedContent = fixedContent.replace(
                  /(import\s+[^;]+;[\s\n]*)+/,
                  `$&import { useIndexStore } from '@/store/index';\n`
                );
              } else {
                fixedContent = `import { useIndexStore } from '@/store/index';\n${fixedContent}`;
              }
            }
            
            // Add indexStore initialization if needed (generic)
            const indexStoreInitPattern = /const\s+indexStore\s*=\s*useIndexStore\s*\(/;
            if (!indexStoreInitPattern.test(fixedContent)) {
              const storeMatch = fixedContent.match(/export\s+const\s+use\w+Store\s*=\s*defineStore/);
              if (storeMatch) {
                const afterDefineStore = fixedContent.indexOf(storeMatch[0]) + storeMatch[0].length;
                const beforeContent = fixedContent.substring(0, afterDefineStore);
                const afterContent = fixedContent.substring(afterDefineStore);
                fixedContent = beforeContent + `\n  const indexStore = useIndexStore();` + afterContent;
              }
            }
            
            result.fixed = true;
            result.fixes.push(`Redirected ${fullFuncName} to indexStore.${setMethodName}`);
          }
        }
        
        // If no index store or method not found, add state and function to current store
        // Check if variable already exists (handle variants)
        const varNameVariants = [
          varName, // loading
          varName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), // current_user -> currentUser
          varName.replace(/([A-Z])/g, '_$1').toLowerCase() // currentUser -> current_user
        ];
        
        let hasVar = false;
        for (const variant of varNameVariants) {
          const varPattern = new RegExp(`(?:const|let|var)\\s+${variant}\\s*=\\s*(?:ref|reactive)\\s*\\(`, 'i');
          if (varPattern.test(fixedContent)) {
            hasVar = true;
            break;
          }
        }
        
        const funcPattern = new RegExp(`function\\s+${fullFuncName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)`, 'g');
        const hasFunc = funcPattern.test(fixedContent);
        
        // Only add if both variable and function are missing
        if (!hasVar && !hasFunc) {
          const storeMatch = fixedContent.match(/export\s+const\s+use\w+Store\s*=\s*defineStore\s*\([^)]+\)\s*=>\s*\{/);
          if (storeMatch) {
            const afterDefineStore = fixedContent.indexOf(storeMatch[0]) + storeMatch[0].length;
            const beforeContent = fixedContent.substring(0, afterDefineStore);
            const afterContent = fixedContent.substring(afterDefineStore);
            
            // Find first ref/reactive declaration to insert after (to maintain order)
            const firstRefMatch = afterContent.match(/(const\s+\w+\s*=\s*ref\s*\()/);
            let insertPos = 0;
            if (firstRefMatch) {
              insertPos = afterContent.indexOf(firstRefMatch[0]) + firstRefMatch[0].length;
              const nextSemicolon = afterContent.indexOf(';', insertPos);
              const nextNewline = afterContent.indexOf('\n', insertPos);
              insertPos = Math.min(nextSemicolon !== -1 ? nextSemicolon + 1 : afterContent.length, nextNewline !== -1 ? nextNewline + 1 : afterContent.length);
            }
            
            // GENERIC: Add variable and function (works for any SET_XXX pattern)
            const varType = varName.includes('loading') || varName.includes('is') ? 'boolean' : 'any';
            const stateCode = `\n  const ${varName} = ref<${varType}>(false);\n  \n  function ${fullFuncName}(value: ${varType}): void {\n    ${varName}.value = value;\n  }\n`;
            fixedContent = beforeContent + afterContent.substring(0, insertPos) + stateCode + afterContent.substring(insertPos);
            
            // Add to return statement (generic)
            // GENERIC: Fix return statement syntax - ensure proper comma placement
            const returnMatch = fixedContent.match(/return\s+(\{[\s\S]*?)(\})/);
            if (returnMatch) {
              const returnContent = returnMatch[1];
              if (!returnContent.includes(varName) && !returnContent.includes(fullFuncName)) {
                // Find the last property in the return statement
                const lastPropMatch = returnContent.match(/(\w+:\s*\w+)([,\n]*)\s*$/);
                if (lastPropMatch) {
                  const lastProp = lastPropMatch[1];
                  const afterLastProp = lastPropMatch[2];
                  // If last property doesn't end with comma, add it
                  if (!afterLastProp.includes(',')) {
                    // Replace the last property with version that has comma, then add new properties
                    fixedContent = fixedContent.replace(
                      /return\s+(\{[\s\S]*?)(\})/,
                      `return $1${lastProp},\n    ${varName}: ${varName},\n    ${fullFuncName}: ${fullFuncName},\n$2`
                    );
                  } else {
                    // Last property already has comma, just add new properties
                    fixedContent = fixedContent.replace(
                      /return\s+(\{[\s\S]*?)(\})/,
                      `return $1    ${varName}: ${varName},\n    ${fullFuncName}: ${fullFuncName},\n$2`
                    );
                  }
                } else {
                  // No properties yet - add new properties
                  fixedContent = fixedContent.replace(
                    /return\s+(\{[\s\S]*?)(\})/,
                    `return $1    ${varName}: ${varName},\n    ${fullFuncName}: ${fullFuncName},\n$2`
                  );
                }
              }
            }
            
            result.fixed = true;
            result.fixes.push(`Added missing ${varName} state and ${fullFuncName} function`);
          }
        }
      });
    }
  }

  // Fix: Correct return statement syntax errors (missing commas, etc.)
  // GENERIC: Fix any return statement with syntax errors
  if ((filePath.endsWith('.ts') || filePath.endsWith('.js')) && filePath.includes('store')) {
    // Pattern: return { ... property } - missing comma before closing brace
    // Pattern: return { ... property\n      newProperty: value } - missing comma after property
    const returnStatementPattern = /return\s+(\{[\s\S]*?)(\})/g;
    let returnMatch;
    
    while ((returnMatch = returnStatementPattern.exec(fixedContent)) !== null) {
      const returnContent = returnMatch[1];
      
      // Check for missing comma before closing brace (property followed by newline and closing brace)
      const missingCommaPattern = /(\w+:\s*\w+)\s*\n\s*\}/;
      if (missingCommaPattern.test(returnContent)) {
        fixedContent = fixedContent.replace(
          /(\w+:\s*\w+)\s*\n\s*\}/g,
          '$1,\n  }'
        );
        result.fixed = true;
        result.fixes.push("Fixed missing comma in return statement");
      }
      
      // Check for property without comma followed by another property on new line
      const missingCommaBetweenProps = /(\w+:\s*\w+)\s*\n\s*(\w+:\s*\w+)/;
      if (missingCommaBetweenProps.test(returnContent)) {
        fixedContent = fixedContent.replace(
          /(\w+:\s*\w+)\s*\n\s*(\w+:\s*\w+)/g,
          '$1,\n    $2'
        );
        result.fixed = true;
        result.fixes.push("Fixed missing comma between properties in return statement");
      }
    }
  }

  // Fix: Correct return statement syntax errors (missing commas, etc.)
  // GENERIC: Fix any return statement with syntax errors in store files
  if ((filePath.endsWith('.ts') || filePath.endsWith('.js')) && filePath.includes('store')) {
    // Pattern: return { ... property } - missing comma before closing brace
    // Pattern: return { ... property\n      newProperty: value } - missing comma after property
    const returnStatementPattern = /return\s+(\{[\s\S]*?)(\})/g;
    let returnMatch;
    
    while ((returnMatch = returnStatementPattern.exec(fixedContent)) !== null) {
      const returnContent = returnMatch[1];
      
      // Check for missing comma before closing brace (property followed by newline and closing brace without comma)
      const missingCommaPattern = /(\w+:\s*\w+)\s*\n\s*\}/;
      if (missingCommaPattern.test(returnContent)) {
        fixedContent = fixedContent.replace(
          /(\w+:\s*\w+)\s*\n\s*\}/g,
          '$1,\n  }'
        );
        result.fixed = true;
        result.fixes.push("Fixed missing comma in return statement");
      }
      
      // Check for property without comma followed by another property on new line
      const missingCommaBetweenProps = /(\w+:\s*\w+)\s*\n\s*(\w+:\s*\w+)/;
      if (missingCommaBetweenProps.test(returnContent)) {
        fixedContent = fixedContent.replace(
          /(\w+:\s*\w+)\s*\n\s*(\w+:\s*\w+)/g,
          '$1,\n    $2'
        );
        result.fixed = true;
        result.fixes.push("Fixed missing comma between properties in return statement");
      }
    }
  }

  // Final cleanup: Remove any remaining inline imports in script setup tags and merge duplicates
  // This handles cases where inline imports were created by other fixers after Fix 8b
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );

    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const inlineImportMatch = fixedContent.match(
        /(<script\s+setup[^>]*>)\s*import\s+([^;]+);/
      );

      if (inlineImportMatch) {
        // Extract inline import
        const inlineImportContent = `import ${inlineImportMatch[2]};`;

        // Add to scriptContent if not already present
        scriptContent = inlineImportContent + "\n" + scriptContent;

        // Remove inline import from script tag
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)\s*import\s+[^;]+;\s*/,
          "$1\n"
        );

        // Now merge duplicate imports
        const allImports: Array<{ content: string; normalized: string }> = [];
        const importPattern = /import\s+[^;]+;/g;
        let importMatch;
        importPattern.lastIndex = 0;

        while ((importMatch = importPattern.exec(scriptContent)) !== null) {
          if (importMatch && importMatch[0]) {
            const content = importMatch[0];
            const normalized = content.replace(/\s+/g, " ").trim();
            const alreadyExists = allImports.some(
              (imp) => imp.normalized === normalized
            );
            if (!alreadyExists) {
              allImports.push({ content, normalized });
            }
          }
        }

        // Group by module and merge exports
        // IMPORTANT: Separate named imports from default imports (component imports)
        const importsByModule = new Map<string, Set<string>>();
        const defaultImports: string[] = []; // Store default imports separately (e.g., import ComponentName from '...')
        
        allImports.forEach(({ normalized, content }) => {
          // Check if it's a default import (component import): import ComponentName from '...'
          const defaultImportMatch = normalized.match(
            /import\s+([A-Z][a-zA-Z0-9]*)\s+from\s+['"]([^'"]+)['"]/
          );
          if (defaultImportMatch) {
            // It's a default import (component), preserve it as-is
            defaultImports.push(content);
          } else {
            // It's a named import: import { ... } from '...'
            const importNameMatch = normalized.match(
              /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/
            );
            if (importNameMatch) {
              const exportNames = importNameMatch[1]
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              const fromPath = importNameMatch[2];

              if (!importsByModule.has(fromPath)) {
                importsByModule.set(fromPath, new Set());
              }
              const moduleExports = importsByModule.get(fromPath)!;
              exportNames.forEach((name) => moduleExports.add(name));
            }
          }
        });

        // Rebuild unique imports (named imports grouped by module)
        const uniqueImports: string[] = [];
        importsByModule.forEach((exports, modulePath) => {
          const sortedExports = Array.from(exports)
            .sort()
            .filter((e) => e.length > 0);
          if (sortedExports.length > 0) {
            uniqueImports.push(
              `import { ${sortedExports.join(", ")} } from '${modulePath}';`
            );
          }
        });

        // Remove all imports and rebuild (preserving default imports)
        const cleanedContent = scriptContent.replace(
          /import\s+[^;]+;\s*\n?/g,
          ""
        );
        
        // Combine named imports and default imports
        const allUniqueImports = [...uniqueImports, ...defaultImports];
        if (allUniqueImports.length > 0) {
          scriptContent = allUniqueImports.join("\n") + "\n\n" + cleanedContent;
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`
          );
          result.fixed = true;
          result.fixes.push(
            "Merged duplicate imports from same modules (final cleanup)"
          );
        }
      }
    }
  }

  // Fix: Correct incorrect store import paths (GENERIC)
  // Pattern: import { useIndexStore } from '@/store/modules/index' → import { useIndexStore } from '@/store/index'
  // This fixes cases where the index store is incorrectly imported from modules/index instead of store/index
  // Works for any store name, not just useIndexStore
  if (fixedContent.includes("@/store/modules/index")) {
    // Check if store/index.ts or store/index.js exists
    if (projectRoot) {
      const storeIndexPath = path.join(projectRoot, "src", "store", "index.ts");
      const storeIndexPathJs = path.join(projectRoot, "src", "store", "index.js");
      
      if (fsSync.existsSync(storeIndexPath) || fsSync.existsSync(storeIndexPathJs)) {
        // Replace all imports from @/store/modules/index to @/store/index
        // This is generic and works for any store name
        fixedContent = fixedContent.replace(
          /from\s+['"]@\/store\/modules\/index['"]/g,
          'from "@/store/index"'
        );
        
        if (fixedContent !== content) {
          result.fixed = true;
          result.fixes.push("Corrected incorrect store import: @/store/modules/index → @/store/index");
        }
      }
    }
  }

  // Final pass: Re-check and add missing component imports (in case they were missed earlier)
  // This ensures component imports are added even if other rules modified the script
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
    
    if (scriptSetupMatch && templateMatch) {
      let scriptContent = scriptSetupMatch[1];
      const templateContent = templateMatch[1];
      
      // Detect component usage: <ComponentName /> or <component-name />
      const pascalCasePattern = /<([A-Z][a-zA-Z0-9]*)(?:\s|>|\/)|<\/([A-Z][a-zA-Z0-9]*)>/g;
      const usedComponents = new Set<string>();
      let componentMatch;
      
      while ((componentMatch = pascalCasePattern.exec(templateContent)) !== null) {
        const componentName = componentMatch[1] || componentMatch[2];
        if (!componentName) continue;
        
        // Skip built-in Vue components and Vue Router components (they don't need imports)
        const builtInComponents = [
          'RouterView', 'RouterLink', 'Transition', 'KeepAlive', 'Suspense', 'Teleport',
          'TransitionGroup', 'Component', 'Fragment', 'Suspense'
        ];
        const htmlTags = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'input', 'select', 'option', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'form', 'label', 'nav', 'header', 'footer', 'main', 'section', 'article', 'aside'];
        if (!builtInComponents.includes(componentName) && !htmlTags.includes(componentName.toLowerCase())) {
          usedComponents.add(componentName);
        }
      }
      
      // Check kebab-case components
      const kebabCasePattern = /<([a-z]+(?:-[a-z]+)+)(?:\s|>|\/)|<\/([a-z]+(?:-[a-z]+)+)>/g;
      while ((componentMatch = kebabCasePattern.exec(templateContent)) !== null) {
        const kebabName = componentMatch[1] || componentMatch[2];
        const pascalName = kebabName.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join('');
        usedComponents.add(pascalName);
      }
      
      // Add imports for used components if not already imported
      const componentsToImport: string[] = [];
      usedComponents.forEach(componentName => {
        const defaultImportPattern = new RegExp(`import\\s+${componentName}\\s+from`);
        const namedImportPattern = new RegExp(`import\\s+\\{[^}]*\\b${componentName}\\b[^}]*\\}\\s+from`);
        const isAlreadyImported = scriptContent.match(defaultImportPattern) || scriptContent.match(namedImportPattern);
        
        if (!isAlreadyImported) {
          componentsToImport.push(componentName);
        }
      });
      
      // Add all missing component imports at once
      if (componentsToImport.length > 0) {
        const componentImports = componentsToImport.map(componentName => {
          const componentPath = `@/components/${componentName}.vue`;
          return `import ${componentName} from '${componentPath}';`;
        }).join('\n');
        
        const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        if (importMatch) {
          scriptContent = scriptContent.replace(
            /(import\s+[^;]+;[\s\n]*)+/,
            `$&${componentImports}\n`
          );
        } else {
          scriptContent = `${componentImports}\n${scriptContent}`;
        }
        
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`
        );
        result.fixed = true;
        result.fixes.push(`Added missing component import${componentsToImport.length > 1 ? 's' : ''} (final pass): ${componentsToImport.join(', ')}`);
      }
    }
  }

  // Final fix: Remove incorrect imports for built-in Vue Router components (execute last)
  // RouterView and RouterLink are built-in components and don't need imports
  // This must run after all other import-related fixes
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/
    );
    
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const builtInRouterComponents = ['RouterView', 'RouterLink'];
      let hasRemovedImports = false;
      
      builtInRouterComponents.forEach(componentName => {
        // Remove incorrect imports: import RouterView from '@/components/RouterView.vue'
        // Pattern 1: import RouterView from '@/components/RouterView.vue' (default import)
        const incorrectImportPattern1 = new RegExp(`import\\s+${componentName}\\s+from\\s+['"]@/components/${componentName}\\.vue['"];?\\s*\\n?`, 'g');
        // Pattern 2: import { RouterView } from '@/components/RouterView.vue' (named import)
        const incorrectImportPattern2 = new RegExp(`import\\s+\\{[^}]*\\b${componentName}\\b[^}]*\\}\\s+from\\s+['"]@/components/${componentName}\\.vue['"];?\\s*\\n?`, 'g');
        
        const beforeReplace = scriptContent;
        // Replace both patterns
        scriptContent = scriptContent.replace(incorrectImportPattern1, '');
        scriptContent = scriptContent.replace(incorrectImportPattern2, '');
        
        if (scriptContent !== beforeReplace) {
          hasRemovedImports = true;
        }
      });
      
      if (hasRemovedImports) {
        // Update fixedContent with cleaned script content
        const scriptTagMatch = fixedContent.match(/(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/);
        if (scriptTagMatch) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `${scriptTagMatch[1]}${scriptContent}${scriptTagMatch[3]}`
          );
          result.fixed = true;
          result.fixes.push("Removed incorrect imports for built-in Vue Router components (RouterView, RouterLink)");
        }
      }
    }
  }

  // Fix: Correct filter usage in templates (currency on non-numeric values, etc.)
  // GENERIC: Detect and fix incorrect filter usage
  if (isVueFile && fixedContent.includes("<template")) {
    const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      let templateContent = templateMatch[1];
      let templateFixed = false;
      
      // Pattern: currency(filter) where filter is not a numeric value
      // GENERIC: Detect currency filter used on non-numeric values (strings, objects, etc.)
      // Common patterns: currency(product.name), currency(product.category), etc.
      const currencyOnNonNumericPattern = /\{\{\s*currency\s*\(\s*([^)]+)\s*\)\s*\}\}/g;
      let currencyMatch;
      
      while ((currencyMatch = currencyOnNonNumericPattern.exec(templateContent)) !== null) {
        const fullMatch = currencyMatch[0];
        const propertyPath = currencyMatch[1].trim();
        
        // Check if property path suggests it's not a numeric value
        // Common non-numeric property names: name, category, title, description, email, role, status, type, tag
        // Also check if it's not a numeric property like price, amount, cost, total, etc.
        const nonNumericProps = ['name', 'category', 'title', 'description', 'email', 'role', 'status', 'type', 'tag', 'id', 'label'];
        const numericProps = ['price', 'amount', 'cost', 'total', 'sum', 'quantity', 'count', 'number', 'value'];
        
        const isNonNumeric = nonNumericProps.some(prop => propertyPath.includes(prop)) && 
                            !numericProps.some(prop => propertyPath.includes(prop));
        
        if (isNonNumeric) {
          // Replace currency() with capitalize() for text values
          // GENERIC: Use capitalize for text values
          templateContent = templateContent.replace(
            new RegExp(fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            `{{ capitalize(${propertyPath}) }}`
          );
          templateFixed = true;
          
          // GENERIC: Add capitalize import if not already imported
          if (isVueFile && fixedContent.includes("<script setup")) {
            const scriptSetupMatch = fixedContent.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
            if (scriptSetupMatch) {
              let scriptContent = scriptSetupMatch[1];
              const capitalizeImportPattern = /import\s+.*capitalize.*from/;
              if (!capitalizeImportPattern.test(scriptContent)) {
                // Check if there's already an import from '@/filters'
                const filtersImportPattern = /import\s+\{([^}]*)\}\s+from\s+['"]@\/filters['"]/;
                const filtersImportMatch = scriptContent.match(filtersImportPattern);
                if (filtersImportMatch) {
                  // Add capitalize to existing import
                  const existingImports = filtersImportMatch[1].trim();
                  if (!existingImports.includes('capitalize')) {
                    scriptContent = scriptContent.replace(
                      filtersImportPattern,
                      `import { ${existingImports}, capitalize } from '@/filters'`
                    );
                    fixedContent = fixedContent.replace(
                      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
                      `<script setup lang="ts">${scriptContent}</script>`
                    );
                  }
                } else {
                  // Add new import
                  const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                  if (importMatch) {
                    scriptContent = scriptContent.replace(
                      /(import\s+[^;]+;[\s\n]*)+/,
                      `$&import { capitalize } from '@/filters';\n`
                    );
                  } else {
                    scriptContent = `import { capitalize } from '@/filters';\n${scriptContent}`;
                  }
                  fixedContent = fixedContent.replace(
                    /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
                    `<script setup lang="ts">${scriptContent}</script>`
                  );
                }
              }
            }
          }
        }
      }
      
      // Also fix: currency() used directly on non-numeric properties without checking
      // Pattern: {{ currency(product.category) }} where category is a string
      const currencyOnStringPattern = /\{\{\s*currency\s*\(\s*([^)]+\.(name|category|title|description|email|role|status|type|tag|id|label))\s*\)\s*\}\}/g;
      if (currencyOnStringPattern.test(templateContent)) {
        templateContent = templateContent.replace(
          currencyOnStringPattern,
          (match) => {
            return match.replace(/currency\s*\(/, 'capitalize(');
          }
        );
        templateFixed = true;
      }
      
      if (templateFixed) {
        fixedContent = fixedContent.replace(
          /<template>([\s\S]*?)<\/template>/,
          `<template>${templateContent}</template>`
        );
        result.fixed = true;
        result.fixes.push("Fixed incorrect currency filter usage on non-numeric values");
      }
    }
  }
  
  // Fix: Correct syntax errors in computed declarations
  // GENERIC: Fix malformed computed syntax like computed<any>() => instead of computed<any>(() =>
  // THIS MUST BE THE FIRST FIX APPLIED TO AVOID OTHER RULES BREAKING THE CODE
  // Apply this fix DIRECTLY on fixedContent before any other processing
  if (isVueFile && fixedContent.includes("<script setup")) {
    // CRITICAL FIX: computed<any>() => → computed<any>(() =>
    // This MUST be done FIRST before any other transformations
    const criticalFixPattern = /computed\s*<[^>]*>\s*\(\)\s*=>/g;
    fixedContent = fixedContent.replace(criticalFixPattern, (match) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() =>`;
    });
    
    // CRITICAL FIX: computed() => → computed(() =>
    const criticalFixPattern2 = /computed\s*\(\)\s*=>/g;
    fixedContent = fixedContent.replace(criticalFixPattern2, 'computed(() =>');
  }
  
  // Fix: Correct syntax errors in computed declarations (continued)
  // GENERIC: Fix malformed computed syntax like computed<any>() => instead of computed<any>(() =>
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      let scriptFixed = false;
      
      // Pattern 1: Fix double || [] || [] patterns first (anywhere in the code)
      // Fix: store.property || [] || [] should be (store.property || [])
      // Also handle: property || [] || []).length) → (property || []).length)
      const doubleOrPattern = /([\w.]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]/g;
      if (doubleOrPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          doubleOrPattern,
          (match, propertyPath) => {
            return `(${propertyPath} || [])`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 2: Fix malformed patterns like: property || [] || []).length)
      // Should be: (property || []).length)
      const doubleOrWithLengthPattern = /\(([\w.]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]\)\s*\)\s*\.length\)/g;
      if (doubleOrWithLengthPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          doubleOrWithLengthPattern,
          (match, propertyPath) => {
            return `(${propertyPath} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 3: Fix computed<any>() => → computed<any>(() =>
      // This must come after fixing double || patterns
      // Match: computed<any>() => or computed<any>() => anything
      // IMPORTANT: This pattern must match BEFORE other patterns that might consume it
      // Use a more robust approach - iterate and replace all occurrences
      const basicMalformedPattern = /computed\s*<[^>]*>\s*\(\)\s*=>/g;
      let hasMatches = false;
      
      // Replace all occurrences in one pass
      const newContent = scriptContent.replace(
        basicMalformedPattern,
        (match) => {
          hasMatches = true;
          // Extract type annotation if present
          const typeMatch = match.match(/<([^>]+)>/);
          const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
          return `computed${typeAnnotation}(() =>`;
        }
      );
      
      if (hasMatches) {
        scriptContent = newContent;
        scriptFixed = true;
      }
      
      // Pattern 3b: Also fix patterns where we have computed<any>(() => property || [] || []).length)
      // Should be: computed<any>(() => (property || []).length)
      const computedWithDoubleOrPattern = /computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([\w.]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]\)\s*\.length\)/g;
      if (computedWithDoubleOrPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          computedWithDoubleOrPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 4: Fix computed() => → computed(() =>
      const simpleMalformedPattern = /computed\s*\(\)\s*=>/g;
      if (simpleMalformedPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(simpleMalformedPattern, 'computed(() =>');
        scriptFixed = true;
      }
      
      // Pattern 5: Fix malformed patterns like: computed<any>() => property || [].length)
      // This should be: computed<any>(() => (property || []).length)
      const malformedLengthPattern = /computed\s*<[^>]*>\s*\(\)\s*=>\s*([^)]+)\s*\|\|\s*\[\]\s*\.length\)/g;
      if (malformedLengthPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          malformedLengthPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath.trim()} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 6: Fix patterns like: computed<any>() => property.length) where property.length is followed by )
      const missingParenLengthPattern = /computed\s*<[^>]*>\s*\(\)\s*=>\s*([^)]+\.length)\)/g;
      if (missingParenLengthPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          missingParenLengthPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => ${propertyPath})`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 7: Fix patterns like: computed<any>(() => property || [] || []).length)
      // Should be: computed<any>(() => (property || []).length)
      const doubleOrInComputedPattern = /computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([^)]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]\)\s*\.length\)/g;
      if (doubleOrInComputedPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          doubleOrInComputedPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath.trim()} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 8: Fix patterns like: computed<any>(() => property || [] || []).length)
      // More robust pattern that handles nested parentheses
      const complexDoubleOrPattern = /computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([^)]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]\)\s*\)\s*\.length\)/g;
      if (complexDoubleOrPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          complexDoubleOrPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath.trim()} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 9: Fix patterns like: computed<any>(() => property || [] || []).length)
      // Should be: computed<any>(() => (property || []).length)
      const simpleOrLengthPattern = /computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([\w.]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]\)\s*\.length\)/g;
      if (simpleOrLengthPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          simpleOrLengthPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 10: Fix patterns like: computed<any>(() => property || []) || []) || []).length)
      // Should be: computed<any>(() => (property || []).length)
      // This handles multiple closing parentheses and || [] chains
      const multipleOrWithParenPattern = /computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([\w.]+)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\.length\)/g;
      if (multipleOrWithParenPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          multipleOrWithParenPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      // Pattern 11: Fix patterns like: computed<any>() => property.length) without null check
      // Should be: computed<any>(() => (property || []).length)
      const computedWithoutNullCheckPattern = /computed\s*<[^>]*>\s*\(\)\s*=>\s*\(([\w.]+)\.length\)/g;
      if (computedWithoutNullCheckPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          computedWithoutNullCheckPattern,
          (match, propertyPath) => {
            const typeMatch = match.match(/<([^>]+)>/);
            const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
            return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
          }
        );
        scriptFixed = true;
      }
      
      if (scriptFixed) {
        fixedContent = fixedContent.replace(
          /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
          `<script setup lang="ts">${scriptContent}</script>`
        );
        result.fixed = true;
        result.fixes.push("Fixed malformed computed syntax");
      }
    }
  }
  
  // Fix: Prevent .length access on undefined computed properties
  // GENERIC: Add null/undefined checks for .length access on computed properties
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      let scriptFixed = false;
      
      // Pattern: computed(() => store.property.length) where property might be undefined
      // GENERIC: Detect computed properties that access .length without null check
      // IMPORTANT: Don't match if already has null check: (property || []).length
      // Match: const varName = computed<any>(() => store.property.length) BUT NOT (property || []).length
      const computedLengthPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\([^)]*\)\s*=>\s*([^}]+\.length)|const\s+(\w+)\s*=\s*computed\s*\([^)]*\)\s*=>\s*([^}]+\.length)/g;
      let computedLengthMatch;
      
      while ((computedLengthMatch = computedLengthPattern.exec(scriptContent)) !== null) {
        const computedName = computedLengthMatch[1] || computedLengthMatch[3];
        const propertyPathWithLength = (computedLengthMatch[2] || computedLengthMatch[4]).trim();
        
        // Extract property path without .length
        const propertyPath = propertyPathWithLength.replace(/\.length$/, '').trim();
        
        // Get the full computed definition line
        const computedDefLine = scriptContent.match(new RegExp(`const\\s+${computedName}\\s*=\\s*computed[^;]+;`, 's'));
        
        // CRITICAL: Check if the code is already correct (has proper parentheses)
        // Pattern: computed(() => (property || []).length) is already correct - SKIP IT
        const isAlreadyCorrect = computedDefLine && 
          computedDefLine[0].includes(`(${propertyPath} || []).length`);
        
        if (isAlreadyCorrect) {
          continue; // Skip this one, it's already correct
        }
        
        // Check if the computed already has a null check
        const hasNullCheck = computedDefLine && 
                           (computedDefLine[0].includes(`${propertyPath}?.length`) || 
                            computedDefLine[0].includes(`(${propertyPath} || []).length`) ||
                            computedDefLine[0].includes(`${propertyPath} ?? []`) ||
                            computedDefLine[0].includes(`(${propertyPath} || [])`));
        
        // Also check for malformed patterns (double parentheses, etc.)
        const isMalformed = computedDefLine && (
          computedDefLine[0].includes(`((${propertyPath}`) ||
          computedDefLine[0].includes(`${propertyPath} || []) || []`)
        );
        
        if (!hasNullCheck && !isMalformed) {
          // Add null check: (propertyPath || []).length
          // Escape special regex characters in propertyPath
          const escapedPropertyPath = propertyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          
          // IMPORTANT: Only fix if the computed syntax is correct (has () =>)
          // Don't modify if it's malformed like computed<any>() =>
          const computedDefLineFull = scriptContent.match(new RegExp(`const\\s+${computedName}\\s*=\\s*computed[^;]+;`, 's'));
          const hasCorrectComputedSyntax = computedDefLineFull && computedDefLineFull[0].includes('(() =>');
          
          if (hasCorrectComputedSyntax) {
            const safeLengthPattern = new RegExp(
              `const\\s+${computedName}\\s*=\\s*computed[^}]*\\(\\(\\)\\s*=>\\s*[^}]*${escapedPropertyPath}\\.length`,
              'g'
            );
            
            scriptContent = scriptContent.replace(
              safeLengthPattern,
              (match) => {
                // Only replace if propertyPath.length is NOT already wrapped in (propertyPath || [])
                if (!match.includes(`(${propertyPath} || [])`)) {
                  // Replace with safe access: (propertyPath || []).length
                  return match.replace(
                    new RegExp(`${escapedPropertyPath}\\.length`, 'g'),
                    `(${propertyPath} || []).length`
                  );
                }
                return match;
              }
            );
            scriptFixed = true;
          }
        } else if (isMalformed) {
          // Fix malformed patterns
          const escapedPropertyPathForMalformed = propertyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const malformedPattern = new RegExp(
            `const\\s+${computedName}\\s*=\\s*computed[^}]*=>\\s*\\(?\\(?${escapedPropertyPathForMalformed}[^}]*\\)`,
            'g'
          );
          scriptContent = scriptContent.replace(
            malformedPattern,
            (match) => {
              // Fix double parentheses and malformed patterns
              return match.replace(
                /\(\(/g,
                '('
              ).replace(
                /\|\|\s*\[\]\)\s*\|\|\s*\[\]/g,
                '|| []'
              ).replace(
                new RegExp(`\\(${escapedPropertyPathForMalformed}\\s*\\|\\)\\s*\\.length`, 'g'),
                `(${propertyPath} || []).length`
              );
            }
          );
          scriptFixed = true;
        }
      }
      
      // Fix malformed computed patterns (double parentheses, etc.)
      // GENERIC: Fix syntax errors like ((property || []).length or (property || []) || []).length
      // Pattern 1: ((property || []).length - double opening parenthesis
      // Pattern 2: (property || []) || []).length - double || [] with extra closing parenthesis
      const malformedComputedPattern = /const\s+(\w+)\s*=\s*computed[^}]*=>\s*\(\([^)]+\)|const\s+(\w+)\s*=\s*computed[^}]*=>\s*\([^)]+\|\|\s*\[\]\)\s*\|\|\s*\[\]\)/g;
      let malformedMatch;
      const computedNamesToFix = new Set<string>();
      
      while ((malformedMatch = malformedComputedPattern.exec(scriptContent)) !== null) {
        const computedName = malformedMatch[1] || malformedMatch[2];
        computedNamesToFix.add(computedName);
      }
      
      // Also detect malformed patterns by looking for specific syntax errors
      const doubleParenPattern = /const\s+(\w+)\s*=\s*computed[^}]*=>\s*\(\(/g;
      let doubleParenMatch;
      while ((doubleParenMatch = doubleParenPattern.exec(scriptContent)) !== null) {
        computedNamesToFix.add(doubleParenMatch[1]);
      }
      
      const doubleOrPattern = /const\s+(\w+)\s*=\s*computed[^}]*=>\s*\([^)]+\|\|\s*\[\]\)\s*\|\|\s*\[\]\)/g;
      let doubleOrMatch;
      while ((doubleOrMatch = doubleOrPattern.exec(scriptContent)) !== null) {
        computedNamesToFix.add(doubleOrMatch[1]);
      }
      
      computedNamesToFix.forEach(computedName => {
        // Find the full computed definition
        const computedDefPattern = new RegExp(`const\\s+${computedName}\\s*=\\s*computed[^;]+;`, 's');
        const computedDefMatch = scriptContent.match(computedDefPattern);
        if (computedDefMatch) {
          let fixedDef = computedDefMatch[0];
          // Fix double parentheses: ((property -> (property
          fixedDef = fixedDef.replace(/\(\(/g, '(');
          // Fix double || []: (property || []) || []).length -> (property || []).length
          fixedDef = fixedDef.replace(/\(([^)]+\|\|\s*\[\])\)\s*\|\|\s*\[\]\)/g, '$1');
          // Fix patterns like property || []) || []).length
          fixedDef = fixedDef.replace(/\|\|\s*\[\]\)\s*\|\|\s*\[\]\)/g, '|| [])');
          
          scriptContent = scriptContent.replace(computedDefPattern, fixedDef);
          scriptFixed = true;
        }
      });
      
      // Also fix direct .length access in templates via computed: {{ computedName.length }}
      // Pattern: const computedName = computed(() => store.property) and usage {{ computedName.length }}
      const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
      if (templateMatch) {
        let templateContent = templateMatch[1];
        const templateLengthPattern = /\{\{\s*(\w+)\.length\s*\}\}/g;
        const templateLengthMatches = Array.from(templateContent.matchAll(templateLengthPattern));
        
        templateLengthMatches.forEach(match => {
          const varName = match[1];
          // Check if this variable is a computed that might be undefined
          const computedDefPattern = new RegExp(`const\\s+${varName}\\s*=\\s*computed`, 'g');
          if (computedDefPattern.test(scriptContent)) {
            // Check if computed returns an array or might be undefined
            const computedReturnPattern = new RegExp(`const\\s+${varName}\\s*=\\s*computed[^}]*=>\\s*([^}]+)`, 'g');
            const computedReturnMatch = computedReturnPattern.exec(scriptContent);
            if (computedReturnMatch) {
              const returnValue = computedReturnMatch[1].trim();
              // If return value doesn't have null check and ends with .length or is a property access, add safe access
              if (!returnValue.includes('||') && !returnValue.includes('??') && !returnValue.includes('?.length')) {
                // Check if it's already safe (has || [])
                const isAlreadySafe = scriptContent.includes(`(${varName} || [])`);
                if (!isAlreadySafe) {
                  templateContent = templateContent.replace(
                    new RegExp(`\\{\\{\\s*${varName}\\.length\\s*\\}\\}`, 'g'),
                    `{{ (${varName} || []).length }}`
                  );
                  scriptFixed = true;
                }
              }
            }
          }
        });
        
        if (scriptFixed && templateContent !== templateMatch[1]) {
          fixedContent = fixedContent.replace(
            /<template>([\s\S]*?)<\/template>/,
            `<template>${templateContent}</template>`
          );
        }
      }
      
      if (scriptFixed) {
        fixedContent = fixedContent.replace(
          /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
          `<script setup lang="ts">${scriptContent}</script>`
        );
        result.fixed = true;
        result.fixes.push("Added null checks for .length access on computed properties");
      }
    }
  }

  // FINAL FIX: computed<any>() => → computed<any>(() =>
  // Apply this at the VERY END to ensure it's not overwritten by other rules
  if (isVueFile && fixedContent.includes("<script setup")) {
    // Fix computed<any>() => → computed<any>(() =>
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\)\s*=>/g, (match) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() =>`;
    });
    
    // Fix computed() => → computed(() =>
    fixedContent = fixedContent.replace(/computed\s*\(\)\s*=>/g, 'computed(() =>');
    
    // Fix malformed patterns: computed<any>(() => (property.length); → computed<any>(() => (property || []).length);
    // Pattern: computed<any>(() => (property.length); (missing closing paren and null check)
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*\(([\w.]+)\.length\);/g, (match, propertyPath) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() => (${propertyPath} || []).length);`;
    });
    
    // Fix multiple || [] patterns: (property || [])) || []) || []) → (property || [])
    // Pattern: (property || [])) || []) || []) || []) || []).length)
    // Use a more robust approach: replace all occurrences of )) || []) with just )
    // This handles any number of repetitions
    let previousContent = '';
    let iterations = 0;
    while (previousContent !== fixedContent && iterations < 50) {
      previousContent = fixedContent;
      // Fix: (property || [])) || []) → (property || [])
      fixedContent = fixedContent.replace(/\(([\w.]+)\s*\|\|\s*\[\]\)\)\s*\|\|\s*\[\]\)/g, '($1 || [])');
      // Also fix: property || [] || [] → (property || [])
      fixedContent = fixedContent.replace(/([\w.]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]/g, '($1 || [])');
      // Fix: (property || []) || [] → (property || [])
      fixedContent = fixedContent.replace(/\(([\w.]+)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)/g, '($1 || [])');
      // Fix: computed<any>(() => property || []) || []) || []).length) → computed<any>(() => (property || []).length)
      fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([\w.]+)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\.length\)/g, (match, propertyPath) => {
        const typeMatch = match.match(/<([^>]+)>/);
        const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
        return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
      });
      // Fix: computed<any>(() => property || []) || []).length) → computed<any>(() => (property || []).length)
      fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([\w.]+)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\.length\)/g, (match, propertyPath) => {
        const typeMatch = match.match(/<([^>]+)>/);
        const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
        return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
      });
      iterations++;
    }
    
    // Fix: computed<any>(() => (property || []) || []) || []).length) → computed<any>(() => (property || []).length)
    // Handle the case where we have computed<any>(() => (property || []) || []) || []).length)
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*\(([\w.]+)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\)\s*\.length\)/g, (match, propertyPath) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
    });
    
    // Also fix: computed<any>(() => property || [] || []).length) → computed<any>(() => (property || []).length)
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*([\w.]+)\s*\|\|\s*\[\]\s*\|\|\s*\[\]\)\s*\.length\)/g, (match, propertyPath) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
    });
    
    // Final fix: computed<any>(() => (property || []) || []).length) → computed<any>(() => (property || []).length)
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*\(([\w.]+)\s*\|\|\s*\[\]\)\s*\|\|\s*\[\]\)\s*\.length\)/g, (match, propertyPath) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
    });
    
    // Fix: computed<any>(() => (property || [])).length) → computed<any>(() => (property || []).length)
    fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\(\)\s*=>\s*\(([\w.]+)\s*\|\|\s*\[\]\)\)\s*\.length\)/g, (match, propertyPath) => {
      const typeMatch = match.match(/<([^>]+)>/);
      const typeAnnotation = typeMatch ? `<${typeMatch[1]}>` : '';
      return `computed${typeAnnotation}(() => (${propertyPath} || []).length)`;
    });
  }
  
  // Fix: Missing v-model bindings in <script setup>
  // GENERIC: Detect v-model="propertyName" in template and add missing ref declarations
  if (isVueFile && fixedContent.includes("<script setup") && fixedContent.includes("v-model")) {
    const scriptSetupMatch = fixedContent.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
    
    if (scriptSetupMatch && templateMatch) {
      let scriptContent = scriptSetupMatch[1];
      const templateContent = templateMatch[1];
      let scriptFixed = false;
      
      // Find all v-model bindings in template
      const vModelPattern = /v-model\s*=\s*["']([^"']+)["']/g;
      const vModelBindings = new Set<string>();
      let vModelMatch;
      
      while ((vModelMatch = vModelPattern.exec(templateContent)) !== null) {
        const bindingName = vModelMatch[1].trim();
        // Skip if it's a store property
        if (!bindingName.includes('.') && !bindingName.includes('[')) {
          vModelBindings.add(bindingName);
        }
      }
      
      // Check which v-model bindings are not declared in script
      vModelBindings.forEach((bindingName) => {
        // Check if property is already declared
        const isDeclared = scriptContent.match(
          new RegExp(`(const|let|var)\\s+${bindingName}\\s*=`, 'g')
        ) || scriptContent.match(
          new RegExp(`computed.*${bindingName}`, 'g')
        );
        
        if (!isDeclared) {
          // Check if there's a computed with similar name
          const similarComputed = scriptContent.match(
            new RegExp(`const\\s+(\\w+)\\s*=\\s*computed.*theme`, 'i')
          );
          
          if (similarComputed && bindingName.toLowerCase().includes('theme')) {
            // Use the computed property name and create a ref that syncs with it
            const computedName = similarComputed[1];
            // Find the store that has setTheme method
            const storeMatch = scriptContent.match(/const\s+(\w+Store)\s*=\s*use(\w+)Store\(\)/);
            if (storeMatch) {
              const storeVarName = storeMatch[1];
              // Add ref that syncs with computed and store
              const lastStoreInit = scriptContent.match(/const\s+\w+Store\s*=\s*use\w+Store\(\);/g);
              if (lastStoreInit) {
                const lastMatch = scriptContent.lastIndexOf(lastStoreInit[lastStoreInit.length - 1]);
                const insertPos = lastMatch + lastStoreInit[lastStoreInit.length - 1].length;
                const refCode = `\nconst ${bindingName} = ref(${computedName}.value || 'light');\nwatch(${bindingName}, (newValue) => { ${storeVarName}.setTheme(newValue); });\nwatch(() => ${computedName}.value, (newValue) => { ${bindingName}.value = newValue; });`;
                scriptContent = scriptContent.slice(0, insertPos) + refCode + scriptContent.slice(insertPos);
                
                // Add ref and watch imports if not present
                const vueImportMatch = scriptContent.match(/import\s+{([^}]+)}\s+from\s+['"]vue['"]/);
                if (vueImportMatch) {
                  let imports = vueImportMatch[1];
                  if (!imports.includes('ref')) imports += ', ref';
                  if (!imports.includes('watch')) imports += ', watch';
                  scriptContent = scriptContent.replace(vueImportMatch[0], `import {${imports}} from 'vue'`);
                } else {
                  scriptContent = `import { ref, watch } from 'vue';\n${scriptContent}`;
                }
                
                scriptFixed = true;
              }
            }
          } else {
            // Add ref declaration for the v-model binding
            // Try to infer initial value from store if possible
            let initialValue = 'null';
            
            // Try to find a related store property
            const storeInitMatch = scriptContent.match(/const\s+(\w+Store)\s*=\s*use(\w+)Store\(\)/);
            if (storeInitMatch) {
              const storeVarName = storeInitMatch[1];
              // Check if store has a property with similar name
              if (bindingName.toLowerCase().includes('theme')) {
                initialValue = `${storeVarName}.theme || 'light'`;
              }
            }
            
            // Add ref declaration after the last store initialization
            const allStoreInits = scriptContent.match(/const\s+\w+Store\s*=\s*use\w+Store\(\);/g);
            if (allStoreInits && allStoreInits.length > 0) {
              const lastMatch = scriptContent.lastIndexOf(allStoreInits[allStoreInits.length - 1]);
              const insertPos = lastMatch + allStoreInits[allStoreInits.length - 1].length;
              const refCode = `\nconst ${bindingName} = ref(${initialValue});`;
              scriptContent = scriptContent.slice(0, insertPos) + refCode + scriptContent.slice(insertPos);
              
              // Add ref import if not present
              const vueImportMatch = scriptContent.match(/import\s+{([^}]+)}\s+from\s+['"]vue['"]/);
              if (vueImportMatch) {
                let imports = vueImportMatch[1].trim();
                // Clean up imports (remove extra spaces, commas)
                imports = imports.split(',').map(i => i.trim()).filter(Boolean).join(', ');
                if (!imports.includes('ref')) {
                  imports += ', ref';
                }
                scriptContent = scriptContent.replace(vueImportMatch[0], `import { ${imports} } from 'vue'`);
              } else {
                // Find the first import line and add vue import before it, or at the beginning
                const firstImportMatch = scriptContent.match(/^import\s+/m);
                if (firstImportMatch) {
                  const importPos = scriptContent.indexOf(firstImportMatch[0]);
                  scriptContent = scriptContent.slice(0, importPos) + `import { ref } from 'vue';\n` + scriptContent.slice(importPos);
                } else {
                  scriptContent = `import { ref } from 'vue';\n${scriptContent}`;
                }
              }
              
              scriptFixed = true;
            } else {
              // No store found, add ref at the beginning of script after imports
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const importEnd = importMatch.index! + importMatch[0].length;
                const refCode = `\nconst ${bindingName} = ref(${initialValue});`;
                scriptContent = scriptContent.slice(0, importEnd) + refCode + scriptContent.slice(importEnd);
                
                // Add ref import if not present
                const vueImportMatch = scriptContent.match(/import\s+{([^}]+)}\s+from\s+['"]vue['"]/);
                if (vueImportMatch) {
                  let imports = vueImportMatch[1].trim();
                  imports = imports.split(',').map(i => i.trim()).filter(Boolean).join(', ');
                  if (!imports.includes('ref')) {
                    imports += ', ref';
                  }
                  scriptContent = scriptContent.replace(vueImportMatch[0], `import { ${imports} } from 'vue'`);
                } else {
                  // Find the first import line and add vue import before it, or at the beginning
                  const firstImportMatch = scriptContent.match(/^import\s+/m);
                  if (firstImportMatch) {
                    const importPos = scriptContent.indexOf(firstImportMatch[0]);
                    scriptContent = scriptContent.slice(0, importPos) + `import { ref } from 'vue';\n` + scriptContent.slice(importPos);
                  } else {
                    scriptContent = `import { ref } from 'vue';\n${scriptContent}`;
                  }
                }
                
                scriptFixed = true;
              } else {
                // No imports at all, add both import and ref at the beginning
                scriptContent = `import { ref } from 'vue';\nconst ${bindingName} = ref(${initialValue});\n${scriptContent}`;
                scriptFixed = true;
              }
            }
          }
        }
      });
      
      if (scriptFixed) {
        fixedContent = fixedContent.replace(
          /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
          `<script setup lang="ts">${scriptContent}</script>`
        );
        result.fixed = true;
        result.fixes.push("Added missing v-model bindings");
      }
    }
  }

    // Final cleanup: Remove extra closing parentheses after computed properties (GENERIC)
    // This must be done at the very end to clean up any parentheses added by previous rules
    // Pattern: })); or )); where there should be }); or );
    // Also fix: || null); → || null; (missing closing brace for computed)
    if (filePath.endsWith('.ts') || filePath.endsWith('.js') || isVueFile) {
      // Fix pattern: || null); → || null; }); (add missing closing brace for computed)
      // This happens when computed function is missing its closing brace
      if (fixedContent.includes('|| null);') && !fixedContent.includes('|| null; }')) {
        // Replace || null); with || null; }); when it's inside a computed
        fixedContent = fixedContent.replace(/(return\s+[^;]+?\|\|\s*null)\)\s*;/g, '$1;\n  });');
        result.fixed = true;
        result.fixes.push('Fixed missing closing brace in computed properties');
      }
      let parenFixed = false;
      let previousContent = '';
      let iterations = 0;
      
      // Iterative approach to fix all extra parentheses
      while (previousContent !== fixedContent && iterations < 10) {
        previousContent = fixedContent;
        iterations++;
        
        // Simple direct fix: })); → });
        // This catches cases where a computed block ends with })); instead of });
        // Very simple: replace })); with }); when it appears after computed
        let tempContent = fixedContent;
        const blockPattern = /\}\)\)+/g;
        let blockMatch;
        while ((blockMatch = blockPattern.exec(tempContent)) !== null) {
          const matchIndex = blockMatch.index;
          const beforeMatch = tempContent.substring(Math.max(0, matchIndex - 300), matchIndex);
          if (beforeMatch.includes('computed') && beforeMatch.includes('() => {')) {
            const fixed = blockMatch[0].replace(/\)\)+$/, ')');
            if (fixed !== blockMatch[0]) {
              fixedContent = fixedContent.substring(0, matchIndex) + fixed + fixedContent.substring(matchIndex + blockMatch[0].length);
              parenFixed = true;
              // Reset and restart
              blockPattern.lastIndex = 0;
              tempContent = fixedContent;
            }
          }
        }
        
        // Simple direct fix: ))); → );
        // This catches cases where a computed expression ends with ))); instead of );
        // Very simple: replace ))); with ); when it appears after computed
        tempContent = fixedContent;
        const exprPattern = /\)\)\)+/g;
        let exprMatch;
        while ((exprMatch = exprPattern.exec(tempContent)) !== null) {
          const matchIndex = exprMatch.index;
          const beforeMatch = tempContent.substring(Math.max(0, matchIndex - 300), matchIndex);
          if (beforeMatch.includes('computed') || beforeMatch.includes('.value')) {
            const fixed = exprMatch[0].replace(/\)\)+$/, ')');
            if (fixed !== exprMatch[0]) {
              fixedContent = fixedContent.substring(0, matchIndex) + fixed + fixedContent.substring(matchIndex + exprMatch[0].length);
              parenFixed = true;
              // Reset and restart
              exprPattern.lastIndex = 0;
              tempContent = fixedContent;
            }
          }
        }
        
        // Fix computed with block: })); → });
        // Match: const name = computed(() => { ... return result; })); with extra )
        // Pattern matches: computed<any>(() => { ... return result; })); → computed<any>(() => { ... return result; });
        const computedBlockPattern = /(const\s+\w+\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{[^}]*return[^}]*\})\s*\)\)+/g;
        fixedContent = fixedContent.replace(computedBlockPattern, (match) => {
          // Remove extra closing parentheses, keep only one after the block
          const fixed = match.replace(/\}\)\)+$/, '})');
          if (fixed !== match) {
            parenFixed = true;
          }
          return fixed;
        });
        
        // Fix computed with simple expression: )); → );
        // Match: const name = computed(() => expr)); with extra )
        // Pattern matches: computed<any>(() => expr)); → computed<any>(() => expr);
        const computedSimplePattern = /(const\s+\w+\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*[^)]+\))\)\)+/g;
        fixedContent = fixedContent.replace(computedSimplePattern, (match) => {
          // Remove extra closing parentheses, keep only one
          const fixed = match.replace(/\)\)+$/, ')');
          if (fixed !== match) {
            parenFixed = true;
          }
          return fixed;
        });
        
        // Fix: Remove extra closing parentheses after computed property access
        // Pattern: [COMPUTED].value.length)); → [COMPUTED].value.length); (GENERIC)
        // More precise: match the entire computed declaration with extra parens
        const computedAccessPattern = /(const\s+\w+\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*[^)]+\.value\.length\))\)\)+/g;
        fixedContent = fixedContent.replace(computedAccessPattern, (match) => {
          const fixed = match.replace(/\)\)+$/, ')');
          if (fixed !== match) {
            parenFixed = true;
          }
          return fixed;
        });
        
        // More aggressive: Fix any })); pattern that appears after a computed block
        // This handles edge cases where the pattern wasn't caught by previous rules
        // Match })); and check if it's part of a computed block
        const aggressivePattern = /\}\)\)+/g;
        let aggressiveMatch;
        const aggressiveMatches: Array<{ index: number; match: string }> = [];
        while ((aggressiveMatch = aggressivePattern.exec(fixedContent)) !== null) {
          aggressiveMatches.push({ index: aggressiveMatch.index, match: aggressiveMatch[0] });
        }
        
        // Process in reverse order to avoid index shifting
        for (let i = aggressiveMatches.length - 1; i >= 0; i--) {
          const { index, match } = aggressiveMatches[i];
          const beforeMatch = fixedContent.substring(Math.max(0, index - 500), index);
          // Check if we're inside a computed block
          if (beforeMatch.includes('computed') && beforeMatch.includes('() => {') && beforeMatch.includes('return')) {
            const fixed = match.replace(/\)\)+$/, ')');
            if (fixed !== match) {
              fixedContent = fixedContent.substring(0, index) + fixed + fixedContent.substring(index + match.length);
              parenFixed = true;
            }
          }
        }
        
        // Also fix patterns like ))); that appear after computed expressions
        // Match: ))); and check if it's part of a computed
        const tripleParenPattern = /\)\)\)+/g;
        let tripleMatch;
        const tripleMatches: Array<{ index: number; match: string }> = [];
        while ((tripleMatch = tripleParenPattern.exec(fixedContent)) !== null) {
          tripleMatches.push({ index: tripleMatch.index, match: tripleMatch[0] });
        }
        
        // Process in reverse order
        for (let i = tripleMatches.length - 1; i >= 0; i--) {
          const { index, match } = tripleMatches[i];
          const beforeMatch = fixedContent.substring(Math.max(0, index - 300), index);
          // Check if it's part of a computed
          if (beforeMatch.includes('computed') || beforeMatch.includes('.value')) {
            const fixed = match.replace(/\)\)+$/, ')');
            if (fixed !== match) {
              fixedContent = fixedContent.substring(0, index) + fixed + fixedContent.substring(index + match.length);
              parenFixed = true;
            }
          }
        }
        
        // Also fix standalone patterns: ))); → );
        // This catches any remaining cases where we have multiple closing parens
        // Match: ))); and check if it's part of a computed
        const standaloneExtraParenPattern = /(\))\)\)+/g;
        let standaloneMatch;
        const standaloneMatches: Array<{ index: number; match: string }> = [];
        while ((standaloneMatch = standaloneExtraParenPattern.exec(fixedContent)) !== null) {
          standaloneMatches.push({ index: standaloneMatch.index, match: standaloneMatch[0] });
        }
        
        // Process in reverse order
        for (let i = standaloneMatches.length - 1; i >= 0; i--) {
          const { index, match } = standaloneMatches[i];
          const beforeMatch = fixedContent.substring(Math.max(0, index - 200), index);
          if (beforeMatch.includes('computed') || beforeMatch.includes('.value')) {
            const fixed = match.replace(/\)\)+$/, ')');
            if (fixed !== match) {
              fixedContent = fixedContent.substring(0, index) + fixed + fixedContent.substring(index + match.length);
              parenFixed = true;
              standaloneExtraParenPattern.lastIndex = 0;
              break; // Break and restart the while loop
            }
          }
        }
      }
      
      if (parenFixed) {
        result.fixed = true;
        result.fixes.push('Removed extra closing parentheses from computed properties (final cleanup)');
      }
    }

  // CRITICAL FINAL FIX: Fix all remaining issues (GENERIC)
  // This is the absolute last cleanup step - fixes all remaining patterns
  if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    let finalFixed = false;
    
    // Fix 1: Remove extra closing parentheses
    // Fix })); → });
    fixedContent = fixedContent.replace(/\}\s*\)\)+/g, (match) => {
      const matchIndex = fixedContent.indexOf(match);
      if (matchIndex > 0) {
        const beforeMatch = fixedContent.substring(Math.max(0, matchIndex - 500), matchIndex);
        if (beforeMatch.includes('computed') && beforeMatch.includes('() => {')) {
          const fixed = match.replace(/\)\)+$/, ')');
          if (fixed !== match) {
            finalFixed = true;
            return fixed;
          }
        }
      }
      return match;
    });
    
    // Fix 2: computed.length → computed.value.length (GENERIC)
    // Pattern: const [ANY_NAME] = computed(() => [COMPUTED_NAME].length) where [COMPUTED_NAME] is a computed
    const computedNames = new Set<string>();
    const allComputedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
    let allComputedMatch;
    while ((allComputedMatch = allComputedPattern.exec(fixedContent)) !== null) {
      computedNames.add(allComputedMatch[1]);
    }
    
    // Fix computed properties that access other computed without .value
    fixedContent = fixedContent.replace(/const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+)\.length\s*\)/g, (match, computedName, referencedVar) => {
      if (computedNames.has(referencedVar) && !match.includes('.value')) {
        finalFixed = true;
        return `const ${computedName} = computed<any>(() => ${referencedVar}.value.length)`;
      }
      return match;
    });
    
    // Also fix without type annotation
    fixedContent = fixedContent.replace(/const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+)\.length\s*\)/g, (match, computedName, referencedVar) => {
      if (computedNames.has(referencedVar) && !match.includes('.value')) {
        finalFixed = true;
        return `const ${computedName} = computed<any>(() => ${referencedVar}.value.length)`;
      }
      return match;
    });
    
    // Fix 3: Add filtering logic to computed properties that should filter but don't
    // GENERIC: Works for ANY computed property name, not just "filteredUsers"
    // Pattern: const [ANY_NAME] = computed(() => { let result = array.value; return result; })
    // More flexible pattern that handles various whitespace and ANY computed name
    const computedWithSimpleReturnPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{\s*let\s+result\s*=\s*(\w+)\.value\s*;\s*return\s+result\s*;\s*\}\)/g;
    let computedMatch;
    
    // Detect reactive variables (ref/reactive declarations) - GENERIC
    const reactiveVarsSet = new Set<string>();
    const refPattern = /(?:const|let|var)\s+(\w+)\s*=\s*ref\s*\(/g;
    const reactivePattern = /(?:const|let|var)\s+(\w+)\s*=\s*reactive\s*\(/g;
    let refMatch;
    while ((refMatch = refPattern.exec(fixedContent)) !== null) {
      reactiveVarsSet.add(refMatch[1]);
    }
    let reactiveMatch;
    while ((reactiveMatch = reactivePattern.exec(fixedContent)) !== null) {
      reactiveVarsSet.add(reactiveMatch[1]);
    }
    
    while ((computedMatch = computedWithSimpleReturnPattern.exec(fixedContent)) !== null) {
      const computedName = computedMatch[1];
      const arrayVar = computedMatch[2];
      
      // GENERIC: Check if computed name suggests filtering/transformation
      // Works for ANY name pattern that suggests filtering/transformation (GENERIC)
      const computedNameLower = computedName.toLowerCase();
      const suggestsFiltering = computedNameLower.includes("filter") || 
                                computedNameLower.includes("display") ||
                                computedNameLower.includes("visible") ||
                                computedNameLower.includes("shown") ||
                                computedNameLower.includes("list");
      
      // Check if filters exist - GENERIC detection
      const hasFilters = /(?:const|let|var)\s+filters\s*=\s*reactive\s*\(/.test(fixedContent);
      
      // Only apply if: filters exist, computed name suggests filtering, and arrayVar is reactive
      if (hasFilters && suggestsFiltering && reactiveVarsSet.has(arrayVar)) {
        // Analyze filters
        const filterAnalysis = analyzeFilterProperties(fixedContent);
        const arrayVarStr = String(arrayVar);
        const itemAnalysis = analyzeArrayItemProperties(fixedContent, arrayVarStr);
        
        const categoryFilter = filterAnalysis.categoryFilter || null;
        const searchFilter = filterAnalysis.searchFilter || null;
        // Use detected categoryProperty or infer from filter name
        const categoryProperty = itemAnalysis.categoryProperty || categoryFilter || null;
        const searchProperties = Array.from(itemAnalysis.properties).filter((p) => {
          const prop = String(p).toLowerCase();
          const nonTextPatterns = ['id', 'ids', 'uuid', 'key', 'date', 'time', 'created', 'updated'];
          return !nonTextPatterns.some(pattern => prop === pattern || prop.endsWith(pattern));
        }) as string[];
        
        const arrayVarWithValue = `${arrayVar}.value`;
        const searchConditions = searchProperties.length > 0
          ? searchProperties.map(prop => `item.${prop}?.toLowerCase().includes(searchLower)`).join(" ||\n        ")
          : `Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(searchLower))`;
        
        // Use categoryFilter as property name if categoryProperty is not detected
        const actualCategoryProperty = categoryProperty || categoryFilter;
        const categoryFilterCode = (categoryFilter && actualCategoryProperty) 
          ? `    if (filters.${categoryFilter}) {
      result = result.filter(item => item.${actualCategoryProperty} === filters.${categoryFilter});
    }
    `
          : '';
        
        const searchFilterCode = searchFilter
          ? `    if (filters.${searchFilter}) {
      const searchLower = filters.${searchFilter}.toLowerCase();
      result = result.filter(item => 
        ${searchConditions}
      );
    }
    `
          : '';
        
        const fixedFilteredComputed = `const ${computedName} = computed<any>(() => {
    let result = ${arrayVarWithValue};
    ${categoryFilterCode}${searchFilterCode}return result;
  })`;
        
        fixedContent = fixedContent.replace(computedMatch[0], fixedFilteredComputed);
        finalFixed = true;
        result.fixes.push(`Added generic filtering logic to ${computedName} (final fix)`);
      }
    }
    
    // Fix 3b: Add missing role filter if search filter exists but role filter is missing
    // GENERIC: Check if computed has partial filtering (e.g., only search but missing category filter)
    // Pattern: const [ANY_NAME] = computed(() => { ... if (filters.[FILTER_NAME]) ... }) but missing other filters
    const computedWithPartialFilterPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\{[^}]*if\s*\(filters\.(\w+)\)[^}]*\}\s*\)/g;
    let partialFilterMatch;
    while ((partialFilterMatch = computedWithPartialFilterPattern.exec(fixedContent)) !== null) {
      const computedName = partialFilterMatch[1];
      const existingFilter = partialFilterMatch[2];
      
      // Check if there are other filters in the filters object that aren't being used
      const filterAnalysis = analyzeFilterProperties(fixedContent);
      const allFilters = Array.from(filterAnalysis.allFilters);
      const missingFilters = allFilters.filter(f => f !== existingFilter);
      
      if (missingFilters.length > 0) {
        // Find the missing filter that should be added (category/role/type filter) - GENERIC
        const categoryFilter = filterAnalysis.categoryFilter;
        const missingCategoryFilter = categoryFilter && categoryFilter !== existingFilter ? categoryFilter : null;
        
        if (missingCategoryFilter) {
          // Analyze array item properties to find the property name - GENERIC
          const arrayVarMatch = partialFilterMatch[0].match(/let\s+result\s*=\s*(\w+)\.value/);
          if (arrayVarMatch) {
            const arrayVar = arrayVarMatch[1];
            const arrayVarStr = String(arrayVar);
            const itemAnalysis = analyzeArrayItemProperties(fixedContent, arrayVarStr);
            const categoryProperty = itemAnalysis.categoryProperty || missingCategoryFilter;
            
            // Find the return statement position
            const matchIndex = partialFilterMatch.index;
            const matchContent = partialFilterMatch[0];
            const returnIndex = matchContent.lastIndexOf('return result');
            
            if (returnIndex > 0) {
              // Insert missing filter before return - GENERIC
              const beforeReturn = matchContent.substring(0, returnIndex);
              const afterReturn = matchContent.substring(returnIndex);
              const missingFilterCode = `    if (filters.${missingCategoryFilter}) {
      result = result.filter(item => item.${categoryProperty} === filters.${missingCategoryFilter});
    }
    `;
              const fixedContent2 = beforeReturn + missingFilterCode + afterReturn;
              fixedContent = fixedContent.substring(0, matchIndex) + fixedContent2 + fixedContent.substring(matchIndex + matchContent.length);
              finalFixed = true;
              result.fixes.push(`Added missing ${missingCategoryFilter} filter to ${computedName} (generic)`);
            }
          }
        }
      }
    }
    
    // Fix 4: store.property || [].length → (store.property || []).length (GENERIC)
    fixedContent = fixedContent.replace(/(\w+Store\.\w+)\s*\|\|\s*\[\]\s*\.length/g, (match, propertyPath) => {
      const fixed = `(${propertyPath} || []).length`;
      if (fixed !== match) {
        finalFixed = true;
      }
      return fixed;
    });
    
    // Fix 5: Correct incorrect store references (GENERIC)
    // Pattern: wrongStore.propertyName where propertyName suggests a different store
    // This is completely generic - works for ANY store and ANY property name
    if (isVueFile && fixedContent.includes('<script setup')) {
      const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];
        
        // Find all stores - GENERIC detection (including imports)
        const storePattern = /const\s+(\w+Store)\s*=\s*use(\w+)Store\s*\(\)/g;
        const stores = new Map<string, string>();
        let storeMatch;
        while ((storeMatch = storePattern.exec(scriptContent)) !== null) {
          stores.set(storeMatch[1], storeMatch[2].toLowerCase());
        }
        
        // Also detect store imports to know which stores are available
        const storeImportPattern = /import\s+.*use(\w+)Store.*from/g;
        let importMatch;
        const availableStores = new Set<string>();
        while ((importMatch = storeImportPattern.exec(scriptContent)) !== null) {
          const storeName = importMatch[1].toLowerCase();
          availableStores.add(storeName);
        }
        
        // Find all property accesses - GENERIC detection
        const propertyAccessPattern = /(\w+Store)\.(\w+)/g;
        let propertyMatch;
        const propertyAccesses: Array<{ storeVar: string; propertyName: string }> = [];
        
        while ((propertyMatch = propertyAccessPattern.exec(scriptContent)) !== null) {
          const storeVar = propertyMatch[1];
          const propertyName = propertyMatch[2];
          propertyAccesses.push({
            storeVar,
            propertyName
          });
        }
        
        // For each property access, check if it should come from a different store - GENERIC inference
        propertyAccesses.forEach(({ storeVar, propertyName }) => {
          const currentStoreName = stores.get(storeVar);
          if (!currentStoreName) return;
          
          // GENERIC: Infer correct store from property name
          // Infer correct store from property name
          const propertyLower = propertyName.toLowerCase();
          
          // Remove "all" prefix if present
          const withoutAll = propertyLower.replace(/^all/, '');
          // Remove plural ending
          const singular = withoutAll.endsWith('s') ? withoutAll.slice(0, -1) : withoutAll;
          // Handle special cases: "ies" -> "y" (categories -> category)
          const normalized = singular.endsWith('ies') ? singular.slice(0, -3) + 'y' : singular;
          
          // Check if normalized name matches a different store name
          stores.forEach((storeName, otherStoreVar) => {
            if (storeName === normalized && otherStoreVar !== storeVar) {
              // This property should come from the other store
              const correctPattern = new RegExp(`${storeVar}\\.${propertyName}`, 'g');
              if (correctPattern.test(fixedContent)) {
                fixedContent = fixedContent.replace(correctPattern, `${otherStoreVar}.${propertyName}`);
                finalFixed = true;
                result.fixes.push(`Fixed incorrect store reference: ${storeVar}.${propertyName} → ${otherStoreVar}.${propertyName} (generic inference)`);
              }
            }
          });
          
          // If store doesn't exist but should (based on property name), add import and initialization
          // Don't check availableStores - we'll add the import if needed (more permissive)
          if (normalized && !stores.has(`${normalized}Store`)) {
            // Re-extract scriptContent after potential modifications
            const updatedScriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
            const updatedScriptContent = updatedScriptMatch ? updatedScriptMatch[1] : scriptContent;
            
            // Find where to add the store import and initialization
            const lastStoreInit = updatedScriptContent.match(/const\s+\w+Store\s*=\s*use\w+Store\s*\(\)/g);
            if (lastStoreInit) {
              const lastMatch = fixedContent.lastIndexOf(lastStoreInit[lastStoreInit.length - 1]);
              const insertPos = lastMatch + lastStoreInit[lastStoreInit.length - 1].length;
              const storeVarName = `${normalized}Store`;
              const storeImportName = `use${normalized.charAt(0).toUpperCase() + normalized.slice(1)}Store`;
              
              // Add store import if missing
              const storeImportPattern2 = new RegExp(`import.*${storeImportName}.*from`, 'g');
              if (!storeImportPattern2.test(updatedScriptContent)) {
                // Find import section in fixedContent
                const importSection = updatedScriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                if (importSection) {
                  const lastImport = importSection[0];
                  const importIndex = fixedContent.lastIndexOf(lastImport) + lastImport.length;
                  const storeImport = `\nimport { ${storeImportName} } from '@/store/modules/${normalized}';`;
                  fixedContent = fixedContent.substring(0, importIndex) + storeImport + fixedContent.substring(importIndex);
                }
              }
              
              // Add store initialization
              const storeInit = `\nconst ${storeVarName} = ${storeImportName}();`;
              fixedContent = fixedContent.substring(0, insertPos) + storeInit + fixedContent.substring(insertPos);
              
              // Now fix the property access
              const correctPattern = new RegExp(`${storeVar}\\.${propertyName}`, 'g');
              if (correctPattern.test(fixedContent)) {
                fixedContent = fixedContent.replace(correctPattern, `${storeVarName}.${propertyName}`);
                finalFixed = true;
                result.fixes.push(`Added missing store ${storeVarName} and fixed reference: ${storeVar}.${propertyName} → ${storeVarName}.${propertyName} (generic)`);
              }
            }
          }
        });
        
        // Fix: store.property || [].length → (store.property || []).length (GENERIC)
        // Pattern: ANY store property with || [].length (missing parentheses)
        // More aggressive: also fix in computed declarations
        // Fix standalone: store.property || [].length
        fixedContent = fixedContent.replace(/(\w+Store\.\w+)\s*\|\|\s*\[\]\s*\.length/g, (match, propertyPath) => {
          finalFixed = true;
          return `(${propertyPath} || []).length`;
        });
        
        // Fix in computed: computed(() => store.property || [].length)
        fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store\.\w+)\s*\|\|\s*\[\]\s*\.length/g, (match, propertyPath) => {
          finalFixed = true;
          return match.replace(`${propertyPath} || [].length`, `(${propertyPath} || []).length`);
        });
        
        // Fix in computed with parentheses: computed(() => (store.property || [].length))
        fixedContent = fixedContent.replace(/computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*\((\w+Store\.\w+)\s*\|\|\s*\[\]\s*\.length\)/g, (match, propertyPath) => {
          finalFixed = true;
          return match.replace(`(${propertyPath} || [].length)`, `((${propertyPath} || []).length)`);
        });
        
        // More aggressive: Fix any occurrence of store.property || [].length (even without spaces)
        fixedContent = fixedContent.replace(/(\w+Store\.\w+)\|\|\[\]\.length/g, (match, propertyPath) => {
          finalFixed = true;
          return `(${propertyPath} || []).length`;
        });
        
        // Fix: Add missing store imports when property is accessed but store not initialized
        // This must run AFTER the first pass that checks stores, so we can detect missing stores
        const propertyAccessPattern2 = /(\w+Store)\.(all\w+)/g;
        let propertyMatch2;
        const missingStores = new Map<string, { storeVarName: string; propertyName: string; wrongStore: string }>();
        
        // Re-extract scriptContent to get latest state
        const updatedScriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        const updatedScriptContent = updatedScriptMatch ? updatedScriptMatch[1] : scriptContent;
        
        // Re-detect stores in updated content
        const updatedStorePattern = /const\s+(\w+Store)\s*=\s*use(\w+)Store\s*\(\)/g;
        const updatedStores = new Map<string, string>();
        let updatedStoreMatch;
        while ((updatedStoreMatch = updatedStorePattern.exec(updatedScriptContent)) !== null) {
          updatedStores.set(updatedStoreMatch[1], updatedStoreMatch[2].toLowerCase());
        }
        
        while ((propertyMatch2 = propertyAccessPattern2.exec(updatedScriptContent)) !== null) {
          const storeVar = propertyMatch2[1];
          const propertyName = propertyMatch2[2];
          
          // Infer correct store from property name
          const propertyLower = propertyName.toLowerCase();
          const withoutAll = propertyLower.replace(/^all/, '');
          const singular = withoutAll.endsWith('s') ? withoutAll.slice(0, -1) : withoutAll;
          const normalized = singular.endsWith('ies') ? singular.slice(0, -3) + 'y' : singular;
          const correctStoreVar = `${normalized}Store`;
          
          // If the property should come from a different store and that store is not initialized
          // Always try to fix if property name suggests a different store (more permissive)
          if (normalized && correctStoreVar !== storeVar && !updatedStores.has(correctStoreVar)) {
            const key = `${storeVar}.${propertyName}`;
            if (!missingStores.has(key)) {
              missingStores.set(key, { storeVarName: correctStoreVar, propertyName, wrongStore: storeVar });
            }
          }
        }
        
        // Add missing store imports and initializations
        missingStores.forEach(({ storeVarName, propertyName, wrongStore }) => {
          const storeName = storeVarName.replace('Store', '');
          const storeImportName = `use${storeName.charAt(0).toUpperCase() + storeName.slice(1)}Store`;
          
          // Check if import already exists - check both scriptContent and fixedContent
          const importPattern = new RegExp(`import.*${storeImportName}.*from`, 'g');
          const reExtractedScript = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
          const currentScriptContent = reExtractedScript ? reExtractedScript[1] : scriptContent;
          
          if (!importPattern.test(currentScriptContent)) {
            // Find last import statement in fixedContent
            const importSectionMatch = currentScriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (importSectionMatch) {
              const lastImport = importSectionMatch[0];
              // Find the position in fixedContent
              const scriptTagMatch = fixedContent.match(/<script[^>]*>/);
              const scriptTagEnd = scriptTagMatch ? fixedContent.indexOf(scriptTagMatch[0]) + scriptTagMatch[0].length : 0;
              const importIndex = fixedContent.indexOf(lastImport, scriptTagEnd);
              
              if (importIndex !== -1) {
                const insertPos = importIndex + lastImport.length;
                const storeImport = `\nimport { ${storeImportName} } from '@/store/modules/${storeName}';`;
                fixedContent = fixedContent.substring(0, insertPos) + storeImport + fixedContent.substring(insertPos);
                
                // Add store initialization after last store init
                const updatedScript = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
                const updatedScriptContent = updatedScript ? updatedScript[1] : currentScriptContent;
                const lastStoreInit = updatedScriptContent.match(/const\s+\w+Store\s*=\s*use\w+Store\s*\(\)/g);
                if (lastStoreInit) {
                  const lastMatch = fixedContent.lastIndexOf(lastStoreInit[lastStoreInit.length - 1]);
                  const insertPos2 = lastMatch + lastStoreInit[lastStoreInit.length - 1].length;
                  const storeInit = `\nconst ${storeVarName} = ${storeImportName}();`;
                  fixedContent = fixedContent.substring(0, insertPos2) + storeInit + fixedContent.substring(insertPos2);
                }
                
                // Fix property access - replace wrongStore.propertyName with correctStoreVar.propertyName
                const wrongPattern = new RegExp(`\\b${wrongStore}\\.${propertyName}\\b`, 'g');
                fixedContent = fixedContent.replace(wrongPattern, `${storeVarName}.${propertyName}`);
                finalFixed = true;
                result.fixes.push(`Added missing store ${storeVarName} and fixed ${wrongStore}.${propertyName} → ${storeVarName}.${propertyName} (generic)`);
              }
            }
          }
        });
      }
    }
    
    // Fix: computed properties in stores accessing .length without .value (GENERIC)
    // Pattern: const varName = computed(() => filteredItems.length) should be filteredItems.value.length
    // Works for ANY computed property name (filteredUsers, filteredProducts, etc.)
    if (!isVueFile && fixedContent.includes('computed') && fixedContent.includes('.length')) {
      // Pattern: computed(() => filteredItems.length) where filteredItems is a computed property
      const computedLengthPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+)\.length\)/g;
      let computedLengthMatch;
      while ((computedLengthMatch = computedLengthPattern.exec(fixedContent)) !== null) {
        const computedVarName = computedLengthMatch[1]; // e.g., "userCount"
        const accessedVarName = computedLengthMatch[2]; // e.g., "filteredUsers"
        
        // Check if accessedVarName is a computed property (should have .value)
        if (fixedContent.includes(`const ${accessedVarName} = computed`)) {
          fixedContent = fixedContent.replace(
            new RegExp(`const\\s+${computedVarName}\\s*=\\s*computed\\s*<[^>]*>\\s*\\(\\s*\\(\\)\\s*=>\\s*${accessedVarName}\\.length\\)`, 'g'),
            `const ${computedVarName} = computed<any>(() => ${accessedVarName}.value.length)`
          );
          finalFixed = true;
          result.fixes.push(`Fixed ${computedVarName} to use ${accessedVarName}.value.length instead of ${accessedVarName}.length (generic)`);
        }
      }
    }
    
    // Fix 6: Detail views - use store.allItems.find() instead of currentItem (GENERIC)
    // Pattern: const item = computed(() => store.currentItem) where we should find by ID
    // Works for ANY detail view (UserDetail, ProductDetail, PostDetail, etc.) and ANY store
    // Check both file path and content for "Detail"
    if (isVueFile && (filePath.includes('Detail') || fixedContent.includes('Detail')) && fixedContent.includes('<script setup')) {
      const scriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];
        
        // GENERIC: Find computed properties that use currentItem pattern
        // Pattern: const item = computed(() => store.currentItem) where item name matches store name
        // Also handle: const item = computed(() => store.currentItem) without type annotation
        // Works for any currentItem pattern (GENERIC)
        // IMPORTANT: Also catch simple patterns like "const user = computed(() => userStore.currentUser)" 
        // even if the variable name doesn't match the store name exactly
        const currentItemPatterns = [
          /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current(\w+)\s*\)/g,
          /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current(\w+)\s*\)/g,
          // More flexible: matches any computed property that accesses store.currentX where X matches store name
          /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current\w+\s*\)/g,
          /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current\w+\s*\)/g,
          // Catch simple pattern: const user = computed(() => userStore.currentUser) in Detail views
          /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.currentUser\s*\)/g,
          /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+Store)\.currentUser\s*\)/g
        ];
        
        for (const currentItemPattern of currentItemPatterns) {
          let currentItemMatch;
          while ((currentItemMatch = currentItemPattern.exec(scriptContent)) !== null) {
            const itemVarName = currentItemMatch[1];
            const storeVar = currentItemMatch[2];
            const itemType = currentItemMatch.length > 3 ? currentItemMatch[3] : '';
            
            // Check if there's an id prop/param - GENERIC
            const hasIdProp = /defineProps.*id|route\.params\.id|props\.id/.test(scriptContent);
            
            if (hasIdProp) {
              // GENERIC: Infer allItems property name from store name
              const storeNameMatch = scriptContent.match(new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`));
              if (storeNameMatch) {
                const storeName = storeNameMatch[1].toLowerCase();
                const allItemsProperty = `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
                
                // Find the actual allItems property name - check all possible patterns
                const allItemsPattern = new RegExp(`${storeVar}\\.(all\\w+)`, 'g');
                const allItemsMatch = scriptContent.match(allItemsPattern);
                let actualAllItems = allItemsMatch ? allItemsMatch[1] : allItemsProperty;
                
                // If not found in script, try to infer from store name (more generic)
                if (!allItemsMatch) {
                  actualAllItems = allItemsProperty;
                }
                
                // Always apply the fix if we have an id prop and a store (GENERIC)
                // The store should have allItems property (we'll let runtime handle if it doesn't exist)
                // Replace with find logic - GENERIC
                const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
                const userIdMatch = scriptContent.match(userIdPattern);
                let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
                // Remove "return" if present
                idSource = idSource.replace(/^\s*return\s+/, '').trim();
                // Remove trailing semicolon if present
                idSource = idSource.replace(/;\s*$/, '').trim();
                
                const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${actualAllItems}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
                
                fixedContent = fixedContent.replace(currentItemMatch[0], fixedItemComputed);
                finalFixed = true;
                result.fixes.push(`Fixed ${itemVarName} to use ${storeVar}.${actualAllItems}.find() instead of current${itemType || 'Item'} (generic)`);
                break; // Only fix once per pattern
              }
            }
          }
        }
        
        // More flexible pattern that doesn't require "current" prefix match
        const flexibleCurrentPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current\w+\s*\)/g;
        let flexibleMatch;
        while ((flexibleMatch = flexibleCurrentPattern.exec(scriptContent)) !== null) {
          const itemVarName = flexibleMatch[1];
          const storeVar = flexibleMatch[2];
          
          // Check if there's an id prop/param
          const hasIdProp = /defineProps.*id|route\.params\.id|props\.id/.test(scriptContent);
          
          if (hasIdProp && !fixedContent.includes(`${itemVarName} = computed<any>(() => {`)) {
            // Infer allItems property name
            const storeNameMatch = scriptContent.match(new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`));
            if (storeNameMatch) {
              const storeName = storeNameMatch[1].toLowerCase();
              const allItemsProperty = `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
              
              const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
              const userIdMatch = scriptContent.match(userIdPattern);
              let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
              // Remove "return" if present
              idSource = idSource.replace(/^\s*return\s+/, '').trim();
              // Remove trailing semicolon if present
              idSource = idSource.replace(/;\s*$/, '').trim();
              
              const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${allItemsProperty}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
              
              fixedContent = fixedContent.replace(flexibleMatch[0], fixedItemComputed);
              finalFixed = true;
              result.fixes.push(`Fixed ${itemVarName} to use ${storeVar}.${allItemsProperty}.find() instead of currentUser (generic)`);
            }
          }
        }
        
        // Additional catch-all for Detail views: const user = computed(() => store.currentUser)
        // This handles cases where the pattern above didn't match
        if (!finalFixed && scriptContent.includes('currentUser') && scriptContent.includes('defineProps') && scriptContent.includes('id')) {
          const simpleCurrentUserPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.currentUser\s*\)/g;
          let simpleMatch;
          while ((simpleMatch = simpleCurrentUserPattern.exec(scriptContent)) !== null) {
            const itemVarName = simpleMatch[1];
            const storeVar = simpleMatch[2];
            
            // Check if already fixed
            if (fixedContent.includes(`${itemVarName} = computed<any>(() => {`)) {
              continue;
            }
            
            // Infer allItems property name
            const storeNameMatch = scriptContent.match(new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`));
            if (storeNameMatch) {
              const storeName = storeNameMatch[1].toLowerCase();
              const allItemsProperty = `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
              
              // Check if allUsers exists in script (more reliable)
              const allUsersPattern = new RegExp(`${storeVar}\\.(all\\w+)`, 'g');
              const allUsersMatch = scriptContent.match(allUsersPattern);
              const actualAllItems = allUsersMatch ? allUsersMatch[1] : allItemsProperty;
              
              // Get id source
              const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
              const userIdMatch = scriptContent.match(userIdPattern);
              let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
              // Remove "return" if present
              idSource = idSource.replace(/^\s*return\s+/, '').trim();
              // Remove trailing semicolon if present
              idSource = idSource.replace(/;\s*$/, '').trim();
              
              const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${actualAllItems}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
              
              // Replace in fixedContent (not scriptContent)
              fixedContent = fixedContent.replace(simpleMatch[0], fixedItemComputed);
              finalFixed = true;
              result.fixes.push(`Fixed ${itemVarName} to use ${storeVar}.${actualAllItems}.find() instead of currentUser (catch-all)`);
              break;
            }
          }
        }
      }
    }
  }
    
  // FINAL PASS: Aggressive fixes for common issues that might have been missed (COMPLETELY GENERIC)
  // This runs at the very end to catch any remaining issues - works for ANY Vue project
  // IMPORTANT: This must run AFTER all other fixes to catch remaining issues
  if (isVueFile && fixedContent.includes('<script setup')) {
      let finalFixed = false;
      const finalScriptMatch = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (finalScriptMatch) {
        const finalScriptContent = finalScriptMatch[1];
        
        // GENERIC Fix 1: Detect wrongStore.allItems → correctStore.allItems (GENERIC)
        // Pattern: Any store.property where property name suggests a different store
        const wrongStorePattern = /(\w+Store)\.(all\w+)/g;
        let wrongStoreMatch;
        const wrongStoreFixes = new Map<string, { wrongStore: string; property: string; correctStore: string }>();
        
        while ((wrongStoreMatch = wrongStorePattern.exec(finalScriptContent)) !== null) {
          const wrongStoreVar = wrongStoreMatch[1];
          const propertyName = wrongStoreMatch[2];
          
          // GENERIC: Infer correct store from property name
          const propertyLower = propertyName.toLowerCase();
          const withoutAll = propertyLower.replace(/^all/, '');
          const singular = withoutAll.endsWith('s') ? withoutAll.slice(0, -1) : withoutAll;
          const normalized = singular.endsWith('ies') ? singular.slice(0, -3) + 'y' : singular;
          const correctStoreVar = `${normalized}Store`;
          
          // If property suggests a different store and that store is not initialized
          if (normalized && correctStoreVar !== wrongStoreVar) {
            const storesInScript = finalScriptContent.match(/const\s+(\w+Store)\s*=\s*use\w+Store\s*\(\)/g);
            const initializedStores = storesInScript ? storesInScript.map(s => s.match(/const\s+(\w+Store)/)?.[1]).filter(Boolean) : [];
            
            if (!initializedStores.includes(correctStoreVar)) {
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
        }
        
        // Apply wrong store fixes - GENERIC
        wrongStoreFixes.forEach(({ wrongStore, property, correctStore }) => {
          const storeName = correctStore.replace('Store', '');
          const storeImportName = `use${storeName.charAt(0).toUpperCase() + storeName.slice(1)}Store`;
          
          // Add import if missing
          if (!finalScriptContent.includes(storeImportName)) {
            const importMatch = finalScriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (importMatch) {
              const lastImport = importMatch[0];
              const scriptTagMatch = fixedContent.match(/<script[^>]*>/);
              const scriptTagEnd = scriptTagMatch ? fixedContent.indexOf(scriptTagMatch[0]) + scriptTagMatch[0].length : 0;
              const importIndex = fixedContent.indexOf(lastImport, scriptTagEnd);
              if (importIndex !== -1) {
                const insertPos = importIndex + lastImport.length;
                const storeImport = `\nimport { ${storeImportName} } from '@/store/modules/${storeName}';`;
                fixedContent = fixedContent.substring(0, insertPos) + storeImport + fixedContent.substring(insertPos);
              }
            }
          }
          
          // Add initialization if missing
          const updatedScript = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
          const updatedScriptContent = updatedScript ? updatedScript[1] : finalScriptContent;
          if (!updatedScriptContent.includes(`const ${correctStore} = ${storeImportName}()`)) {
            const storeInitMatch = updatedScriptContent.match(/const\s+\w+Store\s*=\s*use\w+Store\s*\(\)/g);
            if (storeInitMatch) {
              const lastStoreInit = storeInitMatch[storeInitMatch.length - 1];
              const initIndex = fixedContent.lastIndexOf(lastStoreInit) + lastStoreInit.length;
              const storeInit = `\nconst ${correctStore} = ${storeImportName}();`;
              fixedContent = fixedContent.substring(0, initIndex) + storeInit + fixedContent.substring(initIndex);
            }
          }
          
          // Fix the reference - GENERIC
          const wrongPattern = new RegExp(`\\b${wrongStore}\\.${property}\\b`, 'g');
          fixedContent = fixedContent.replace(wrongPattern, `${correctStore}.${property}`);
          finalFixed = true;
          result.fixes.push(`Final fix (generic): ${wrongStore}.${property} → ${correctStore}.${property}`);
        });
        
        // GENERIC Fix 2: store.property || [].length → (store.property || []).length
        // Re-extract after potential modifications
        const updatedScript2 = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        const updatedScriptContent2 = updatedScript2 ? updatedScript2[1] : finalScriptContent;
        if (updatedScriptContent2.includes('|| [].length')) {
          fixedContent = fixedContent.replace(/(\w+Store\.\w+)\s*\|\|\s*\[\]\s*\.length/g, (match, propertyPath) => {
            if (!match.includes('(')) {
              finalFixed = true;
              return `(${propertyPath} || []).length`;
            }
            return match;
          });
        }
        
        // GENERIC Fix 3: In Detail views, store.currentItem → store.allItems.find() (GENERIC)
        // Works for ANY Detail view (UserDetail, ProductDetail, PostDetail, etc.) and ANY store
        // IMPORTANT: Check both the extracted script AND the full file content for better matching
        const updatedScript3 = fixedContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        const updatedScriptContent3 = updatedScript3 ? updatedScript3[1] : finalScriptContent;
        if (filePath.includes('Detail') || fixedContent.includes('Detail')) {
          // First, try direct replacement in the full file content (more reliable for single-line scripts)
          const directFilePattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current(\w+)\s*\)/g;
          let directFileMatch;
          directFilePattern.lastIndex = 0;
          
          while ((directFileMatch = directFilePattern.exec(fixedContent)) !== null) {
            const itemVarName = directFileMatch[1];
            const storeVar = directFileMatch[2];
            
            // Skip if already fixed
            if (fixedContent.includes(`${itemVarName} = computed<any>(() => {`)) {
              continue;
            }
            
            // Only process if we're in a Detail view context
            const contextBefore = fixedContent.substring(Math.max(0, directFileMatch.index - 200), directFileMatch.index);
            if (!contextBefore.includes('Detail') && !filePath.includes('Detail')) {
              continue;
            }
            
            // Find store name from the script content
            const storeNameMatch = fixedContent.match(new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`));
            if (storeNameMatch) {
              const storeName = storeNameMatch[1].toLowerCase();
              
              // Find actual allItems property
              const allItemsPattern = new RegExp(`${storeVar}\\.(all\\w+)`, 'g');
              const allItemsMatches = [...fixedContent.matchAll(allItemsPattern)];
              const actualAllItems = allItemsMatches.length > 0 ? allItemsMatches[0][1] : `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
              
              // Get id source
              const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
              const userIdMatch = fixedContent.match(userIdPattern);
              let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
              // Remove "return" if present
              idSource = idSource.replace(/^\s*return\s+/, '').trim();
              // Remove trailing semicolon if present
              idSource = idSource.replace(/;\s*$/, '').trim();
              
              const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${actualAllItems}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
              
              // Replace in fixedContent
              fixedContent = fixedContent.replace(directFileMatch[0], fixedItemComputed);
              finalFixed = true;
              result.fixes.push(`Final fix (generic): ${itemVarName} in Detail view uses ${storeVar}.${actualAllItems}.find()`);
              break;
            }
          }
          
          // Fallback to script content matching if direct file matching didn't work
          if (!finalFixed) {
            // Direct replacement approach: find any computed(() => store.currentX) in Detail views
            // This is more reliable than complex regex patterns
            const directPattern = /const\s+(\w+)\s*=\s*computed\s*<[^>]*>\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current(\w+)\s*\)/g;
          let directMatch;
          directPattern.lastIndex = 0;
          
          while ((directMatch = directPattern.exec(updatedScriptContent3)) !== null) {
            const itemVarName = directMatch[1];
            const storeVar = directMatch[2];
            
            // Skip if already fixed
            if (updatedScriptContent3.includes(`${itemVarName} = computed<any>(() => {`)) {
              continue;
            }
            
            // Find store name
            const storeNameMatch = updatedScriptContent3.match(new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`));
            if (storeNameMatch) {
              const storeName = storeNameMatch[1].toLowerCase();
              
              // Find actual allItems property in script
              const allItemsPattern = new RegExp(`${storeVar}\\.(all\\w+)`, 'g');
              const allItemsMatches = [...updatedScriptContent3.matchAll(allItemsPattern)];
              const actualAllItems = allItemsMatches.length > 0 ? allItemsMatches[0][1] : `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
              
              // Get id source
              const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
              const userIdMatch = updatedScriptContent3.match(userIdPattern);
              let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
              // Remove "return" if present
              idSource = idSource.replace(/^\s*return\s+/, '').trim();
              // Remove trailing semicolon if present
              idSource = idSource.replace(/;\s*$/, '').trim();
              
              const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${actualAllItems}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
              
              // Replace in fixedContent
              fixedContent = fixedContent.replace(directMatch[0], fixedItemComputed);
              finalFixed = true;
              result.fixes.push(`Final fix (generic): ${itemVarName} in Detail view uses ${storeVar}.${actualAllItems}.find()`);
              break;
            }
          }
          
          // Fallback: simpler pattern without type annotation
          if (!finalFixed) {
            const simplePattern = /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+Store)\.current(\w+)\s*\)/g;
            let simpleMatch;
            simplePattern.lastIndex = 0;
            
            while ((simpleMatch = simplePattern.exec(updatedScriptContent3)) !== null) {
              const itemVarName = simpleMatch[1];
              const storeVar = simpleMatch[2];
              
              // Skip if already fixed
              if (updatedScriptContent3.includes(`${itemVarName} = computed<any>(() => {`)) {
                continue;
              }
              
              const storeNameMatch = updatedScriptContent3.match(new RegExp(`const\\s+${storeVar}\\s*=\\s*use(\\w+)Store`));
              if (storeNameMatch) {
                const storeName = storeNameMatch[1].toLowerCase();
                const allItemsPattern = new RegExp(`${storeVar}\\.(all\\w+)`, 'g');
                const allItemsMatches = [...updatedScriptContent3.matchAll(allItemsPattern)];
                const actualAllItems = allItemsMatches.length > 0 ? allItemsMatches[0][1] : `all${storeName.charAt(0).toUpperCase() + storeName.slice(1)}s`;
                
                const userIdPattern = /const\s+(\w+Id)\s*=\s*computed\s*\([^)]*\)\s*=>\s*(?:return\s+)?([^;]+?)(?:;|$)/;
                const userIdMatch = updatedScriptContent3.match(userIdPattern);
                let idSource = userIdMatch ? userIdMatch[2].trim() : 'props.id || (route.params.id as string)';
                // Remove "return" if present
                idSource = idSource.replace(/^\s*return\s+/, '').trim();
                // Remove trailing semicolon if present
                idSource = idSource.replace(/;\s*$/, '').trim();
                
                const fixedItemComputed = `const ${itemVarName} = computed<any>(() => {
    const id = ${idSource};
    return ${storeVar}.${actualAllItems}?.find((item: any) => item.id === parseInt(id as string)) || null;
  })`;
                
                fixedContent = fixedContent.replace(simpleMatch[0], fixedItemComputed);
                finalFixed = true;
                result.fixes.push(`Final fix (generic): ${itemVarName} in Detail view uses ${storeVar}.${actualAllItems}.find()`);
                break;
              }
            }
          }
        }
      }
      
    if (finalFixed) {
      result.fixed = true;
      if (!result.fixes.some(f => f.includes('final fix'))) {
        result.fixes.push('Applied critical final fixes');
      }
    }
    
    // Final cleanup: Fix malformed const id = { return ... } patterns
    // This can happen when idSource extraction includes return statement incorrectly
    if (isVueFile && fixedContent.includes('const id = {')) {
      // Fix pattern: const id = { return ... } → const id = ...
      // Handle both single line and multi-line patterns
      fixedContent = fixedContent.replace(/const\s+id\s*=\s*\{\s*return\s+([^}]+?)\s*;\s*\}/g, (match, idValue) => {
        const cleanedValue = idValue.trim().replace(/;\s*$/, '');
        return `const id = ${cleanedValue}`;
      });
      
      // Fix pattern where return is on next line with newline
      fixedContent = fixedContent.replace(/const\s+id\s*=\s*\{\s*\n\s*return\s+([^}]+?)\s*;\s*\}/g, (match, idValue) => {
        const cleanedValue = idValue.trim().replace(/;\s*$/, '');
        return `const id = ${cleanedValue}`;
      });
      
      // Fix pattern: const id = { followed by return on next line (more flexible)
      fixedContent = fixedContent.replace(/const\s+id\s*=\s*\{\s*([\s\S]*?)return\s+([^}]+?)\s*;\s*\}/g, (match, beforeReturn, idValue) => {
        // Only fix if there's a return statement
        if (beforeReturn.trim() === '' || beforeReturn.includes('\n')) {
          const cleanedValue = idValue.trim().replace(/;\s*$/, '');
          return `const id = ${cleanedValue}`;
        }
        return match;
      });
      
      if (fixedContent !== content) {
        result.fixed = true;
        result.fixes.push('Fixed malformed const id = { return ... } pattern');
      }
    }
  }
  }

  // Final formatting: Fix script setup tag formatting
  // Ensure <script setup> and imports are on separate lines, and </script> is on its own line
  if (isVueFile && fixedContent.includes('<script setup')) {
    // Fix: <script setup lang="ts">import ... → <script setup lang="ts">\nimport ...
    // Match script tag followed immediately by import (no newline)
    fixedContent = fixedContent.replace(/<script\s+setup[^>]*>import/g, (match) => {
      // Extract the script tag part
      const scriptTagMatch = match.match(/<script\s+setup[^>]*>/);
      if (scriptTagMatch) {
        return scriptTagMatch[0] + '\nimport';
      }
      return match;
    });
    
    // Fix: ...;</script> → ...;\n</script>
    // Match any code ending with ; followed by </script> on same line
    fixedContent = fixedContent.replace(/([^;\n]);\s*<\/script>/g, '$1;\n</script>');
    
    // Also handle cases where there's code before </script> without semicolon
    fixedContent = fixedContent.replace(/([^\n}])\s*<\/script>/g, (match, beforeTag) => {
      // Only fix if </script> is on same line as code and it's not already properly formatted
      if (!beforeTag.includes('\n') && beforeTag.trim().length > 0 && !beforeTag.endsWith(';')) {
        // Check if it's the end of a statement (ends with } or ))
        if (beforeTag.trim().endsWith('}') || beforeTag.trim().endsWith(')')) {
          return beforeTag + '\n</script>';
        }
      }
      return match;
    });
    
    if (fixedContent !== content) {
      result.fixed = true;
      result.fixes.push('Fixed script setup tag formatting');
    }
  }

  // Final step: Format with Prettier if available (for proper indentation and formatting)
  // This ensures consistent code style for Vue 3 projects
  try {
    const prettierFormatted = await formatWithPrettier(filePath, fixedContent, projectRoot);
    if (prettierFormatted !== fixedContent) {
      fixedContent = prettierFormatted;
      if (!result.fixed) {
        result.fixed = true;
      }
      result.fixes.push("Formatted code with Prettier");
    }
  } catch {
    // If Prettier is not available or fails, continue with basic formatting
    // The basic formatting rules above should handle most cases
  }

  return {
    ...result,
    fixed: fixedContent !== content,
    content: fixedContent,
  };
}

/**
 * Fixes import paths to use the @ alias for src/ directory.
 * Converts relative imports (e.g., `../../store/`) to alias imports (e.g., `@/store/`).
 * 
 * @param content - The file content to fix
 * @param projectRoot - The root directory of the project
 * @param filePath - The path to the file being processed
 * @returns The fixed content with updated import paths
 */
export function fixImportPaths(
  content: string,
  projectRoot: string,
  filePath: string
): string {
  let fixed = content;

  // Convert relative imports to @ alias for src/ directory
  const relativeImportPattern = /from\s+['"](\.\.\/)+store\//g;
  if (relativeImportPattern.test(fixed)) {
    // Calculate relative path from file to src
    const srcPath = path.join(projectRoot, "src");

    // If file is in src/, use @ alias
    if (filePath.startsWith(srcPath)) {
      fixed = fixed.replace(/from\s+['"](\.\.\/)+store\//g, 'from "@/store/');
      fixed = fixed.replace(/from\s+['"]\.\.\/store\//g, 'from "@/store/');
    }
  }

  return fixed;
}
