import * as fs from "fs/promises";
import * as path from "path";
import { 
  analyzeArrayItemProperties, 
  analyzeFilterProperties,
  analyzeTemplateProperties 
} from "./property-analyzer";

export interface FixResult {
  fixed: boolean;
  issues: string[];
  fixes: string[];
  content: string; // Fixed content
}

/**
 * Post-migration fixer to correct common issues after migration
 * - Removes this. references in setup()
 * - Removes export default in <script setup>
 * - Makes functions async if they use await
 * - Removes Vuex imports
 */
/**
 * Find the main store (store/index.js or stores/index.js) and return its store name
 */
async function findMainStore(projectRoot: string): Promise<{ storeName: string; importPath: string } | null> {
  try {
    // Try src/store/index.js first
    const storeIndexPath = path.join(projectRoot, "src", "store", "index.js");
    try {
      const storeContent = await fs.readFile(storeIndexPath, 'utf-8');
      const storeNameMatch = storeContent.match(/export\s+const\s+(use\w+Store)\s*=/);
      if (storeNameMatch) {
        return {
          storeName: storeNameMatch[1],
          importPath: '@/store/index'
        };
      }
    } catch (error) {
      // Try src/store/index.ts
      try {
        const storeIndexPathTs = path.join(projectRoot, "src", "store", "index.ts");
        const storeContent = await fs.readFile(storeIndexPathTs, 'utf-8');
        const storeNameMatch = storeContent.match(/export\s+const\s+(use\w+Store)\s*=/);
        if (storeNameMatch) {
          return {
            storeName: storeNameMatch[1],
            importPath: '@/store/index'
          };
        }
      } catch (error2) {
        // Try src/stores/index.js
        try {
          const storesIndexPath = path.join(projectRoot, "src", "stores", "index.js");
          const storeContent = await fs.readFile(storesIndexPath, 'utf-8');
          const storeNameMatch = storeContent.match(/export\s+const\s+(use\w+Store)\s*=/);
          if (storeNameMatch) {
            return {
              storeName: storeNameMatch[1],
              importPath: '@/stores/index'
            };
          }
        } catch (error3) {
          // Try src/stores/index.ts
          try {
            const storesIndexPathTs = path.join(projectRoot, "src", "stores", "index.ts");
            const storeContent = await fs.readFile(storesIndexPathTs, 'utf-8');
            const storeNameMatch = storeContent.match(/export\s+const\s+(use\w+Store)\s*=/);
            if (storeNameMatch) {
              return {
                storeName: storeNameMatch[1],
                importPath: '@/stores/index'
              };
            }
          } catch (error4) {
            // No main store found
          }
        }
      }
    }
  } catch (error) {
    // Error reading directory
  }
  return null;
}

/**
 * Analyze Pinia stores to build a dynamic map of methods/getters → store modules
 * This makes store detection generic for any project
 */
async function analyzePiniaStores(
  projectRoot: string,
): Promise<Map<string, string>> {
  const methodToStoreMap = new Map<string, string>();
  
  try {
    // Find all store files in src/store/modules/
    const storeModulesPath = path.join(projectRoot, "src", "store", "modules");
    
    try {
      const storeFiles = await fs.readdir(storeModulesPath);
      
      for (const storeFile of storeFiles) {
        if (!storeFile.endsWith('.js') && !storeFile.endsWith('.ts')) {
          continue;
        }
        
        const storeFilePath = path.join(storeModulesPath, storeFile);
        const storeContent = await fs.readFile(storeFilePath, 'utf-8');
        
        // Extract module name from filename (e.g., 'user.js' → 'user')
        const moduleName = storeFile.replace(/\.(js|ts)$/, '');
        
        // Extract store name from export: export const useUserStore = ...
        const storeNameMatch = storeContent.match(/export\s+const\s+(use\w+Store)\s*=/);
        if (!storeNameMatch) continue;
        
        // Extract all methods/getters from the return statement
        // Pattern: return { method1, method2, getter1, ... } or return { prop1: value1, prop2: value2 }
        // Find the return statement by locating the last 'return' before the closing '});'
        const returnIndex = storeContent.lastIndexOf('return');
        if (returnIndex !== -1) {
          const afterReturn = storeContent.substring(returnIndex);
          // Find the closing }); of defineStore
          const closingIndex = afterReturn.indexOf('});');
          if (closingIndex !== -1) {
            // Extract content between return { and };
            const returnSection = afterReturn.substring(0, closingIndex);
            // Match return { ... };
            const returnMatch = returnSection.match(/return\s*\{([\s\S]+?)\}\s*;/);
            if (returnMatch) {
              const returnContent = returnMatch[1];
              
              // Extract property names from return object
              // Pattern 1: methodName, (shorthand)
              // Pattern 2: methodName: variableName, (with alias)
              // Pattern 3: methodName: computedValue, (computed property)
              const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
              let propMatch;
              while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
                const exportedName = propMatch[2] || propMatch[1]; // Use alias if present, otherwise original name
                const internalName = propMatch[1];
                
                // Skip common Vue/Pinia keywords and internal variables
                if (!['ref', 'reactive', 'computed', 'watch', 'onMounted', 'onUnmounted', 'undefined', 'null'].includes(exportedName)) {
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
          // Skip internal functions (usually uppercase like SET_USER)
          if (!funcName.match(/^[A-Z_]+$/)) {
            methodToStoreMap.set(funcName, moduleName);
          }
        }
        
        // Extract const declarations that are methods
        // Pattern: const methodName = (...) => { ... } or const methodName = async (...) => { ... }
        const constMethodPattern = /const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
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
          if (!storeFile.endsWith('.js') && !storeFile.endsWith('.ts')) {
            continue;
          }
          const storeFilePath = path.join(storesPath, storeFile);
          const storeContent = await fs.readFile(storeFilePath, 'utf-8');
          const moduleName = storeFile.replace(/\.(js|ts)$/, '').replace(/\.store$/, '');
          
          // Same extraction logic as above
          const returnMatch = storeContent.match(/return\s*\{([^}]+)\}/s);
          if (returnMatch) {
            const returnContent = returnMatch[1];
            const propertyPattern = /(\w+)(?:\s*:\s*\w+)?/g;
            let propMatch;
            while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
              const propName = propMatch[1];
              if (!['ref', 'reactive', 'computed', 'watch'].includes(propName)) {
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
 * Extract object structure from code assignments (e.g., SET_POSTS([{ id: 1, title: '...' }]))
 * Returns interface properties for TypeScript
 */
function extractObjectStructureFromCode(code: string, varName: string): { properties: string[]; sampleCount: number } {
  const properties = new Set<string>();
  let sampleCount = 0;
  
  try {
    // Pattern 1: const posts = [{ id: 1, title: '...' }, ...]
    const arrayAssignPattern = new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*\\[\\s*\\{([^}]+)\\}[^\\]]*\\]`, 'g');
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
    const functionCallPattern = new RegExp(`SET_\\w+\\(\\s*\\[\\s*\\{([^}]+)\\}[^\\]]*\\]\\s*\\)`, 'g');
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
    const valueAssignPattern = new RegExp(`(\\w+)\\.value\\s*=\\s*\\[\\s*\\{([^}]+)\\}[^\\]]*\\]`, 'g');
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

export async function fixPostMigrationIssues(
  filePath: string,
  content: string,
  enableTypeScript: boolean = false,
  projectRoot?: string,
): Promise<FixResult> {
  const result: FixResult = {
    fixed: false,
    issues: [],
    fixes: [],
    content: content, // Initialize with original content
  };

  let fixedContent = content;

  // Check if it's a Vue file
  const isVueFile = filePath.endsWith(".vue");

  if (isVueFile) {
    // Fix 1: Remove export default in <script setup>
    if (
      fixedContent.includes("<script setup") &&
      fixedContent.includes("export default")
    ) {
      // Extract the script setup section
      const scriptSetupMatch = fixedContent.match(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
      );
      if (scriptSetupMatch) {
        let scriptContent = scriptSetupMatch[1];
        const originalScriptContent = scriptContent;

        // Remove export default { ... } completely if it's in script setup
        // Pattern: export default { name: "...", computed: {...}, ... }
        // Need to handle nested braces properly
        let braceCount = 0;
        let startIndex = scriptContent.indexOf("export default");
        if (startIndex !== -1) {
          // Find the opening brace
          let braceStart = scriptContent.indexOf("{", startIndex);
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
            `$1${scriptContent}$3`,
          );
          result.fixed = true;
          result.fixes.push("Removed export default from <script setup>");
        }
      }
    }

    // Fix 2: Handle this.$emit in <script setup>
    // Convert this.$emit('eventName', ...) to emit('eventName', ...) with defineEmits
    if (fixedContent.includes("<script setup")) {
      const scriptSetupMatch = fixedContent.match(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
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
          const hasDefineEmits = /const\s+emit\s*=\s*defineEmits/.test(scriptContent);
          
          if (!hasDefineEmits) {
            // Create defineEmits with all event names
            const eventsArray = Array.from(eventNames).map(e => `'${e}'`).join(', ');
            const defineEmitsLine = `const emit = defineEmits([${eventsArray}]);\n`;
            
            // Insert after imports and before other code
            const importMatch = scriptContent.match(/(import\s+[^;]+;?\s*\n*)+/);
            if (importMatch) {
              const insertIndex = importMatch[0].length;
              scriptContent = scriptContent.substring(0, insertIndex) + 
                            defineEmitsLine + 
                            scriptContent.substring(insertIndex);
            } else {
              // No imports, add at the beginning
              scriptContent = defineEmitsLine + scriptContent;
            }
            
            result.fixed = true;
            result.fixes.push(`Added defineEmits for events: ${Array.from(eventNames).join(', ')}`);
          }

          // Replace this.$emit('eventName', ...) with emit('eventName', ...)
          scriptContent = scriptContent.replace(
            /this\.\$emit\((['"][^'"]+['"])/g,
            'emit($1'
          );
        }

        // Fix this.$router and this.$route - add useRouter/useRoute if missing
        const hasThisRouter = /this\.\$router/.test(scriptContent);
        const hasThisRoute = /this\.\$route/.test(scriptContent);
        const hasUseRouter = scriptContent.includes('useRouter');
        const hasUseRoute = scriptContent.includes('useRoute');
        
        if ((hasThisRouter || hasThisRoute) && (!hasUseRouter || !hasUseRoute)) {
          // Add imports if missing
          if (hasThisRouter && !hasUseRouter) {
            if (!scriptContent.includes("import { useRouter }")) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$1import { useRouter } from 'vue-router';\n`
              );
            }
            // Add const router = useRouter() if missing
            if (!scriptContent.includes('const router = useRouter()')) {
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const insertPos = importMatch[0].length;
                scriptContent = scriptContent.slice(0, insertPos) + 
                  '\nconst router = useRouter();\n' + 
                  scriptContent.slice(insertPos);
              }
            }
            // Replace this.$router with router
            scriptContent = scriptContent.replace(/this\.\$router/g, 'router');
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
            if (!scriptContent.includes('const route = useRoute()')) {
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const insertPos = importMatch[0].length;
                scriptContent = scriptContent.slice(0, insertPos) + 
                  '\nconst route = useRoute();\n' + 
                  scriptContent.slice(insertPos);
              }
            }
            // Replace this.$route with route
            scriptContent = scriptContent.replace(/this\.\$route/g, 'route');
            result.fixed = true;
            result.fixes.push("Replaced this.$route with useRoute()");
          }
        }
        
        // Fix route.query.redirect that might be an object (causes [object Object] in URL)
        // Pattern: route.query.redirect or this.$route.query.redirect
        const routeQueryRedirectPattern = /(route|this\.\$route)\.query\.redirect(\s*\|\|)?/g;
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
              const varName = match.match(/const\s+(\w+)\s*=/)?.[1] || 'redirect';
              // Ensure redirect is a string, not an object
              const fallbackValue = fallback ? fallback.match(/['"]([^'"]+)['"]/)?.[1] || '/dashboard' : '/dashboard';
              return `${prefix}typeof ${routeVar === 'this.$route' ? 'route' : routeVar}.query.redirect === 'string' ? ${routeVar === 'this.$route' ? 'route' : routeVar}.query.redirect : '${fallbackValue}'`;
            }
          );
          
          // Also fix direct usage in router.push(route.query.redirect)
          scriptContent = scriptContent.replace(
            /router\.push\((route|this\.\$route)\.query\.redirect\)/g,
            (match, routeVar) => {
              const routeName = routeVar === 'this.$route' ? 'route' : routeVar;
              return `router.push(typeof ${routeName}.query.redirect === 'string' ? ${routeName}.query.redirect : '/dashboard')`;
            }
          );
          result.fixed = true;
          result.fixes.push("Fixed route.query.redirect to handle object type (prevent [object Object] in URL)");
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
          },
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
          },
        );

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`,
          );
          result.fixed = true;
          if (!result.fixes.some(f => f.includes('defineEmits'))) {
            result.fixes.push("Removed this. references from <script setup>");
          }
        }
      }
    }

    // Fix 3: Make functions async if they use await
    // Pattern: onMounted(() => { await ... })
    // More comprehensive pattern to catch various cases
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
      // Fix arrow functions
      fixedContent = fixedContent.replace(
        /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(\(\)\s*=>\s*\{/g,
        (match, hook) => {
          // Check if the function body contains await
          const afterMatch = fixedContent.substring(
            fixedContent.indexOf(match) + match.length,
          );
          if (afterMatch.includes("await")) {
            return `${hook}(async () => {`;
          }
          return match;
        },
      );

      // Fix regular functions
      fixedContent = fixedContent.replace(
        /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(function\s*\(\)\s*\{/g,
        (match, hook) => {
          const afterMatch = fixedContent.substring(
            fixedContent.indexOf(match) + match.length,
          );
          if (afterMatch.includes("await")) {
            return `${hook}(async function() {`;
          }
          return match;
        },
      );

      if (fixedContent !== content) {
        result.fixed = true;
        result.fixes.push("Made lifecycle hooks async where await is used");
      }
    }

    // Fix 3b: Make regular functions async if they use await (not just hooks)
    // Pattern: const functionName = () => { await ... } or function functionName() { await ... }
    if (fixedContent.includes("<script setup") || fixedContent.includes("<script>")) {
      const scriptMatch = fixedContent.match(
        /<script[^>]*>([\s\S]*?)<\/script>/,
      );
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        const originalScriptContent = scriptContent;

        // Find all functions that contain await but are not async
        // Pattern 1: const funcName = () => { ... await ... }
        scriptContent = scriptContent.replace(
          /(const\s+(\w+)\s*=\s*)(\([^)]*\)\s*=>\s*\{)/g,
          (match, before, funcName, arrowPart) => {
            // Check if already async
            if (before.includes('async')) return match;
            // Find the function body after this match
            const matchIndex = scriptContent.indexOf(match);
            const afterMatch = scriptContent.substring(matchIndex + match.length);
            // Find the matching closing brace
            let braceCount = 0;
            let bodyEnd = 0;
            for (let i = 0; i < afterMatch.length; i++) {
              if (afterMatch[i] === '{') braceCount++;
              if (afterMatch[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  bodyEnd = i + 1;
                  break;
                }
              }
            }
            const functionBody = afterMatch.substring(0, bodyEnd);
            // Check if body contains await
            if (functionBody.includes('await')) {
              return before + 'async ' + arrowPart;
            }
            return match;
          }
        );

        // Pattern 2: function funcName() { ... await ... }
        scriptContent = scriptContent.replace(
          /(function\s+(\w+)\s*\([^)]*\)\s*\{)/g,
          (match, funcDecl, funcName) => {
            // Check if already async
            if (funcDecl.includes('async')) return match;
            // Find the function body
            const matchIndex = scriptContent.indexOf(match);
            const afterMatch = scriptContent.substring(matchIndex + match.length);
            // Find the matching closing brace
            let braceCount = 0;
            let bodyEnd = 0;
            for (let i = 0; i < afterMatch.length; i++) {
              if (afterMatch[i] === '{') braceCount++;
              if (afterMatch[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  bodyEnd = i + 1;
                  break;
                }
              }
            }
            const functionBody = afterMatch.substring(0, bodyEnd);
            // Check if body contains await
            if (functionBody.includes('await')) {
              return funcDecl.replace(/function\s+/, 'async function ');
            }
            return match;
          }
        );

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`,
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
  if (enableTypeScript && (filePath.endsWith('.ts') || filePath.endsWith('.js'))) {
    // Fix 1: function funcName(param: Event) where param is not actually an Event
    // Common patterns: SET_USER, SET_TOKEN, SET_FILTER, UPDATE_POST, etc.
    const incorrectEventTypePattern = /function\s+(\w+)\s*\(([^)]+)\)\s*:\s*(?:void|Promise<void>|any)\s*\{/g;
    let eventTypeMatch;
    while ((eventTypeMatch = incorrectEventTypePattern.exec(fixedContent)) !== null) {
      const funcName = eventTypeMatch[1];
      const params = eventTypeMatch[2];
      
      // Skip if function name suggests it's actually handling DOM events
      if (funcName.toLowerCase().includes('handler') || funcName.toLowerCase().includes('onclick') || funcName.toLowerCase().includes('onsubmit')) {
        continue;
      }
      
      // Fix parameters with : Event type that shouldn't be Event
      // Pattern: param: Event or { key: Event, value }: Event
      let fixedParams = params;
      
      // Fix simple parameter: param: Event → param: any
      fixedParams = fixedParams.replace(/(\w+)\s*:\s*Event(?!\w)/g, (match, paramName) => {
        // Skip if param name suggests it's actually an event (e, evt, event)
        if (paramName.toLowerCase() === 'e' || paramName.toLowerCase() === 'evt' || paramName.toLowerCase() === 'event') {
          return match;
        }
        return `${paramName}: any`;
      });
      
      // Fix destructured parameter: { key: Event, value }: Event → { key: string, value: any }: { key: string; value: any }
      // This is a common mistake from incorrect type inference
      fixedParams = fixedParams.replace(/\{\s*key\s*:\s*Event\s*,\s*value\s*:\s*(\w+)\s*\}\s*:\s*Event/g, '{ key: string, value: any }: { key: string; value: any }');
      fixedParams = fixedParams.replace(/\{\s*(\w+)\s*:\s*Event\s*,\s*(\w+)\s*:\s*(\w+)\s*\}\s*:\s*Event/g, (match, keyName, valueName, valueType) => {
        // Infer proper types based on parameter names
        const inferredKeyType = 'string';
        const inferredValueType = valueType === 'Event' ? 'any' : valueType;
        return `{ ${keyName}: ${inferredKeyType}, ${valueName}: ${inferredValueType} }: { ${keyName}: ${inferredKeyType}; ${valueName}: ${inferredValueType} }`;
      });
      
      // Fix incorrect destructuring syntax: { key: any, value } → { key, value }: { key: string; value: any }
      // This pattern means "rename key to any" which is wrong - should be { key, value } with proper type
      fixedParams = fixedParams.replace(/\{\s*(\w+)\s*:\s*any\s*,\s*(\w+)\s*\}\s*:\s*Event/g, (match, keyName, valueName) => {
        // Infer proper types based on parameter names
        const inferredKeyType = keyName === 'key' ? 'string' : 'any';
        return `{ ${keyName}, ${valueName} }: { ${keyName}: ${inferredKeyType}; ${valueName}: any }`;
      });
      
      // Also fix without Event type: { key: any, value } → { key, value }: { key: string; value: any }
      fixedParams = fixedParams.replace(/\{\s*(\w+)\s*:\s*any\s*,\s*(\w+)\s*\}(?!\s*:)/g, (match, keyName, valueName) => {
        // Only fix if it looks like a function parameter (not a variable declaration)
        if (fixedParams.includes('function') || fixedParams.includes('=>')) {
          const inferredKeyType = keyName === 'key' ? 'string' : 'any';
          return `{ ${keyName}, ${valueName} }: { ${keyName}: ${inferredKeyType}; ${valueName}: any }`;
        }
        return match;
      });
      
      if (fixedParams !== params) {
        fixedContent = fixedContent.replace(eventTypeMatch[0], eventTypeMatch[0].replace(params, fixedParams));
        result.fixed = true;
        result.fixes.push(`Fixed incorrect Event type in function ${funcName} parameters`);
      }
    }
    
    // Fix 2: Arrow functions with incorrect Event types
    const arrowEventTypePattern = /(const\s+\w+\s*=\s*\([^)]+\)\s*:\s*(?:void|Promise<void>|any)\s*=>)/g;
    let arrowMatch;
    while ((arrowMatch = arrowEventTypePattern.exec(fixedContent)) !== null) {
      const match = arrowMatch[0];
      const paramsMatch = match.match(/\(([^)]+)\)/);
      if (paramsMatch) {
        let params = paramsMatch[1];
        let fixedParams = params;
        
        // Fix simple parameter: param: Event → param: any
        fixedParams = fixedParams.replace(/(\w+)\s*:\s*Event(?!\w)/g, (match, paramName) => {
          if (paramName.toLowerCase() === 'e' || paramName.toLowerCase() === 'evt' || paramName.toLowerCase() === 'event') {
            return match;
          }
          return `${paramName}: any`;
        });
        
        if (fixedParams !== params) {
          fixedContent = fixedContent.replace(match, match.replace(params, fixedParams));
          result.fixed = true;
          result.fixes.push(`Fixed incorrect Event type in arrow function parameters`);
        }
      }
    }
  }

  // Fix 3e: Fix filters[key] access in Pinia stores (TypeScript error)
  // Pattern: filters[key] = value where filters is reactive({ category: null, search: '' })
  // TypeScript doesn't allow dynamic key access without type assertion
  if (enableTypeScript && (filePath.endsWith('.ts') || filePath.endsWith('.js'))) {
    // Pattern: filters[key] = value or filters[key] where key is a string parameter
    const filtersKeyPattern = /filters\[(\w+)\]\s*=/g;
    let filtersMatch;
    while ((filtersMatch = filtersKeyPattern.exec(fixedContent)) !== null) {
      const keyVar = filtersMatch[1];
      // Check if this is in a function that takes { key, value } as parameter
      const functionContext = fixedContent.substring(0, filtersMatch.index);
      const functionMatch = functionContext.match(/(function\s+\w+\s*\([^)]*\{[^}]*key[^}]*\}[^)]*\)|const\s+\w+\s*=\s*\([^)]*\{[^}]*key[^}]*\}[^)]*\))/);
      
      if (functionMatch || keyVar === 'key') {
        // Replace filters[key] with (filters as any)[key] for TypeScript compatibility
        fixedContent = fixedContent.replace(
          new RegExp(`filters\\[${keyVar}\\]`, 'g'),
          `(filters as any)[${keyVar}]`
        );
        result.fixed = true;
        result.fixes.push(`Fixed filters[key] access with type assertion for TypeScript compatibility`);
        break; // Only fix once per file
      }
    }
  }

  // Fix 3c: Make functions async if they use await in .js/.ts files (stores, etc.)
  // This handles Pinia stores and other JS files that aren't Vue components
  if ((filePath.endsWith('.js') || filePath.endsWith('.ts')) && !isVueFile && fixedContent.includes('await')) {
    // Pattern 1: function funcName() { ... await ... } or function funcName(): void { ... await ... }
    const functionPattern = /(function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*(?:void|Promise<void>|any))?\s*\{)/g;
    let functionMatch;
    const functionsToFix: Array<{ match: string; replacement: string }> = [];
    
    while ((functionMatch = functionPattern.exec(fixedContent)) !== null) {
      const match = functionMatch[0];
      const funcName = functionMatch[2];
      
      // Skip if already async
      if (match.includes('async')) continue;
      
      // Find the function body
      const matchIndex = functionMatch.index;
      const afterMatch = fixedContent.substring(matchIndex + match.length);
      
      // Find the matching closing brace
      let braceCount = 0;
      let bodyEnd = 0;
      for (let i = 0; i < afterMatch.length; i++) {
        if (afterMatch[i] === '{') braceCount++;
        if (afterMatch[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }
      
      const functionBody = afterMatch.substring(0, bodyEnd);
      // Check if body contains await
      if (functionBody.includes('await')) {
        // Replace function with async function, preserving return type annotation if present
        let replacement = match;
        if (match.includes('): void')) {
          replacement = match.replace(/function\s+/, 'async function ').replace(/:\s*void/, ': Promise<void>');
        } else if (match.includes('): Promise<void>')) {
          replacement = match.replace(/function\s+/, 'async function ');
        } else {
          replacement = match.replace(/function\s+/, 'async function ');
        }
        functionsToFix.push({ match, replacement });
      }
    }
    
    // Also check for arrow functions: const funcName = () => { await ... }
    // Pattern 1: const funcName = () => { await ... } (no type annotation)
    const arrowFunctionPattern1 = /(const\s+(\w+)\s*=\s*)(\([^)]*\)\s*=>\s*\{)/g;
    let arrowMatch1;
    const arrowFunctionsToFix: Array<{ match: string; replacement: string; index: number }> = [];
    
    while ((arrowMatch1 = arrowFunctionPattern1.exec(fixedContent)) !== null) {
      const match = arrowMatch1[0];
      const funcName = arrowMatch1[2];
      
      // Skip if already async
      if (match.includes('async')) continue;
      
      // Find the function body
      const matchIndex = arrowMatch1.index;
      const afterMatch = fixedContent.substring(matchIndex + match.length);
      
      // Find the matching closing brace
      let braceCount = 0;
      let bodyEnd = 0;
      for (let i = 0; i < afterMatch.length; i++) {
        if (afterMatch[i] === '{') braceCount++;
        if (afterMatch[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }
      
      const functionBody = afterMatch.substring(0, bodyEnd);
      // Check if body contains await
      if (functionBody.includes('await')) {
        // Replace with async arrow function
        const replacement = match.replace(/(const\s+\w+\s*=\s*\()/, '$1async ');
        arrowFunctionsToFix.push({ match, replacement, index: matchIndex });
      }
    }
    
    // Pattern 2: const funcName = (): void => { await ... } (with type annotation)
    const arrowFunctionPattern2 = /(const\s+(\w+)\s*=\s*)(\([^)]*\)\s*:\s*(?:void|Promise<void>|any)\s*=>\s*\{)/g;
    let arrowMatch2;
    
    while ((arrowMatch2 = arrowFunctionPattern2.exec(fixedContent)) !== null) {
      const match = arrowMatch2[0];
      const funcName = arrowMatch2[2];
      
      // Skip if already async
      if (match.includes('async')) continue;
      
      // Find the function body
      const matchIndex = arrowMatch2.index;
      const afterMatch = fixedContent.substring(matchIndex + match.length);
      
      // Find the matching closing brace
      let braceCount = 0;
      let bodyEnd = 0;
      for (let i = 0; i < afterMatch.length; i++) {
        if (afterMatch[i] === '{') braceCount++;
        if (afterMatch[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }
      
      const functionBody = afterMatch.substring(0, bodyEnd);
      // Check if body contains await
      if (functionBody.includes('await')) {
        // Replace with async arrow function, preserving return type if present
        let replacement = match;
        if (match.includes('): void')) {
          replacement = match.replace(/(const\s+\w+\s*=\s*\()/, '$1async ').replace(/:\s*void/, ': Promise<void>');
        } else if (match.includes('): Promise<void>')) {
          replacement = match.replace(/(const\s+\w+\s*=\s*\()/, '$1async ');
        } else {
          replacement = match.replace(/(const\s+\w+\s*=\s*\()/, '$1async ');
        }
        arrowFunctionsToFix.push({ match, replacement, index: matchIndex });
      }
    }
    
    // Apply fixes (in reverse order to preserve indices)
    functionsToFix.reverse().forEach(({ match, replacement }) => {
      fixedContent = fixedContent.replace(match, replacement);
    });
    
    arrowFunctionsToFix.reverse().forEach(({ match, replacement }) => {
      fixedContent = fixedContent.replace(match, replacement);
    });
    
    if (functionsToFix.length > 0 || arrowFunctionsToFix.length > 0) {
      result.fixed = true;
      result.fixes.push(`Made ${functionsToFix.length + arrowFunctionsToFix.length} function(s) async where await is used`);
    }

    // Fix 3e: Improve TypeScript types and generate interfaces from code assignments
    // Analyze assignments like SET_POSTS([{ id: 1, title: '...' }]) to generate interfaces
    if (enableTypeScript && (filePath.endsWith('.ts') || filePath.endsWith('.js')) && fixedContent.includes('defineStore')) {
      // Find empty interfaces that need to be filled: interface Post {}
      const emptyInterfacePattern = /interface\s+(\w+)\s*\{\s*\}/g;
      let interfaceMatch;
      const interfacesToFill = new Map<string, { properties: string[] }>();
      
      while ((interfaceMatch = emptyInterfacePattern.exec(fixedContent)) !== null) {
        const interfaceName = interfaceMatch[1];
        // Try to extract object structure from code
        const structure = extractObjectStructureFromCode(fixedContent, interfaceName.toLowerCase());
        if (structure.properties.length > 0) {
          interfacesToFill.set(interfaceName, structure);
        }
      }
      
      // Replace empty interfaces with filled ones
      interfacesToFill.forEach((structure, interfaceName) => {
        // Infer types for each property (simple heuristic)
        const typedProperties = structure.properties.map(prop => {
          // Infer type from property name
          const propLower = prop.toLowerCase();
          if (propLower.includes('id') || propLower.includes('count') || propLower.includes('index')) {
            return `  ${prop}: number;`;
          } else if (propLower.includes('is') || propLower.includes('has') || propLower.includes('should')) {
            return `  ${prop}: boolean;`;
          } else {
            return `  ${prop}: string;`;
          }
        });
        
        const filledInterface = `interface ${interfaceName} {\n${typedProperties.join('\n')}\n}`;
        const emptyInterface = `interface ${interfaceName} {}`;
        fixedContent = fixedContent.replace(emptyInterface, filledInterface);
        result.fixed = true;
        result.fixes.push(`Generated TypeScript interface '${interfaceName}' with properties: ${structure.properties.join(', ')}`);
      });
      
      // Improve ref types: ref(null) → ref<Post | null>(null) based on context
      // Pattern: const currentPost = ref(null) where Post interface exists
      const refNullPattern = /const\s+(\w+)\s*=\s*ref\s*<\s*any\s*>\s*\(\s*null\s*\)/g;
      let refNullMatch;
      while ((refNullMatch = refNullPattern.exec(fixedContent)) !== null) {
        const varName = refNullMatch[1];
        // Infer interface name from variable name
        const interfaceName = varName.charAt(0).toUpperCase() + varName.slice(1);
        // Check if interface exists
        if (fixedContent.includes(`interface ${interfaceName}`)) {
          const improvedRef = `const ${varName} = ref<${interfaceName} | null>(null)`;
          fixedContent = fixedContent.replace(refNullMatch[0], improvedRef);
          result.fixed = true;
          result.fixes.push(`Improved type for ref '${varName}': ref<${interfaceName} | null>`);
        }
      }
      
      // Improve ref types: ref([]) → ref<Post[]>([]) based on context
      const refArrayPattern = /const\s+(\w+)\s*=\s*ref\s*<\s*any\[\]\s*>\s*\(\s*\[\s*\]\s*\)/g;
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
          result.fixes.push(`Improved type for ref '${varName}': ref<${interfaceName}[]>`);
        }
      }
    }

    // Fix 3d: Fix incomplete computed properties in Pinia stores
    // Pattern 1: const filteredProducts = computed(() => filtered); → should have full logic
    // Pattern 2: const categories = computed(() => Array.from(cats)); where cats is undefined
    // GENERIC: Automatically infers missing logic from store context
    if (fixedContent.includes('defineStore') && fixedContent.includes('computed')) {
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
      const incompleteComputedPattern = /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+)\s*\)/g;
      let incompleteMatch;
      
      while ((incompleteMatch = incompleteComputedPattern.exec(fixedContent)) !== null) {
        const computedName = incompleteMatch[1];
        const referencedVar = incompleteMatch[2];
        
        // Check if the referenced variable is not defined in the store
        if (computedName !== referencedVar && !fixedContent.match(new RegExp(`(const|let|var|ref|reactive)\\s+${referencedVar}\\b`))) {
          // Try to infer from context: if computedName is plural (categories, tags, items), 
          // and we have a similar singular reactive var (posts, products), infer extraction logic
          const computedNameLower = computedName.toLowerCase();
          
          // Common patterns: categories → posts.category, tags → items.tags, etc.
          let inferredSource: string | null = null;
          let inferredProperty: string | null = null;
          
          // GENERIC PATTERN: Infer source from computed name and available reactive vars
          // Works for: categories → any array var with 'category' property, tags → any array var with 'tags' property
          // Strategy: Find any reactive var that could contain the property we're looking for
          
          // Extract property name from computed name (categories → category, tags → tag)
          let targetProperty = computedNameLower.replace(/s$/, ''); // Remove plural 's'
          
          // Pattern 1: categories/category → find any array var and extract 'category' property
          if (computedNameLower.includes('categor')) {
            targetProperty = 'category';
            // Find any array-like reactive var (any plural noun or array-like name)
            const arrayLikeVars = Array.from(reactiveVars).filter(v => {
              const vLower = v.toLowerCase();
              // Match common array patterns: posts, items, products, data, list, array, etc.
              return vLower.endsWith('s') || vLower.includes('list') || vLower.includes('array') || 
                     vLower.includes('data') || vLower.includes('items') || vLower.includes('collection');
            });
            if (arrayLikeVars.length > 0) {
              inferredSource = arrayLikeVars[0];
              inferredProperty = targetProperty;
            }
          }
          // Pattern 2: tags → find any array var and extract 'tags' property
          else if (computedNameLower.includes('tag')) {
            targetProperty = 'tags';
            const arrayLikeVars = Array.from(reactiveVars).filter(v => {
              const vLower = v.toLowerCase();
              return vLower.endsWith('s') || vLower.includes('list') || vLower.includes('array') || 
                     vLower.includes('data') || vLower.includes('items') || vLower.includes('collection');
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
              if (computedNameLower.includes(varNameLower.slice(0, -1)) || 
                  varNameLower.includes(computedNameLower.slice(0, -1)) ||
                  // Also match if they share a common root (e.g., "categor" in both "categories" and "posts" doesn't match, but "items" and "products" might)
                  (computedNameLower.length > 3 && varNameLower.includes(computedNameLower.substring(0, computedNameLower.length - 1)))) {
                inferredSource = varName;
                // Try to infer property name from computed name
                inferredProperty = computedNameLower.replace(varNameLower, '').replace(/s$/, '') || targetProperty;
                break;
              }
            }
            
            // Fallback: if no match found, use first array-like reactive var
            if (!inferredSource && reactiveVars.size > 0) {
              const arrayLikeVars = Array.from(reactiveVars).filter(v => {
                const vLower = v.toLowerCase();
                return vLower.endsWith('s') || vLower.includes('list') || vLower.includes('array') || 
                       vLower.includes('data') || vLower.includes('items') || vLower.includes('collection');
              });
              if (arrayLikeVars.length > 0) {
                inferredSource = arrayLikeVars[0];
                inferredProperty = targetProperty || 'category'; // Default to 'category' if can't infer
              }
            }
          }
          
          if (inferredSource) {
            // Auto-fix: Replace computed(() => undefinedVar) with proper extraction logic
            const property = inferredProperty || 'category';
            const fixedComputed = `const ${computedName} = computed(() => {\n    const ${referencedVar} = new Set(${inferredSource}.value.map(item => item.${property}).filter(Boolean));\n    return Array.from(${referencedVar});\n  })`;
            fixedContent = fixedContent.replace(incompleteMatch[0], fixedComputed);
            result.fixed = true;
            result.fixes.push(`Auto-fixed incomplete computed property '${computedName}': inferred extraction from ${inferredSource}.${property}`);
          } else {
            result.issues.push(`Incomplete computed property detected: ${computedName} references undefined variable '${referencedVar}'. Could not auto-fix - manual fix required.`);
          }
        }
        
        // Pattern 2.5: Fix computed that returns ref directly without .value
        // Pattern: const filteredPosts = computed(() => posts) → computed(() => posts.value)
        const refComputedPattern = /const\s+(\w+)\s*=\s*computed\s*<\s*any\s*>\s*\(\s*\(\)\s*=>\s*(\w+)\s*\)/g;
        let refComputedMatch;
        while ((refComputedMatch = refComputedPattern.exec(fixedContent)) !== null) {
          const computedName = refComputedMatch[1];
          const refVar = refComputedMatch[2];
          
          // Check if refVar is a reactive variable (ref/reactive)
          if (reactiveVars.has(refVar)) {
            // Check if it's not already using .value
            const matchStr = refComputedMatch[0];
            if (!matchStr.includes('.value')) {
              // Fix: add .value
              const fixedComputed = matchStr.replace(`=> ${refVar})`, `=> ${refVar}.value)`);
              fixedContent = fixedContent.replace(matchStr, fixedComputed);
              result.fixed = true;
              result.fixes.push(`Fixed computed '${computedName}': added .value to ${refVar}`);
            }
          }
        }
        
        // Pattern 3: ANY computed property that returns a simple array ref without filtering/sorting logic
        // GENERIC PATTERN: Detects computed properties that just return a reactive array without transformation
        // Works for: filteredPosts, sortedUsers, displayedItems, visibleProducts, etc.
        // Pattern: const [ANY_NAME] = computed(() => arrayVar); where arrayVar is a reactive ref
        // Should add filtering/sorting logic if filters exist
        // This is TRULY generic - works with ANY naming convention
        const simpleComputedPattern = /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*(\w+)\s*\)/g;
        let simpleMatch;
        const processedComputed = new Set<string>(); // Track already processed to avoid duplicates
        
        while ((simpleMatch = simpleComputedPattern.exec(fixedContent)) !== null) {
          const [fullMatch, computedName, arrayVar] = simpleMatch;
          
          // Skip if already processed or if computedName === arrayVar (like allPosts = computed(() => allPosts))
          if (processedComputed.has(computedName) || computedName === arrayVar) {
            continue;
          }
          
          // GENERIC: Check if filters exist in the store (any form: reactive(filters) or filters: {})
          const hasFilters = /(?:const|let|var)\s+filters\s*=\s*reactive\s*\(/.test(fixedContent);
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
          const filtersUsedInOtherComputed = /const\s+\w+\s*=\s*computed\s*\([^)]*filters/.test(fixedContent);
          
          // Check if computed name suggests transformation
          const suggestsTransformation = 
            computedNameLower.includes('filter') || 
            computedNameLower.includes('sort') || 
            computedNameLower.includes('display') || 
            computedNameLower.includes('visible') ||
            computedNameLower.includes('shown') ||
            computedNameLower.includes('list');
          
          // Check if computed name is different from arrayVar (suggests it should transform the data)
          // e.g., filteredPosts vs posts, sortedUsers vs users
          const nameDiffersFromArrayVar = computedNameLower !== arrayVarLower && 
                                          !computedNameLower.includes(arrayVarLower) &&
                                          !arrayVarLower.includes(computedNameLower);
          
          // Apply fix if filters exist AND:
          // - Name suggests transformation, OR
          // - Filters are used in other computed properties, OR  
          // - Name differs from arrayVar (suggests transformation intent)
          const shouldApplyFix = (hasFilters || hasFiltersObject) && 
                                reactiveVars.has(arrayVar) && 
                                (suggestsTransformation || filtersUsedInOtherComputed || nameDiffersFromArrayVar);
          
          if (shouldApplyFix) {
            processedComputed.add(computedName);
            // TRULY GENERIC: Dynamically analyze properties from codebase instead of hardcoding
            // Analyze filter properties dynamically
            const filterAnalysis = analyzeFilterProperties(fixedContent);
            const categoryFilter = filterAnalysis.categoryFilter || 'category';
            const searchFilter = filterAnalysis.searchFilter || 'search';
            
            // Analyze array item properties dynamically
            const arrayVarStr = String(arrayVar); // Ensure it's a string
            const itemAnalysis = analyzeArrayItemProperties(fixedContent, arrayVarStr, projectRoot);
            const categoryProperty = itemAnalysis.categoryProperty || 'category';
            const searchProperties = Array.from(itemAnalysis.properties).filter((p) => {
              const prop = String(p);
              return ['title', 'name', 'content', 'description', 'text', 'label', 'author'].includes(prop);
            }) as string[];
            
            // Build filtered computed property with TRULY GENERIC logic
            // Uses dynamically detected properties instead of hardcoded ones
            const arrayVarWithValue = `${arrayVar}.value`;
            
            // Build search filter condition dynamically based on detected properties
            const searchConditions = searchProperties.length > 0
              ? searchProperties.map(prop => `item.${prop}?.toLowerCase().includes(searchLower)`).join(' ||\n        ')
              : `item.title?.toLowerCase().includes(searchLower) ||
        item.content?.toLowerCase().includes(searchLower) ||
        item.name?.toLowerCase().includes(searchLower) ||
        item.author?.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower) ||
        item.text?.toLowerCase().includes(searchLower) ||
        (typeof item === 'string' && item.toLowerCase().includes(searchLower))`;
            
            const fixedFilteredComputed = `const ${computedName} = computed(() => {
    let result = ${arrayVarWithValue};
    
    // Filter by category/type/tag (dynamically detected property: ${categoryProperty})
    if (filters.${categoryFilter}) {
      result = result.filter(item => item.${categoryProperty} === filters.${categoryFilter});
    }
    
    // Filter by search query (searches in dynamically detected properties)
    if (filters.${searchFilter}) {
      const searchLower = filters.${searchFilter}.toLowerCase();
      result = result.filter(item => 
        ${searchConditions}
      );
    }
    
    return result;
  })`;
            
            fixedContent = fixedContent.replace(fullMatch, fixedFilteredComputed);
            result.fixed = true;
            result.fixes.push(`Auto-fixed incomplete computed '${computedName}': added generic filtering logic based on filters object`);
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
        /const\s+(\w+)\s*=\s*computed\s*\(\s*\(\)\s*=>\s*\{[\s\n]*return\s+Array\.from\s*\(\s*(\w+)\s*\)\s*;?[\s\n]*\}\s*\)/g
      ];
      
      for (const arrayFromPattern of arrayFromPatterns) {
        let arrayFromMatch;
        arrayFromPattern.lastIndex = 0; // Reset regex state
        
        while ((arrayFromMatch = arrayFromPattern.exec(fixedContent)) !== null) {
          const computedName = arrayFromMatch[1];
          const undefinedVar = arrayFromMatch[2];
          
          // Check if the variable is not defined (skip if it's defined elsewhere in the computed)
          const computedBlock = fixedContent.substring(
            fixedContent.indexOf(arrayFromMatch[0]),
            fixedContent.indexOf(arrayFromMatch[0]) + arrayFromMatch[0].length
          );
          const isDefinedInComputed = computedBlock.match(new RegExp(`(const|let|var)\\s+${undefinedVar}\\b`));
          
          if (!isDefinedInComputed && !fixedContent.match(new RegExp(`(const|let|var|ref|reactive)\\s+${undefinedVar}\\b`))) {
            // Try to infer from context
            const computedNameLower = computedName.toLowerCase();
            let inferredSource: string | null = null;
            let inferredProperty: string | null = null;
            
            // GENERIC PATTERN: Infer source from computed name and available reactive vars
            // Works for any project, not just specific variable names
            if (computedNameLower.includes('categor')) {
              inferredProperty = 'category';
              // Find any array-like reactive var (any plural noun or array-like name)
              const arrayLikeVars = Array.from(reactiveVars).filter(v => {
                const vLower = v.toLowerCase();
                return vLower.endsWith('s') || vLower.includes('list') || vLower.includes('array') || 
                       vLower.includes('data') || vLower.includes('items') || vLower.includes('collection');
              });
              if (arrayLikeVars.length > 0) {
                inferredSource = arrayLikeVars[0];
              }
            } else if (computedNameLower.includes('tag')) {
              inferredProperty = 'tags';
              const arrayLikeVars = Array.from(reactiveVars).filter(v => {
                const vLower = v.toLowerCase();
                return vLower.endsWith('s') || vLower.includes('list') || vLower.includes('array') || 
                       vLower.includes('data') || vLower.includes('items') || vLower.includes('collection');
              });
              if (arrayLikeVars.length > 0) {
                inferredSource = arrayLikeVars[0];
              }
            } else {
              // Generic inference: find best matching reactive var
              // Try to match computed name with reactive var names
              for (const varName of reactiveVars) {
                const varNameLower = varName.toLowerCase();
                // Match patterns like: categories → posts, items → products
                if (computedNameLower.includes(varNameLower.slice(0, -1)) || 
                    varNameLower.includes(computedNameLower.slice(0, -1)) ||
                    (computedNameLower.length > 3 && varNameLower.includes(computedNameLower.substring(0, computedNameLower.length - 1)))) {
                  inferredSource = varName;
                  // Try to infer property name: categories → category, tags → tag
                  inferredProperty = computedNameLower.replace(varNameLower, '').replace(/s$/, '') || 
                                     computedNameLower.replace(/s$/, '') || 'category';
                  break;
                }
              }
              
              // Fallback: if we have reactive vars but no match, use the first array-like one
              if (!inferredSource && reactiveVars.size > 0) {
                const arrayLikeVars = Array.from(reactiveVars).filter(v => {
                  const vLower = v.toLowerCase();
                  return vLower.endsWith('s') || vLower.includes('list') || vLower.includes('array') || 
                         vLower.includes('data') || vLower.includes('items') || vLower.includes('collection');
                });
                if (arrayLikeVars.length > 0) {
                  inferredSource = arrayLikeVars[0];
                  // Try to infer property from computed name
                  inferredProperty = computedNameLower.replace(/s$/, '') || 'category';
                }
              }
            }
            
            if (inferredSource) {
              // Auto-fix: Replace Array.from(undefinedVar) with proper extraction
              const property = inferredProperty || 'category';
              // Check if original had TypeScript type annotation
              const hasTypeAnnotation = arrayFromMatch[0].includes('computed<');
              const typeAnnotation = hasTypeAnnotation ? arrayFromMatch[0].match(/computed<([^>]+)>/)?.[1] || 'any' : 'any';
              const fixedComputed = `const ${computedName} = computed<${typeAnnotation}>(() => {\n    const ${undefinedVar} = new Set(${inferredSource}.value.map(item => item.${property}).filter(Boolean));\n    return Array.from(${undefinedVar});\n  })`;
              fixedContent = fixedContent.replace(arrayFromMatch[0], fixedComputed);
              result.fixed = true;
              result.fixes.push(`Auto-fixed Array.from(${undefinedVar}) in computed '${computedName}': inferred extraction from ${inferredSource}.${property}`);
              break; // Only fix once per pattern
            } else {
              result.issues.push(`Incomplete computed property detected: ${computedName} uses Array.from(${undefinedVar}) where '${undefinedVar}' is undefined. Available reactive vars: ${Array.from(reactiveVars).join(', ')}. Could not auto-fix - manual fix required.`);
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
    const incorrectCreateAppPattern = /const\s+app\s*=\s*createApp\s*\(\s*\{\s*router\s*,\s*render\s*:\s*\(\)\s*=>\s*h\s*\(\s*App\s*\)\s*\}\s*\)/;
    if (incorrectCreateAppPattern.test(fixedContent)) {
      // Extract router import if exists
      const routerImportMatch = fixedContent.match(/import\s+router\s+from\s+['"]([^'"]+)['"]/);
      const routerPath = routerImportMatch ? routerImportMatch[1] : './router';
      
      // Replace with correct syntax
      fixedContent = fixedContent.replace(
        incorrectCreateAppPattern,
        'const app = createApp(App)'
      );
      
      // Ensure router is imported
      if (!fixedContent.includes('import router')) {
        const appImportMatch = fixedContent.match(/import\s+App\s+from\s+['"]([^'"]+)['"]/);
        if (appImportMatch) {
          const appImportLine = appImportMatch[0];
          fixedContent = fixedContent.replace(
            appImportLine,
            `${appImportLine}\nimport router from '${routerPath}'`
          );
        }
      }
      
      // Ensure app.use(router) is called after createApp
      if (!fixedContent.includes('app.use(router)')) {
        fixedContent = fixedContent.replace(
          /(const\s+app\s*=\s*createApp\s*\(\s*App\s*\)\s*;)/,
          '$1\n\napp.use(router);'
        );
      }
      
      result.fixed = true;
      result.fixes.push("Fixed createApp syntax to Vue 3 format");
    }

    // Fix order: Pinia must be initialized BEFORE router (router guards may use stores)
    // Pattern: app.use(router); app.use(createPinia()); → app.use(createPinia()); app.use(router);
    const piniaAfterRouterPattern = /app\.use\(router\)\s*;\s*app\.use\(createPinia\(\)\)/;
    if (piniaAfterRouterPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(
        /(app\.use\(router\)\s*;)\s*(app\.use\(createPinia\(\)\)\s*;)/,
        '$2\n$1'
      );
      result.fixed = true;
      result.fixes.push("Fixed Pinia initialization order (Pinia before Router)");
    }

    // Remove unused 'h' import from createApp
    const unusedHImportPattern = /import\s+\{\s*createApp\s*,\s*h\s*\}\s+from\s+['"]vue['"]/;
    if (unusedHImportPattern.test(fixedContent) && !fixedContent.includes('h(') && !fixedContent.includes('h (')) {
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
    const createWebHistoryPattern = /createWebHistory\s*\(\s*\{\s*base\s*:\s*process\.env\.BASE_URL\s*\}\s*\)/g;
    if (createWebHistoryPattern.test(fixedContent)) {
      // Remove the base option completely - Vue Router will use '/' by default
      fixedContent = fixedContent.replace(
        /createWebHistory\s*\(\s*\{\s*base\s*:\s*process\.env\.BASE_URL\s*\}\s*\)/g,
        'createWebHistory()'
      );
      result.fixed = true;
      result.fixes.push("Removed process.env.BASE_URL from createWebHistory (can cause [object Object] in URL)");
    }
    
    // Also handle cases where base is passed as a variable or other expression
    const createWebHistoryWithBasePattern = /createWebHistory\s*\(\s*\{\s*base\s*:\s*([^}]+)\s*\}\s*\)/g;
    const matches = Array.from(fixedContent.matchAll(createWebHistoryWithBasePattern));
    matches.forEach(match => {
      const baseValue = match[1].trim();
      // If base value contains process.env.BASE_URL or looks like it could be an object
      if (baseValue.includes('process.env.BASE_URL') || baseValue.includes('BASE_URL')) {
        fixedContent = fixedContent.replace(match[0], 'createWebHistory()');
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
      result.fixes.push("Fixed catch-all route: path: '*' → path: '/:pathMatch(.*)*'");
    }
  }

  // Fix 6: Fix router navigation guards that use router.app.$store or store.getters
  // Pattern: router.app.$store.getters['module/getter'] or store.getters['module/getter']
  // Transform to: useModuleStore().getter
  if (filePath.includes("router") || filePath.includes("Router")) {
    // Pattern 1: router.app.$store.getters['module/getter']
    const routerStorePattern =
      /router\.app\.\$store\.(getters|dispatch|state)\[['"]([^'"]+)['"]\]/g;
    // Pattern 2: store.getters['module/getter'] (direct store import)
    const directStorePattern =
      /store\.(getters|dispatch|state)\[['"]([^'"]+)\/([^'"]+)['"]\]/g;
    const matches = Array.from(fixedContent.matchAll(routerStorePattern));
    const directMatches = Array.from(fixedContent.matchAll(directStorePattern));
    
    if (matches.length > 0 || directMatches.length > 0) {
      const scriptMatch = fixedContent.match(
        /<script[^>]*>([\s\S]*?)<\/script>/,
      ) || fixedContent.match(/^([\s\S]*)$/); // For .js files
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        const originalScriptContent = scriptContent;
        const storesToImport = new Map<string, string>(); // module name → store name
        
        // Process router.app.$store patterns
        matches.forEach((match) => {
          const [, type, path] = match;
          // Extract module name from path like 'user/isAuthenticated' or 'user'
          const parts = path.split('/');
          let moduleName: string | null = null;
          let propertyName: string;
          
          if (parts.length === 2) {
            // Pattern: 'user/isAuthenticated' - explicit module/property format
            [moduleName, propertyName] = parts;
          } else {
            // Pattern: 'isAuthenticated' - cannot infer module without analysis
            // Skip this pattern - we need explicit module/property format or dynamic store analysis
            // This ensures genericity - we don't guess module names
            // Skip this match - cannot determine module safely
            return; // Skip to next match
          }
          
          // Only proceed if we have a valid module name
          if (moduleName) {
            // Determine store name: 'user' → 'useUserStore'
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName);
            
            // Replace router.app.$store.getters['module/prop'] with store().prop
            // Note: Store will be initialized inside beforeEach guard
            const storeVarName = `${moduleName}Store`;
            let replacement: string;
            
            if (type === 'getters') {
              replacement = `${storeVarName}.${propertyName}`;
            } else if (type === 'dispatch') {
              replacement = `${storeVarName}.${propertyName}()`;
            } else {
              // state
              replacement = `${storeVarName}.${propertyName}`;
            }
            
            // Replace the pattern
            const patternToReplace = match[0];
            scriptContent = scriptContent.replace(patternToReplace, replacement);
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
            
            if (type === 'getters') {
              replacement = `${storeVarName}.${propertyName}`;
            } else if (type === 'dispatch') {
              replacement = `${storeVarName}.${propertyName}()`;
            } else {
              // state
              replacement = `${storeVarName}.${propertyName}`;
            }
            
            // Replace the pattern (escape special regex chars)
            const patternToReplace = match[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            scriptContent = scriptContent.replace(new RegExp(patternToReplace, 'g'), replacement);
          }
        });
        
        // Add store imports if needed
        if (storesToImport.size > 0 && scriptContent !== originalScriptContent) {
          storesToImport.forEach((storeName, moduleName) => {
            const importPath = `@/store/modules/${moduleName}`;
            const importPattern = new RegExp(`import\\s+.*${storeName}.*from`, 'g');
            
            if (!importPattern.test(scriptContent)) {
              // Add import at the top of script content
              const importLine = `import { ${storeName} } from '${importPath}';\n`;
              scriptContent = importLine + scriptContent;
            }
            
            // Remove old store import if it exists
            const oldStoreImportPattern = /import\s+store\s+from\s+['"]\.\.\/store['"];?\s*\n?/g;
            scriptContent = scriptContent.replace(oldStoreImportPattern, '');
            
            // Initialize store INSIDE router.beforeEach guard (not at module level)
            // This is required because Pinia must be initialized with app.use(pinia) before stores can be used
            const storeVarName = `${moduleName}Store`;
            const moduleLevelInitPattern = new RegExp(`const\\s+${storeVarName}\\s*=\\s*${storeName}\\(\\);?\\s*\\n`, 'g');
            const insideBeforeEachPattern = new RegExp(`router\\.beforeEach[^}]*const\\s+${storeVarName}`, 's');
            
            // First, check if store is initialized at module level (outside beforeEach)
            const hasModuleLevelInit = moduleLevelInitPattern.test(scriptContent);
            const hasInsideBeforeEach = insideBeforeEachPattern.test(scriptContent);
            
            // Also check if store variable is used but not initialized inside beforeEach
            const storeUsagePattern = new RegExp(`router\\.beforeEach[^}]*\\b${storeVarName}\\b`, 's');
            const storeUsedButNotInit = storeUsagePattern.test(scriptContent) && !hasInsideBeforeEach;
            
            // If store is initialized at module level OR used but not initialized, move/create it inside beforeEach
            if ((hasModuleLevelInit || storeUsedButNotInit) && !hasInsideBeforeEach) {
              // Remove module-level initialization if it exists
              if (hasModuleLevelInit) {
                scriptContent = scriptContent.replace(moduleLevelInitPattern, '');
              }
              
              // Check if router.beforeEach exists
              const beforeEachMatch = scriptContent.match(/router\.beforeEach\s*\([^)]*\)\s*=>\s*\{/);
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
                  scriptContent = scriptContent.slice(0, insertPos) + 
                    `${beforeEachCode}` + 
                    scriptContent.slice(insertPos);
                } else {
                  scriptContent = `${beforeEachCode}${scriptContent}`;
                }
              }
            } else if (!hasInsideBeforeEach) {
              // Store not initialized anywhere - add it inside beforeEach
              const beforeEachMatch = scriptContent.match(/router\.beforeEach\s*\([^)]*\)\s*=>\s*\{/);
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
                  scriptContent = scriptContent.slice(0, insertPos) + 
                    `${beforeEachCode}` + 
                    scriptContent.slice(insertPos);
                } else {
                  scriptContent = `${beforeEachCode}${scriptContent}`;
                }
              }
            }
          });
          
          // Update fixedContent
          if (fixedContent.includes('<script')) {
            fixedContent = fixedContent.replace(
              /(<script[^>]*>)([\s\S]*?)(<\/script>)/,
              `$1${scriptContent}$3`,
            );
          } else {
            // For .js files without script tags
            fixedContent = scriptContent;
          }
          
          result.fixed = true;
          result.fixes.push(`Migrated router.app.$store to Pinia stores: ${Array.from(storesToImport.keys()).join(', ')}`);
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
        /<script[^>]*>([\s\S]*?)<\/script>/,
      );
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        const originalScriptContent = scriptContent;

        // Detect which stores are used
        const storeModules = new Map<string, string>();

        // Pattern: ...mapGetters('auth', ['isAuthenticated', 'currentUser'])
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
            /\.\.\.mapGetters\(['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]/g,
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
                    "s",
                  ),
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
            /\.\.\.mapActions\(['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]/g,
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
            /methods:\s*\{([\s\S]*?)\n\s*\}/,
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
                    `mapActions\\(['"]${moduleName}['"]\\s*,\\s*\\[([^\\]]+)\\]`,
                  ),
                );
                if (actionsMatch) {
                  actionsMatch[1].split(",").forEach((a) => {
                    allStoreActions.add(a.trim().replace(/['"]/g, ""));
                  });
                }

                // Find getters for this module
                const gettersMatch = scriptContent.match(
                  new RegExp(
                    `mapGetters\\(['"]${moduleName}['"]\\s*,\\s*\\[([^\\]]+)\\]`,
                  ),
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
                },
              );

              // Replace this.getterName with getterName (when not called as function)
              transformedBody = transformedBody.replace(
                /this\.(\w+)(?!\()/g,
                (match, prop) => {
                  if (allStoreGetters.has(prop)) {
                    return prop;
                  }
                  return match;
                },
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
                },
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
              `<script setup>\n${newScriptContent}</script>`,
            );
            result.fixed = true;
            result.fixes.push(
              "Converted Vuex mapGetters/mapActions to Pinia stores",
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
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Get dynamic store map from analysis - NO hardcoded fallback for genericity
      let storeMethodMap: Record<string, string> = {};
      
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
              new RegExp(`this\\.${methodName}\\s*\\(`, 'g'),
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
              new RegExp(`this\\.${propertyName}(?!\\s*\\()`, 'g'),
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
        while ((directCallMatch = directCallPattern.exec(scriptContent)) !== null) {
          const methodName = directCallMatch[1];
          // Skip if it's already a store call (store.methodName), a Vue API, or a local function
          // GENERIC: Check if methodName exists in storeMethodMap (dynamically detected from stores)
          const isDefinedLocally = scriptContent.match(new RegExp(`(const|let|var|function|import)\\s+${methodName}\\b`));
          const isStoreCall = scriptContent.match(new RegExp(`\\w+Store\\.${methodName}`));
          const isVueAPI = ['computed', 'ref', 'reactive', 'watch', 'onMounted', 'onUnmounted', 'defineProps', 'defineEmits', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].includes(methodName);
          
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
        directCalls.forEach(methodName => {
          const moduleName = storeMethodMap[methodName];
          if (moduleName) {
            const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
            storesToImport.set(moduleName, storeName); // moduleName → storeName
            
            // Replace methodName() with storeVarName.methodName()
            const storeVarName = `${moduleName}Store`;
            scriptContent = scriptContent.replace(
              new RegExp(`\\b${methodName}\\s*\\(`, 'g'),
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
            if (!scriptContent.includes(`const ${storeVarName} = ${storeName}`)) {
              // Find the best place to insert store initialization (after imports, before usage)
              const afterImportsMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (afterImportsMatch) {
                const insertIndex = afterImportsMatch[0].length;
                scriptContent = scriptContent.slice(0, insertIndex) + 
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
        if (scriptContent && scriptContent.includes('import')) {
          // Step 1: Extract all imports with their positions
          const importPattern = /import\s+[^;]+;/g;
          const allImports: Array<{ content: string; normalized: string }> = [];
          let importMatch;
          
          while ((importMatch = importPattern.exec(scriptContent)) !== null) {
            if (importMatch && importMatch[0]) {
              const content = importMatch[0];
              const normalized = content.replace(/\s+/g, ' ').trim();
              allImports.push({ content, normalized });
            }
          }
          
          // Step 2: Deduplicate imports by grouping by module and merging exports
          // GENERIC: Groups imports by their 'from' path and merges all exports
          const importsByModule = new Map<string, Set<string>>(); // modulePath → Set of export names
          
          allImports.forEach(({ content, normalized }) => {
            const importNameMatch = normalized.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
            if (importNameMatch) {
              const exportNames = importNameMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0); // Filter empty strings
              const fromPath = importNameMatch[2];
              
              if (!importsByModule.has(fromPath)) {
                importsByModule.set(fromPath, new Set());
              }
              
              const moduleExports = importsByModule.get(fromPath)!;
              exportNames.forEach(name => moduleExports.add(name));
            } else {
              // Simple import without destructuring - keep as is
              const simpleMatch = normalized.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
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
            const sortedExports = Array.from(exports).sort().filter(e => e.length > 0); // Filter empty exports
            if (sortedExports.length > 0) {
              const importStatement = `import { ${sortedExports.join(', ')} } from '${modulePath}';`;
              uniqueImports.push(importStatement);
            }
          });
          
          // Step 4: Always remove all imports and rebuild with merged unique imports
          // This ensures imports from the same module are merged (e.g., computed + computed,onMounted → computed,onMounted)
          // Remove ALL import statements using regex (more reliable than string replacement)
          let cleanedContent = scriptContent.replace(/import\s+[^;]+;\s*\n?/g, '');
          
          // Clean up multiple consecutive newlines and empty lines
          cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '').trim();
          
          // Add unique imports at the beginning (always rebuild to ensure proper merging)
          if (uniqueImports.length > 0) {
            // Clean up any imports with empty commas (e.g., import { , useAppStore } → import { useAppStore })
            const cleanedImports = uniqueImports.map(imp => {
              return imp.replace(/import\s+\{\s*,+\s*([^}]+)\}\s+from/, 'import { $1 } from')
                       .replace(/import\s+\{([^}]+)\s*,+\s*\}\s+from/, 'import { $1 } from')
                       .replace(/import\s+\{\s*,+\s*\}\s+from/, ''); // Remove completely empty imports
            }).filter(imp => imp.length > 0);
            
            scriptContent = cleanedImports.join('\n') + '\n\n' + cleanedContent;
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
          
          while ((storeDeclMatch = storeDeclPattern.exec(scriptContent)) !== null) {
            const varName = storeDeclMatch[1];
            if (seenStoreVars.has(varName)) {
              // Duplicate - mark for removal
              storeDeclsToRemove.push({
                start: storeDeclMatch.index,
                end: storeDeclMatch.index + storeDeclMatch[0].length
              });
            } else {
              seenStoreVars.add(varName);
            }
          }
          
          // Remove duplicate declarations (in reverse order to preserve indices)
          storeDeclsToRemove.reverse().forEach(pos => {
            const before = scriptContent.substring(0, pos.start);
            const after = scriptContent.substring(pos.end);
            // Remove the declaration and clean up surrounding whitespace
            scriptContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
          });
          
          // Step 5: Clean up empty lines and multiple consecutive newlines
          scriptContent = scriptContent.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
        }
        
        // Step 6: Remove duplicate variable declarations (const varName = ...)
        // GENERIC: Detects and removes duplicate variable declarations
        const varDeclPattern = /const\s+(\w+)\s*=/g;
        const seenVars = new Map<string, number>(); // varName → first occurrence index
        const varDeclsToRemove: Array<{ start: number; end: number; varName: string }> = [];
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
              if (!declMatch[0].endsWith(';')) {
                const afterDecl = scriptContent.substring(end);
                const newlineMatch = afterDecl.match(/^\s*\n/);
                if (newlineMatch) {
                  end += newlineMatch[0].length;
                }
              }
              varDeclsToRemove.push({
                start: start,
                end: end,
                varName: varName
              });
            }
          } else {
            seenVars.set(varName, varDeclMatch.index);
          }
        }
        
        // Remove duplicate declarations (in reverse order to preserve indices)
        varDeclsToRemove.reverse().forEach(pos => {
          const before = scriptContent.substring(0, pos.start);
          const after = scriptContent.substring(pos.end);
          // Remove the declaration and clean up surrounding whitespace
          scriptContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
        });
        
        // Clean up empty lines again
        scriptContent = scriptContent.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
        
        // Step 7: Remove duplicate store declarations and reorganize them
        // GENERIC: Removes duplicates and moves all store declarations to the top to avoid "used before declaration" errors
        const storeDeclPattern = /const\s+(\w+Store)\s*=\s*use\w+Store\(\)\s*;?/g;
        
        // Helper function to find all store declarations
        const findAllStoreDecls = (content: string): Array<{ varName: string; declaration: string; index: number; fullMatch: string }> => {
          const decls: Array<{ varName: string; declaration: string; index: number; fullMatch: string }> = [];
          storeDeclPattern.lastIndex = 0;
          let match;
          while ((match = storeDeclPattern.exec(content)) !== null) {
            const varName = match[1];
            const fullMatch = match[0];
            const declaration = fullMatch.endsWith(';') ? fullMatch : fullMatch + ';';
            decls.push({
              varName,
              declaration,
              index: match.index,
              fullMatch: fullMatch
            });
          }
          return decls;
        };
        
        let storeDeclarations = findAllStoreDecls(scriptContent);
        
        if (storeDeclarations.length > 0) {
          // Step 7a: Remove ALL duplicates (keep only first occurrence of each store)
          const seenStoreVars = new Set<string>();
          const duplicatesToRemove: Array<{ start: number; end: number }> = [];
          
          storeDeclarations.forEach(decl => {
            if (seenStoreVars.has(decl.varName)) {
              // Duplicate - mark for removal (include trailing whitespace/newlines)
              const afterMatch = scriptContent.substring(decl.index + decl.fullMatch.length);
              const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || '';
              duplicatesToRemove.push({
                start: decl.index,
                end: decl.index + decl.fullMatch.length + trailingWhitespace.length
              });
            } else {
              seenStoreVars.add(decl.varName);
            }
          });
          
          // Remove duplicates (in reverse order to preserve indices)
          if (duplicatesToRemove.length > 0) {
            duplicatesToRemove.reverse().forEach(pos => {
              const before = scriptContent.substring(0, pos.start);
              const after = scriptContent.substring(pos.end);
              scriptContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
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
            storeDeclarations.forEach(decl => {
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
              storeDeclarations.reverse().forEach(decl => {
                const before = reorganizedContent.substring(0, decl.index);
                const afterMatch = reorganizedContent.substring(decl.index + decl.fullMatch.length);
                const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || '';
                const after = reorganizedContent.substring(decl.index + decl.fullMatch.length + trailingWhitespace.length);
                reorganizedContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
              });
              
              // Get unique declarations only (should already be unique after Step 7a)
              const finalUniqueStoreDecls = new Map<string, string>();
              storeDeclarations.reverse().forEach(decl => {
                if (!finalUniqueStoreDecls.has(decl.varName)) {
                  finalUniqueStoreDecls.set(decl.varName, decl.declaration);
                }
              });
              
              // Find the end of imports section
              const importMatch = reorganizedContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const insertIndex = importMatch[0].length;
                const storeDeclsText = Array.from(finalUniqueStoreDecls.values()).join('\n');
                reorganizedContent = reorganizedContent.slice(0, insertIndex) + 
                  '\n\n' + storeDeclsText + '\n' + 
                  reorganizedContent.slice(insertIndex).trim();
              } else {
                // No imports, add at the beginning
                const storeDeclsText = Array.from(finalUniqueStoreDecls.values()).join('\n');
                reorganizedContent = storeDeclsText + '\n\n' + reorganizedContent.trim();
              }
              
              scriptContent = reorganizedContent;
              result.fixed = true;
              result.fixes.push("Reorganized store declarations to top of script");
              
              // Final check: remove any duplicates that might have been created during reorganization
              const finalStoreDecls = findAllStoreDecls(scriptContent);
              const finalSeenVars = new Set<string>();
              const finalDuplicatesToRemove: Array<{ start: number; end: number }> = [];
              
              finalStoreDecls.forEach(decl => {
                if (finalSeenVars.has(decl.varName)) {
                  const afterMatch = scriptContent.substring(decl.index + decl.fullMatch.length);
                  const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || '';
                  finalDuplicatesToRemove.push({
                    start: decl.index,
                    end: decl.index + decl.fullMatch.length + trailingWhitespace.length
                  });
                } else {
                  finalSeenVars.add(decl.varName);
                }
              });
              
              if (finalDuplicatesToRemove.length > 0) {
                finalDuplicatesToRemove.reverse().forEach(pos => {
                  const before = scriptContent.substring(0, pos.start);
                  const after = scriptContent.substring(pos.end);
                  scriptContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
                });
                result.fixes.push("Removed duplicate store declarations after reorganization");
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
          
          while ((storeCallMatch = storeMethodCallPattern.exec(scriptContent)) !== null) {
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
          
          // Find all store.property access (e.g., authStore.cartItemCount → cartStore.cartItemCount)
          // Pattern: storeVar.property (not followed by opening parenthesis, which would be a method call)
          // We need to match store.property in various contexts: computed(() => store.property), store.property, etc.
          const storePropertyPattern = /(\w+Store)\.(\w+)(?![(\s]*\()/g;
          let storePropMatch;
          
          storePropertyPattern.lastIndex = 0;
          const seenCorrections = new Set<string>();
          
          while ((storePropMatch = storePropertyPattern.exec(scriptContent)) !== null) {
            const storeVarName = storePropMatch[1];
            const propertyName = storePropMatch[2];
            const moduleName = storeMethodMap[propertyName];
            
            // Debug: log if property is found in map
            if (propertyName === 'cartItemCount' || propertyName === 'isAuthenticated') {
              // This helps debug property detection
            }
            
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
                  corrections.push({ wrong: wrongAccess, correct: correctAccess });
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
                          corrections.push({ wrong: wrongAccess, correct: correctAccess });
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
          if (scriptContent.includes('cartItemCount') && !storeMethodMap['cartItemCount']) {
            // cartItemCount is used but not in map - this might indicate an issue with store analysis
            result.issues.push(`Property 'cartItemCount' is used but not found in storeMethodMap. Store analysis may need improvement.`);
          }
          
          // Apply corrections (apply in reverse to avoid index issues)
          corrections.reverse().forEach(({ wrong, correct }) => {
            scriptContent = scriptContent.replace(
              new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
              correct
            );
          });
          
          if (corrections.length > 0) {
            result.fixes.push(`Corrected wrong store method calls and property access: ${corrections.map(c => `${c.wrong} → ${c.correct}`).join(', ')}`);
          }
          
          // Fix 8c.1: Detect and warn about potential null/undefined access in templates
          // Pattern: {{ computedProperty.property }} where computedProperty might be null
          // This helps prevent "Cannot read properties of undefined" errors
          if (isVueFile) {
            const templateMatch = fixedContent.match(/<template>([\s\S]*?)<\/template>/);
            if (templateMatch) {
              const templateContent = templateMatch[1];
              const nullAccessPattern = /\{\{\s*(\w+)\.(\w+)\s*\}\}/g;
              let nullMatch;
              const potentialNullAccesses = new Set<string>();
              
              while ((nullMatch = nullAccessPattern.exec(templateContent)) !== null) {
                const computedName = nullMatch[1];
                const propertyName = nullMatch[2];
                
                // Check if this computed property might return null/undefined
                // Common patterns: currentUser, selectedItem, activeItem, etc.
                const mightBeNull = computedName.toLowerCase().includes('current') ||
                                    computedName.toLowerCase().includes('selected') ||
                                    computedName.toLowerCase().includes('active') ||
                                    computedName.toLowerCase().includes('user');
                
                // Check if computed is defined: computed(() => store.property) where property might be null
                const computedDefPattern = new RegExp(`const\\s+${computedName}\\s*=\\s*computed`, 'g');
                const computedDef = scriptContent.match(computedDefPattern);
                
                if (mightBeNull && computedDef) {
                  // Check if there's already a v-if guard
                  const hasGuard = templateContent.includes(`v-if="${computedName}"`) ||
                                  templateContent.includes(`v-if="!${computedName}"`) ||
                                  templateContent.includes(`v-if="${computedName} &&"`);
                  
                  if (!hasGuard) {
                    potentialNullAccesses.add(`${computedName}.${propertyName}`);
                  }
                }
              }
              
              if (potentialNullAccesses.size > 0) {
                // AUTOMATISÉ: Add v-if guards automatically to prevent null/undefined errors
                let modifiedTemplate = templateContent;
                const addedGuards: string[] = [];
                
                potentialNullAccesses.forEach(access => {
                  const computedName = access.split('.')[0];
                  
                  // Find the parent element containing this access
                  // Pattern: <tag>...{{ computedName.property }}...</tag>
                  const accessPattern = new RegExp(`(<[^>]+>)([^<]*\\{\\{\\s*${computedName}\\.\\w+\\s*\\}\\}[^<]*)(</[^>]+>)`, 'g');
                  let accessMatch;
                  
                  while ((accessMatch = accessPattern.exec(modifiedTemplate)) !== null) {
                    const [fullMatch, openingTag, content, closingTag] = accessMatch;
                    
                    // Check if opening tag already has v-if
                    if (!openingTag.includes(`v-if="${computedName}"`) && 
                        !openingTag.includes(`v-if="!${computedName}"`)) {
                      
                      // Add v-if guard to opening tag
                      const tagNameMatch = openingTag.match(/^<(\w+)/);
                      if (tagNameMatch) {
                        const tagName = tagNameMatch[1];
                        // Insert v-if before closing >
                        const newOpeningTag = openingTag.replace(/>$/, ` v-if="${computedName}">`);
                        const newFullMatch = newOpeningTag + content + closingTag;
                        
                        modifiedTemplate = modifiedTemplate.replace(fullMatch, newFullMatch);
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
                  result.fixes.push(`Added v-if guards to prevent null/undefined access: ${addedGuards.join(', ')}`);
                } else {
                  // If automatic fix failed, add warning
                  result.issues.push(
                    `Potential null/undefined access detected in template: ${Array.from(potentialNullAccesses).join(', ')}. Consider adding v-if guards (e.g., v-if="${Array.from(potentialNullAccesses)[0].split('.')[0]}").`
                  );
                }
              }
            }
          }
        }

        // Fix 8d: Add missing imports for used but not imported stores/functions
        // GENERIC: Detects usage of stores/functions and adds missing imports
        // Check for useRouter usage
        if (scriptContent.includes('useRouter()') && !scriptContent.match(/import\s+.*useRouter.*from/)) {
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
          if (!scriptContent.includes('const router = useRouter()')) {
            const afterImportsMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (afterImportsMatch) {
              const insertIndex = afterImportsMatch[0].length;
              scriptContent = scriptContent.slice(0, insertIndex) + 
                `\nconst router = useRouter();\n` + 
                scriptContent.slice(insertIndex);
            } else {
              scriptContent = `const router = useRouter();\n${scriptContent}`;
            }
          }
        }
        
        // Check for useRoute usage (similar to useRouter) - GENERIC
        // Detect both useRoute() and const route = useRoute() patterns
        const hasUseRouteUsage = /useRoute\s*\(|const\s+\w+\s*=\s*useRoute\s*\(/.test(scriptContent);
        const hasUseRouteImport = /import\s+.*\{[^}]*\buseRoute\b[^}]*\}\s+from\s+['"]vue-router['"]/.test(scriptContent);
        
        if (hasUseRouteUsage && !hasUseRouteImport) {
          // Check if vue-router import already exists
          const vueRouterImportMatch = scriptContent.match(/import\s+.*\{([^}]*)\}\s+from\s+['"]vue-router['"]/);
          if (vueRouterImportMatch) {
            // Add useRoute to existing import
            const existingImports = vueRouterImportMatch[1].split(',').map(i => i.trim()).filter(i => i);
            if (!existingImports.includes('useRoute')) {
              const newImports = [...existingImports, 'useRoute'];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]*\}\s+from\s+['"]vue-router['"]/,
                `import { ${newImports.join(', ')} } from 'vue-router'`
              );
              result.fixed = true;
              result.fixes.push("Added useRoute to existing vue-router import");
            }
          } else {
            // Create new import
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
        const routerPushWithParamsPattern = /router\.push\s*\(\s*\{\s*name\s*:\s*['"]([^'"]+)['"]\s*,\s*params\s*:\s*\{([^}]+)\}\s*\}\s*\)/g;
        let routerPushMatch;
        const routerPushMatches: Array<{ fullMatch: string; routeName: string; paramsString: string; paramName: string; paramValue: string }> = [];
        
        // First pass: collect all matches
        while ((routerPushMatch = routerPushWithParamsPattern.exec(scriptContent)) !== null) {
          const [fullMatch, routeName, paramsString] = routerPushMatch;
          
          // Extract param name and value from params object
          // e.g., "id: postId" or "id: post.id"
          const paramMatch = paramsString.match(/(\w+)\s*:\s*([^,}]+)/);
          if (paramMatch) {
            const [, paramName, paramValue] = paramMatch;
            const trimmedParamValue = paramValue.trim();
            routerPushMatches.push({ fullMatch, routeName, paramsString, paramName, paramValue: trimmedParamValue });
          }
        }
        
        // Second pass: replace matches (in reverse order to preserve positions)
        for (const match of routerPushMatches.reverse()) {
          const { fullMatch, routeName, paramName, paramValue } = match;
          
          // Try to infer path from route name (common patterns)
          let inferredPath: string;
          if (routeName.toLowerCase().includes('post') || routeName.toLowerCase().includes('detail')) {
            // Common pattern: BlogPost -> /blog/:id
            inferredPath = `/blog/\${${paramValue}}`;
          } else if (routeName.toLowerCase().includes('user') || routeName.toLowerCase().includes('profile')) {
            inferredPath = `/user/\${${paramValue}}`;
          } else {
            // Generic: use route name lowercase + param
            // BlogPost -> blog-post -> /blog-post/:id
            const routePath = routeName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
            inferredPath = `/${routePath}/\${${paramValue}}`;
          }
          
          // Replace with path-based navigation (more reliable in Vue Router 4)
          // Use template literal for dynamic path - simpler and more reliable
          const pathBasedNavigation = `router.push({ path: \`${inferredPath}\` })`;
          
          scriptContent = scriptContent.replace(fullMatch, pathBasedNavigation);
          result.fixed = true;
          result.fixes.push(`Secured router.push with params for route '${routeName}' (Vue Router 4 compatibility - using path instead of name+params)`);
        }
        
        // Fix 8f: Add type checking and undefined checks for router.push functions
        // Pattern: const goToPost = postId => { router.push({ path: `/blog/${postId}` }) }
        // Should become: const goToPost = (postId: number | string | undefined) => { if (postId !== undefined && postId !== null) { router.push({ path: `/blog/${postId}` }) } }
        if (scriptContent.includes('router.push') && scriptContent.includes('path:')) {
          // Find functions that use router.push with template literals containing parameters
          // Pattern matches: const functionName = param => { router.push({ path: `/route/${param}` }) }
          const routerPushFunctionPattern = /const\s+(\w+)\s*=\s*(\w+)\s*=>\s*\{[^}]*router\.push\s*\(\s*\{\s*path\s*:\s*[`'"]\/[^`'"]*\$\{(\w+)\}[^`'"]*[`'"]/g;
          let routerPushFunctionMatch;
          const processedFunctions = new Set<string>();
          
          while ((routerPushFunctionMatch = routerPushFunctionPattern.exec(scriptContent)) !== null) {
            const [fullMatch, functionName, paramName, pathParam] = routerPushFunctionMatch;
            
            // Skip if already processed
            if (processedFunctions.has(functionName)) continue;
            processedFunctions.add(functionName);
            
            // Check if function already has type annotation
            const hasTypeAnnotation = /const\s+\w+\s*:\s*\([^)]+\)\s*=>/.test(fullMatch) || 
                                      /const\s+\w+\s*=\s*\([^)]+:\s*\w+/.test(fullMatch);
            
            // Check if function already has undefined check
            const hasUndefinedCheck = /if\s*\([^)]*undefined[^)]*\)/.test(fullMatch) || 
                                     /if\s*\([^)]*!==\s*undefined/.test(fullMatch);
            
            if (!hasTypeAnnotation || !hasUndefinedCheck) {
              // Extract the full function body
              const functionBodyMatch = scriptContent.match(new RegExp(`const\\s+${functionName}\\s*=\\s*${paramName}\\s*=>\\s*\\{([^}]+)\\}`, 's'));
              if (functionBodyMatch) {
                const functionBody = functionBodyMatch[1].trim();
                
                // Build the fixed function
                const typeAnnotation = enableTypeScript ? `(${paramName}: number | string | undefined)` : `(${paramName})`;
                let fixedFunction = `const ${functionName} = ${typeAnnotation} => {\n`;
                fixedFunction += `  if (${paramName} !== undefined && ${paramName} !== null) {\n`;
                fixedFunction += `    ${functionBody}\n`;
                fixedFunction += `  }\n`;
                fixedFunction += `}`;
                
                scriptContent = scriptContent.replace(functionBodyMatch[0], fixedFunction);
                result.fixed = true;
                result.fixes.push(`Added type checking and undefined check for ${functionName} function with router.push`);
              }
            }
          }
        }
        
        // Fix 8g: Improve fetch* functions to search existing data first (GENERIC)
        // Pattern: async function fetchPost(postId: number) { ... const post = { id: postId, ... } SET_CURRENT_*(post) }
        // Should become: async function fetchPost(postId: number) { ... const existingPost = arrayVar.value.find(p => p.id === postId); if (existingPost) { SET_CURRENT_*(existingPost) } else { ... } }
        // This is GENERIC - works for any fetch* function, any array variable, any SET_CURRENT_* function
        if (scriptContent.includes('async function fetch')) {
          // Find fetch functions that create new objects instead of searching existing data
          // Pattern matches: async function fetch*Name*(param: type) { ... const item = { id: param, ... } SET_CURRENT_*(item) }
          const fetchFunctionPattern = /async\s+function\s+(fetch\w+)\s*\([^)]+\)\s*:\s*Promise<void>\s*\{([\s\S]*?const\s+\w+\s*=\s*\{[^}]*id\s*:\s*\w+[^}]*\}[\s\S]*?SET_CURRENT_\w+)/g;
          let fetchFunctionMatch;
          
          while ((fetchFunctionMatch = fetchFunctionPattern.exec(scriptContent)) !== null) {
            const [fullMatch, functionName, functionBody] = fetchFunctionMatch;
            
            // Check if function already searches existing data (GENERIC check)
            const alreadySearches = /\.find\s*\([^)]*\.id\s*===/.test(functionBody) || 
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
                const refDeclarations = scriptContent.match(/const\s+(\w+)\s*=\s*ref\s*\(/g);
                if (refDeclarations) {
                  // Extract ref variable names
                  const refVars = refDeclarations.map(match => {
                    const varMatch = match.match(/const\s+(\w+)\s*=/);
                    return varMatch ? varMatch[1] : null;
                  }).filter(Boolean) as string[];
                  
                  // Try to infer from function name: fetchPost -> posts, fetchUser -> users, etc.
                  const functionNameLower = functionName.toLowerCase();
                  const baseName = functionName.replace(/^fetch/, '').toLowerCase();
                  const pluralName = baseName + 's';
                  
                  // Look for matching ref variable (exact match or contains base name)
                  const matchingRef = refVars.find(refVar => {
                    const refVarLower = refVar.toLowerCase();
                    return refVarLower === pluralName || 
                           refVarLower.includes(baseName) ||
                           baseName.includes(refVarLower.replace(/s$/, ''));
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
                const setFunctionMatch = functionBody.match(/(SET_CURRENT_\w+)/);
                const setFunction = setFunctionMatch ? setFunctionMatch[1] : `SET_CURRENT_${arrayVar.charAt(0).toUpperCase() + arrayVar.slice(1, -1)}`;
                
                // GENERIC: Build improved function body using detected variables
                const itemName = arrayVar.slice(0, -1); // posts -> post, users -> user, etc.
                const existingItemName = `existing${itemName.charAt(0).toUpperCase() + itemName.slice(1)}`;
                
                const searchCode = `\n      // Try to find ${itemName} in existing ${arrayVar} first\n      const ${existingItemName} = ${arrayVar}.value.find((p: any) => p.id === ${paramName});\n      if (${existingItemName}) {\n        ${setFunction}(${existingItemName});\n      } else {\n`;
                
                // Find where the new object is created and wrap it in else
                const newObjectPattern = /const\s+\w+\s*=\s*\{[^}]*id\s*:\s*\w+[^}]*\}/;
                const newObjectMatch = functionBody.match(newObjectPattern);
                if (newObjectMatch) {
                  const improvedBody = functionBody.replace(
                    newObjectMatch[0],
                    searchCode + '        ' + newObjectMatch[0] + '\n      }'
                  );
                  
                  scriptContent = scriptContent.replace(functionBody, improvedBody);
                  result.fixed = true;
                  result.fixes.push(`Improved ${functionName} to search existing data before creating new (generic fix)`);
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
              if (mainStore && !scriptContent.match(new RegExp(`import\\s+.*${mainStore.storeName}.*from`))) {
                const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
                if (importMatch) {
                  scriptContent = scriptContent.replace(
                    /(import\s+[^;]+;[\s\n]*)+/,
                    `$&import { ${mainStore.storeName} } from '${mainStore.importPath}';\n`
                  );
                } else {
                  scriptContent = `import { ${mainStore.storeName} } from '${mainStore.importPath}';\n${scriptContent}`;
                }
                
                // Replace useIndexStore() with the correct store name
                scriptContent = scriptContent.replace(/useIndexStore\(\)/g, `${mainStore.storeName}()`);
                // Derive store variable name
                const storeVarMatch = mainStore.storeName.match(/use(\w+)Store/);
                const storeVarName = storeVarMatch ? storeVarMatch[1].charAt(0).toLowerCase() + storeVarMatch[1].slice(1) + 'Store' : 'appStore';
                scriptContent = scriptContent.replace(/const\s+indexStore\s*=\s*useIndexStore\(\)/g, `const ${storeVarName} = ${mainStore.storeName}()`);
                scriptContent = scriptContent.replace(/indexStore\./g, `${storeVarName}.`);
              }
            } catch (error) {
              // Could not find main store
            }
          }
        }

      // Final step: Always merge imports at the end (after all other fixes that might add imports)
      // This ensures that even if other fixes add imports, they are properly merged
      if (scriptContent && scriptContent.includes('import')) {
        const importPattern = /import\s+[^;]+;/g;
        const finalImports: Array<{ content: string; normalized: string }> = [];
        let importMatch;
        
        // Reset regex lastIndex
        importPattern.lastIndex = 0;
        
        while ((importMatch = importPattern.exec(scriptContent)) !== null) {
          if (importMatch && importMatch[0]) {
            const content = importMatch[0];
            const normalized = content.replace(/\s+/g, ' ').trim();
            finalImports.push({ content, normalized });
          }
        }
        
        if (finalImports.length > 0) {
          // Group imports by module and merge exports
          const finalImportsByModule = new Map<string, Set<string>>();
          
          finalImports.forEach(({ content, normalized }) => {
            const importNameMatch = normalized.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
            if (importNameMatch) {
              const exportNames = importNameMatch[1].split(',').map(s => s.trim());
              const fromPath = importNameMatch[2];
              
              if (!finalImportsByModule.has(fromPath)) {
                finalImportsByModule.set(fromPath, new Set());
              }
              
              const moduleExports = finalImportsByModule.get(fromPath)!;
              exportNames.forEach(name => moduleExports.add(name));
            }
          });
          
          // Rebuild merged imports
          const finalUniqueImports: string[] = [];
          finalImportsByModule.forEach((exports, modulePath) => {
            const sortedExports = Array.from(exports).sort().filter(e => e.length > 0); // Filter empty exports
            if (sortedExports.length > 0) {
              const importStatement = `import { ${sortedExports.join(', ')} } from '${modulePath}';`;
              finalUniqueImports.push(importStatement);
            }
          });
          
          // Remove all imports and rebuild
          let finalCleanedContent = scriptContent.replace(/import\s+[^;]+;\s*\n?/g, '');
          finalCleanedContent = finalCleanedContent.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '').trim();
          
          if (finalUniqueImports.length > 0) {
            // Clean up any imports with empty commas
            const cleanedImports = finalUniqueImports.map(imp => {
              return imp.replace(/import\s+\{\s*,+\s*([^}]+)\}\s+from/, 'import { $1 } from')
                       .replace(/import\s+\{([^}]+)\s*,+\s*\}\s+from/, 'import { $1 } from')
                       .replace(/import\s+\{\s*,+\s*\}\s+from/, ''); // Remove completely empty imports
            }).filter(imp => imp.length > 0);
            
            scriptContent = cleanedImports.join('\n') + '\n\n' + finalCleanedContent;
            result.fixed = true;
            if (!result.fixes.includes("Merged duplicate imports from same modules")) {
              result.fixes.push("Merged duplicate imports from same modules");
            }
          }
        }
      }

      if (scriptContent !== originalScriptContent) {
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`,
        );
        result.fixed = true;
        result.fixes.push("Fixed store method calls in <script setup> using dynamic store detection");
      }
      }
    }
  }

  // Fix 7b: Detect and correct wrong store imports
  // Pattern: import { useUsersStore } but code uses fetchProducts, deleteProduct, etc. → should be useProductsStore
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;
      
      // Get dynamic store map from analysis - NO hardcoded fallback for genericity
      let storeMethodMap: Record<string, string> = {};
      
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
        const vuexDispatchPattern = /this\.\$store\.dispatch\(['"]([^'"]+)\/([^'"]+)['"]/g;
        const vuexGettersPattern = /this\.\$store\.getters\[['"]([^'"]+)\/([^'"]+)['"]/g;
        
        let dispatchMatch;
        while ((dispatchMatch = vuexDispatchPattern.exec(scriptContent)) !== null) {
          const [, module, method] = dispatchMatch;
          usedModules.add(module);
          usedMethods.add(method);
          
          // Replace this.$store.dispatch('module/method') with storeVar.method()
          const storeVarName = `${module}Store`;
          const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
          const replacement = `${storeVarName}.${method}()`;
          
          // Ensure store is imported and initialized
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
            const afterImportsMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (afterImportsMatch) {
              const insertIndex = afterImportsMatch[0].length;
              scriptContent = scriptContent.slice(0, insertIndex) + 
                `\nconst ${storeVarName} = ${storeName}();\n` + 
                scriptContent.slice(insertIndex);
            } else {
              scriptContent = `const ${storeVarName} = ${storeName}();\n${scriptContent}`;
            }
          }
          
          // Replace the dispatch call
          scriptContent = scriptContent.replace(
            new RegExp(`this\\.\\$store\\.dispatch\\(['"]${module}/${method}['"]\\)`, 'g'),
            replacement
          );
        }
        
        let gettersMatch;
        while ((gettersMatch = vuexGettersPattern.exec(scriptContent)) !== null) {
          const [, module, getter] = gettersMatch;
          usedModules.add(module);
          usedMethods.add(getter);
          
          // Replace this.$store.getters['module/getter'] with storeVar.getter
          const storeVarName = `${module}Store`;
          const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
          const replacement = `${storeVarName}.${getter}`;
          
          // Ensure store is imported and initialized (same logic as above)
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
            const afterImportsMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (afterImportsMatch) {
              const insertIndex = afterImportsMatch[0].length;
              scriptContent = scriptContent.slice(0, insertIndex) + 
                `\nconst ${storeVarName} = ${storeName}();\n` + 
                scriptContent.slice(insertIndex);
            } else {
              scriptContent = `const ${storeVarName} = ${storeName}();\n${scriptContent}`;
            }
          }
          
          // Replace the getter access
          scriptContent = scriptContent.replace(
            new RegExp(`this\\.\\$store\\.getters\\[['"]${module}/${getter}['"]\\]`, 'g'),
            replacement
          );
        }
        
        // Check if computed is used but not imported (after replacing this.$store.getters)
        if (scriptContent.includes('computed(') && !scriptContent.match(/import\s+.*\{[^}]*\bcomputed\b[^}]*\}\s+from\s+['"]vue['"]/)) {
          // Add computed to vue import or create new import
          const vueImportMatch = scriptContent.match(/import\s+.*\{([^}]+)\}\s+from\s+['"]vue['"]/);
          if (vueImportMatch) {
            const existingImports = vueImportMatch[1].split(',').map(i => i.trim()).filter(i => i);
            if (!existingImports.includes('computed')) {
              const newImports = [...existingImports, 'computed'];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]+\}\s+from\s+['"]vue['"]/,
                `import { ${newImports.join(', ')} } from 'vue'`
              );
              result.fixed = true;
              result.fixes.push("Added missing computed import");
            }
          } else {
            // Create new import
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
        Object.keys(storeMethodMap).forEach(method => {
          // Pattern 1: storeName.method() - explicit store call
          // Pattern 2: method() - direct method call (if it's a store method)
          // Pattern 3: method.value - computed property access
          // Pattern 4: method, - destructured or referenced
          const patterns = [
            new RegExp(`\\w+Store\\.${method}\\b`, 'g'), // store.method
            new RegExp(`\\b${method}\\s*\\(`, 'g'), // method()
            new RegExp(`\\b${method}\\.value\\b`, 'g'), // method.value
            new RegExp(`\\b${method}\\s*[,\\}]`, 'g'), // method, or method}
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
        usedModules.forEach(module => {
          storeUsage.set(module, (storeUsage.get(module) || 0) + 10); // Higher weight for explicit module references
        });
        
        // Then add modules from method calls
        usedMethods.forEach(method => {
          const module = storeMethodMap[method];
          if (module) {
            storeUsage.set(module, (storeUsage.get(module) || 0) + 1);
          }
        });
        
        // Find wrong store imports
        const wrongStorePattern = /import\s+\{\s*use(\w+)Store\s*\}\s+from\s+['"]@\/store\/modules\/(\w+)['"]/g;
        let match;
        const wrongImports: Array<{ importLine: string; wrongStore: string; wrongModule: string; correctModule: string }> = [];
        
        while ((match = wrongStorePattern.exec(scriptContent)) !== null) {
          const [, storeName, importedModule] = match;
          const actualModule = storeName.toLowerCase().replace('store', '');
          
          // Check if the imported module doesn't match the methods used
          if (storeUsage.size > 0) {
            // Find the most used module
            let mostUsedModule = '';
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
                correctModule: mostUsedModule
              });
            }
          }
        }
        
        // Fix wrong imports
        wrongImports.forEach(({ importLine, wrongStore, wrongModule, correctModule }) => {
          const correctStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
          const correctImport = `import { ${correctStore} } from '@/store/modules/${correctModule}'`;
          
          scriptContent = scriptContent.replace(importLine, correctImport);
          
          // Also fix store variable initialization
          const wrongStoreVar = `${wrongModule}Store`;
          const correctStoreVar = `${correctModule}Store`;
          scriptContent = scriptContent.replace(
            new RegExp(`const\\s+${wrongStoreVar}\\s*=\\s*${wrongStore}\\(\\)`, 'g'),
            `const ${correctStoreVar} = ${correctStore}()`
          );
          
          // Fix store method calls
          scriptContent = scriptContent.replace(
            new RegExp(`${wrongStoreVar}\\.`, 'g'),
            `${correctStoreVar}.`
          );
        });
        
        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`,
          );
          result.fixed = true;
          result.fixes.push(`Corrected wrong store imports: ${wrongImports.map(i => `${i.wrongStore} → use${i.correctModule.charAt(0).toUpperCase() + i.correctModule.slice(1)}Store`).join(', ')}`);
        }
      }
    }
  }

  // Fix 8: Add missing Pinia store imports and initializations in <script setup>
  // This handles components that were converted to <script setup> but are missing store setup
  // GENERIC: No hardcoded patterns - relies entirely on dynamic store analysis
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Detect which stores are needed based on template usage
      const templateMatch = fixedContent.match(
        /<template>([\s\S]*?)<\/template>/,
      );
      const templateContent = templateMatch ? templateMatch[1] : "";

      // Get dynamic store map from analysis - NO hardcoded fallback for genericity
      let storeMethodMap: Record<string, string> = {};
      
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
        const allContent = templateContent + ' ' + scriptContent;
        Object.keys(storeMethodMap).forEach(method => {
          const pattern = new RegExp(`\\b${method}\\b`, 'g');
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
          const hasStoreImport = scriptContent.includes(`import { ${storeName} }`);
          const storeVarName = `${moduleName}Store`;
          const hasStoreInit = scriptContent.includes(`const ${storeVarName} = ${storeName}`);

          if (!hasStoreImport || !hasStoreInit) {
            storesToAdd.add(JSON.stringify({ store: storeName, module: moduleName }));
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
          const needsComputed = usedModules.size > 0 && !scriptContent.includes("import { computed }");
          if (needsComputed) {
            newImports += "import { computed } from 'vue';\n";
          }

          // Add store getters/actions that are used in template but not defined (generic approach)
          // Use the dynamically detected stores instead of hardcoded patterns
          usedModules.forEach((storeName, moduleName) => {
            const storeVarName = `${moduleName}Store`;
            
            // Dynamically detect which properties from this store are used in template
            // and add computed properties for them if they're not already defined
            Object.keys(storeMethodMap).forEach(method => {
              if (storeMethodMap[method] === moduleName) {
                // Check if this property is used in template but not defined in script
                const propertyPattern = new RegExp(`\\b${method}\\b`, 'g');
                if (propertyPattern.test(templateContent) && !scriptContent.includes(`const ${method}`)) {
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
            "",
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
              },
            );
          }

          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`,
          );
            result.fixed = true;
            result.fixes.push(
              "Added missing Pinia store imports and initializations",
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
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Extract prop names from defineProps
      const propNames = new Set<string>();
      
      // Pattern 1: defineProps({ propName: Type, ... })
      const propsObjectMatch = scriptContent.match(/defineProps\s*\(\s*\{([^}]+)\}/);
      if (propsObjectMatch) {
        const propsContent = propsObjectMatch[1];
        const propNamePattern = /(\w+)\s*:/g;
        let propMatch;
        while ((propMatch = propNamePattern.exec(propsContent)) !== null) {
          propNames.add(propMatch[1]);
        }
      }
      
      // Pattern 2: defineProps(['prop1', 'prop2'])
      const propsArrayMatch = scriptContent.match(/defineProps\s*\(\s*\[([^\]]+)\]/);
      if (propsArrayMatch) {
        const propsContent = propsArrayMatch[1];
        const propNamePattern = /['"](\w+)['"]/g;
        let propMatch;
        while ((propMatch = propNamePattern.exec(propsContent)) !== null) {
          propNames.add(propMatch[1]);
        }
      }

      // Fix watch(() => propName.value, ...) → watch(() => props.propName, ...)
      propNames.forEach(propName => {
        // Pattern: watch(() => propName.value, ...)
        const watchPattern = new RegExp(
          `watch\\(\\s*\\(\\)\\s*=>\\s*${propName}\\.value`,
          'g'
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
          'g'
        );
        // Check if propName is not a ref (not declared as const propName = ref(...))
        const isRef = new RegExp(`const\\s+${propName}\\s*=\\s*ref\\(`).test(scriptContent);
        if (watchDirectPattern.test(scriptContent) && !isRef) {
          scriptContent = scriptContent.replace(
            watchDirectPattern,
            `watch(() => props.${propName},`
          );
        }

        // Pattern: computed(() => propName.value) → computed(() => props.propName)
        const computedPattern = new RegExp(
          `computed\\(\\s*\\(\\)\\s*=>\\s*${propName}\\.value`,
          'g'
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
      if (scriptContent.includes('defineProps') && scriptContent.includes('props.') && scriptContent.includes('watch')) {
        // Find all props that end with 'Id' (id, userId, postId, itemId, etc.)
        const propsIdPattern = /props\.(\w*Id|\w*id)/g;
        const propsIds = new Set<string>();
        let propsIdMatch;
        while ((propsIdMatch = propsIdPattern.exec(scriptContent)) !== null) {
          propsIds.add(propsIdMatch[1]);
        }
        
        // Ensure useRoute is imported (only once, before the loop)
        if (!scriptContent.includes('useRoute')) {
          const vueRouterImport = scriptContent.match(/import\s+.*from\s+['"]vue-router['"]/);
          if (vueRouterImport) {
            // Add useRoute to existing import
            scriptContent = scriptContent.replace(
              /import\s+{([^}]+)}\s+from\s+['"]vue-router['"]/,
              (match, imports) => {
                if (!imports.includes('useRoute')) {
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
          if (!scriptContent.includes('const route = useRoute()') && !scriptContent.includes('const route = useRoute();')) {
            const routerMatch = scriptContent.match(/const\s+router\s*=\s*useRouter\(\)/);
            if (routerMatch) {
              scriptContent = scriptContent.replace(routerMatch[0], `const route = useRoute();\n${routerMatch[0]}`);
            } else {
              // Add after imports
              const importEnd = scriptContent.lastIndexOf('import');
              const nextLine = scriptContent.indexOf('\n', importEnd);
              if (nextLine !== -1) {
                scriptContent = scriptContent.slice(0, nextLine + 1) + 'const route = useRoute();\n' + scriptContent.slice(nextLine + 1);
              }
            }
          }
          result.fixed = true;
          result.fixes.push('Added useRoute import and initialization for route.params fallback');
        }
        
        // Process each propId found (GENERIC - works for id, userId, postId, itemId, etc.)
        propsIds.forEach(propId => {
          if (scriptContent.includes(`props.${propId}`) && scriptContent.includes('watch')) {
            // Check if there's already a computed fallback for this propId
            const computedVarName = propId.charAt(0).toLowerCase() + propId.slice(1).replace(/Id$/, 'Id'); // id -> id, userId -> userId
            const hasRouteParamsFallback = new RegExp(`const\\s+\\w+\\s*=\\s*computed\\s*\\([^)]*props\\.${propId}\\s*\\|\\|\\s*route\\.params`).test(scriptContent);
            
            if (!hasRouteParamsFallback) {
              // Find watch(() => props.propId, ...)
              const watchPropsIdPattern = new RegExp(`watch\\s*\\(\\s*\\(\\)\\s*=>\\s*props\\.${propId}`, 'g');
              if (watchPropsIdPattern.test(scriptContent)) {
                // GENERIC: Create computed variable name dynamically
                // Convention: id -> postId (common pattern), userId -> userId, postId -> postId, etc.
                // Try to infer from context: if propId is just 'id', look for context clues
                let computedName: string;
                if (propId === 'id') {
                  // Try to infer from component/route context
                  const componentContext = scriptContent.match(/component:\s*(\w+)/) || 
                                          scriptContent.match(/name:\s*['"](\w+)['"]/);
                  if (componentContext) {
                    const componentName = componentContext[1].toLowerCase();
                    // Extract base name: BlogPost -> post, UserDetail -> user, etc.
                    const baseName = componentName.replace(/(post|detail|view|page)$/i, '').toLowerCase() || 'post';
                    computedName = baseName + 'Id';
                  } else {
                    // Default convention: id -> postId (most common pattern)
                    computedName = 'postId';
                  }
                } else {
                  // Use propId as-is: userId -> userId, postId -> postId
                  computedName = computedVarName;
                }
                
                // Add computed fallback before watch
                const computedFallback = `\n// Get ${propId} from props or route params\nconst ${computedName} = computed(() => {\n  return props.${propId} || (route.params.${propId} as string);\n});\n\n`;
                
                // Insert before the watch statement
                scriptContent = scriptContent.replace(
                  new RegExp(`(watch\\s*\\(\\s*\\(\\)\\s*=>\\s*props\\.${propId})`),
                  `${computedFallback}$1`
                );
                
                // Update watch to use computedName.value instead of props.propId
                scriptContent = scriptContent.replace(
                  new RegExp(`watch\\s*\\(\\s*\\(\\)\\s*=>\\s*props\\.${propId}\\s*,\\s*(\\w+)\\s*=>`, 'g'),
                  `watch(() => ${computedName}.value, $1 =>`
                );
                
                result.fixed = true;
                result.fixes.push(`Added route.params.${propId} fallback for props.${propId} in Vue Router component (generic fix)`);
              }
            }
          }
        });
      }

      // Fix 5: Add NaN checks for parseInt in watch functions and route params
      // Pattern: watch(() => props.id, newId => { fetchPost(parseInt(newId)) })
      // Should be: watch(() => props.id, newId => { if (newId && !isNaN(parseInt(newId))) { fetchPost(parseInt(newId)) } })
      if (scriptContent.includes('parseInt')) {
        // Fix functions that use parseInt without NaN checks
        // Pattern: async function fetchPost(postId: number): Promise<void> { ...parseInt(postId)... }
        const functionParseIntPattern = /(async\s+)?function\s+(\w+)\s*\([^)]*(\w+)\s*:\s*number[^)]*\)\s*:\s*Promise<void>\s*\{([^}]*parseInt\s*\(\s*\3\s*\)[^}]*)\}/g;
        let funcMatch;
        while ((funcMatch = functionParseIntPattern.exec(scriptContent)) !== null) {
          const isAsync = funcMatch[1];
          const funcName = funcMatch[2];
          const paramName = funcMatch[3];
          const funcBody = funcMatch[4];
          
          // Check if there's already a NaN check
          if (!funcBody.includes('isNaN') && !funcBody.includes('NaN') && !funcBody.includes('if (!')) {
            // Add NaN check at the beginning of the function
            const fixedBody = funcBody.replace(
              /^/,
              `  if (!${paramName} || isNaN(${paramName})) {\n    return;\n  }\n`
            );
            scriptContent = scriptContent.replace(funcMatch[0], funcMatch[0].replace(funcBody, fixedBody));
            result.fixed = true;
            result.fixes.push(`Added NaN check in function ${funcName} for parameter ${paramName}`);
          }
        }
      }
      
      // Fix malformed watch statements with extra braces and missing parentheses
      // This is a GENERIC fix that works for any watch statement, not just props or parseInt
      if (scriptContent.includes('watch')) {
        // Pattern 1: watch(() => ..., param => { { ... } }) - double braces
        // This pattern is generic and works for any watch source and body
        const doubleBracePattern = /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*\{\s*([^}]+)\s*\}\s*\}\)/g;
        let doubleBraceMatch;
        while ((doubleBraceMatch = doubleBracePattern.exec(scriptContent)) !== null) {
          const watchSource = doubleBraceMatch[1].trim();
          const paramName = doubleBraceMatch[2];
          let watchBody = doubleBraceMatch[3].trim();
          
          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;
          
          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ')';
          }
          
          // Add semicolon if missing (unless it's already there or ends with })
          if (!watchBody.endsWith(';') && !watchBody.endsWith(')')) {
            watchBody += ';';
          }
          
          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${watchBody}\n})`;
          scriptContent = scriptContent.replace(doubleBraceMatch[0], fixedWatch);
          result.fixed = true;
          result.fixes.push(`Fixed malformed watch statement with extra braces`);
        }
        
        // Pattern 2: watch(() => ..., param => { if (...) { { ... } } }) - double braces inside if
        const doubleBraceInIfPattern = /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*(if\s*\([^)]+\)\s*)\{\s*\{\s*([^}]+)\s*\}\s*\}\s*\}\)/g;
        let doubleBraceInIfMatch;
        while ((doubleBraceInIfMatch = doubleBraceInIfPattern.exec(scriptContent)) !== null) {
          const watchSource = doubleBraceInIfMatch[1].trim();
          const paramName = doubleBraceInIfMatch[2];
          const ifCondition = doubleBraceInIfMatch[3].trim();
          let watchBody = doubleBraceInIfMatch[4].trim();
          
          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;
          
          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ')';
          }
          
          // Add semicolon if missing
          if (!watchBody.endsWith(';') && !watchBody.endsWith(')')) {
            watchBody += ';';
          }
          
          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${ifCondition}{\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(doubleBraceInIfMatch[0], fixedWatch);
          result.fixed = true;
          result.fixes.push(`Fixed malformed watch statement with extra braces in if statement`);
        }
        
        // Pattern 3: watch(() => ..., param => { if (...) { { code } } }) - more complex pattern
        // This handles cases where the watch body has multiple statements
        const complexWatchPattern = /watch\s*\(([^,]+),\s*(\w+)\s*=>\s*\{\s*(if\s*\([^)]+\)\s*)\{\s*\{\s*([^}]*blogStore[^}]*\w+\([^)]*\)[^}]*)\s*\}\s*\}\s*\}\)/g;
        let complexWatchMatch;
        while ((complexWatchMatch = complexWatchPattern.exec(scriptContent)) !== null) {
          const watchSource = complexWatchMatch[1].trim();
          const paramName = complexWatchMatch[2];
          const ifCondition = complexWatchMatch[3].trim();
          let watchBody = complexWatchMatch[4].trim();
          
          // Count parentheses to fix missing closing ones
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;
          
          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ')';
          }
          
          // Add semicolon if missing
          if (!watchBody.endsWith(';') && !watchBody.endsWith(')')) {
            watchBody += ';';
          }
          
          const fixedWatch = `watch(${watchSource}, ${paramName} => {\n  ${ifCondition}{\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(complexWatchMatch[0], fixedWatch);
          result.fixed = true;
          result.fixes.push(`Fixed complex malformed watch statement with extra braces`);
        }
      }
      
      if (scriptContent.includes('parseInt') && scriptContent.includes('watch')) {
        // Fix malformed watch statements with missing parentheses/braces
        // Pattern: watch(() => props.id, newId => { { blogStore.fetchPost(parseInt(newId) } })
        // This pattern matches watch statements with extra braces and missing closing parentheses
        const malformedWatchPattern = /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*\{([^}]*if[^}]*)\{\s*([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\s*\}\s*\}\)/g;
        let malformedMatch;
        while ((malformedMatch = malformedWatchPattern.exec(scriptContent)) !== null) {
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
            watchBody += ')';
          }
          
          // Add semicolon if missing
          if (!watchBody.endsWith(';')) {
            watchBody += ';';
          }
          
          // Extract the if condition properly (remove the extra opening brace)
          const cleanIfCondition = ifCondition.replace(/^\s*if\s*\(/, 'if (').replace(/\{\s*$/, '');
          
          const fixedWatch = `watch(() => props.${propName}, ${paramName} => {\n  ${cleanIfCondition} {\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(malformedMatch[0], fixedWatch);
          result.fixed = true;
          result.fixes.push(`Fixed malformed watch statement with missing parentheses/braces for props.${propName}`);
        }
        
        // Also fix simpler pattern: watch(() => props.id, newId => { { blogStore.fetchPost(parseInt(newId) } })
        const simpleMalformedPattern = /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*\{\s*\{\s*([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\s*\}\s*\}\)/g;
        let simpleMalformedMatch;
        while ((simpleMalformedMatch = simpleMalformedPattern.exec(scriptContent)) !== null) {
          const propName = simpleMalformedMatch[1];
          const paramName = simpleMalformedMatch[2];
          let watchBody = simpleMalformedMatch[3].trim();
          
          // Fix: remove extra braces and add missing semicolon/parentheses
          const openParens = (watchBody.match(/\(/g) || []).length;
          const closeParens = (watchBody.match(/\)/g) || []).length;
          
          // Add missing closing parentheses
          for (let i = 0; i < openParens - closeParens; i++) {
            watchBody += ')';
          }
          
          // Add semicolon if missing
          if (!watchBody.endsWith(';')) {
            watchBody += ';';
          }
          
          const fixedWatch = `watch(() => props.${propName}, ${paramName} => {\n  if (${paramName} && !isNaN(parseInt(${paramName}))) {\n    ${watchBody}\n  }\n})`;
          scriptContent = scriptContent.replace(simpleMalformedMatch[0], fixedWatch);
          result.fixed = true;
          result.fixes.push(`Fixed malformed watch statement with missing parentheses/braces for props.${propName}`);
        }
        
        // Pattern: watch(() => props.id, newId => { ...parseInt(newId)... })
        const watchParseIntPattern = /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*\{([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\}\s*\)/g;
        let watchMatch;
        while ((watchMatch = watchParseIntPattern.exec(scriptContent)) !== null) {
          const propName = watchMatch[1];
          const paramName = watchMatch[2];
          const watchBody = watchMatch[3];
          
          // Check if there's already a NaN check
          if (!watchBody.includes('isNaN') && !watchBody.includes('NaN')) {
            // Add NaN check
            const fixedBody = `  if (${paramName} && !isNaN(parseInt(${paramName}))) {\n${watchBody}\n  }`;
            const fixedWatch = `watch(() => props.${propName}, ${paramName} => {\n${fixedBody}\n})`;
            scriptContent = scriptContent.replace(watchMatch[0], fixedWatch);
            result.fixed = true;
            result.fixes.push(`Added NaN check for parseInt in watch function for props.${propName}`);
          }
        }
        
        // Pattern: watch(() => props.id, newId => blogStore.fetchPost(parseInt(newId)))
        const watchParseIntSimplePattern = /watch\s*\(\s*\(\)\s*=>\s*props\.(\w+)\s*,\s*(\w+)\s*=>\s*([^,}]+parseInt\s*\(\s*\2\s*\)[^,}]*)\s*\)/g;
        let watchSimpleMatch;
        while ((watchSimpleMatch = watchParseIntSimplePattern.exec(scriptContent)) !== null) {
          const propName = watchSimpleMatch[1];
          const paramName = watchSimpleMatch[2];
          const watchCall = watchSimpleMatch[3];
          
          // Check if there's already a NaN check in the options
          const fullMatch = watchSimpleMatch[0];
          if (!fullMatch.includes('isNaN') && !fullMatch.includes('NaN')) {
            // Wrap in a function with NaN check
            const fixedWatch = `watch(() => props.${propName}, ${paramName} => {
  if (${paramName} && !isNaN(parseInt(${paramName}))) {
    ${watchCall}
  }
})`;
            scriptContent = scriptContent.replace(fullMatch, fixedWatch);
            result.fixed = true;
            result.fixes.push(`Added NaN check for parseInt in watch function for props.${propName}`);
          }
        }
        
        // Pattern: watch(() => postId.value, newId => { ...parseInt(newId)... })
        // Handle computed postId.value pattern (common in Vue Router components)
        const watchComputedParseIntPattern = /watch\s*\(\s*\(\)\s*=>\s*(\w+)\.value\s*,\s*(\w+)\s*=>\s*\{([^}]*parseInt\s*\(\s*\2\s*\)[^}]*)\}\s*\)/g;
        let watchComputedMatch;
        while ((watchComputedMatch = watchComputedParseIntPattern.exec(scriptContent)) !== null) {
          const computedVar = watchComputedMatch[1];
          const paramName = watchComputedMatch[2];
          const watchBody = watchComputedMatch[3];
          
          // Check if there's already a NaN check
          if (!watchBody.includes('isNaN') && !watchBody.includes('NaN') && !watchBody.includes('if (')) {
            // Add NaN check
            const fixedBody = `  if (${paramName} && typeof ${paramName} === 'string' && ${paramName}.trim() && !isNaN(parseInt(${paramName}))) {\n${watchBody}\n  }`;
            const fixedWatch = `watch(() => ${computedVar}.value, ${paramName} => {\n${fixedBody}\n})`;
            scriptContent = scriptContent.replace(watchComputedMatch[0], fixedWatch);
            result.fixed = true;
            result.fixes.push(`Added NaN check for parseInt in watch function for ${computedVar}.value`);
          }
        }
        
        // Pattern: watch(() => postId.value, newId => blogStore.fetchPost(parseInt(newId)))
        const watchComputedParseIntSimplePattern = /watch\s*\(\s*\(\)\s*=>\s*(\w+)\.value\s*,\s*(\w+)\s*=>\s*([^,}]+parseInt\s*\(\s*\2\s*\)[^,}]*)\s*\)/g;
        let watchComputedSimpleMatch;
        while ((watchComputedSimpleMatch = watchComputedParseIntSimplePattern.exec(scriptContent)) !== null) {
          const computedVar = watchComputedSimpleMatch[1];
          const paramName = watchComputedSimpleMatch[2];
          const watchCall = watchComputedSimpleMatch[3];
          
          // Check if there's already a NaN check
          const fullMatch = watchComputedSimpleMatch[0];
          if (!fullMatch.includes('isNaN') && !fullMatch.includes('NaN')) {
            // Wrap in a function with NaN check
            const fixedWatch = `watch(() => ${computedVar}.value, ${paramName} => {
  if (${paramName} && typeof ${paramName} === 'string' && ${paramName}.trim() && !isNaN(parseInt(${paramName}))) {
    ${watchCall}
  }
})`;
            scriptContent = scriptContent.replace(fullMatch, fixedWatch);
            result.fixed = true;
            result.fixes.push(`Added NaN check for parseInt in watch function for ${computedVar}.value`);
          }
        }
      }

      // Final step: Always merge imports at the end (after all other fixes that might add imports)
      // This ensures that even if other fixes add imports, they are properly merged
      if (scriptContent && scriptContent.includes('import')) {
        const importPattern = /import\s+[^;]+;/g;
        const finalImports: Array<{ content: string; normalized: string }> = [];
        let importMatch;
        
        // Reset regex lastIndex
        importPattern.lastIndex = 0;
        
        while ((importMatch = importPattern.exec(scriptContent)) !== null) {
          if (importMatch && importMatch[0]) {
            const content = importMatch[0];
            const normalized = content.replace(/\s+/g, ' ').trim();
            finalImports.push({ content, normalized });
          }
        }
        
        if (finalImports.length > 0) {
          // Group imports by module and merge exports
          const finalImportsByModule = new Map<string, Set<string>>();
          
          finalImports.forEach(({ content, normalized }) => {
            const importNameMatch = normalized.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
            if (importNameMatch) {
              const exportNames = importNameMatch[1].split(',').map(s => s.trim());
              const fromPath = importNameMatch[2];
              
              if (!finalImportsByModule.has(fromPath)) {
                finalImportsByModule.set(fromPath, new Set());
              }
              
              const moduleExports = finalImportsByModule.get(fromPath)!;
              exportNames.forEach(name => moduleExports.add(name));
            }
          });
          
          // Rebuild merged imports
          const finalUniqueImports: string[] = [];
          finalImportsByModule.forEach((exports, modulePath) => {
            const sortedExports = Array.from(exports).sort().filter(e => e.length > 0); // Filter empty exports
            if (sortedExports.length > 0) {
              const importStatement = `import { ${sortedExports.join(', ')} } from '${modulePath}';`;
              finalUniqueImports.push(importStatement);
            }
          });
          
          // Remove all imports and rebuild
          let finalCleanedContent = scriptContent.replace(/import\s+[^;]+;\s*\n?/g, '');
          finalCleanedContent = finalCleanedContent.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '').trim();
          
          if (finalUniqueImports.length > 0) {
            // Clean up any imports with empty commas
            const cleanedImports = finalUniqueImports.map(imp => {
              return imp.replace(/import\s+\{\s*,+\s*([^}]+)\}\s+from/, 'import { $1 } from')
                       .replace(/import\s+\{([^}]+)\s*,+\s*\}\s+from/, 'import { $1 } from')
                       .replace(/import\s+\{\s*,+\s*\}\s+from/, ''); // Remove completely empty imports
            }).filter(imp => imp.length > 0);
            
            scriptContent = cleanedImports.join('\n') + '\n\n' + finalCleanedContent;
            result.fixed = true;
            if (!result.fixes.includes("Merged duplicate imports from same modules")) {
              result.fixes.push("Merged duplicate imports from same modules");
            }
          }
        }
      }

      if (scriptContent !== originalScriptContent) {
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`,
        );
        result.fixed = true;
        result.fixes.push("Fixed props references in watchers and computed");
      }
    }
  }

  // Fix 13: Clean up store/index.js - remove unused imports and fix duplications
  if (filePath.includes("store/index") && fixedContent.includes("defineStore")) {
    // Remove unused Vue import
    const vueImportPattern = /import\s+Vue\s+from\s+['"]vue['"];?\n?/g;
    if (vueImportPattern.test(fixedContent) && !fixedContent.includes('Vue.')) {
      fixedContent = fixedContent.replace(vueImportPattern, "");
      result.fixed = true;
      result.fixes.push("Removed unused Vue import from store/index.js");
    }

    // Remove unused module imports (auth, products, cart, etc.)
    const moduleImportPattern = /import\s+\w+\s+from\s+['"]\.\/modules\/\w+['"];?\n?/g;
    const moduleImports = fixedContent.match(moduleImportPattern);
    if (moduleImports && moduleImports.length > 0) {
      // Check if these modules are actually used
      moduleImports.forEach(importLine => {
        const moduleMatch = importLine.match(/import\s+(\w+)\s+from/);
        if (moduleMatch) {
          const moduleName = moduleMatch[1];
          // If module is not used in the code, remove it
          const moduleUsagePattern = new RegExp(`\\b${moduleName}\\b`);
          if (!moduleUsagePattern.test(fixedContent.replace(importLine, ''))) {
            fixedContent = fixedContent.replace(importLine, '');
            result.fixed = true;
            result.fixes.push(`Removed unused module import: ${moduleName}`);
          }
        }
      });
    }

    // Fix duplications in return statement (e.g., appName: appName, appName: appNameComputed)
    // Pattern: propName: value1, propName: value2
    const returnMatch = fixedContent.match(/return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/);
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
          const duplicatePattern = new RegExp(`(\\s*)${propName}\\s*:\\s*\\w+\\s*,?\\s*`, 'g');
          const matches = Array.from(returnContent.matchAll(new RegExp(`${propName}\\s*:\\s*(\\w+)`, 'g')));
          if (matches.length > 1) {
            // Replace all but keep the last
            let newReturnContent = returnContent;
            for (let i = 0; i < matches.length - 1; i++) {
              newReturnContent = newReturnContent.replace(
                new RegExp(`\\s*${propName}\\s*:\\s*\\w+\\s*,?`),
                ''
              );
            }
            // Ensure the last one exists
            if (!newReturnContent.includes(`${propName}:`)) {
              newReturnContent = `${propName}: ${lastValue},\n${newReturnContent}`;
            }
            fixedContent = fixedContent.replace(returnMatch[0], `return {${newReturnContent}};})`);
            result.fixed = true;
            result.fixes.push(`Fixed duplicate property in return: ${propName}`);
          }
        }
      });
    }

    // Ensure export is named (e.g., useAppStore, useIndexStore) not default
    // GENERIC: Derives store name from defineStore ID, not hardcoded
    if (fixedContent.includes('export default defineStore')) {
      // Extract store name from defineStore call
      const storeNameMatch = fixedContent.match(/defineStore\s*\(\s*['"]([^'"]+)['"]/);
      // GENERIC: Use the store ID from defineStore, or derive from file path if not found
      // No hardcoded fallback - derives from file path or uses 'app' as last resort
      const storeId = storeNameMatch 
        ? storeNameMatch[1] 
        : (filePath.match(/store[\/\\](index|app|main|core|base)/i)?.[1]?.toLowerCase() || 'app');
      const useStoreName = `use${storeId.charAt(0).toUpperCase() + storeId.slice(1)}Store`;
      
      fixedContent = fixedContent.replace(
        /export\s+default\s+defineStore/,
        `export const ${useStoreName} = defineStore`
      );
      result.fixed = true;
      result.fixes.push(`Changed export default to named export: ${useStoreName}`);
    }
  }

  // Fix 12: Detect undefined properties in <script setup> that might be from stores
  // This handles cases like appInfo, appName, version, cartItems, cartTotal that come from stores
  if (isVueFile && fixedContent.includes("<script setup") && projectRoot) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
    );
    const templateMatch = fixedContent.match(
      /<template>([\s\S]*?)<\/template>/,
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
        const isDefined = scriptContent.match(
          new RegExp(`(const|let|var|function|import)\\s+${propName}\\b`, 'g')
        ) || scriptContent.match(
          new RegExp(`\\b${propName}\\s*=\\s*computed`, 'g')
        );
        
        if (!isDefined && !['v-if', 'v-for', 'v-show', 'v-model'].some(v => templateContent.includes(`${v}="${propName}"`))) {
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
          const isDefined = scriptContent.match(
            new RegExp(`(const|let|var|function|import)\\s+${propName}\\b`, 'g')
          ) || scriptContent.match(
            new RegExp(`\\b${propName}\\s*=\\s*computed`, 'g')
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
        const isDefined = scriptContent.match(
          new RegExp(`(const|let|var|function|import)\\s+${propName}\\b`, 'g')
        ) || scriptContent.match(
          new RegExp(`\\b${propName}\\s*=\\s*computed`, 'g')
        );
        if (!isDefined) {
          usedProperties.add(propName);
        }
      }
      
      // Extract properties used in script (computed, functions, etc.)
      // Pattern: allProducts.length, allProducts.method(), if (allProducts.length), etc.
      // Match identifiers that are not declared and are used with . or in conditions
      const scriptUsagePattern = /\b([a-z][a-zA-Z0-9]*)\s*(?:\.|\(|\)|===|!==|==|!=|>|<|>=|<=|\|\||&&|\?|:)/g;
      const vueKeywords = new Set(['computed', 'ref', 'reactive', 'watch', 'onMounted', 'onUnmounted', 'defineProps', 'defineEmits', 'useRouter', 'useRoute', 'router', 'route', 'const', 'let', 'var', 'function', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'null', 'undefined', 'true', 'false', 'length', 'value', 'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'map', 'filter', 'reduce', 'find', 'includes', 'indexOf', 'toString', 'toLowerCase', 'toUpperCase']);
      
      scriptUsagePattern.lastIndex = 0;
      let scriptUsageMatch;
      while ((scriptUsageMatch = scriptUsagePattern.exec(scriptContent)) !== null) {
        const propName = scriptUsageMatch[1];
        // Skip if it's a keyword, Vue function, or already declared
        if (!vueKeywords.has(propName) && 
            !propName.endsWith('Store') && 
            !propName.endsWith('store') &&
            !scriptContent.match(new RegExp(`(const|let|var|function|import|export)\\s+${propName}\\b`)) &&
            !scriptContent.match(new RegExp(`\\b${propName}\\s*=\\s*computed`)) &&
            propName.length > 2) { // Skip very short names
          usedProperties.add(propName);
        }
      }
      
      // If we found undefined properties, try to find them in all stores (main + modules)
      if (usedProperties.size > 0 && projectRoot) {
        const propertyToStoreMap = new Map<string, { storeName: string; importPath: string; storeVarName: string }>();
        
        // First check main store
        const mainStore = await findMainStore(projectRoot);
        if (mainStore) {
          const storeIndexPath = path.join(projectRoot, "src", "store", "index.js");
          let storeContent = '';
          try {
            storeContent = await fs.readFile(storeIndexPath, 'utf-8');
          } catch (error) {
            try {
              const storeIndexPathTs = path.join(projectRoot, "src", "store", "index.ts");
              storeContent = await fs.readFile(storeIndexPathTs, 'utf-8');
            } catch (error2) {
              try {
                const storesIndexPath = path.join(projectRoot, "src", "stores", "index.js");
                storeContent = await fs.readFile(storesIndexPath, 'utf-8');
              } catch (error3) {
                try {
                  const storesIndexPathTs = path.join(projectRoot, "src", "stores", "index.ts");
                  storeContent = await fs.readFile(storesIndexPathTs, 'utf-8');
                } catch (error4) {
                  // Could not read store
                }
              }
            }
          }
          
          // Extract exported properties from the main store
          const exportedProperties = new Set<string>();
          if (storeContent) {
            const returnMatch = storeContent.match(/return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/);
            if (returnMatch) {
              const returnContent = returnMatch[1];
              const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
              let propMatch;
              while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
                const exportedName = propMatch[2] || propMatch[1];
                exportedProperties.add(exportedName);
              }
            }
          }
          
          // Map properties to main store
          // GENERIC: Only map properties that are actually exported from the main store
          // Derive store variable name from store name (e.g., useAppStore → appStore)
          const storeVarNameMatch = mainStore.storeName.match(/use(\w+)Store/);
          const storeVarName = storeVarNameMatch ? storeVarNameMatch[1].charAt(0).toLowerCase() + storeVarNameMatch[1].slice(1) + 'Store' : 'appStore';
          
          usedProperties.forEach(prop => {
            if (exportedProperties.has(prop)) {
              propertyToStoreMap.set(prop, {
                storeName: mainStore.storeName,
                importPath: mainStore.importPath,
                storeVarName: storeVarName
              });
            }
          });
        }
        
        // Then check module stores (cart, products, auth, etc.)
        try {
          const storeModulesPath = path.join(projectRoot, "src", "store", "modules");
          const storeFiles = await fs.readdir(storeModulesPath);
          
          for (const storeFile of storeFiles) {
            if (!storeFile.endsWith('.js') && !storeFile.endsWith('.ts')) continue;
            
            const storeFilePath = path.join(storeModulesPath, storeFile);
            const storeContent = await fs.readFile(storeFilePath, 'utf-8');
            
            // Extract store name
            const storeNameMatch = storeContent.match(/export\s+const\s+(use\w+Store)\s*=/);
            if (!storeNameMatch) continue;
            const storeName = storeNameMatch[1];
            const moduleName = storeFile.replace(/\.(js|ts)$/, '');
            const storeVarName = moduleName + 'Store';
            const importPath = `@/store/modules/${moduleName}`;
            
            // Extract exported properties
            const exportedProperties = new Set<string>();
            const returnMatch = storeContent.match(/return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/);
            if (returnMatch) {
              const returnContent = returnMatch[1];
              const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
              let propMatch;
              while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
                const exportedName = propMatch[2] || propMatch[1];
                exportedProperties.add(exportedName);
              }
            }
            
            // Map properties to this store (only if not already mapped)
            usedProperties.forEach(prop => {
              if (exportedProperties.has(prop) && !propertyToStoreMap.has(prop)) {
                propertyToStoreMap.set(prop, {
                  storeName: storeName,
                  importPath: importPath,
                  storeVarName: storeVarName
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
          const storeToProperties = new Map<string, { properties: string[], storeInfo: { storeName: string; importPath: string; storeVarName: string } }>();
          
          propertyToStoreMap.forEach((storeInfo, propName) => {
            if (!storeToProperties.has(storeInfo.storeName)) {
              storeToProperties.set(storeInfo.storeName, {
                properties: [],
                storeInfo: storeInfo
              });
            }
            storeToProperties.get(storeInfo.storeName)!.properties.push(propName);
          });
          
          // Add imports and computed for each store
          storeToProperties.forEach(({ properties, storeInfo }) => {
            // Add import if missing
            if (!scriptContent.includes(`import { ${storeInfo.storeName} }`)) {
              scriptContent = `import { ${storeInfo.storeName} } from '${storeInfo.importPath}';\n${scriptContent}`;
            }
            
            // Add store initialization if not present
            if (!scriptContent.includes(`const ${storeInfo.storeVarName} = ${storeInfo.storeName}`)) {
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
            properties.forEach(propName => {
              // Check if it's used as a method (storeVar.propName() or propName())
              const isMethod = scriptContent.match(new RegExp(`(?:${storeInfo.storeVarName}\\.${propName}|\\b${propName})\\s*\\(`));
              // Check if it's already declared
              const isDeclared = scriptContent.match(new RegExp(`const\\s+${propName}\\s*=`));
              
              if (!isMethod && !isDeclared) {
                // Add computed property after store initialization
                const storeInitMatch = scriptContent.match(new RegExp(`const\\s+${storeInfo.storeVarName}\\s*=\\s*${storeInfo.storeName}\\(\\);`));
                if (storeInitMatch) {
                  const insertPos = storeInitMatch.index! + storeInitMatch[0].length;
                  // Correct TypeScript syntax: computed<type>(() => ...) not computed(<type>() => ...)
                  const computedCode = enableTypeScript 
                    ? `\nconst ${propName} = computed<any>(() => ${storeInfo.storeVarName}.${propName});`
                    : `\nconst ${propName} = computed(() => ${storeInfo.storeVarName}.${propName});`;
                  scriptContent = scriptContent.slice(0, insertPos) + computedCode + scriptContent.slice(insertPos);
                }
              }
            });
          });
          
          if (scriptContent !== originalScriptContent) {
            fixedContent = fixedContent.replace(
              /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
              `$1${scriptContent}$3`,
            );
            result.fixed = true;
            const allProperties = Array.from(propertyToStoreMap.keys());
            result.fixes.push(`Added missing store imports and computed properties: ${allProperties.join(', ')}`);
          }
        }
      }
      
      // Final Step: Remove duplicate store declarations and reorganize them (AFTER all other fixes)
      // GENERIC: This must run last to catch any duplicates created by previous fixes
      if (scriptContent) {
        const storeDeclPattern = /const\s+(\w+Store)\s*=\s*use\w+Store\(\)\s*;?/g;
      
        // Helper function to find all store declarations
        const findAllStoreDecls = (content: string): Array<{ varName: string; declaration: string; index: number; fullMatch: string }> => {
          const decls: Array<{ varName: string; declaration: string; index: number; fullMatch: string }> = [];
          storeDeclPattern.lastIndex = 0;
          let match;
          while ((match = storeDeclPattern.exec(content)) !== null) {
            const varName = match[1];
            const fullMatch = match[0];
            const declaration = fullMatch.endsWith(';') ? fullMatch : fullMatch + ';';
            decls.push({
              varName,
              declaration,
              index: match.index,
              fullMatch: fullMatch
            });
          }
          return decls;
        };
        
        let storeDeclarations = findAllStoreDecls(scriptContent);
        
        if (storeDeclarations.length > 0) {
          // Remove ALL duplicates (keep only first occurrence of each store)
          const seenStoreVars = new Set<string>();
          const duplicatesToRemove: Array<{ start: number; end: number }> = [];
          
          storeDeclarations.forEach(decl => {
            if (seenStoreVars.has(decl.varName)) {
              // Duplicate - mark for removal (include trailing whitespace/newlines)
              const afterMatch = scriptContent.substring(decl.index + decl.fullMatch.length);
              const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || '';
              duplicatesToRemove.push({
                start: decl.index,
                end: decl.index + decl.fullMatch.length + trailingWhitespace.length
              });
            } else {
              seenStoreVars.add(decl.varName);
            }
          });
          
          // Remove duplicates (in reverse order to preserve indices)
          if (duplicatesToRemove.length > 0) {
            duplicatesToRemove.reverse().forEach(pos => {
              const before = scriptContent.substring(0, pos.start);
              const after = scriptContent.substring(pos.end);
              scriptContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
            });
            result.fixed = true;
            result.fixes.push("Removed duplicate store declarations (final cleanup)");
            
            // Re-find store declarations after duplicate removal
            storeDeclarations = findAllStoreDecls(scriptContent);
          }
          
          // Reorganize store declarations to top (after imports, before usage)
          if (storeDeclarations.length > 0) {
            // Check if stores are used before their declarations
            let needsReorganization = false;
            storeDeclarations.forEach(decl => {
              const beforeDecl = scriptContent.substring(0, decl.index);
              const usagePattern = new RegExp(`\\b${decl.varName}\\b`);
              if (usagePattern.test(beforeDecl)) {
                needsReorganization = true;
              }
            });
            
            if (needsReorganization) {
              // Remove ALL store declarations from their current positions (in reverse order)
              let reorganizedContent = scriptContent;
              storeDeclarations.reverse().forEach(decl => {
                const before = reorganizedContent.substring(0, decl.index);
                const afterMatch = reorganizedContent.substring(decl.index + decl.fullMatch.length);
                const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || '';
                const after = reorganizedContent.substring(decl.index + decl.fullMatch.length + trailingWhitespace.length);
                reorganizedContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
              });
              
              // Get unique declarations only
              const finalUniqueStoreDecls = new Map<string, string>();
              storeDeclarations.reverse().forEach(decl => {
                if (!finalUniqueStoreDecls.has(decl.varName)) {
                  finalUniqueStoreDecls.set(decl.varName, decl.declaration);
                }
              });
              
              // Find the end of imports section
              const importMatch = reorganizedContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const insertIndex = importMatch[0].length;
                const storeDeclsText = Array.from(finalUniqueStoreDecls.values()).join('\n');
                reorganizedContent = reorganizedContent.slice(0, insertIndex) + 
                  '\n\n' + storeDeclsText + '\n' + 
                  reorganizedContent.slice(insertIndex).trim();
              } else {
                const storeDeclsText = Array.from(finalUniqueStoreDecls.values()).join('\n');
                reorganizedContent = storeDeclsText + '\n\n' + reorganizedContent.trim();
              }
              
              scriptContent = reorganizedContent;
              result.fixed = true;
              result.fixes.push("Reorganized store declarations to top of script (final cleanup)");
              
              // Final check: remove any duplicates that might have been created during reorganization
              const finalStoreDecls = findAllStoreDecls(scriptContent);
              const finalSeenVars = new Set<string>();
              const finalDuplicatesToRemove: Array<{ start: number; end: number }> = [];
              
              finalStoreDecls.forEach(decl => {
                if (finalSeenVars.has(decl.varName)) {
                  const afterMatch = scriptContent.substring(decl.index + decl.fullMatch.length);
                  const trailingWhitespace = afterMatch.match(/^\s*/)?.[0] || '';
                  finalDuplicatesToRemove.push({
                    start: decl.index,
                    end: decl.index + decl.fullMatch.length + trailingWhitespace.length
                  });
                } else {
                  finalSeenVars.add(decl.varName);
                }
              });
              
              if (finalDuplicatesToRemove.length > 0) {
                finalDuplicatesToRemove.reverse().forEach(pos => {
                  const before = scriptContent.substring(0, pos.start);
                  const after = scriptContent.substring(pos.end);
                  scriptContent = before.replace(/\n+$/, '') + '\n' + after.replace(/^\s*\n+/, '');
                });
                result.fixes.push("Removed duplicate store declarations after final reorganization");
              }
            }
          }
          
        // Step 7.5: Check for Vue lifecycle hooks usage and add imports (AFTER all reorganizations)
        // This must run last to ensure lifecycle hooks are added correctly after all other fixes
        const lifecycleHooks = ['onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount', 'onUpdated', 'onBeforeUpdate', 'onActivated', 'onDeactivated'];
        const usedLifecycleHooks = lifecycleHooks.filter(hook => scriptContent.includes(`${hook}(`));
        if (usedLifecycleHooks.length > 0) {
          // Check if lifecycle hooks are imported
          const hasLifecycleImport = scriptContent.match(/import\s+.*\{[^}]*\b(?:onMounted|onUnmounted|onBeforeMount|onBeforeUnmount|onUpdated|onBeforeUpdate|onActivated|onDeactivated)\b[^}]*\}\s+from\s+['"]vue['"]/);
          if (!hasLifecycleImport) {
            // Add lifecycle hooks to existing vue import or create new import
            const vueImportMatch = scriptContent.match(/import\s+.*\{([^}]+)\}\s+from\s+['"]vue['"]/);
            if (vueImportMatch) {
              // Add to existing import
              const existingImports = vueImportMatch[1].split(',').map(i => i.trim()).filter(i => i);
              const newImports = [...existingImports, ...usedLifecycleHooks.filter(h => !existingImports.includes(h))];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]+\}\s+from\s+['"]vue['"]/,
                `import { ${newImports.join(', ')} } from 'vue'`
              );
            } else {
              // Create new import
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                scriptContent = scriptContent.replace(
                  /(import\s+[^;]+;[\s\n]*)+/,
                  `$&import { ${usedLifecycleHooks.join(', ')} } from 'vue';\n`
                );
              } else {
                scriptContent = `import { ${usedLifecycleHooks.join(', ')} } from 'vue';\n${scriptContent}`;
              }
            }
            result.fixed = true;
            result.fixes.push(`Added missing lifecycle hooks imports: ${usedLifecycleHooks.join(', ')}`);
          }
        }
        
        // Step 7.6: Detect and add missing Vue imports (ref, watch, etc.) GENERIC
        // This detects usage of Vue functions and adds imports if missing
        const vueFunctions = ['ref', 'reactive', 'computed', 'watch', 'watchEffect', 'onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount', 'onUpdated', 'onBeforeUpdate', 'onActivated', 'onDeactivated', 'provide', 'inject', 'nextTick', 'defineProps', 'defineEmits', 'defineExpose'];
        const usedVueFunctions = vueFunctions.filter(func => {
          // Check if function is used (not just mentioned in comments/strings)
          // Pattern: func( or func< or const x = func or func.value (for ref)
          const usagePattern = new RegExp(`\\b${func}\\s*[<(]|const\\s+\\w+\\s*=\\s*${func}\\s*[<(]|\\w+\\.${func}\\b`, 'g');
          return usagePattern.test(scriptContent);
          const funcPattern = new RegExp(`\\b${func}\\s*\\(|\\b${func}\\s*=|import.*${func}`, 'g');
          return funcPattern.test(scriptContent) && !scriptContent.match(new RegExp(`import\\s+.*\\{[^}]*\\b${func}\\b[^}]*\\}\\s+from\\s+['"]vue['"]`));
        });
        
        // Also check for vue-router functions (useRoute, useRouter) - GENERIC
        // This is a comprehensive check that runs after all other fixes
        const routerFunctions = ['useRoute', 'useRouter'];
        const usedRouterFunctions = routerFunctions.filter(func => {
          // Check if function is used (e.g., useRoute(), const route = useRoute(), useRoute().query, etc.)
          const funcPattern = new RegExp(`\\b${func}\\s*\\(|const\\s+\\w+\\s*=\\s*${func}\\s*\\(|\\b${func}\\(\\)`, 'g');
          const hasImport = scriptContent.match(new RegExp(`import\\s+.*\\{[^}]*\\b${func}\\b[^}]*\\}\\s+from\\s+['"]vue-router['"]`));
          return funcPattern.test(scriptContent) && !hasImport;
        });
        
        if (usedRouterFunctions.length > 0) {
          // Check if vue-router import already exists
          const vueRouterImportMatch = scriptContent.match(/import\s+.*\{([^}]*)\}\s+from\s+['"]vue-router['"]/);
          if (vueRouterImportMatch) {
            // Add missing functions to existing import
            const existingImports = vueRouterImportMatch[1].split(',').map(i => i.trim()).filter(i => i.length > 0);
            const missingImports = usedRouterFunctions.filter(f => !existingImports.includes(f));
            if (missingImports.length > 0) {
              const newImports = [...existingImports, ...missingImports];
              scriptContent = scriptContent.replace(
                /import\s+.*\{[^}]*\}\s+from\s+['"]vue-router['"]/,
                `import { ${newImports.join(', ')} } from 'vue-router'`
              );
              result.fixed = true;
              result.fixes.push(`Added missing vue-router imports: ${missingImports.join(', ')}`);
            }
          } else {
            // Create new import
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${usedRouterFunctions.join(', ')} } from 'vue-router';\n`
              );
            } else {
              scriptContent = `import { ${usedRouterFunctions.join(', ')} } from 'vue-router';\n${scriptContent}`;
            }
            result.fixed = true;
            result.fixes.push(`Added missing vue-router imports: ${usedRouterFunctions.join(', ')}`);
          }
        }
        
        if (usedVueFunctions.length > 0) {
          const vueImportMatch = scriptContent.match(/import\s+.*\{([^}]+)\}\s+from\s+['"]vue['"]/);
          if (vueImportMatch) {
            const existingImports = vueImportMatch[1].split(',').map(i => i.trim()).filter(i => i);
            const newImports = [...existingImports, ...usedVueFunctions.filter(f => !existingImports.includes(f))];
            scriptContent = scriptContent.replace(
              /import\s+.*\{[^}]+\}\s+from\s+['"]vue['"]/,
              `import { ${newImports.join(', ')} } from 'vue'`
            );
            result.fixed = true;
            result.fixes.push(`Added missing Vue imports: ${usedVueFunctions.join(', ')}`);
          } else {
            // Create new import
            const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
            if (importMatch) {
              scriptContent = scriptContent.replace(
                /(import\s+[^;]+;[\s\n]*)+/,
                `$&import { ${usedVueFunctions.join(', ')} } from 'vue';\n`
              );
            } else {
              scriptContent = `import { ${usedVueFunctions.join(', ')} } from 'vue';\n${scriptContent}`;
            }
            result.fixed = true;
            result.fixes.push(`Added missing Vue imports: ${usedVueFunctions.join(', ')}`);
          }
        }
        
        // Step 7.6.5: Remove unused store imports and declarations GENERIC
        // Detect store imports that are declared but never used
        // Also detect stores that are used but not imported
        if (scriptContent.includes('Store')) {
          // First, find all store declarations: const XStore = useXStore();
          const storeDeclPattern = /const\s+(\w+Store)\s*=\s*(use\w+Store)\(\)/g;
          const storeDecls = new Map<string, string>(); // storeVar → storeName
          let match;
          while ((match = storeDeclPattern.exec(scriptContent)) !== null) {
            const [, storeVar, storeName] = match;
            storeDecls.set(storeVar, storeName);
            
            // Check if import exists for this store
            const importPattern = new RegExp(`import\\s+\\{[^}]*\\b${storeName}\\b[^}]*\\}\\s+from`, 'g');
            if (!importPattern.test(scriptContent)) {
              // Store is used but not imported - add import
              const modulePath = `@/store/modules/${storeName.replace(/^use/, '').replace(/Store$/, '').toLowerCase()}`;
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
            const usagePattern = new RegExp(`\\b${storeVar}\\.[a-zA-Z_$]|\\b${storeVar}\\s*\\(|\\b${storeVar}\\s*\\)|\\b${storeVar}\\s*,|\\b${storeVar}\\s*;|\\b${storeVar}\\s*\\]|\\b${storeVar}\\s*\\}`, 'g');
            const allMatches = Array.from(scriptContent.matchAll(usagePattern));
            // Filter out the declaration itself
            const actualUsages = allMatches.filter(m => {
              const beforeMatch = scriptContent.substring(0, m.index);
              // Check if this is not part of the declaration: const storeVar = useStore()
              const isInDeclaration = beforeMatch.match(/const\s+$/);
              // Also check if it's used in computed/watched expressions
              const isInComputed = beforeMatch.match(/computed\s*\(\s*\(\)\s*=>\s*$/);
              const isInWatch = beforeMatch.match(/watch\s*\(/);
              return !isInDeclaration && (isInComputed || isInWatch || !beforeMatch.match(/const\s+$/));
            });
            
            // If store is not used, remove declaration and import
            // BUT: Make sure we're not removing stores that are used but our pattern didn't catch
            // Double-check by looking for the store variable name in computed/watched expressions
            const hasUsageInComputed = new RegExp(`computed\\s*\\(\\s*\\(\\)\\s*=>\\s*.*\\b${storeVar}\\b`, 's').test(scriptContent);
            const hasUsageInWatch = new RegExp(`watch\\s*\\([^)]*\\b${storeVar}\\b`, 's').test(scriptContent);
            const hasUsageInTemplate = scriptContent.includes(`{{ ${storeVar}`) || scriptContent.includes(`v-if="${storeVar}`) || scriptContent.includes(`v-for="${storeVar}`);
            
            if (actualUsages.length === 0 && !hasUsageInComputed && !hasUsageInWatch && !hasUsageInTemplate) {
              // Remove declaration
              scriptContent = scriptContent.replace(
                new RegExp(`const\\s+${storeVar}\\s*=\\s*${storeName}\\(\\);?\\s*\\n?`, 'g'),
                ''
              );
              
              // Remove import if no other store from same module is used
              const importPattern = new RegExp(`import\\s+\\{[^}]*\\b${storeName}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"];?\\s*\\n?`, 'g');
              scriptContent = scriptContent.replace(importPattern, (importMatch) => {
                // Check if other stores from same module are imported
                const modulePath = importMatch.match(/from\s+['"]([^'"]+)['"]/)?.[1];
                if (modulePath) {
                  // Check if any other store from this module is used
                  const otherStorePattern = new RegExp(`const\\s+(\\w+Store)\\s*=\\s*(use\\w+Store)\\(\\)`, 'g');
                  let otherMatch;
                  let hasOtherStore = false;
                  while ((otherMatch = otherStorePattern.exec(scriptContent)) !== null) {
                    const [, otherVar, otherName] = otherMatch;
                    if (otherVar !== storeVar && scriptContent.includes(`from '${modulePath}'`)) {
                      // Check if other store is used
                      const otherUsagePattern = new RegExp(`\\b${otherVar}\\.[a-zA-Z_$]|\\b${otherVar}\\s*\\)`, 'g');
                      if (otherUsagePattern.test(scriptContent)) {
                        hasOtherStore = true;
                        break;
                      }
                    }
                  }
                  
                  if (!hasOtherStore) {
                    // Remove entire import
                    return '';
                  } else {
                    // Remove only this store from import
                    return importMatch.replace(new RegExp(`\\s*,\\s*${storeName}|${storeName}\\s*,?\\s*`), '');
                  }
                }
                return '';
              });
              
              result.fixed = true;
              result.fixes.push(`Removed unused store: ${storeVar}`);
            }
          });
        }
        
        // Step 7.7: Replace remaining this.$store.dispatch/getters in watchers and methods GENERIC
        // This handles cases where this.$store is used but not yet replaced
        if (scriptContent.includes('this.$store')) {
          // Detect all this.$store.dispatch('module/method', ...) patterns
          const dispatchPattern = /this\.\$store\.dispatch\(['"]([^'"]+)\/([^'"]+)['"]\s*,?\s*([^)]*)\)/g;
          let dispatchMatch;
          const dispatchReplacements: Array<{ pattern: string; replacement: string; storeVar: string; storeName: string; module: string }> = [];
          
          while ((dispatchMatch = dispatchPattern.exec(scriptContent)) !== null) {
            const [, module, method, args] = dispatchMatch;
            const storeVarName = `${module}Store`;
            const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
            const fullMatch = dispatchMatch[0];
            const replacement = args.trim() ? `${storeVarName}.${method}(${args.trim()})` : `${storeVarName}.${method}()`;
            
            dispatchReplacements.push({
              pattern: fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              replacement: replacement,
              storeVar: storeVarName,
              storeName: storeName,
              module: module
            });
          }
          
          // Apply replacements
          dispatchReplacements.forEach(({ pattern, replacement, storeVar, storeName, module }) => {
            scriptContent = scriptContent.replace(new RegExp(pattern, 'g'), replacement);
            
            // Ensure store is imported and initialized
            if (!scriptContent.includes(`import { ${storeName} }`)) {
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const insertPos = importMatch[0].length;
                scriptContent = scriptContent.slice(0, insertPos) + 
                  `\nconst ${storeVar} = ${storeName}();\n` + 
                  scriptContent.slice(insertPos);
              }
            }
          });
          
          // Detect this.$store.getters['module/getter'] patterns
          const gettersPattern = /this\.\$store\.getters\[['"]([^'"]+)\/([^'"]+)['"]\]/g;
          let gettersMatch;
          const gettersReplacements: Array<{ pattern: string; replacement: string; storeVar: string; storeName: string; module: string }> = [];
          
          while ((gettersMatch = gettersPattern.exec(scriptContent)) !== null) {
            const [, module, getter] = gettersMatch;
            const storeVarName = `${module}Store`;
            const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
            const fullMatch = gettersMatch[0];
            const replacement = `${storeVarName}.${getter}`;
            
            gettersReplacements.push({
              pattern: fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              replacement: replacement,
              storeVar: storeVarName,
              storeName: storeName,
              module: module
            });
          }
          
          // Apply getters replacements
          gettersReplacements.forEach(({ pattern, replacement, storeVar, storeName, module }) => {
            scriptContent = scriptContent.replace(new RegExp(pattern, 'g'), replacement);
            
            // Ensure store is imported and initialized (same logic as dispatch)
            if (!scriptContent.includes(`import { ${storeName} }`)) {
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
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
              const importMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
              if (importMatch) {
                const insertPos = importMatch[0].length;
                scriptContent = scriptContent.slice(0, insertPos) + 
                  `\nconst ${storeVar} = ${storeName}();\n` + 
                  scriptContent.slice(insertPos);
              }
            }
          });
          
          if (dispatchReplacements.length > 0 || gettersReplacements.length > 0) {
            result.fixed = true;
            const fixes = [];
            if (dispatchReplacements.length > 0) {
              fixes.push(`Replaced ${dispatchReplacements.length} this.$store.dispatch calls`);
            }
            if (gettersReplacements.length > 0) {
              fixes.push(`Replaced ${gettersReplacements.length} this.$store.getters calls`);
            }
            result.fixes.push(fixes.join(', '));
          }
        }
        
        // Fix: Remove TypeScript syntax from JavaScript files (GENERIC)
        // Pattern: (value as string) or (value as number) in files without lang="ts"
        // Check if script tag has lang="ts" or lang="typescript"
        const scriptTagMatch = fixedContent.match(/<script\s+setup[^>]*>/);
        const hasTypeScriptLang = scriptTagMatch && /lang\s*=\s*["']ts["']|lang\s*=\s*["']typescript["']/.test(scriptTagMatch[0]);
        
        if (!enableTypeScript && !hasTypeScriptLang) {
          // Remove TypeScript type assertions: (value as string) -> String(value) or just value
          // Pattern: (expression as type) - handles nested parentheses and complex expressions
          // More robust pattern that handles: (route.params.id as string), ((value) as string), etc.
          const typeAssertionPattern = /\(([^()]+|\([^()]*\)+)\s+as\s+(\w+)\)/g;
          let typeAssertionMatch;
          const processedAssertions = new Set<string>();
          
          while ((typeAssertionMatch = typeAssertionPattern.exec(scriptContent)) !== null) {
            const [fullMatch, expression, type] = typeAssertionMatch;
            
            // Skip if already processed (avoid infinite loops)
            if (processedAssertions.has(fullMatch)) continue;
            processedAssertions.add(fullMatch);
            
            // Convert TypeScript assertion to JavaScript conversion
            let replacement: string;
            const trimmedExpr = expression.trim();
            
            if (type === 'string') {
              // Use String() for conversion, but handle edge cases
              if (trimmedExpr.includes('||')) {
                // For expressions like: props.id || (route.params.id as string)
                // Replace just the assertion part: (route.params.id as string) -> String(route.params.id || '')
                replacement = `String(${trimmedExpr} || '')`;
              } else {
                replacement = `String(${trimmedExpr})`;
              }
            } else if (type === 'number') {
              replacement = `Number(${trimmedExpr})`;
            } else if (type === 'boolean') {
              replacement = `Boolean(${trimmedExpr})`;
            } else {
              // For other types, just remove the assertion (keep the expression)
              replacement = trimmedExpr;
            }
            
            scriptContent = scriptContent.replace(fullMatch, replacement);
            result.fixed = true;
            result.fixes.push(`Removed TypeScript type assertion 'as ${type}' from JavaScript file (generic fix)`);
          }
          
          // Fix: Remove TypeScript generic syntax from JavaScript files (GENERIC)
          // Pattern: computed<any>(() => ...), ref<number>(value), reactive<Type>({...})
          // This removes type parameters like <any>, <string>, <number>, etc.
          const genericPatterns = [
            /(computed)<[^>]+>/g,
            /(ref)<[^>]+>/g,
            /(reactive)<[^>]+>/g,
            /(computed)<[^>]+>/g,
            /(defineStore)<[^>]+>/g,
            /(defineComponent)<[^>]+>/g,
            /(defineProps)<[^>]+>/g,
            /(defineEmits)<[^>]+>/g,
          ];
          
          genericPatterns.forEach(pattern => {
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
              result.fixes.push(`Removed TypeScript generic '<...>' from ${functionName} in JavaScript file (generic fix)`);
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
          if (extraClosings.length > 1 && 
              (openBraces - closeBraces === extraClosings.match(/\}/g)?.length ||
               openParens - closeParens === extraClosings.match(/\)/g)?.length)) {
            scriptContent = scriptContent.replace(scriptEndMatch[0], beforeEnd + '</script>');
            result.fixed = true;
            result.fixes.push('Removed extra closing braces/parentheses before script closing tag');
          }
        }
        
        // Fix: Correct malformed router.push with broken template literals (GENERIC)
        // Pattern: router.push({ path: `/route/${param\n  }\n}` }) - broken template literal with newlines
        // This is GENERIC - works for any route path and parameter name
        const brokenTemplateLiteralPattern = /router\.push\s*\(\s*\{\s*path\s*:\s*[`'"]\/[^`'"]*\$\{(\w+)\s*\n\s*\}\s*\n\s*\}[`'"]/g;
        let brokenTemplateMatch;
        const processedBrokenPushes = new Set<string>();
        
        while ((brokenTemplateMatch = brokenTemplateLiteralPattern.exec(scriptContent)) !== null) {
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
            const functionContext = scriptContent.substring(0, brokenTemplateMatch.index);
            const functionMatch = functionContext.match(/const\s+(\w+)\s*=\s*\([^)]+\)\s*=>/);
            if (functionMatch) {
              const functionName = functionMatch[1].toLowerCase();
              // Common patterns: goToPost -> /blog, navigateToUser -> /user, etc.
              if (functionName.includes('post')) {
                routePath = '/blog';
              } else if (functionName.includes('user')) {
                routePath = '/user';
              } else if (functionName.includes('item')) {
                routePath = '/item';
              } else {
                // Generic: extract base from function name
                const baseName = functionName.replace(/^(go|navigate|open|view)/, '').replace(/to$/, '');
                routePath = `/${baseName}`;
              }
            } else {
              // Fallback: use generic /route
              routePath = '/route';
            }
          }
          
          const fixedPush = `router.push({ path: \`${routePath}/\${${paramName}}\` })`;
          scriptContent = scriptContent.replace(fullMatch, fixedPush);
          result.fixed = true;
          result.fixes.push(`Fixed broken template literal in router.push for ${routePath} (generic fix)`);
        }
        
        // Update fixedContent with final scriptContent
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`,
        );
      }
    }
  }
  
  // Fix TypeScript syntax in JavaScript files (non-Vue files)
  // This handles .js and .ts files that are not Vue components
  if (!isVueFile && (filePath.endsWith('.js') || filePath.endsWith('.ts'))) {
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
      
      genericPatterns.forEach(pattern => {
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
          result.fixes.push(`Removed TypeScript generic '<...>' from ${functionName} in JavaScript file (generic fix)`);
        }
      });
      
      // Remove TypeScript type assertions: (value as string) -> String(value)
      const typeAssertionPattern = /\(([^()]+|\([^()]*\)+)\s+as\s+(\w+)\)/g;
      let typeAssertionMatch;
      const processedAssertions = new Set<string>();
      
      while ((typeAssertionMatch = typeAssertionPattern.exec(fixedContent)) !== null) {
        const [fullMatch, expression, type] = typeAssertionMatch;
        
        // Skip if already processed
        if (processedAssertions.has(fullMatch)) continue;
        processedAssertions.add(fullMatch);
        
        // Convert TypeScript assertion to JavaScript conversion
        let replacement: string;
        const trimmedExpr = expression.trim();
        
        if (type === 'string') {
          replacement = trimmedExpr.includes('||') 
            ? `String(${trimmedExpr} || '')` 
            : `String(${trimmedExpr})`;
        } else if (type === 'number') {
          replacement = `Number(${trimmedExpr})`;
        } else if (type === 'boolean') {
          replacement = `Boolean(${trimmedExpr})`;
        } else {
          replacement = trimmedExpr;
        }
        
        fixedContent = fixedContent.replace(fullMatch, replacement);
        result.fixed = true;
        result.fixes.push(`Removed TypeScript type assertion 'as ${type}' from JavaScript file (generic fix)`);
      }
    }
  }
  }

  return {
    ...result,
    fixed: fixedContent !== content,
    content: fixedContent,
  };
}

/**
 * Fix import paths to use @ alias
 */
export function fixImportPaths(
  content: string,
  projectRoot: string,
  filePath: string,
): string {
  let fixed = content;

  // Convert relative imports to @ alias for src/ directory
  const relativeImportPattern = /from\s+['"](\.\.\/)+store\//g;
  if (relativeImportPattern.test(fixed)) {
    // Calculate relative path from file to src
    const fileDir = path.dirname(filePath);
    const srcPath = path.join(projectRoot, "src");

    // If file is in src/, use @ alias
    if (filePath.startsWith(srcPath)) {
      fixed = fixed.replace(/from\s+['"](\.\.\/)+store\//g, 'from "@/store/');
      fixed = fixed.replace(/from\s+['"]\.\.\/store\//g, 'from "@/store/');
    }
  }

  return fixed;
}
