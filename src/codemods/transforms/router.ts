import { Transform, FileInfo, API } from "jscodeshift";

/**
 * Transforms Vue Router 3 to Vue Router 4
 * Key changes:
 * - new Router() → createRouter()
 * - mode: 'history' → history: createWebHistory()
 * - base option → history: createWebHistory({ base: '...' })
 * - router-link/router-view props changes
 */
export const routerTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;

  // Remove Vue.use(VueRouter) calls
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    if (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "Vue" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "use" &&
      path.value.arguments.length > 0 &&
      path.value.arguments[0].type === "Identifier" &&
      path.value.arguments[0].name === "VueRouter"
    ) {
      // Remove the entire statement
      let statement = path.parent;
      // Find the ExpressionStatement parent
      while (
        statement &&
        statement.value &&
        statement.value.type !== "ExpressionStatement" &&
        statement.value.type !== "VariableDeclarator"
      ) {
        statement = statement.parent;
      }
      if (
        statement &&
        statement.value &&
        statement.value.type === "ExpressionStatement"
      ) {
        j(statement).remove();
        hasChanges = true;
      }
    }
  });

  // Transform new VueRouter({ ... }) or new Router({ ... }) to createRouter({ ... })
  root.find(j.NewExpression).forEach((path: any) => {
    const callee = path.value.callee;
    const isVueRouter =
      (callee.type === "Identifier" &&
        (callee.name === "Router" || callee.name === "VueRouter")) ||
      (callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.object.name === "VueRouter" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "Router");

    if (isVueRouter) {
      const args = path.value.arguments;

      if (args.length > 0 && args[0].type === "ObjectExpression") {
        const config = args[0];
        const properties = config.properties || [];

        // Transform mode to history
        const modeProp = properties.find(
          (p: any) => p.key && p.key.name === "mode",
        );
        const baseProp = properties.find(
          (p: any) => p.key && p.key.name === "base",
        );

        if (modeProp && modeProp.value) {
          const modeValue = modeProp.value.value;

          if (
            modeValue === "history" ||
            modeValue === "hash" ||
            modeValue === "abstract"
          ) {
            // Remove mode property by filtering it out
            const modeIndex = properties.indexOf(modeProp);
            if (modeIndex !== -1) {
              properties.splice(modeIndex, 1);
            }

            // Add history property
            const historyFunction =
              modeValue === "history"
                ? "createWebHistory"
                : modeValue === "hash"
                  ? "createWebHashHistory"
                  : "createMemoryHistory";

            let historyArgs: any[] = [];

            if (baseProp) {
              // Combine base into history
              historyArgs = [
                j.objectExpression([
                  j.property("init", j.identifier("base"), baseProp.value),
                ]),
              ];
              // Remove base property
              const baseIndex = properties.indexOf(baseProp);
              if (baseIndex !== -1) {
                properties.splice(baseIndex, 1);
              }
            }

            const historyCall = j.callExpression(
              j.identifier(historyFunction),
              historyArgs,
            );

            config.properties.push(
              j.property("init", j.identifier("history"), historyCall),
            );

            hasChanges = true;
          }
        }

        // Transform to createRouter call
        const createRouterCall = j.callExpression(
          j.identifier("createRouter"),
          [config],
        );

        j(path).replaceWith(createRouterCall);
        hasChanges = true;
      }
    }
  });

  // Transform catch-all routes: path: '*' → path: '/:pathMatch(.*)*'
  // Vue Router 4 requires catch-all routes to use a param with custom regexp
  root.find(j.ObjectExpression).forEach((path: any) => {
    const properties = path.value.properties || [];
    properties.forEach((prop: any) => {
      if (
        prop.key &&
        prop.key.name === "path" &&
        prop.value &&
        prop.value.type === "Literal" &&
        prop.value.value === "*"
      ) {
        // Replace path: '*' with path: '/:pathMatch(.*)*'
        prop.value.value = "/:pathMatch(.*)*";
        hasChanges = true;
      }
    });
  });

  // Transform router-link props
  // router-link :to="{ name: 'route' }" → router-link :to="{ name: 'route' }" (same, but handle v-slot)
  // This is mostly handled in templates, but we can detect router-link usage in JS

  // Transform router.push/replace with string to object
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;

    if (
      callee.type === "MemberExpression" &&
      callee.property.type === "Identifier" &&
      ["push", "replace"].includes(callee.property.name)
    ) {
      const args = path.value.arguments;

      // If first arg is a string literal, convert to object with path
      if (
        args.length > 0 &&
        args[0].type === "Literal" &&
        typeof args[0].value === "string"
      ) {
        const pathValue = args[0].value;

        // Only convert if it looks like a path (starts with /)
        if (pathValue.startsWith("/")) {
          args[0] = j.objectExpression([
            j.property("init", j.identifier("path"), args[0]),
          ]);
          hasChanges = true;
        }
      }
    }
  });

  // Update imports: remove Vue and VueRouter default imports, add createRouter and createWebHistory
  if (hasChanges) {
    let needsCreateWebHistory = false;

    // Check if we need createWebHistory (if mode was 'history')
    const source = root.toSource();
    if (
      source.includes("createWebHistory") ||
      source.includes('mode: "history"')
    ) {
      needsCreateWebHistory = true;
    }

    // Collect imports to modify (avoid modifying collection while iterating)
    const importsToModify: any[] = [];
    const importsToRemove: any[] = [];
    let hasRouterImport = false;

    root.find(j.ImportDeclaration).forEach((path: any) => {
      if (!path.value || !path.value.source) {
        return;
      }

      // Remove Vue default import if present
      if (path.value.source.value === "vue") {
        const specifiers = path.value.specifiers || [];
        const defaultSpec = specifiers.find(
          (s: any) => s && s.type === "ImportDefaultSpecifier",
        );
        if (defaultSpec && specifiers.length === 1) {
          // Remove entire import if only default Vue
          importsToRemove.push(path);
        } else if (defaultSpec) {
          // Remove default specifier but keep others
          importsToModify.push({ path, action: "removeDefaultVue" });
        }
      }

      // Update vue-router imports
      if (path.value.source.value === "vue-router") {
        hasRouterImport = true;
        importsToModify.push({
          path,
          action: "updateRouter",
          needsCreateWebHistory,
        });
      }
    });

    // Remove imports
    importsToRemove.forEach((path) => {
      j(path).remove();
    });

    // Modify imports
    importsToModify.forEach(
      ({ path, action, needsCreateWebHistory: needsHistory }) => {
        if (action === "removeDefaultVue") {
          const specifiers = path.value.specifiers || [];
          path.value.specifiers = specifiers.filter(
            (s: any) => s && s.type !== "ImportDefaultSpecifier",
          );
        } else if (action === "updateRouter") {
          const specifiers = path.value.specifiers || [];

          // Remove VueRouter default import
          const vueRouterDefault = specifiers.find(
            (s: any) =>
              s &&
              (s.type === "ImportDefaultSpecifier" ||
                (s.imported && s.imported.name === "VueRouter")),
          );
          if (vueRouterDefault) {
            path.value.specifiers = specifiers.filter(
              (s: any) => s && s !== vueRouterDefault,
            );
          }

          // Add createRouter if not present
          const hasCreateRouter = specifiers.some(
            (s: any) => s && s.imported && s.imported.name === "createRouter",
          );
          if (!hasCreateRouter) {
            path.value.specifiers.push(
              j.importSpecifier(j.identifier("createRouter")),
            );
          }

          // Add createWebHistory if needed
          if (needsHistory) {
            const hasCreateWebHistory = specifiers.some(
              (s: any) =>
                s && s.imported && s.imported.name === "createWebHistory",
            );
            if (!hasCreateWebHistory) {
              path.value.specifiers.push(
                j.importSpecifier(j.identifier("createWebHistory")),
              );
            }
          }
        }
      },
    );

    // Add import if it doesn't exist
    if (!hasRouterImport) {
      const importSpecifiers = [
        j.importSpecifier(j.identifier("createRouter")),
      ];
      if (needsCreateWebHistory) {
        importSpecifiers.push(
          j.importSpecifier(j.identifier("createWebHistory")),
        );
      }
      const importStatement = j.importDeclaration(
        importSpecifiers,
        j.literal("vue-router"),
      );
      root.get().node.program.body.unshift(importStatement);
    }
  }

  return hasChanges ? root.toSource() : fileInfo.source;
};
