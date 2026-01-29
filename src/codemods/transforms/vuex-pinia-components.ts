import { Transform, FileInfo, API } from "jscodeshift";

/**
 * Transforms Vue components using Vuex mapGetters/mapActions to Pinia useStore
 * This transform should run AFTER vuex-pinia-setup to ensure stores are already migrated
 * Key changes:
 * - ...mapGetters('module', ['getter1']) → useModuleStore().getter1
 * - ...mapActions('module', ['action1']) → useModuleStore().action1
 * - Converts to Composition API setup() with Pinia stores
 */
export const vuexPiniaComponentsTransform: Transform = (
  fileInfo: FileInfo,
  api: API,
  options: any = {},
) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;
  const storeModules = new Map<string, string>(); // module name → store name (e.g., 'user' → 'useUserStore')

  // Find all mapGetters, mapActions, mapState, mapMutations calls
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;

    if (
      callee.type === "Identifier" &&
      ["mapGetters", "mapActions", "mapState", "mapMutations"].includes(
        callee.name,
      )
    ) {
      const args = path.value.arguments || [];

      if (args.length >= 2) {
        const moduleName =
          args[0].value || (args[0].type === "Literal" ? args[0].value : null);

        if (moduleName) {
          // Determine store name: 'user' → 'useUserStore'
          const storeName = `use${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Store`;
          storeModules.set(moduleName, storeName);
          hasChanges = true;
        }
      }
    }
  });

  // If we found Vuex helpers, we need to transform the component
  if (!hasChanges || storeModules.size === 0) {
    return fileInfo.source;
  }

  // Find export default with component options
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;

    if (declaration && declaration.type === "ObjectExpression") {
      const properties = declaration.properties || [];

      // Check if component already uses setup()
      const hasSetup = properties.some(
        (p: any) => p.key && p.key.name === "setup",
      );

      if (!hasSetup) {
        // Find computed and methods that use mapGetters/mapActions
        const computedProp = properties.find(
          (p: any) => p.key && p.key.name === "computed",
        );
        const methodsProp = properties.find(
          (p: any) => p.key && p.key.name === "methods",
        );
        const dataProp = properties.find(
          (p: any) => p.key && p.key.name === "data",
        );
        const mountedProp = properties.find(
          (p: any) => p.key && p.key.name === "mounted",
        );
        const watchProp = properties.find(
          (p: any) => p.key && p.key.name === "watch",
        );

        // Build setup() function
        const setupStatements: any[] = [];
        const returnProperties: any[] = [];
        const vueImports = new Set<string>();
        const storeImports = new Map<string, string>(); // storeName → importPath

        // Initialize stores
        storeModules.forEach((storeName, moduleName) => {
          const importPath = `../store/modules/${moduleName}`;
          storeImports.set(storeName, importPath);

          const storeVarName = moduleName + "Store";
          setupStatements.push(
            j.variableDeclaration("const", [
              j.variableDeclarator(
                j.identifier(storeVarName),
                j.callExpression(j.identifier(storeName), []),
              ),
            ]),
          );
        });

        // Transform computed properties
        if (
          computedProp &&
          computedProp.value &&
          computedProp.value.type === "ObjectExpression"
        ) {
          const computedProps = computedProp.value.properties || [];

          computedProps.forEach((prop: any) => {
            // Handle ...mapGetters() spread
            if (prop.type === "SpreadElement" && prop.argument) {
              const spreadArg = prop.argument;
              if (
                spreadArg.type === "CallExpression" &&
                spreadArg.callee.name === "mapGetters"
              ) {
                const args = spreadArg.arguments || [];
                if (args.length >= 2) {
                  const moduleName =
                    args[0].value ||
                    (args[0].type === "Literal" ? args[0].value : null);
                  const getters = args[1];

                  if (
                    moduleName &&
                    getters &&
                    getters.type === "ArrayExpression"
                  ) {
                    const storeVarName = moduleName + "Store";
                    getters.elements.forEach((getter: any) => {
                      const getterName =
                        getter.value ||
                        (getter.type === "Literal" ? getter.value : null);
                      if (getterName) {
                        // Create computed property from store getter
                        const computedCall = j.callExpression(
                          j.identifier("computed"),
                          [
                            j.arrowFunctionExpression(
                              [],
                              j.memberExpression(
                                j.identifier(storeVarName),
                                j.identifier(getterName),
                              ),
                            ),
                          ],
                        );

                        setupStatements.push(
                          j.variableDeclaration("const", [
                            j.variableDeclarator(
                              j.identifier(getterName),
                              computedCall,
                            ),
                          ]),
                        );

                        returnProperties.push(
                          j.property(
                            "init",
                            j.identifier(getterName),
                            j.identifier(getterName),
                          ),
                        );
                        vueImports.add("computed");
                      }
                    });
                  }
                }
              }
            } else if (prop.key && prop.value) {
              // Regular computed property - transform to computed()
              const propName = prop.key.name;
              const propValue = prop.value;

              if (
                propValue.type === "FunctionExpression" ||
                propValue.type === "ArrowFunctionExpression"
              ) {
                let computedBody: any = null;

                if (
                  propValue.body &&
                  propValue.body.type === "BlockStatement"
                ) {
                  const returnStmt = propValue.body.body.find(
                    (stmt: any) => stmt.type === "ReturnStatement",
                  );
                  if (returnStmt && returnStmt.argument) {
                    computedBody = j.arrowFunctionExpression(
                      [],
                      returnStmt.argument,
                    );
                  }
                } else if (propValue.body) {
                  computedBody = j.arrowFunctionExpression([], propValue.body);
                }

                if (computedBody) {
                  setupStatements.push(
                    j.variableDeclaration("const", [
                      j.variableDeclarator(
                        j.identifier(propName),
                        j.callExpression(j.identifier("computed"), [
                          computedBody,
                        ]),
                      ),
                    ]),
                  );

                  returnProperties.push(
                    j.property(
                      "init",
                      j.identifier(propName),
                      j.identifier(propName),
                    ),
                  );
                  vueImports.add("computed");
                }
              }
            }
          });
        }

        // Transform methods
        if (
          methodsProp &&
          methodsProp.value &&
          methodsProp.value.type === "ObjectExpression"
        ) {
          const methodProps = methodsProp.value.properties || [];

          methodProps.forEach((prop: any) => {
            // Handle ...mapActions() spread
            if (prop.type === "SpreadElement" && prop.argument) {
              const spreadArg = prop.argument;
              if (
                spreadArg.type === "CallExpression" &&
                spreadArg.callee.name === "mapActions"
              ) {
                const args = spreadArg.arguments || [];
                if (args.length >= 2) {
                  const moduleName =
                    args[0].value ||
                    (args[0].type === "Literal" ? args[0].value : null);
                  const actions = args[1];

                  if (
                    moduleName &&
                    actions &&
                    actions.type === "ArrayExpression"
                  ) {
                    const storeVarName = moduleName + "Store";
                    actions.elements.forEach((action: any) => {
                      const actionName =
                        action.value ||
                        (action.type === "Literal" ? action.value : null);
                      if (actionName) {
                        // Create method that calls store action
                        const methodFn = j.functionExpression(
                          j.identifier(actionName),
                          [j.restElement(j.identifier("args"))],
                          j.blockStatement([
                            j.returnStatement(
                              j.callExpression(
                                j.memberExpression(
                                  j.identifier(storeVarName),
                                  j.identifier(actionName),
                                ),
                                [j.spreadElement(j.identifier("args"))],
                              ),
                            ),
                          ]),
                        );

                        setupStatements.push(methodFn);
                        returnProperties.push(
                          j.property(
                            "init",
                            j.identifier(actionName),
                            j.identifier(actionName),
                          ),
                        );
                      }
                    });
                  }
                }
              }
            } else if (prop.key && prop.value) {
              // Regular method - keep it
              const methodName = prop.key.name;
              const methodValue = prop.value;

              if (
                methodValue.type === "FunctionExpression" ||
                methodValue.type === "ObjectMethod"
              ) {
                setupStatements.push(methodValue);
                returnProperties.push(
                  j.property(
                    "init",
                    j.identifier(methodName),
                    j.identifier(methodName),
                  ),
                );
              }
            }
          });
        }

        // Transform data() to ref()
        if (dataProp && dataProp.value) {
          if (dataProp.value.type === "FunctionExpression") {
            const dataBody = dataProp.value.body;
            if (dataBody && dataBody.type === "BlockStatement") {
              const returnStmt = dataBody.body.find(
                (stmt: any) => stmt.type === "ReturnStatement",
              );
              if (
                returnStmt &&
                returnStmt.argument &&
                returnStmt.argument.type === "ObjectExpression"
              ) {
                returnStmt.argument.properties.forEach((prop: any) => {
                  const propName = prop.key.name;
                  const propValue = prop.value;

                  setupStatements.push(
                    j.variableDeclaration("const", [
                      j.variableDeclarator(
                        j.identifier(propName),
                        j.callExpression(j.identifier("ref"), [
                          propValue || j.literal(null),
                        ]),
                      ),
                    ]),
                  );

                  returnProperties.push(
                    j.property(
                      "init",
                      j.identifier(propName),
                      j.identifier(propName),
                    ),
                  );
                  vueImports.add("ref");
                });
              }
            }
          }
        }

        // Transform mounted() to onMounted()
        if (mountedProp && mountedProp.value) {
          const mountedBody =
            mountedProp.value.type === "FunctionExpression"
              ? mountedProp.value.body
              : mountedProp.value.body;

          if (mountedBody && mountedBody.type === "BlockStatement") {
            setupStatements.push(
              j.callExpression(j.identifier("onMounted"), [
                j.arrowFunctionExpression([], mountedBody),
              ]),
            );
            vueImports.add("onMounted");
          }
        }

        // Create setup() function
        const setupFunction = j.functionExpression(
          j.identifier("setup"),
          [],
          j.blockStatement([
            ...setupStatements,
            j.returnStatement(j.objectExpression(returnProperties)),
          ]),
        );

        // Add setup property to component
        properties.push(
          j.property("init", j.identifier("setup"), setupFunction),
        );

        // Remove old computed, methods, data, mounted properties
        const propsToRemove = [
          "computed",
          "methods",
          "data",
          "mounted",
          "watch",
        ];
        propsToRemove.forEach((propName) => {
          const index = properties.findIndex(
            (p: any) => p.key && p.key.name === propName,
          );
          if (index >= 0) {
            properties.splice(index, 1);
          }
        });

        // Add imports
        const program = root.get().node.program;

        // Add store imports
        storeImports.forEach((importPath, storeName) => {
          const importStmt = j.importDeclaration(
            [j.importSpecifier(j.identifier(storeName))],
            j.literal(importPath),
          );
          program.body.unshift(importStmt);
        });

        // Add Vue imports
        if (vueImports.size > 0) {
          const vueImportStmt = j.importDeclaration(
            Array.from(vueImports).map((name) =>
              j.importSpecifier(j.identifier(name)),
            ),
            j.literal("vue"),
          );
          program.body.unshift(vueImportStmt);
        }

        hasChanges = true;
      }
    }
  });

  return hasChanges ? root.toSource() : fileInfo.source;
};
