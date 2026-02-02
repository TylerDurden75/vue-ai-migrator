import { Transform, FileInfo, API } from "jscodeshift";

/**
 * Transforms Vue 2 global API to Vue 3
 * new Vue() → createApp()
 * Vue.use() → app.use()
 * Vue.component() → app.component()
 * Vue.directive() → app.directive()
 */
export const pluginsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;
  let appVariableName = "app"; // Default app variable name

  // Check if this is a main.js/main.ts entry point file
  const isMainFile =
    fileInfo.path.includes("main.js") || fileInfo.path.includes("main.ts");

  // Transform new Vue() → createApp()
  root.find(j.NewExpression).forEach((path: any) => {
    const callee = path.value.callee;

    if (callee.type === "Identifier" && callee.name === "Vue") {
      hasChanges = true;

      // Get the arguments passed to new Vue()
      const args = path.value.arguments || [];

      // Find the parent statement to replace
      const parent = path.parent;

      // Check if this is: new Vue({ ... }).$mount('#app')
      let mountCallPath: any = null;

      if (
        parent &&
        parent.value.type === "MemberExpression" &&
        parent.value.property &&
        parent.value.property.name === "$mount"
      ) {
        // Check if there's a call to $mount
        const mountParent = parent.parent;
        if (
          mountParent &&
          mountParent.value.type === "CallExpression" &&
          mountParent.value.callee === parent.value
        ) {
          mountCallPath = mountParent;
        }
      }

      // Remove 'store' property from options if present (Vuex → Pinia migration)
      let filteredArgs = args;
      if (args.length > 0 && args[0].type === "ObjectExpression") {
        const options = args[0];
        const properties = options.properties || [];
        const storeProperty = properties.find(
          (p: any) =>
            p.key && (p.key.name === "store" || p.key.value === "store"),
        );
        if (storeProperty) {
          // Remove store property
          options.properties = properties.filter(
            (p: any) => p !== storeProperty,
          );
          filteredArgs = [options];
        }
      }

      // Create createApp() call
      const createAppCall = j.callExpression(
        j.identifier("createApp"),
        filteredArgs,
      );

      // If there was a $mount call, replace the entire chain
      if (mountCallPath) {
        // Replace: new Vue({ ... }).$mount('#app') → createApp({ ... }).mount('#app')
        const mountCallExpr = j.callExpression(
          j.memberExpression(createAppCall, j.identifier("mount")),
          mountCallPath.value.arguments,
        );

        // Find the statement containing the mount call
        let statement = mountCallPath;
        while (
          statement &&
          statement.value.type !== "ExpressionStatement" &&
          statement.value.type !== "VariableDeclarator"
        ) {
          statement = statement.parent;
        }

        if (statement && statement.value.type === "ExpressionStatement") {
          j(statement).replaceWith(j.expressionStatement(mountCallExpr));
        } else {
          // Replace the CallExpression directly
          j(mountCallPath).replaceWith(mountCallExpr);
        }
      } else {
        // Check if this is assigned to a variable: const app = new Vue()
        const parentPath = path.parent;
        if (
          parentPath &&
          parentPath.value.type === "VariableDeclarator" &&
          parentPath.value.id &&
          parentPath.value.id.type === "Identifier"
        ) {
          // Use the existing variable name
          appVariableName = parentPath.value.id.name;
          // Replace new Vue() with createApp()
          j(path).replaceWith(createAppCall);
        } else {
          // Replace new Vue() with createApp() and assign to app
          const appVar = j.variableDeclaration("const", [
            j.variableDeclarator(j.identifier(appVariableName), createAppCall),
          ]);

          // Find the statement containing new Vue()
          let statement = path;
          while (statement && statement.value.type !== "ExpressionStatement") {
            statement = statement.parent;
          }

          if (statement) {
            j(statement).replaceWith(appVar);
          } else {
            // Fallback: just replace new Vue() with createApp()
            j(path).replaceWith(createAppCall);
          }
        }
      }
    }
  });

  // Transform Vue.use() calls
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;

    if (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "Vue" &&
      callee.property.type === "Identifier" &&
      ["use", "component", "directive", "mixin", "config"].includes(
        callee.property.name,
      )
    ) {
      // These need to be called on the app instance
      // Vue.use(plugin) → app.use(plugin)
      // We'll mark them and suggest app context
      hasChanges = true;

      // Try to find if there's an app variable nearby
      // If not, we'll need to create one or use AI
      const parent = path.parent;
      if (parent && parent.value.type === "Program") {
        // At top level, we can suggest creating app
        // For now, just mark for AI processing
      }
    }
  });

  // Transform Vue.component() global registration
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;

    if (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "Vue" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "component"
    ) {
      // Vue.component('name', Component) → app.component('name', Component)
      // This requires app context
      hasChanges = true;
    }
  });

  // After transforming new Vue() to createApp(), remove store from options (Pinia doesn't need it)
  if (hasChanges) {
    root.find(j.ObjectExpression).forEach((path: any) => {
      // Check if this object is passed to createApp()
      const parent = path.parent;
      if (
        parent &&
        parent.value &&
        parent.value.type === "CallExpression" &&
        parent.value.callee &&
        parent.value.callee.type === "Identifier" &&
        parent.value.callee.name === "createApp"
      ) {
        if (path.value.properties) {
          // Create a new array without the store property
          const filteredProperties = path.value.properties.filter(
            (prop: any) => {
              return !(
                prop.key &&
                prop.key.name === "store" &&
                prop.value &&
                prop.value.type === "Identifier"
              );
            },
          );

          if (filteredProperties.length !== path.value.properties.length) {
            path.value.properties = filteredProperties;
            hasChanges = true;
          }
        }
      }
    });
  }

  // Remove Vue.config.* statements (Vue 2 specific)
  root.find(j.MemberExpression).forEach((path: any) => {
    if (
      path.value.object &&
      path.value.object.type === "Identifier" &&
      path.value.object.name === "Vue" &&
      path.value.property &&
      path.value.property.type === "Identifier" &&
      path.value.property.name === "config"
    ) {
      // Find the parent statement (e.g., Vue.config.productionTip = false)
      let currentPath: any = path;
      while (currentPath && currentPath.parent) {
        const parentValue = currentPath.parent.value;
        if (
          parentValue &&
          (parentValue.type === "ExpressionStatement" ||
            parentValue.type === "AssignmentExpression")
        ) {
          // Remove the entire statement
          if (parentValue.type === "ExpressionStatement") {
            j(currentPath.parent).remove();
            hasChanges = true;
            break;
          } else if (parentValue.type === "AssignmentExpression") {
            // Find the statement containing this assignment
            let assignmentPath = currentPath.parent;
            while (assignmentPath && assignmentPath.parent) {
              if (assignmentPath.parent.value?.type === "ExpressionStatement") {
                j(assignmentPath.parent).remove();
                hasChanges = true;
                break;
              }
              assignmentPath = assignmentPath.parent;
            }
            break;
          }
        }
        currentPath = currentPath.parent;
      }
    }
  });

  // Check if Pinia store is imported (for main.js initialization)
  let hasPiniaStoreImport = false;
  let hasPiniaImport = false;
  let storeVariableName = "store";

  if (isMainFile) {
    root.find(j.ImportDeclaration).forEach((path: any) => {
      const source = path.value.source.value;

      // Check for store import (could be from './store' or './store/index')
      if (
        typeof source === "string" &&
        (source.includes("store") || source.includes("Store"))
      ) {
        hasPiniaStoreImport = true;
        // Get the imported variable name
        const specifiers = path.value.specifiers || [];
        if (specifiers.length > 0) {
          const firstSpec = specifiers[0];
          if (firstSpec.local && firstSpec.local.name) {
            storeVariableName = firstSpec.local.name;
          } else if (firstSpec.imported && firstSpec.imported.name) {
            storeVariableName = firstSpec.imported.name;
          }
        }
      }

      // Check if Pinia is already imported
      if (source === "pinia") {
        hasPiniaImport = true;
      }
    });

    // Check if store is used in new Vue() or createApp() (Vuex pattern that needs to be removed)
    // This will be handled after new Vue() is transformed to createApp()
    let storeUsedInCreateApp = false;
    root.find(j.ObjectExpression).forEach((path: any) => {
      if (path.value.properties) {
        path.value.properties.forEach((prop: any) => {
          if (
            prop.key &&
            prop.key.name === "store" &&
            prop.value &&
            prop.value.type === "Identifier" &&
            prop.value.name === storeVariableName
          ) {
            storeUsedInCreateApp = true;
          }
        });
      }
    });

    // If we have a store import, we need to initialize Pinia
    if (hasPiniaStoreImport || storeUsedInCreateApp) {
      // Check if createPinia is already called
      let piniaAlreadyInitialized = false;
      root.find(j.CallExpression).forEach((path: any) => {
        if (
          path.value.callee &&
          path.value.callee.type === "Identifier" &&
          path.value.callee.name === "createPinia"
        ) {
          piniaAlreadyInitialized = true;
        }
      });

      if (!piniaAlreadyInitialized) {
        // Add createPinia import
        if (!hasPiniaImport) {
          const piniaImport = j.importDeclaration(
            [j.importSpecifier(j.identifier("createPinia"))],
            j.literal("pinia"),
          );
          const program = root.get().node.program;
          if (program && program.body) {
            // Insert after Vue imports
            const vueImportIndex = program.body.findIndex((stmt: any) => {
              return (
                stmt.type === "ImportDeclaration" && stmt.source.value === "vue"
              );
            });
            if (vueImportIndex >= 0) {
              program.body.splice(vueImportIndex + 1, 0, piniaImport);
            } else {
              program.body.unshift(piniaImport);
            }
          }
          hasChanges = true;
        } else {
          // Add createPinia to existing Pinia import
          root.find(j.ImportDeclaration).forEach((path: any) => {
            if (path.value.source.value === "pinia") {
              const specifiers = path.value.specifiers || [];
              const hasCreatePinia = specifiers.some(
                (s: any) =>
                  (s.imported && s.imported.name === "createPinia") ||
                  s.local?.name === "createPinia",
              );
              if (!hasCreatePinia) {
                specifiers.push(j.importSpecifier(j.identifier("createPinia")));
                path.value.specifiers = specifiers;
                hasChanges = true;
              }
            }
          });
        }

        // Find createApp call and add app.use(createPinia())
        // Handle both cases: const app = createApp() and createApp().mount()
        let appVarName = appVariableName;
        let needsAppVariable = false;
        let mountCallPath: any = null;

        root.find(j.CallExpression).forEach((path: any) => {
          if (
            path.value.callee &&
            path.value.callee.type === "Identifier" &&
            path.value.callee.name === "createApp"
          ) {
            // Check if createApp is assigned to a variable
            if (
              path.parent &&
              path.parent.value.type === "VariableDeclarator" &&
              path.parent.value.id &&
              path.parent.value.id.type === "Identifier"
            ) {
              appVarName = path.parent.value.id.name;
            } else if (
              path.parent &&
              path.parent.value.type === "MemberExpression" &&
              path.parent.value.property &&
              path.parent.value.property.name === "mount"
            ) {
              // createApp({...}).mount() - need to extract to variable
              needsAppVariable = true;
              mountCallPath = path.parent.parent; // The mount() call
            }
          }
        });

        // If createApp().mount() pattern, transform to const app = createApp(); app.use(...); app.mount()
        if (needsAppVariable && mountCallPath) {
          const createAppCall = mountCallPath.value.callee.object;
          const mountArgs = mountCallPath.value.arguments || [];

          // Create: const app = createApp({...})
          const appVar = j.variableDeclaration("const", [
            j.variableDeclarator(j.identifier(appVarName), createAppCall),
          ]);

          // Create: app.use(createPinia())
          const piniaUseCall = j.expressionStatement(
            j.callExpression(
              j.memberExpression(j.identifier(appVarName), j.identifier("use")),
              [j.callExpression(j.identifier("createPinia"), [])],
            ),
          );

          // Create: app.mount(...)
          const mountCall = j.expressionStatement(
            j.callExpression(
              j.memberExpression(
                j.identifier(appVarName),
                j.identifier("mount"),
              ),
              mountArgs,
            ),
          );

          // Replace the entire statement
          const parentStmt = mountCallPath.parent;
          if (parentStmt && parentStmt.value.type === "ExpressionStatement") {
            const program = root.get().node.program;
            const stmtIndex = program.body.indexOf(parentStmt.value);
            if (stmtIndex >= 0) {
              // Replace with: const app = ...; app.use(...); app.mount(...)
              program.body[stmtIndex] = appVar;
              program.body.splice(stmtIndex + 1, 0, piniaUseCall);
              program.body.splice(stmtIndex + 2, 0, mountCall);
            }
            hasChanges = true;
          }
        } else {
          // createApp is already assigned to a variable, just add app.use(createPinia())
          const program = root.get().node.program;
          const statements = program.body || [];

          // Find the statement with createApp
          let createAppStatementIndex = -1;
          statements.forEach((stmt: any, index: number) => {
            const stmtCode = j(stmt).toSource();
            if (
              stmtCode.includes(`const ${appVarName}`) ||
              stmtCode.includes(`let ${appVarName}`) ||
              stmtCode.includes(`var ${appVarName}`)
            ) {
              createAppStatementIndex = index;
            }
          });

          if (createAppStatementIndex >= 0) {
            // Check if app.use(createPinia()) is already called
            let hasPiniaUse = false;
            root.find(j.CallExpression).forEach((usePath: any) => {
              if (
                usePath.value.callee &&
                usePath.value.callee.type === "MemberExpression" &&
                usePath.value.callee.object &&
                usePath.value.callee.object.type === "Identifier" &&
                usePath.value.callee.object.name === appVarName &&
                usePath.value.callee.property &&
                usePath.value.callee.property.type === "Identifier" &&
                usePath.value.callee.property.name === "use"
              ) {
                // Check if it's createPinia
                if (
                  usePath.value.arguments &&
                  usePath.value.arguments.length > 0 &&
                  usePath.value.arguments[0] &&
                  usePath.value.arguments[0].type === "CallExpression" &&
                  usePath.value.arguments[0].callee &&
                  usePath.value.arguments[0].callee.type === "Identifier" &&
                  usePath.value.arguments[0].callee.name === "createPinia"
                ) {
                  hasPiniaUse = true;
                }
              }
            });

            if (!hasPiniaUse) {
              // Add app.use(createPinia()) after createApp statement
              const piniaUseCall = j.expressionStatement(
                j.callExpression(
                  j.memberExpression(
                    j.identifier(appVarName),
                    j.identifier("use"),
                  ),
                  [j.callExpression(j.identifier("createPinia"), [])],
                ),
              );

              // Insert after createApp statement
              program.body.splice(createAppStatementIndex + 1, 0, piniaUseCall);
              hasChanges = true;
            }
          }
        }
      }
    }
  }

  // Add import for createApp if we made any changes (new Vue() or Vue.use()/Vue.component())
  if (hasChanges) {
    const imports = root.find(j.ImportDeclaration);
    let hasVueImport = false;

    imports.forEach((path: any) => {
      if (path.value.source.value === "vue") {
        hasVueImport = true;
        const specifiers = path.value.specifiers || [];

        // Check if it's a default import: import Vue from 'vue'
        const hasDefaultImport = specifiers.some(
          (s: any) => s.type === "ImportDefaultSpecifier",
        );

        const hasCreateApp = specifiers.some(
          (s: any) =>
            (s.imported && s.imported.name === "createApp") ||
            s.local?.name === "createApp",
        );

        if (!hasCreateApp) {
          // If there's a default import and we're transforming new Vue(), we can replace it
          // or add createApp as a named import
          if (hasDefaultImport && isMainFile) {
            // For main files, replace default import with createApp
            // Keep other named imports if any
            const namedImports = specifiers.filter(
              (s: any) => s.type === "ImportSpecifier",
            );
            namedImports.push(j.importSpecifier(j.identifier("createApp")));
            path.value.specifiers = namedImports;
          } else {
            // Just add createApp to existing imports
            specifiers.push(j.importSpecifier(j.identifier("createApp")));
            path.value.specifiers = specifiers;
          }
        }
      }
    });

    if (!hasVueImport) {
      const importStatement = j.importDeclaration(
        [j.importSpecifier(j.identifier("createApp"))],
        j.literal("vue"),
      );
      root.get().node.program.body.unshift(importStatement);
    }
  }

  return hasChanges ? root.toSource() : fileInfo.source;
};
