import * as fs from "fs/promises";
import * as path from "path";

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
        // Match return statement that closes the defineStore function
        const returnMatch = storeContent.match(/return\s*\{([\s\S]+?)\}\s*;?\s*\}\)/);
        if (!returnMatch) {
          // Try simpler pattern: return { ... };
          const simpleReturnMatch = storeContent.match(/return\s*\{([\s\S]+?)\}\s*;/);
          if (simpleReturnMatch) {
            const returnContent = simpleReturnMatch[1];
            
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
        } else {
          const returnContent = returnMatch[1];
          
          // Extract property names from return object
          const propertyPattern = /(\w+)(?:\s*:\s*(\w+))?/g;
          let propMatch;
          while ((propMatch = propertyPattern.exec(returnContent)) !== null) {
            const exportedName = propMatch[2] || propMatch[1];
            const internalName = propMatch[1];
            
            if (!['ref', 'reactive', 'computed', 'watch', 'onMounted', 'onUnmounted', 'undefined', 'null'].includes(exportedName)) {
              methodToStoreMap.set(exportedName, moduleName);
              if (internalName !== exportedName) {
                methodToStoreMap.set(internalName, moduleName);
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

    // Remove store from createApp options (legacy pattern)
    const storeInAppPattern =
      /(const\s+app\s*=\s*createApp\([^)]*),\s*store\s*([^)]*\))/;
    if (storeInAppPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(storeInAppPattern, "$1$2");
      result.fixed = true;
      result.fixes.push("Removed store from createApp options");
    }
  }

  // Fix 6: Fix router navigation guards that use router.app.$store
  // Pattern: router.app.$store.getters['module/getter'] or router.app.$store.getters['user/isAuthenticated']
  // Transform to: useUserStore().isAuthenticated
  if (filePath.includes("router") || filePath.includes("Router")) {
    const routerStorePattern =
      /router\.app\.\$store\.(getters|dispatch|state)\[['"]([^'"]+)['"]\]/g;
    const matches = Array.from(fixedContent.matchAll(routerStorePattern));
    
    if (matches.length > 0) {
      const scriptMatch = fixedContent.match(
        /<script[^>]*>([\s\S]*?)<\/script>/,
      ) || fixedContent.match(/^([\s\S]*)$/); // For .js files
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        const originalScriptContent = scriptContent;
        const storesToImport = new Map<string, string>(); // module name → store name
        
        matches.forEach((match) => {
          const [, type, path] = match;
          // Extract module name from path like 'user/isAuthenticated' or 'user'
          const parts = path.split('/');
          let moduleName: string;
          let propertyName: string;
          
          if (parts.length === 2) {
            // Pattern: 'user/isAuthenticated'
            [moduleName, propertyName] = parts;
          } else {
            // Pattern: 'isAuthenticated' - try to infer module from property name
            propertyName = parts[0];
            // Common patterns: isAuthenticated, currentUser → user module
            if (propertyName.includes('user') || propertyName.includes('auth') || propertyName.includes('login')) {
              moduleName = 'user';
            } else if (propertyName.includes('product')) {
              moduleName = 'products';
            } else {
              moduleName = 'user'; // Default fallback
            }
          }
          
          // Determine store name: 'user' → 'useUserStore'
          const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
          storesToImport.set(moduleName, storeName);
          
          // Replace router.app.$store.getters['module/prop'] with store().prop
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
            
            // Initialize store if not already done
            const storeVarName = `${moduleName}Store`;
            const initPattern = new RegExp(`const\\s+${storeVarName}\\s*=`, 'g');
            if (!initPattern.test(scriptContent)) {
              // Add store initialization before router.beforeEach
              const initLine = `const ${storeVarName} = ${storeName}();\n\n`;
              const beforeEachMatch = scriptContent.match(/router\.beforeEach/);
              if (beforeEachMatch) {
                const index = scriptContent.indexOf('router.beforeEach');
                scriptContent = scriptContent.substring(0, index) + 
                              initLine + 
                              scriptContent.substring(index);
              } else {
                // Add at the end before export
                scriptContent = scriptContent.replace(/export\s+default/, `${initLine}export default`);
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
  if (isVueFile && fixedContent.includes("<script setup")) {
    const scriptSetupMatch = fixedContent.match(
      /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
    );
    if (scriptSetupMatch) {
      let scriptContent = scriptSetupMatch[1];
      const originalScriptContent = scriptContent;

      // Detect store method calls that need store initialization
      // Pattern: this.userById(...) where userById is a store getter
      // We need to detect which store to use based on the method name
      const storeMethodPatterns = [
        // Auth store methods
        {
          pattern: /this\.(login|logout|isAuthenticated|currentUser)/g,
          store: "useAuthStore",
        },
        // Users store methods
        {
          pattern: /this\.(fetchUsers|allUsers|isLoading|userById)/g,
          store: "useUsersStore",
        },
      ];

      const storesToImport = new Set<string>();

      storeMethodPatterns.forEach(({ pattern, store }) => {
        if (pattern.test(scriptContent)) {
          storesToImport.add(store);

          // Replace this.methodName with store().methodName
          scriptContent = scriptContent.replace(
            pattern,
            (match, methodName) => {
              const storeVarName =
                store.replace("use", "").replace("Store", "").toLowerCase() +
                "Store";
              return `${storeVarName}.${methodName}`;
            },
          );
        }
      });

      // Add store imports and initialization if needed
      if (storesToImport.size > 0 && scriptContent !== originalScriptContent) {
        // Check if stores are already imported
        storesToImport.forEach((storeName) => {
          const storeVarName =
            storeName.replace("use", "").replace("Store", "").toLowerCase() +
            "Store";
          const importPath =
            storeName === "useAuthStore"
              ? "@/store/modules/auth"
              : "@/store/modules/users";

          // Add import if not present
          if (!scriptContent.includes(`import { ${storeName} }`)) {
            scriptContent = `import { ${storeName} } from '${importPath}';\n${scriptContent}`;
          }

          // Add store initialization if not present
          if (!scriptContent.includes(`const ${storeVarName} = ${storeName}`)) {
            scriptContent = `${scriptContent}\nconst ${storeVarName} = ${storeName}();`;
          }
        });
      }

      if (scriptContent !== originalScriptContent) {
        fixedContent = fixedContent.replace(
          /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
          `$1${scriptContent}$3`,
        );
        result.fixed = true;
        result.fixes.push("Fixed store method calls in <script setup>");
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
      
      // Try to get dynamic store map from analysis, fallback to hardcoded map
      let storeMethodMap: Record<string, string> = {};
      
      // Fallback hardcoded map for common patterns (used if analysis fails)
      const fallbackStoreMethodMap: Record<string, string> = {
        // Products store
        'fetchProducts': 'products',
        'deleteProduct': 'products',
        'addProduct': 'products',
        'updateProduct': 'products',
        'filteredProducts': 'products',
        'allProducts': 'products',
        'setFilter': 'products',
        'isLoading': 'products',
        // User store
        'login': 'user',
        'logout': 'user',
        'addUser': 'user',
        'removeUser': 'user',
        'currentUser': 'user',
        'isAuthenticated': 'user',
        'users': 'user',
        'userCount': 'user',
      };
      
      // Try to analyze stores dynamically if projectRoot is provided
      if (projectRoot) {
        // Use cache if available and for same project
        if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
          try {
            storeAnalysisCache = await analyzePiniaStores(projectRoot);
            storeAnalysisProjectRoot = projectRoot;
          } catch (error) {
            // If analysis fails, use fallback
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
      
      // Merge with fallback map (fallback takes precedence if conflict, but dynamic should have more entries)
      storeMethodMap = { ...fallbackStoreMethodMap, ...storeMethodMap };
      
      // Find all store method/getter calls
      const usedMethods = new Set<string>();
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

  // Fix 8: Add missing Pinia store imports and initializations in <script setup>
  // This handles components that were converted to <script setup> but are missing store setup
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

      // Common store method/state patterns
      const storePatterns = [
        {
          pattern: /isAuthenticated|currentUser|login|logout/g,
          store: "useAuthStore",
          module: "auth",
        },
        {
          pattern: /allUsers|isLoading|fetchUsers|userById/g,
          store: "useUsersStore",
          module: "users",
        },
      ];

      const storesToAdd = new Set<string>();

      storePatterns.forEach(({ pattern, store, module }) => {
        if (pattern.test(templateContent) || pattern.test(scriptContent)) {
          // Check if store is already imported/initialized
          const hasStoreImport = scriptContent.includes(`import { ${store} }`);
          const hasStoreInit = scriptContent.includes(`${module}Store`);

          if (!hasStoreImport || !hasStoreInit) {
            storesToAdd.add(JSON.stringify({ store, module }));
          }
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

        // Add computed imports if needed
        if (
          (templateContent.includes("isAuthenticated") ||
            templateContent.includes("currentUser") ||
            templateContent.includes("allUsers") ||
            templateContent.includes("isLoading")) &&
          !scriptContent.includes("import { computed }")
        ) {
          newImports += "import { computed } from 'vue';\n";
        }

        // Add store getters/actions that are used in template but not defined
        storePatterns.forEach(({ pattern, store, module }) => {
          const storeVarName = module + "Store";

          // Check for isAuthenticated, currentUser
          if (module === "auth") {
            if (
              templateContent.includes("isAuthenticated") &&
              !scriptContent.includes("const isAuthenticated")
            ) {
              if (enableTypeScript) {
                newInits += `const isAuthenticated = computed<boolean>(() => ${storeVarName}.isAuthenticated);\n`;
              } else {
                newInits += `const isAuthenticated = computed(() => ${storeVarName}.isAuthenticated);\n`;
              }
            }
            if (
              templateContent.includes("currentUser") &&
              !scriptContent.includes("const currentUser")
            ) {
              if (enableTypeScript) {
                newInits += `const currentUser = computed<{ name: string; email: string } | null>(() => ${storeVarName}.currentUser);\n`;
              } else {
                newInits += `const currentUser = computed(() => ${storeVarName}.currentUser);\n`;
              }
            }
            if (
              (templateContent.includes('@click="handleLogin"') ||
                scriptContent.includes("handleLogin")) &&
              !scriptContent.includes("const login")
            ) {
              newInits += `const login = ${storeVarName}.login;\n`;
            }
            if (
              (templateContent.includes('@click="handleLogout"') ||
                scriptContent.includes("handleLogout")) &&
              !scriptContent.includes("const logout")
            ) {
              newInits += `const logout = ${storeVarName}.logout;\n`;
            }
          }

          // Check for allUsers, isLoading, fetchUsers
          if (module === "users") {
            if (
              templateContent.includes("allUsers") &&
              !scriptContent.includes("const allUsers")
            ) {
              if (enableTypeScript) {
                newInits += `const allUsers = computed<Array<{ id: number; name: string; email: string; role: string }>>(() => ${storeVarName}.allUsers);\n`;
              } else {
                newInits += `const allUsers = computed(() => ${storeVarName}.allUsers);\n`;
              }
            }
            if (
              templateContent.includes("isLoading") &&
              !scriptContent.includes("const isLoading")
            ) {
              if (enableTypeScript) {
                newInits += `const isLoading = computed<boolean>(() => ${storeVarName}.isLoading);\n`;
              } else {
                newInits += `const isLoading = computed(() => ${storeVarName}.isLoading);\n`;
              }
            }
            if (
              (templateContent.includes('@click="fetchUsers"') ||
                scriptContent.includes("fetchUsers")) &&
              !scriptContent.includes("const fetchUsers")
            ) {
              if (enableTypeScript) {
                newInits += `const fetchUsers = (): Promise<void> => ${storeVarName}.fetchUsers();\n`;
              } else {
                newInits += `const fetchUsers = ${storeVarName}.fetchUsers;\n`;
              }
            }
            if (
              scriptContent.includes("userById") &&
              !scriptContent.includes("const userById")
            ) {
              if (enableTypeScript) {
                newInits += `const userById = (id: string | number): { id: number; name: string; email: string; role: string } | undefined => ${storeVarName}.userById(id);\n`;
              } else {
                newInits += `const userById = ${storeVarName}.userById;\n`;
              }
            }
          }
        });

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
