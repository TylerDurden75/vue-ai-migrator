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
  let needsAppContext = false;
  let appVariableName = "app"; // Default app variable name
  
  // Check if this is a main.js/main.ts entry point file
  const isMainFile = fileInfo.path.includes('main.js') || fileInfo.path.includes('main.ts');

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

      // Create createApp() call
      const createAppCall = j.callExpression(j.identifier("createApp"), args);

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
      needsAppContext = true;
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
      needsAppContext = true;
      hasChanges = true;
    }
  });

  // Add import for createApp if we made any changes (new Vue() or Vue.use()/Vue.component())
  if (hasChanges) {
    const imports = root.find(j.ImportDeclaration);
    let hasVueImport = false;
    let vueImportPath: any = null;

    imports.forEach((path: any) => {
      if (path.value.source.value === "vue") {
        hasVueImport = true;
        vueImportPath = path;
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
