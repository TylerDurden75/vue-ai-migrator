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
export async function fixPostMigrationIssues(
  filePath: string,
  content: string,
  enableTypeScript: boolean = false,
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

    // Fix 2: Remove this. references in <script setup>
    // In <script setup>, this. references should be removed as they don't work
    if (fixedContent.includes("<script setup")) {
      const scriptSetupMatch = fixedContent.match(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
      );
      if (scriptSetupMatch) {
        let scriptContent = scriptSetupMatch[1];
        const originalScriptContent = scriptContent;

        // Remove this. references (but keep this.$router, this.$route, etc.)
        // Pattern: this.methodName() or this.property

        // First, replace this.methodName() with just methodName()
        // This handles cases like: this.login() → login()
        scriptContent = scriptContent.replace(
          /this\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
          (match, methodName) => {
            // Don't replace Vue router/route special properties
            if (
              methodName === "$router" ||
              methodName === "$route" ||
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
          result.fixes.push("Removed this. references from <script setup>");
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

  // Fix 5: Remove store import from main.js if it exists
  if (filePath.includes("main.js") || filePath.includes("main.ts")) {
    // Remove import store from "./store"
    const storeImportPattern =
      /import\s+store\s+from\s+['"]\.\/store['"];?\n?/g;
    if (storeImportPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(storeImportPattern, "");
      result.fixed = true;
      result.fixes.push("Removed store import from main.js");
    }

    // Remove store from createApp options
    const storeInAppPattern =
      /(const\s+app\s*=\s*createApp\([^)]*),\s*store\s*([^)]*\))/;
    if (storeInAppPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(storeInAppPattern, "$1$2");
      result.fixed = true;
      result.fixes.push("Removed store from createApp options");
    }
  }

  // Fix 6: Fix router navigation guards that use router.app.$store
  // Pattern: router.app.$store.getters[...] or router.app.$store.dispatch(...)
  const routerStorePattern =
    /router\.app\.\$store\.(getters|dispatch|state)\[([^\]]+)\]/g;
  if (routerStorePattern.test(fixedContent)) {
    result.issues.push(
      "Found router.app.$store references - these need manual migration to Pinia stores",
    );
    // We can't automatically fix this without knowing which store to use
    // But we can at least detect it
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
