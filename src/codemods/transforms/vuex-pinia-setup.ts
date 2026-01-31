import { Transform, FileInfo, API } from "jscodeshift";

/**
 * Transforms Vuex stores to Pinia Setup Stores
 * Key changes:
 * - new Vuex.Store() → defineStore('name', () => { ... })
 * - state → ref()/reactive() declarations
 * - getters → computed() declarations
 * - mutations → functions (direct state mutation)
 * - actions → functions
 * - return { ... } with all properties and methods
 */
export const vuexPiniaSetupTransform: Transform = (
  fileInfo: FileInfo,
  api: API,
  options: any = {}
) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const enableTypeScript = options?.enableTypeScript || false;

  let hasChanges = false;
  const imports = new Set<string>();

  // Track properties for TypeScript type annotation
  const refProperties = new Set<string>(); // Properties converted to ref()
  const computedProperties = new Set<string>(); // Properties converted to computed()
  const functionNames = new Set<string>(); // Functions (mutations/actions)
  const statePropertyTypes = new Map<string, string>(); // Property name → inferred type for interfaces
  const objectPropertyDetails = new Map<string, any>(); // Property name → object AST for interface generation
  const computedReturnTypes = new Map<string, string>(); // Computed name → inferred return type

  // First, detect and extract const declarations for state, getters, mutations, actions
  // These are often defined before export default { state, getters, mutations, actions }
  const vuexConstDeclarations = new Map<string, any>(); // name → AST node
  root.find(j.VariableDeclarator).forEach((path: any) => {
    const id = path.value.id;
    if (id && id.type === "Identifier") {
      const varName = id.name;
      if (["state", "getters", "mutations", "actions"].includes(varName)) {
        vuexConstDeclarations.set(varName, path.value.init);
      }
    }
  });

  // Also detect Vuex modules (export default { namespaced: true, state, getters, mutations, actions })
  // These should be transformed to separate Pinia stores
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;

    if (declaration && declaration.type === "ObjectExpression") {
      const properties = declaration.properties || [];

      // Check if this is a Vuex module (has namespaced: true or has state/getters/mutations/actions)
      const hasNamespaced = properties.some(
        (p: any) =>
          p.key &&
          p.key.name === "namespaced" &&
          p.value &&
          p.value.value === true
      );
      const hasVuexStructure = properties.some(
        (p: any) =>
          p.key &&
          ["state", "getters", "mutations", "actions"].includes(p.key.name)
      );

      if (
        hasNamespaced ||
        (hasVuexStructure && !path.value.declaration.callee)
      ) {
        // This is a Vuex module - transform it to a Pinia store
        const fileName = fileInfo.path || "module";
        const moduleName =
          fileName
            .replace(/\.(js|ts)$/, "")
            .split("/")
            .pop() || "module";

        const storeName =
          moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
        const useStoreName = `use${storeName}Store`;

        // Build Setup Store function body
        const setupStatements: any[] = [];
        const stateProperties = new Map<
          string,
          { isObject: boolean; value: any }
        >();
        const localComputedProperties = new Set<string>();
        const localFunctionNames = new Set<string>();
        const returnProperties: string[] = [];
        const getterRenames = new Map<string, string>(); // original name → renamed name

        // Extract state - check both export default and const declaration
        let stateValue: any = null;
        const stateProp = properties.find(
          (p: any) => p.key && p.key.name === "state"
        );
        if (stateProp && stateProp.value) {
          // If stateProp.value is an Identifier (reference to const state), resolve it
          if (stateProp.value.type === "Identifier") {
            const varName = stateProp.value.name;
            if (vuexConstDeclarations.has(varName)) {
              stateValue = vuexConstDeclarations.get(varName);
            } else {
              // Try to find the variable declaration in the AST
              root.find(j.VariableDeclarator).forEach((varPath: any) => {
                if (varPath.value.id && varPath.value.id.name === varName) {
                  stateValue = varPath.value.init;
                }
              });
            }
          } else {
            stateValue = stateProp.value;
          }
        } else if (vuexConstDeclarations.has("state")) {
          stateValue = vuexConstDeclarations.get("state");
        }

        if (stateValue) {
          if (stateValue.type === "ObjectExpression") {
            const stateProps = stateValue.properties || [];
            stateProps.forEach((prop: any) => {
              if (prop && prop.key) {
                const propName = prop.key.name || prop.key.value;
                if (propName) {
                  const isObject =
                    prop.value && prop.value.type === "ObjectExpression";
                  stateProperties.set(propName, {
                    isObject,
                    value: prop.value,
                  });
                  returnProperties.push(propName);

                  if (isObject) {
                    setupStatements.push(
                      j.variableDeclaration("const", [
                        j.variableDeclarator(
                          j.identifier(propName),
                          j.callExpression(j.identifier("reactive"), [
                            prop.value,
                          ])
                        ),
                      ])
                    );
                    imports.add("reactive");
                  } else {
                    setupStatements.push(
                      j.variableDeclaration("const", [
                        j.variableDeclarator(
                          j.identifier(propName),
                          j.callExpression(j.identifier("ref"), [
                            prop.value || j.literal(null),
                          ])
                        ),
                      ])
                    );
                    imports.add("ref");
                  }
                }
              }
            });
          } else if (stateValue.type === "FunctionExpression") {
            // state is a function - execute it
            const stateCall = j.callExpression(stateValue, []);
            setupStatements.push(
              j.variableDeclaration("const", [
                j.variableDeclarator(j.identifier("state"), stateCall),
              ])
            );
            // Then extract properties from state object
            // This is simplified - in reality we'd need to execute the function
          }
          hasChanges = true;
        }

        // Extract getters - check both export default and const declaration
        let gettersValue: any = null;
        const gettersProp = properties.find(
          (p: any) => p.key && p.key.name === "getters"
        );
        if (gettersProp && gettersProp.value) {
          // If gettersProp.value is an Identifier (reference to const getters), resolve it
          if (gettersProp.value.type === "Identifier") {
            const varName = gettersProp.value.name;
            if (vuexConstDeclarations.has(varName)) {
              gettersValue = vuexConstDeclarations.get(varName);
            } else {
              // Try to find the variable declaration in the AST
              root.find(j.VariableDeclarator).forEach((varPath: any) => {
                if (varPath.value.id && varPath.value.id.name === varName) {
                  gettersValue = varPath.value.init;
                }
              });
            }
          } else {
            gettersValue = gettersProp.value;
          }
        } else if (vuexConstDeclarations.has("getters")) {
          gettersValue = vuexConstDeclarations.get("getters");
        }

        if (gettersValue && gettersValue.type === "ObjectExpression") {
          const getterProps = gettersValue.properties || [];
          getterProps.forEach((getterProp: any) => {
            if (getterProp && getterProp.key) {
              const getterName = getterProp.key.name || getterProp.key.value;
              if (getterName) {
                // Check if this getter name conflicts with a state property
                const conflictsWithState = stateProperties.has(getterName);

                // If it conflicts, check if the getter is just returning state.xxx
                // If so, we can skip it and use the state property directly
                let shouldSkipGetter = false;
                let renamedGetterName = getterName;

                if (conflictsWithState) {
                  const getterValue: any = getterProp.value;
                  if (getterValue) {
                    const getterCode = j(getterValue).toSource();
                    // Check if getter is just: (state) => state.getterName
                    const simpleReturnPattern = new RegExp(
                      `\\(state\\)\\s*=>\\s*state\\.${getterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
                    );
                    if (simpleReturnPattern.test(getterCode)) {
                      // Simple getter that just returns state - skip it, use state directly
                      shouldSkipGetter = true;
                    } else {
                      // Complex getter with same name as state - rename it
                      renamedGetterName = `${getterName}Computed`;
                    }
                  }
                }

                if (!shouldSkipGetter) {
                  localComputedProperties.add(renamedGetterName);
                  computedProperties.add(renamedGetterName);
                  // Add to returnProperties with the renamed name
                  if (!returnProperties.includes(renamedGetterName)) {
                    returnProperties.push(renamedGetterName);
                  }

                  // Track the mapping for return statement
                  if (renamedGetterName !== getterName) {
                    getterRenames.set(getterName, renamedGetterName);
                  }

                  // Transform getter to computed or function
                  const getterValue: any = getterProp.value;
                  let getterBody: any = null;

                  if (
                    getterValue &&
                    (getterValue.type === "FunctionExpression" ||
                      getterValue.type === "ArrowFunctionExpression")
                  ) {
                    getterBody = getterValue.body;

                    // Check if getter returns a function (e.g., userById: (state) => (id) => ...)
                    // In this case, it should be a regular function, not a computed
                    let returnsFunction = false;
                    let returnedFunction: any = null;
                    if (getterBody && getterBody.type === "BlockStatement") {
                      const returnStmt = getterBody.body.find(
                        (stmt: any) => stmt.type === "ReturnStatement"
                      );
                      if (
                        returnStmt &&
                        returnStmt.argument &&
                        (returnStmt.argument.type ===
                          "ArrowFunctionExpression" ||
                          returnStmt.argument.type === "FunctionExpression")
                      ) {
                        returnsFunction = true;
                        returnedFunction = returnStmt.argument;
                      }
                    } else if (
                      getterBody &&
                      (getterBody.type === "ArrowFunctionExpression" ||
                        getterBody.type === "FunctionExpression")
                    ) {
                      returnsFunction = true;
                      returnedFunction = getterBody;
                    }

                    if (returnsFunction && returnedFunction) {
                      // This is a getter that returns a function - convert to regular function
                      // Extract the returned function's parameters and body
                      const returnedFunctionParams =
                        returnedFunction.params || [];
                      const returnedFunctionBody = returnedFunction.body;

                      // Transform state references in the returned function body
                      let transformedBody = returnedFunctionBody;
                      if (
                        returnedFunctionBody &&
                        returnedFunctionBody.type === "BlockStatement"
                      ) {
                        transformedBody = transformStateReferencesInBody(
                          j,
                          returnedFunctionBody,
                          stateProperties
                        );
                      } else if (returnedFunctionBody) {
                        // Expression body - wrap in return statement
                        const transformedExpr =
                          transformStateReferencesInExpression(
                            j,
                            returnedFunctionBody,
                            stateProperties
                          );
                        transformedBody = j.blockStatement([
                          j.returnStatement(transformedExpr),
                        ]);
                      }

                      setupStatements.push(
                        j.functionDeclaration(
                          j.identifier(renamedGetterName),
                          returnedFunctionParams,
                          transformedBody || j.blockStatement([])
                        )
                      );
                      // Remove from computed properties since it's now a function
                      localComputedProperties.delete(renamedGetterName);
                      computedProperties.delete(renamedGetterName);
                      localFunctionNames.add(renamedGetterName);
                      functionNames.add(renamedGetterName);
                    } else {
                      // Regular getter - convert to computed
                      // Transform state references in getter body
                      if (getterBody && getterBody.type === "BlockStatement") {
                        const returnStmt = getterBody.body.find(
                          (stmt: any) => stmt.type === "ReturnStatement"
                        );
                        if (returnStmt && returnStmt.argument) {
                          let returnExpr = returnStmt.argument;
                          // Transform state references in return expression
                          returnExpr = transformStateReferencesInExpression(
                            j,
                            returnExpr,
                            stateProperties
                          );
                          const arrowFn = j.arrowFunctionExpression(
                            [],
                            returnExpr
                          );
                          setupStatements.push(
                            j.variableDeclaration("const", [
                              j.variableDeclarator(
                                j.identifier(renamedGetterName),
                                j.callExpression(j.identifier("computed"), [
                                  arrowFn,
                                ])
                              ),
                            ])
                          );
                          imports.add("computed");
                        }
                      } else if (getterBody) {
                        // Arrow function with expression body
                        const transformedBody =
                          transformStateReferencesInExpression(
                            j,
                            getterBody,
                            stateProperties
                          );
                        const arrowFn = j.arrowFunctionExpression(
                          [],
                          transformedBody
                        );
                        setupStatements.push(
                          j.variableDeclaration("const", [
                            j.variableDeclarator(
                              j.identifier(renamedGetterName),
                              j.callExpression(j.identifier("computed"), [
                                arrowFn,
                              ])
                            ),
                          ])
                        );
                        imports.add("computed");
                      }
                    }
                  }
                }
              }
            }
          });
          hasChanges = true;
        }

        // Extract mutations - check both export default and const declaration
        let mutationsValue: any = null;
        const mutationsProp = properties.find(
          (p: any) => p.key && p.key.name === "mutations"
        );
        if (mutationsProp && mutationsProp.value) {
          // If mutationsProp.value is an Identifier (reference to const mutations), resolve it
          if (mutationsProp.value.type === "Identifier") {
            const varName = mutationsProp.value.name;
            if (vuexConstDeclarations.has(varName)) {
              mutationsValue = vuexConstDeclarations.get(varName);
            } else {
              // Try to find the variable declaration in the AST
              root.find(j.VariableDeclarator).forEach((varPath: any) => {
                if (varPath.value.id && varPath.value.id.name === varName) {
                  mutationsValue = varPath.value.init;
                }
              });
            }
          } else {
            mutationsValue = mutationsProp.value;
          }
        } else if (vuexConstDeclarations.has("mutations")) {
          mutationsValue = vuexConstDeclarations.get("mutations");
        }

        if (mutationsValue && mutationsValue.type === "ObjectExpression") {
          const mutProps = mutationsValue.properties || [];
          mutProps.forEach((mutProp: any) => {
            if (!mutProp || !mutProp.key) return;

            const mutName = mutProp.key.name || mutProp.key.value;
            if (!mutName) return;

            // Handle both ObjectMethod (shorthand: SET_AUTHENTICATED(state, value) { ... })
            // and ObjectProperty with value (SET_AUTHENTICATED: function(state, value) { ... })
            let mutValue: any = null;
            let mutBody: any = null;
            let mutParams: any[] = [];

            if (mutProp.type === "ObjectMethod") {
              // Shorthand method
              mutValue = mutProp;
              mutBody = mutProp.body;
              mutParams = mutProp.params || [];
            } else if (mutProp.value) {
              // Property with value
              mutValue = mutProp.value;
              if (
                mutValue.type === "FunctionExpression" ||
                mutValue.type === "ArrowFunctionExpression"
              ) {
                mutBody = mutValue.body;
                mutParams = mutValue.params || [];
              } else if (mutValue.type === "ObjectMethod") {
                mutBody = mutValue.body;
                mutParams = mutValue.params || [];
              }
            }

            if (mutBody) {
              localFunctionNames.add(mutName);
              functionNames.add(mutName);
              returnProperties.push(mutName);

              // Remove state parameter
              const newParams =
                mutParams.length > 0 &&
                mutParams[0] &&
                mutParams[0].name === "state"
                  ? mutParams.slice(1)
                  : mutParams;

              // Check for parameter name conflicts with state properties
              // If a parameter name conflicts, we need to rename it in the body
              const paramConflicts = new Map<string, string>();
              const newParamsCopy = newParams.map((param: any) => {
                if (param && param.type === "Identifier") {
                  const paramName = param.name;
                  if (stateProperties.has(paramName)) {
                    // Rename parameter to avoid conflict
                    const newParamName = `${paramName}Param`;
                    paramConflicts.set(paramName, newParamName);
                    // Create a new identifier to avoid mutating the original
                    return j.identifier(newParamName);
                  }
                }
                return param;
              });

              // Transform state references in mutation body
              let transformedBody = mutBody;
              if (mutBody && mutBody.type === "BlockStatement") {
                transformedBody = transformStateReferencesInBody(
                  j,
                  mutBody,
                  stateProperties
                );

                // Rename conflicting parameters in the body
                if (paramConflicts.size > 0) {
                  const bodyCode = j(transformedBody).toSource();
                  let transformedCode = bodyCode;
                  paramConflicts.forEach((newName, oldName) => {
                    // Replace parameter references but not state property references
                    // Use word boundaries and negative lookbehind to avoid replacing property accesses
                    const escapedOldName = oldName.replace(
                      /[.*+?^${}()|[\]\\]/g,
                      "\\$&"
                    );
                    // Match the parameter name but not if it's part of a property access (e.g., users.value)
                    // Pattern: word boundary, not preceded by a dot, followed by word boundary or assignment
                    const paramPattern = new RegExp(
                      `(?<!\\.)\\b${escapedOldName}\\b(?!\\.)`,
                      "g"
                    );
                    transformedCode = transformedCode.replace(
                      paramPattern,
                      newName
                    );
                  });
                  try {
                    const newRoot = j(transformedCode);
                    const program = newRoot.find(j.Program).paths()[0];
                    if (
                      program &&
                      program.value.body &&
                      program.value.body.length > 0
                    ) {
                      const statements = program.value.body;
                      const cleanedStatements: any[] = [];
                      statements.forEach((stmt: any) => {
                        if (stmt.type === "BlockStatement" && stmt.body) {
                          stmt.body.forEach((innerStmt: any) => {
                            cleanedStatements.push(innerStmt);
                          });
                        } else if (stmt.type !== "EmptyStatement") {
                          cleanedStatements.push(stmt);
                        }
                      });
                      transformedBody = j.blockStatement(
                        cleanedStatements.length > 0
                          ? cleanedStatements
                          : transformedBody.body
                      );
                    }
                  } catch (e) {
                    // If parsing fails, keep original body
                  }
                }
              }

              setupStatements.push(
                j.functionDeclaration(
                  j.identifier(mutName),
                  paramConflicts.size > 0 ? newParamsCopy : newParams,
                  transformedBody
                )
              );
            }
          });
          hasChanges = true;
        }

        // Extract actions - check both export default and const declaration
        let actionsValue: any = null;
        const actionsProp = properties.find(
          (p: any) => p.key && p.key.name === "actions"
        );
        if (actionsProp && actionsProp.value) {
          // If actionsProp.value is an Identifier (reference to const actions), resolve it
          if (actionsProp.value.type === "Identifier") {
            const varName = actionsProp.value.name;
            if (vuexConstDeclarations.has(varName)) {
              actionsValue = vuexConstDeclarations.get(varName);
            } else {
              // Try to find the variable declaration in the AST
              root.find(j.VariableDeclarator).forEach((varPath: any) => {
                if (varPath.value.id && varPath.value.id.name === varName) {
                  actionsValue = varPath.value.init;
                }
              });
            }
          } else {
            actionsValue = actionsProp.value;
          }
        } else if (vuexConstDeclarations.has("actions")) {
          actionsValue = vuexConstDeclarations.get("actions");
        }

        if (actionsValue && actionsValue.type === "ObjectExpression") {
          const actionProps = actionsValue.properties || [];
          actionProps.forEach((actionProp: any) => {
            if (!actionProp || !actionProp.key) return;

            const actionName = actionProp.key.name || actionProp.key.value;
            if (!actionName || localFunctionNames.has(actionName)) return;

            // Handle both ObjectMethod (shorthand: login({ commit }) { ... })
            // and ObjectProperty with value (login: function({ commit }) { ... })
            let actionValueForTransform: any = null;
            let actionBody: any = null;
            let actionParams: any[] = [];

            if (actionProp.type === "ObjectMethod") {
              // Shorthand method
              actionValueForTransform = actionProp;
              actionBody = actionProp.body;
              actionParams = actionProp.params || [];
            } else if (actionProp.value) {
              // Property with value
              actionValueForTransform = actionProp.value;
              if (
                actionValueForTransform.type === "FunctionExpression" ||
                actionValueForTransform.type === "ArrowFunctionExpression"
              ) {
                actionBody = actionValueForTransform.body;
                actionParams = actionValueForTransform.params || [];
              } else if (actionValueForTransform.type === "ObjectMethod") {
                actionBody = actionValueForTransform.body;
                actionParams = actionValueForTransform.params || [];
              }
            }

            if (actionBody) {
              localFunctionNames.add(actionName);
              functionNames.add(actionName);
              returnProperties.push(actionName);

              // Remove Vuex context parameters
              const cleanedParams = actionParams.filter((param: any) => {
                if (param.type === "ObjectPattern") {
                  const properties = param.properties || [];
                  const vuexContextProps = [
                    "commit",
                    "dispatch",
                    "state",
                    "getters",
                    "rootState",
                    "rootGetters",
                  ];
                  const hasOnlyVuexProps = properties.every((p: any) => {
                    const keyName = p.key?.name || p.key?.value;
                    return vuexContextProps.includes(keyName);
                  });
                  return !hasOnlyVuexProps;
                }
                return true;
              });

              // Transform commit() calls and state references in action body
              let transformedBody = actionBody;
              if (actionBody && actionBody.type === "BlockStatement") {
                // First transform commit() calls to direct function calls
                transformedBody = transformCommitCalls(
                  j,
                  actionBody,
                  localFunctionNames
                );
                // Then transform state references
                transformedBody = transformStateReferencesInBody(
                  j,
                  transformedBody,
                  stateProperties
                );
              }

              setupStatements.push(
                j.functionDeclaration(
                  j.identifier(actionName),
                  cleanedParams,
                  transformedBody
                )
              );
            }
          });
          hasChanges = true;
        }

        // Create return statement
        // Map original getter names to renamed names in return
        const returnPropertiesAST = returnProperties.map((name: string) => {
          // Check if this is a renamed getter that should use original name in return
          let originalName: string | undefined;
          for (const [orig, renamed] of getterRenames.entries()) {
            if (renamed === name) {
              originalName = orig;
              break;
            }
          }

          if (originalName) {
            // Return with original name pointing to renamed variable
            return j.property(
              "init",
              j.identifier(originalName),
              j.identifier(name)
            );
          }
          return j.property("init", j.identifier(name), j.identifier(name));
        });
        setupStatements.push(
          j.returnStatement(j.objectExpression(returnPropertiesAST))
        );

        // Create defineStore call
        const setupFunction = j.arrowFunctionExpression(
          [],
          j.blockStatement(setupStatements)
        );
        const storeId = j.literal(moduleName);
        const defineStoreCall = j.callExpression(j.identifier("defineStore"), [
          storeId,
          setupFunction,
        ]);

        // Replace export default with export const useStoreName = defineStore(...)
        const exportDeclaration = j.exportNamedDeclaration(
          j.variableDeclaration("const", [
            j.variableDeclarator(j.identifier(useStoreName), defineStoreCall),
          ])
        );

        j(path).replaceWith(exportDeclaration);
        hasChanges = true;
      }
    }
  });

  // Remove const declarations for state, getters, mutations, actions if they were used
  // This must happen after the export default transformation
  if (hasChanges) {
    const declarationsToRemove = new Set<string>();
    root.find(j.VariableDeclarator).forEach((varPath: any) => {
      const id = varPath.value.id;
      if (id && id.type === "Identifier") {
        const varName = id.name;
        if (["state", "getters", "mutations", "actions"].includes(varName)) {
          declarationsToRemove.add(varName);
        }
      }
    });

    // Remove the declarations
    declarationsToRemove.forEach((varName) => {
      root.find(j.VariableDeclaration).forEach((declPath: any) => {
        const declarations = declPath.value.declarations || [];
        if (declarations.length === 1) {
          const declarator = declarations[0];
          if (
            declarator.id &&
            declarator.id.type === "Identifier" &&
            declarator.id.name === varName
          ) {
            j(declPath).remove();
            hasChanges = true;
          }
        } else {
          // Multiple declarations - remove just this one
          const filtered = declarations.filter((d: any) => {
            return !(
              d.id &&
              d.id.type === "Identifier" &&
              d.id.name === varName
            );
          });
          if (filtered.length < declarations.length) {
            declPath.value.declarations = filtered;
            hasChanges = true;
          }
        }
      });
    });
  }

  // Transform new Vuex.Store({ ... }) to defineStore('name', () => { ... })
  root.find(j.NewExpression).forEach((path: any) => {
    if (
      path.value.callee &&
      path.value.callee.type === "MemberExpression" &&
      path.value.callee.object &&
      path.value.callee.object.type === "Identifier" &&
      path.value.callee.object.name === "Vuex" &&
      path.value.callee.property &&
      path.value.callee.property.type === "Identifier" &&
      path.value.callee.property.name === "Store"
    ) {
      const args = path.value.arguments || [];

      if (args.length > 0 && args[0] && args[0].type === "ObjectExpression") {
        const config = args[0];
        const properties = config.properties || [];

        // Extract store name from filename
        const fileName = fileInfo.path || "store";
        const storeName =
          fileName
            .replace(/\.(js|ts)$/, "")
            .split("/")
            .pop() || "main";

        // Build Setup Store function body
        const setupStatements: any[] = [];
        const stateProperties = new Map<
          string,
          { isObject: boolean; value: any }
        >();
        const localComputedProperties = new Set<string>();
        const localFunctionNames = new Set<string>();
        const returnProperties: string[] = [];
        const getterRenames = new Map<string, string>(); // original name → renamed name

        // Step 1: Extract state properties and convert to ref()/reactive()
        const stateProp = properties.find(
          (p: any) => p.key && p.key.name === "state"
        );
        if (
          stateProp &&
          stateProp.value &&
          stateProp.value.type === "ObjectExpression"
        ) {
          const stateProps = stateProp.value.properties || [];
          stateProps.forEach((prop: any) => {
            if (prop && prop.key) {
              const propName = prop.key.name || prop.key.value;
              if (propName) {
                const isObject =
                  prop.value && prop.value.type === "ObjectExpression";
                stateProperties.set(propName, { isObject, value: prop.value });
                returnProperties.push(propName);

                // Convert to ref() or reactive()
                if (isObject) {
                  setupStatements.push(
                    j.variableDeclaration("const", [
                      j.variableDeclarator(
                        j.identifier(propName),
                        j.callExpression(j.identifier("reactive"), [prop.value])
                      ),
                    ])
                  );
                  imports.add("reactive");

                  // Track property types for interface generation (objects)
                  if (enableTypeScript) {
                    statePropertyTypes.set(propName, "object");
                    // Store object AST for interface property generation
                    objectPropertyDetails.set(propName, prop.value);
                  }
                } else {
                  setupStatements.push(
                    j.variableDeclaration("const", [
                      j.variableDeclarator(
                        j.identifier(propName),
                        j.callExpression(j.identifier("ref"), [
                          prop.value || j.literal(null),
                        ])
                      ),
                    ])
                  );
                  imports.add("ref");
                  // Track ref properties for TypeScript typing
                  refProperties.add(propName);

                  // Track property types for interface generation
                  if (enableTypeScript) {
                    // Use AST analysis for better type inference
                    if (prop.value) {
                      const inferredType = inferTypeFromAST(prop.value);
                      statePropertyTypes.set(propName, inferredType);
                      
                      // If it's an array with objects, store the object AST for interface generation
                      if (prop.value.type === "ArrayExpression" && prop.value.elements && prop.value.elements.length > 0) {
                        // Check if first element is an object
                        const firstElement = prop.value.elements[0];
                        if (firstElement && firstElement.type === "ObjectExpression") {
                          // Store the object AST for interface generation
                          objectPropertyDetails.set(propName, firstElement);
                          // Mark as array type with interface
                          statePropertyTypes.set(propName, "any[]");
                        }
                      }
                      // If it's null but the property name suggests it should be an object/array
                      else if (!prop.value || prop.value.type === "NullLiteral" || (prop.value.type === "Literal" && prop.value.value === null)) {
                        // Infer from property name: posts → Post[], currentPost → Post | null
                        if (propName.endsWith('s') || propName.match(/List|Items|Array$/i)) {
                          // Likely an array
                          statePropertyTypes.set(propName, "any[]");
                        } else {
                          // Likely an object, infer interface name from property name
                          const interfaceName = propName.charAt(0).toUpperCase() + propName.slice(1);
                          statePropertyTypes.set(propName, `${interfaceName} | null`);
                        }
                      }
                    } else {
                      // No value provided, infer from property name
                      const propCode = j(j.literal(null)).toSource();
                      const inferredType = inferTypeFromValueString(propCode.trim());
                      statePropertyTypes.set(propName, inferredType);
                    }
                  }
                }
              }
            }
          });
          hasChanges = true;
        }

        // Step 2: Extract getters and convert to computed()
        const gettersProp = properties.find(
          (p: any) => p.key && p.key.name === "getters"
        );
        if (
          gettersProp &&
          gettersProp.value &&
          gettersProp.value.type === "ObjectExpression"
        ) {
          const getterProps = gettersProp.value.properties || [];
          if (getterProps.length > 0) {
            getterProps.forEach((getterProp: any) => {
              if (getterProp && getterProp.key) {
                const getterName = getterProp.key.name || getterProp.key.value;
                if (getterName) {
                  // Check if this getter name conflicts with a state property
                  const conflictsWithState = stateProperties.has(getterName);

                  // If it conflicts, check if the getter is just returning state.xxx
                  // If so, we can skip it and use the state property directly
                  let shouldSkipGetter = false;
                  let renamedGetterName = getterName;

                  // Handle both ObjectMethod (shorthand) and ObjectProperty (with value)
                  let getterValue: any = null;
                  if (getterProp.type === "ObjectMethod") {
                    getterValue = getterProp;
                  } else if (getterProp.value) {
                    getterValue = getterProp.value;
                  }

                  if (conflictsWithState && getterValue) {
                    const getterCode = j(getterValue).toSource();
                    // Check if getter is just: (state) => state.getterName
                    const simpleReturnPattern = new RegExp(
                      `\\(state\\)\\s*=>\\s*state\\.${getterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
                    );
                    if (simpleReturnPattern.test(getterCode)) {
                      // Simple getter that just returns state - skip it, use state directly
                      shouldSkipGetter = true;
                    } else {
                      // Complex getter with same name as state - rename it
                      renamedGetterName = `${getterName}Computed`;
                      getterRenames.set(getterName, renamedGetterName);
                    }
                  } else if (conflictsWithState) {
                    // If we can't determine, rename to be safe
                    renamedGetterName = `${getterName}Computed`;
                    getterRenames.set(getterName, renamedGetterName);
                  }

                  if (!shouldSkipGetter) {
                    localComputedProperties.add(renamedGetterName);
                    computedProperties.add(renamedGetterName);
                    if (!returnProperties.includes(renamedGetterName)) {
                      returnProperties.push(renamedGetterName);
                    }

                    let getterBody: any = null;
                    let isArrowExpression = false;

                    if (getterValue) {
                      if (
                        getterValue.type === "FunctionExpression" ||
                        getterValue.type === "ArrowFunctionExpression"
                      ) {
                        getterBody = getterValue.body;
                        // Check if it's an arrow function with expression body (not block)
                        if (
                          getterValue.type === "ArrowFunctionExpression" &&
                          getterBody.type !== "BlockStatement"
                        ) {
                          isArrowExpression = true;
                        }
                      } else if (getterValue.type === "ObjectMethod") {
                        getterBody = getterValue.body;
                      }
                    }

                    if (!getterBody) {
                      // Create a placeholder computed if body is missing
                      setupStatements.push(
                        j.variableDeclaration("const", [
                          j.variableDeclarator(
                            j.identifier(renamedGetterName),
                            j.callExpression(j.identifier("computed"), [
                              j.arrowFunctionExpression(
                                [],
                                j.identifier("undefined")
                              ),
                            ])
                          ),
                        ])
                      );
                      imports.add("computed");
                      return;
                    }

                    // Extract return statement from getter body
                    let returnExpression: any = null;

                    if (isArrowExpression) {
                      // Arrow function with expression body: (state) => state.count * 2
                      returnExpression = getterBody;
                    } else if (
                      getterBody.type === "BlockStatement" &&
                      getterBody.body
                    ) {
                      const returnStmt = getterBody.body.find(
                        (stmt: any) => stmt && stmt.type === "ReturnStatement"
                      );
                      if (returnStmt && returnStmt.argument) {
                        returnExpression = returnStmt.argument;
                      }
                    }

                    // Transform state references in the return expression
                    if (returnExpression) {
                      const returnCode = j(returnExpression).toSource();
                      let transformedCode = returnCode;

                      // Replace state references - handle nested properties first
                      // Process in order: longest matches first (nested properties), then simple properties
                      const sortedProps = Array.from(
                        stateProperties.entries()
                      ).sort((a, b) => {
                        // Sort by depth (objects first, then refs)
                        if (a[1].isObject && !b[1].isObject) return -1;
                        if (!a[1].isObject && b[1].isObject) return 1;
                        return 0;
                      });

                      sortedProps.forEach(([propName, info]) => {
                        // Escape propName for regex
                        const escapedName = propName.replace(
                          /[.*+?^${}()|[\]\\]/g,
                          "\\$&"
                        );

                        if (info.isObject) {
                          // For reactive objects: state.user.name → user.name, state.user.preferences.theme → user.preferences.theme
                          // Match state.propName.anything (including deeply nested) - match the longest path first
                          // Pattern: state.propName.anything (at least one dot after propName)
                          const nestedPattern = new RegExp(
                            `state\\.${escapedName}(\\.([a-zA-Z_$][a-zA-Z0-9_$]*))+`,
                            "g"
                          );
                          transformedCode = transformedCode.replace(
                            nestedPattern,
                            (match: string) => {
                              // Remove 'state.' prefix
                              return match.replace(/^state\./, "");
                            }
                          );
                          // Also handle direct state.user → user (must come after nested to avoid double replacement)
                          // Match state.user not followed by a dot (end of property access)
                          transformedCode = transformedCode.replace(
                            new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
                            propName
                          );
                        } else {
                          // For refs: state.count → count.value, state.items → items.value
                          // Must match state.items.length, state.items.push, etc.
                          // Match state.items followed by a dot (method/property access)
                          transformedCode = transformedCode.replace(
                            new RegExp(`state\\.${escapedName}\\.`, "g"),
                            `${propName}.value.`
                          );
                          // Also match state.items at end of expression
                          transformedCode = transformedCode.replace(
                            new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
                            `${propName}.value`
                          );
                        }
                      });

                      // Parse back to AST
                      try {
                        // Wrap in parentheses to ensure it's parsed as an expression
                        const wrappedCode = `(${transformedCode})`;
                        const exprRoot = j(wrappedCode);
                        const program = exprRoot.find(j.Program).paths()[0];
                        if (
                          program &&
                          program.value.body &&
                          program.value.body.length > 0
                        ) {
                          const firstStmt = program.value.body[0];
                          if (firstStmt.type === "ExpressionStatement") {
                            const expr = firstStmt.expression;
                            // Unwrap if it's a parenthesized expression
                            if (expr.type === "ParenthesizedExpression") {
                              returnExpression = expr.expression;
                            } else {
                              returnExpression = expr;
                            }
                          } else {
                            returnExpression = firstStmt;
                          }
                        }
                      } catch (e) {
                        // If parsing fails, try parsing the transformed code directly as an expression
                        try {
                          const exprRoot = j(`(${transformedCode})`);
                          const program = exprRoot.find(j.Program).paths()[0];
                          if (
                            program &&
                            program.value.body &&
                            program.value.body.length > 0
                          ) {
                            const firstStmt = program.value.body[0];
                            if (firstStmt.type === "ExpressionStatement") {
                              const expr = firstStmt.expression;
                              if (expr.type === "ParenthesizedExpression") {
                                returnExpression = expr.expression;
                              } else {
                                returnExpression = expr;
                              }
                            }
                          }
                        } catch (e2) {
                          // Keep original if parsing fails
                        }
                      }
                    }

                    // Always create computed - use transformed expression or fallback
                    const finalExpression =
                      returnExpression || j.identifier("undefined");

                    // Infer return type for TypeScript
                    if (enableTypeScript && returnExpression) {
                      const returnType = inferTypeFromAST(returnExpression);
                      if (returnType && returnType !== "any") {
                        computedReturnTypes.set(renamedGetterName, returnType);
                      }
                    }

                    const arrowFn = j.arrowFunctionExpression(
                      [],
                      finalExpression
                    );
                    setupStatements.push(
                      j.variableDeclaration("const", [
                        j.variableDeclarator(
                          j.identifier(renamedGetterName),
                          j.callExpression(j.identifier("computed"), [arrowFn])
                        ),
                      ])
                    );
                    imports.add("computed");
                  }
                }
              }
            });
          }
          hasChanges = true;
        }

        // Step 3: Extract mutations and convert to functions
        const mutationsProp = properties.find(
          (p: any) => p.key && p.key.name === "mutations"
        );
        if (
          mutationsProp &&
          mutationsProp.value &&
          mutationsProp.value.type === "ObjectExpression"
        ) {
          const mutProps = mutationsProp.value.properties || [];
          if (mutProps.length > 0) {
            mutProps.forEach((mutProp: any) => {
              if (!mutProp || !mutProp.key) return;

              const mutName = mutProp.key.name || mutProp.key.value;
              if (!mutName) return;

              localFunctionNames.add(mutName);
              functionNames.add(mutName);
              returnProperties.push(mutName);

              // Handle both ObjectMethod (shorthand) and ObjectProperty (with value)
              let mutValue: any = null;
              let mutBody: any = null;
              let mutParams: any[] = [];

              if (mutProp.type === "ObjectMethod") {
                // Shorthand method: INCREMENT(state) { ... }
                mutValue = mutProp;
                mutBody = mutProp.body;
                mutParams = mutProp.params || [];
              } else if (mutProp.value) {
                // Property with value: INCREMENT: function(state) { ... }
                mutValue = mutProp.value;
                if (
                  mutValue.type === "FunctionExpression" ||
                  mutValue.type === "ArrowFunctionExpression"
                ) {
                  mutBody = mutValue.body;
                  mutParams = mutValue.params || [];
                } else if (mutValue.type === "ObjectMethod") {
                  mutBody = mutValue.body;
                  mutParams = mutValue.params || [];
                }
              }

              if (!mutBody) return;

              // Remove state parameter (first param)
              const newParams =
                mutParams.length > 0 &&
                mutParams[0] &&
                mutParams[0].name === "state"
                  ? mutParams.slice(1)
                  : mutParams;

              // Transform body: state.xxx → variableName.value or variableName.xxx
              let transformedBody = mutBody;
              if (mutBody && mutBody.type === "BlockStatement") {
                transformedBody = transformStateReferencesInBody(
                  j,
                  mutBody,
                  stateProperties
                );
              }

              setupStatements.push(
                j.functionDeclaration(
                  j.identifier(mutName),
                  newParams,
                  transformedBody || j.blockStatement([])
                )
              );
            });
          }
          hasChanges = true;
        }

        // Step 4: Extract actions and convert to functions
        const actionsProp = properties.find(
          (p: any) => p.key && p.key.name === "actions"
        );
        if (
          actionsProp &&
          actionsProp.value &&
          actionsProp.value.type === "ObjectExpression"
        ) {
          const actionProps = actionsProp.value.properties || [];
          if (actionProps.length > 0) {
            actionProps.forEach((actionProp: any) => {
              if (!actionProp || !actionProp.key) return;

              const actionName = actionProp.key.name || actionProp.key.value;
              if (!actionName || localFunctionNames.has(actionName)) return;

              localFunctionNames.add(actionName);
              functionNames.add(actionName);
              returnProperties.push(actionName);

              // Handle both ObjectMethod (shorthand) and ObjectProperty (with value)
              let actionValue: any = null;
              let actionBody: any = null;
              let actionParams: any[] = [];

              if (actionProp.type === "ObjectMethod") {
                // Shorthand method: increment({ commit }) { ... }
                actionValue = actionProp;
                actionBody = actionProp.body;
                actionParams = actionProp.params || [];
              } else if (actionProp.value) {
                // Property with value: increment: function({ commit }) { ... }
                actionValue = actionProp.value;
                if (
                  actionValue.type === "FunctionExpression" ||
                  actionValue.type === "ArrowFunctionExpression"
                ) {
                  actionBody = actionValue.body;
                  actionParams = actionValue.params || [];
                } else if (actionValue.type === "ObjectMethod") {
                  actionBody = actionValue.body;
                  actionParams = actionValue.params || [];
                }
              }

              if (!actionBody) return;

              // Remove { commit } or commit from parameters
              // In Pinia, actions don't receive context, so we remove destructured parameters
              const cleanedParams = actionParams.filter((param: any) => {
                // Remove destructured parameters like { commit }, { commit, dispatch }, etc.
                if (param.type === "ObjectPattern") {
                  // Check if it only contains commit/dispatch/state/getters (Vuex context)
                  const properties = param.properties || [];
                  const vuexContextProps = [
                    "commit",
                    "dispatch",
                    "state",
                    "getters",
                    "rootState",
                    "rootGetters",
                  ];
                  const hasOnlyVuexProps = properties.every((p: any) => {
                    const keyName = p.key?.name || p.key?.value;
                    return vuexContextProps.includes(keyName);
                  });
                  return !hasOnlyVuexProps; // Keep if it has non-Vuex properties
                }
                // Keep non-destructured parameters
                return true;
              });

              // Transform commit() calls and state references
              let transformedBody = actionBody;
              if (actionBody && actionBody.type === "BlockStatement") {
                // First transform commit() calls to direct function calls
                transformedBody = transformCommitCalls(
                  j,
                  actionBody,
                  localFunctionNames
                );
                // Then transform state references
                transformedBody = transformStateReferencesInBody(
                  j,
                  transformedBody,
                  stateProperties
                );
              }

              setupStatements.push(
                j.functionDeclaration(
                  j.identifier(actionName),
                  cleanedParams,
                  transformedBody || j.blockStatement([])
                )
              );
            });
          }
          hasChanges = true;
        }

        // Step 5: Create return statement
        // Map original getter names to renamed names in return
        const returnPropertiesAST = returnProperties.map((name: string) => {
          // Check if this is a renamed getter that should use original name in return
          let originalName: string | undefined;
          for (const [orig, renamed] of getterRenames.entries()) {
            if (renamed === name) {
              originalName = orig;
              break;
            }
          }

          if (originalName) {
            // Return with original name pointing to renamed variable
            return j.property(
              "init",
              j.identifier(originalName),
              j.identifier(name)
            );
          }
          return j.property("init", j.identifier(name), j.identifier(name));
        });
        setupStatements.push(
          j.returnStatement(j.objectExpression(returnPropertiesAST))
        );

        // Step 6: Create setup function and defineStore call
        const setupFunction = j.arrowFunctionExpression(
          [],
          j.blockStatement(setupStatements)
        );
        const storeId = j.literal(storeName);
        const defineStoreCall = j.callExpression(j.identifier("defineStore"), [
          storeId,
          setupFunction,
        ]);

        // Replace new Vuex.Store() with defineStore()
        if (path.parent && path.parent.value) {
          j(path).replaceWith(defineStoreCall);
        } else {
          path.value = defineStoreCall;
        }
        hasChanges = true;
      }
    }
  });

  // Add imports for ref, reactive, computed
  if (hasChanges && imports.size > 0) {
    const importSpecifiers = Array.from(imports).map((imp) =>
      j.importSpecifier(j.identifier(imp))
    );
    const importStatement = j.importDeclaration(
      importSpecifiers,
      j.literal("vue")
    );

    // Check if pinia import exists, add vue import before it
    const existingImports = root.find(j.ImportDeclaration);
    let inserted = false;
    existingImports.forEach((impPath: any) => {
      if (impPath.value.source.value === "pinia" && !inserted) {
        j(impPath).insertBefore(importStatement);
        inserted = true;
      }
    });

    if (!inserted) {
      const program = root.get().node.program;
      if (program && program.body) {
        program.body.unshift(importStatement);
      }
    }
  }

  // Remove Vue.use(Vuex) if present
  root.find(j.CallExpression).forEach((path: any) => {
    if (
      path.value.callee &&
      path.value.callee.type === "MemberExpression" &&
      path.value.callee.object &&
      path.value.callee.object.type === "Identifier" &&
      path.value.callee.object.name === "Vue" &&
      path.value.callee.property &&
      path.value.callee.property.type === "Identifier" &&
      path.value.callee.property.name === "use" &&
      path.value.arguments &&
      path.value.arguments.length > 0 &&
      path.value.arguments[0] &&
      path.value.arguments[0].type === "Identifier" &&
      path.value.arguments[0].name === "Vuex"
    ) {
      let currentPath: any = path;
      while (currentPath && currentPath.parent) {
        const parentValue = currentPath.parent.value;
        if (parentValue && parentValue.type === "ExpressionStatement") {
          j(currentPath.parent).remove();
          hasChanges = true;
          break;
        }
        currentPath = currentPath.parent;
      }
    }
  });

  // Remove Vuex import if present
  root.find(j.ImportDeclaration).forEach((path: any) => {
    if (path.value && path.value.source && path.value.source.value === "vuex") {
      j(path).remove();
      hasChanges = true;
    }
  });

  // Add import for defineStore if needed
  if (hasChanges) {
    const existingImports = root.find(j.ImportDeclaration);
    let hasPiniaImport = false;

    existingImports.forEach((path: any) => {
      if (path.value.source && path.value.source.value === "pinia") {
        hasPiniaImport = true;
        const specifiers = path.value.specifiers || [];
        const hasDefineStore = specifiers.some(
          (s: any) => s.imported && s.imported.name === "defineStore"
        );
        if (!hasDefineStore) {
          specifiers.push(j.importSpecifier(j.identifier("defineStore")));
          path.value.specifiers = specifiers;
        }
      }
    });

    if (!hasPiniaImport) {
      const importStatement = j.importDeclaration(
        [j.importSpecifier(j.identifier("defineStore"))],
        j.literal("pinia")
      );
      const program = root.get().node.program;
      if (program && program.body) {
        program.body.unshift(importStatement);
      }
    }
  }

  let resultCode = hasChanges ? root.toSource() : fileInfo.source;

  // Add TypeScript types if enabled
  if (enableTypeScript && hasChanges) {
    const refProps = Array.from(refProperties);
    const computedProps = Array.from(computedProperties);
    const funcNames = Array.from(functionNames);
    const stateTypes = Object.fromEntries(statePropertyTypes);

    // Always call addTypeScriptTypesToStore if we have any properties or state types
    if (
      refProps.length > 0 ||
      computedProps.length > 0 ||
      funcNames.length > 0 ||
      Object.keys(stateTypes).length > 0
    ) {
      const computedTypes = Object.fromEntries(computedReturnTypes);
      const objectDetails = Object.fromEntries(objectPropertyDetails);

      resultCode = addTypeScriptTypesToStore(resultCode, {
        refProperties: refProps,
        computedProperties: computedProps,
        functionNames: funcNames,
        statePropertyTypes: stateTypes,
        computedReturnTypes: computedTypes,
        objectPropertyDetails: objectDetails,
      });
    }
  }

  return resultCode;
};

/**
 * Transform state references in an expression
 */
function transformStateReferencesInExpression(
  j: any,
  expression: any,
  stateProperties: Map<string, { isObject: boolean; value: any }>
): any {
  if (!expression) return expression;

  // Transform the expression as a string, then parse back
  const exprCode = j(expression).toSource();
  let transformedCode = exprCode;

  // Replace state references - handle nested properties first
  // Process in order: longest matches first (nested properties), then simple properties
  const sortedProps = Array.from(stateProperties.entries()).sort((a, b) => {
    // Sort by depth (objects first, then refs)
    if (a[1].isObject && !b[1].isObject) return -1;
    if (!a[1].isObject && b[1].isObject) return 1;
    return 0;
  });

  sortedProps.forEach(([propName, info]) => {
    // Escape propName for regex
    const escapedName = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (info.isObject) {
      // For reactive objects: state.user.name → user.name
      const nestedPattern = new RegExp(
        `state\\.${escapedName}(\\.([a-zA-Z_$][a-zA-Z0-9_$]*))+`,
        "g"
      );
      transformedCode = transformedCode.replace(
        nestedPattern,
        (match: string) => {
          return match.replace(/^state\./, "");
        }
      );
      // Also handle direct state.user → user
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        propName
      );
    } else {
      // For refs: state.count → count.value
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}\\.`, "g"),
        `${propName}.value.`
      );
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        `${propName}.value`
      );
    }
  });

  // Parse back to expression
  try {
    const newRoot = j(transformedCode);
    const program = newRoot.find(j.Program).paths()[0];
    if (program && program.value.body && program.value.body.length > 0) {
      const firstStmt = program.value.body[0];
      if (firstStmt.type === "ExpressionStatement") {
        return firstStmt.expression;
      }
      // If it's a return statement, extract the expression
      if (firstStmt.type === "ReturnStatement" && firstStmt.argument) {
        return firstStmt.argument;
      }
    }
  } catch (e) {
    // If parsing fails, return original expression
    return expression;
  }

  return expression;
}

/**
 * Transform state references in a BlockStatement body
 */
function transformStateReferencesInBody(
  j: any,
  body: any,
  stateProperties: Map<string, { isObject: boolean; value: any }>
): any {
  if (!body || body.type !== "BlockStatement") return body;

  // Transform the entire body as a string, then parse back
  const bodyCode = j(body).toSource();
  let transformedCode = bodyCode;

  // Replace state references - handle nested properties first
  // Process in order: longest matches first (nested properties), then simple properties
  const sortedProps = Array.from(stateProperties.entries()).sort((a, b) => {
    // Sort by depth (objects first, then refs)
    if (a[1].isObject && !b[1].isObject) return -1;
    if (!a[1].isObject && b[1].isObject) return 1;
    return 0;
  });

  sortedProps.forEach(([propName, info]) => {
    // Escape propName for regex
    const escapedName = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (info.isObject) {
      // For reactive objects: state.user.name → user.name, state.user.preferences.theme → user.preferences.theme
      // Match state.propName.anything (including deeply nested) - match the longest path first
      // Pattern: state.propName.anything (at least one dot after propName)
      const nestedPattern = new RegExp(
        `state\\.${escapedName}(\\.([a-zA-Z_$][a-zA-Z0-9_$]*))+`,
        "g"
      );
      transformedCode = transformedCode.replace(
        nestedPattern,
        (match: string) => {
          // Remove 'state.' prefix
          return match.replace(/^state\./, "");
        }
      );
      // Also handle direct state.user → user (must come after nested to avoid double replacement)
      // Match state.user not followed by a dot (end of property access)
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        propName
      );
    } else {
      // For refs: state.count → count.value, state.items → items.value
      // Must match state.items.length, state.items.push, etc.
      // Match state.items followed by a dot (method/property access)
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}\\.`, "g"),
        `${propName}.value.`
      );
      // Also match state.items at end of expression
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        `${propName}.value`
      );
    }
  });

  // Parse back to BlockStatement
  try {
    const newRoot = j(transformedCode);
    const program = newRoot.find(j.Program).paths()[0];
    if (program && program.value.body && program.value.body.length > 0) {
      // Extract statements from program body
      const statements = program.value.body;
      // Filter out empty block statements and unwrap single-statement blocks
      const cleanedStatements: any[] = [];
      statements.forEach((stmt: any) => {
        if (stmt.type === "BlockStatement" && stmt.body) {
          // Unwrap block statements - add their contents directly
          stmt.body.forEach((innerStmt: any) => {
            cleanedStatements.push(innerStmt);
          });
        } else if (stmt.type !== "EmptyStatement") {
          // Skip empty statements
          cleanedStatements.push(stmt);
        }
      });
      return j.blockStatement(
        cleanedStatements.length > 0 ? cleanedStatements : body.body
      );
    }
  } catch (e) {
    // If parsing fails, return original body
    return body;
  }

  return body;
}

/**
 * Transform commit('MUTATION_NAME', payload) to direct function calls
 */
function transformCommitCalls(
  j: any,
  body: any,
  functionNames: Set<string>
): any {
  if (!body || body.type !== "BlockStatement") return body;

  // Transform commit() calls using string replacement for better reliability
  const bodyCode = j(body).toSource();
  let transformedCode = bodyCode;

  // Replace commit('FUNCTION_NAME', ...) with FUNCTION_NAME(...)
  functionNames.forEach((funcName) => {
    // Escape function name for regex
    const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match: commit('FUNC_NAME', payload) - with payload
    const commitWithPayload = new RegExp(
      `commit\\s*\\(\\s*['"]${escapedName}['"]\\s*,\\s*([^)]+)\\)`,
      "g"
    );
    transformedCode = transformedCode.replace(
      commitWithPayload,
      (_match: string, payload: string) => {
        return `${funcName}(${payload.trim()})`;
      }
    );

    // Match: commit('FUNC_NAME') - without payload
    const commitWithoutPayload = new RegExp(
      `commit\\s*\\(\\s*['"]${escapedName}['"]\\s*\\)`,
      "g"
    );
    transformedCode = transformedCode.replace(commitWithoutPayload, () => {
      return `${funcName}()`;
    });
  });

  // Also handle destructured commit: { commit } → direct calls
  // This is handled by the above patterns

  // Parse back to BlockStatement
  try {
    const newRoot = j(transformedCode);
    const program = newRoot.find(j.Program).paths()[0];
    if (program && program.value.body && program.value.body.length > 0) {
      const statements = program.value.body;
      // Filter out empty block statements and unwrap single-statement blocks
      const cleanedStatements: any[] = [];
      statements.forEach((stmt: any) => {
        if (stmt.type === "BlockStatement" && stmt.body) {
          stmt.body.forEach((innerStmt: any) => {
            cleanedStatements.push(innerStmt);
          });
        } else if (stmt.type !== "EmptyStatement") {
          cleanedStatements.push(stmt);
        }
      });
      return j.blockStatement(
        cleanedStatements.length > 0 ? cleanedStatements : body.body
      );
    }
  } catch (e) {
    // If parsing fails, return original body
    return body;
  }

  return body;
}

/**
 * Post-process generated Pinia store code to add TypeScript type annotations
 */
function addTypeScriptTypesToStore(
  code: string,
  context: {
    refProperties: string[];
    computedProperties: string[];
    functionNames: string[];
    statePropertyTypes?: Record<string, string>;
    computedReturnTypes?: Record<string, string>;
    objectPropertyDetails?: Record<string, any>;
  }
): string {
  let result = code;

  // Early return if no properties to type
  if (
    context.refProperties.length === 0 &&
    context.computedProperties.length === 0 &&
    context.functionNames.length === 0
  ) {
    return result;
  }

  // Track interfaces to generate for arrays and objects
  const arrayInterfaces = new Map<string, string>(); // Interface name → property name
  const objectInterfaces = new Map<
    string,
    { name: string; properties: string[] }
  >(); // Interface name → properties

  // Generate TypeScript interfaces for store state if we have state properties
  if (
    context.statePropertyTypes &&
    Object.keys(context.statePropertyTypes).length > 0
  ) {
    const interfaceProps: string[] = [];
    Object.entries(context.statePropertyTypes).forEach(
      ([propName, propType]) => {
        // Check if this is an array type that needs an interface
        if (propType === "any[]") {
          // Generate interface name from property name (plural → singular, capitalized)
          const interfaceName = pluralToSingularInterface(propName);
          arrayInterfaces.set(interfaceName, propName);
          interfaceProps.push(`  ${propName}: ${interfaceName}[];`);
        } else if (propType === "object") {
          // Generate interface name from property name (capitalize first letter)
          const interfaceName =
            propName.charAt(0).toUpperCase() + propName.slice(1);

          // Extract properties from object AST if available
          let objectProperties: string[] = [];
          if (
            context.objectPropertyDetails &&
            context.objectPropertyDetails[propName]
          ) {
            objectProperties = extractObjectProperties(
              context.objectPropertyDetails[propName]
            );
          }

          objectInterfaces.set(interfaceName, {
            name: interfaceName,
            properties: objectProperties,
          });
          interfaceProps.push(`  ${propName}: ${interfaceName};`);
        } else {
          interfaceProps.push(`  ${propName}: ${propType};`);
        }
      }
    );

    // Generate interfaces for arrays and objects
    const arrayInterfaceCodes: string[] = [];
    arrayInterfaces.forEach((_propName, interfaceName) => {
      arrayInterfaceCodes.push(`interface ${interfaceName} {}`);
    });

    // Generate interfaces for objects with properties
    const objectInterfaceCodes: string[] = [];
    objectInterfaces.forEach(({ name, properties }) => {
      if (properties.length > 0) {
        // Generate interface with properties
        const props = properties.map((prop) => `  ${prop}`).join("\n");
        objectInterfaceCodes.push(`interface ${name} {\n${props}\n}`);
      } else {
        // Empty interface if no properties found
        objectInterfaceCodes.push(`interface ${name} {}`);
      }
    });

    // Combine StoreState interface, array interfaces, and object interfaces
    const allInterfaces: string[] = [];
    if (interfaceProps.length > 0) {
      allInterfaces.push(
        `interface StoreState {\n${interfaceProps.join("\n")}\n}`
      );
    }
    if (arrayInterfaceCodes.length > 0) {
      allInterfaces.push(...arrayInterfaceCodes);
    }
    if (objectInterfaceCodes.length > 0) {
      allInterfaces.push(...objectInterfaceCodes);
    }

    if (allInterfaces.length > 0) {
      const interfaceCode = allInterfaces.join("\n\n");

      // Insert interfaces after the last import statement
      // Find all import statements
      const importRegex = /^import\s+.*$/gm;
      const imports = result.match(importRegex);

      if (imports && imports.length > 0) {
        // Find the last import statement
        const lastImport = imports[imports.length - 1];
        const lastImportIndex = result.lastIndexOf(lastImport);
        const afterLastImport = lastImportIndex + lastImport.length;

        // Insert interfaces after the last import, with proper spacing
        result =
          result.slice(0, afterLastImport) +
          "\n\n" +
          interfaceCode +
          "\n" +
          result.slice(afterLastImport);
      } else {
        // No imports found, insert at the beginning
        result = interfaceCode + "\n\n" + result;
      }
    }
  }

  // Add types to ref() calls: ref(0) → ref<number>(0)
  context.refProperties.forEach((prop) => {
    // Match: const propName = ref(value)
    // Escape prop name for regex
    const escapedProp = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Pattern: const propName = ref(value) - capture everything before ref(, the value, and the closing )
    // Handle both single and double quotes in the code
    const refPattern = new RegExp(
      `(const\\s+${escapedProp}\\s*=\\s*ref)(\\()([^)]+)(\\))`,
      "g"
    );

    // Use replace with a function to handle each match
    result = result.replace(
      refPattern,
      (_match, before, openParen, value, closeParen) => {
        // Infer type from value
        let type = inferTypeFromValueString(value.trim());

        // Check if we have a custom interface for this property
        if (context.statePropertyTypes) {
          const propType = context.statePropertyTypes[prop];

          // If it's an array (any[]), use the interface name
          if (propType === "any[]") {
            const interfaceName = pluralToSingularInterface(prop);
            type = `${interfaceName}[]`;
          }
          // If it's an object, use the interface name
          else if (propType === "object") {
            const interfaceName = prop.charAt(0).toUpperCase() + prop.slice(1);
            type = interfaceName;
          }
          // If it's null but property name suggests it should be an object/array
          else if (propType === "null" || propType.includes("| null")) {
            // Infer from property name: posts → Post[], currentPost → Post | null
            if (prop.endsWith('s') || prop.match(/List|Items|Array$/i)) {
              const interfaceName = pluralToSingularInterface(prop);
              type = `${interfaceName}[] | null`;
            } else {
              // Likely an object, infer interface name from property name
              const interfaceName = prop.charAt(0).toUpperCase() + prop.slice(1);
              type = `${interfaceName} | null`;
            }
          }
        }
        
        // Handle null values - infer type from property name if value is null
        if (value.trim() === "null" || value.trim() === "undefined") {
          if (!context.statePropertyTypes || !context.statePropertyTypes[prop]) {
            // Infer from property name
            if (prop.endsWith('s') || prop.match(/List|Items|Array$/i)) {
              const interfaceName = pluralToSingularInterface(prop);
              type = `${interfaceName}[] | null`;
            } else if (prop !== "loading" && prop !== "isLoading") {
              // Likely an object (but not boolean flags)
              const interfaceName = prop.charAt(0).toUpperCase() + prop.slice(1);
              type = `${interfaceName} | null`;
            } else {
              type = "boolean";
            }
          }
        }

        // Correct format: ref<number>(value) not ref(<number>value)
        return `${before}<${type}>${openParen}${value}${closeParen}`;
      }
    );
  });

  // Add types to computed() calls: computed(() => ...) → computed<string>(() => ...)
  context.computedProperties.forEach((prop) => {
    // Match: const propName = computed(() => ...)
    // Escape prop name for regex
    const escapedProp = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const computedPattern = new RegExp(
      `(const\\s+${escapedProp}\\s*=\\s*computed)(\\()([^)]+)(\\))`,
      "g"
    );
    result = result.replace(
      computedPattern,
      (_match, before, openParen, fn, closeParen) => {
        // Use inferred return type if available
        let returnType = context.computedReturnTypes?.[prop];
        
        // If no return type inferred, try to infer from the function body
        if (!returnType || returnType === "any") {
          // Check if computed returns a ref value (e.g., posts.value, currentPost.value)
          const fnBody = fn.toString();
          
          // Pattern: () => posts.value or () => currentPost.value
          const refValuePattern = /\(\)\s*=>\s*(\w+)\.value/;
          const refMatch = fnBody.match(refValuePattern);
          if (refMatch) {
            const refVarName = refMatch[1];
            // Check if this ref has a type in statePropertyTypes
            if (context.statePropertyTypes) {
              const refType = context.statePropertyTypes[refVarName];
              if (refType) {
                // Extract the base type (remove | null if present)
                returnType = refType.replace(/\s*\|\s*null/g, '');
                // If it's an array type, use it directly
                if (refType.includes('[]')) {
                  returnType = refType.replace(/\s*\|\s*null/g, '');
                }
              }
            }
          }
          
          // Pattern: () => posts (without .value)
          const directRefPattern = /\(\)\s*=>\s*(\w+)(?!\.)/;
          const directRefMatch = fnBody.match(directRefPattern);
          if (directRefMatch && (!returnType || returnType === "any")) {
            const refVarName = directRefMatch[1];
            if (context.statePropertyTypes) {
              const refType = context.statePropertyTypes[refVarName];
              if (refType) {
                returnType = refType.replace(/\s*\|\s*null/g, '');
              }
            }
          }
          
          // Pattern: () => posts.value.length (number)
          if (fnBody.includes('.length')) {
            returnType = "number";
          }
          
          // Pattern: () => Array.from(...) (string[])
          if (fnBody.includes('Array.from')) {
            returnType = "string[]";
          }
          
          // Default to any if still not found
          if (!returnType || returnType === "any") {
            returnType = "any";
          }
        }
        
        // Correct format: computed<number>(() => ...) not computed(<number>() => ...)
        return `${before}<${returnType}>${openParen}${fn}${closeParen}`;
      }
    );
  });

  // Add return types to functions (mutations and actions)
  context.functionNames.forEach((funcName) => {
    // Escape function name for regex
    const escapedFuncName = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match: function functionName(param1, param2) {
    // Pattern needs to capture: function FUNC_NAME(params) {
    // Fix: capture the entire function declaration including the opening brace
    const functionPattern = new RegExp(
      `(function\\s+${escapedFuncName}\\s*\\(([^)]*)\\)\\s*\\{)`,
      "g"
    );

    // Find and replace function declarations
    // Use exec to find the first match and replace it
    let match;
    while ((match = functionPattern.exec(result)) !== null) {
      const fullMatch = match[0];
      const paramList = match[2] || "";

      // Add types to parameters
      let typedParams = paramList;
      if (paramList && paramList.trim()) {
        const paramNames = paramList
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean);
        typedParams = paramNames
          .map((paramName: string) => {
            const paramType = inferParameterType(paramName);
            return `${paramName}: ${paramType}`;
          })
          .join(", ");
      }
      // Add return type annotation
      const replacement = `function ${funcName}(${typedParams}): void {`;
      result = result.replace(fullMatch, replacement);
      // Only replace once per function name
      break;
    }

    // Match: const functionName = (param1, param2) => {
    const arrowPattern = new RegExp(
      `(const\\s+${escapedFuncName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*\\{)`,
      "g"
    );
    result = result.replace(arrowPattern, (_match, paramList) => {
      let typedParams = paramList;
      if (paramList.trim()) {
        const paramNames = paramList
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean);
        typedParams = paramNames
          .map((paramName: string) => {
            const paramType = inferParameterType(paramName);
            return `${paramName}: ${paramType}`;
          })
          .join(", ");
      }
      return `const ${funcName} = (${typedParams}): void => {`;
    });
  });

  return result;
}

/**
 * Infer TypeScript type for a function parameter based on its name
 */
function inferParameterType(paramName: string): string {
  // Remove common prefixes/suffixes and infer type from name
  const lowerName = paramName.toLowerCase();

  // Common patterns
  if (
    lowerName.includes("id") ||
    lowerName.includes("index") ||
    lowerName.includes("count")
  ) {
    return "number";
  }
  if (
    lowerName.includes("name") ||
    lowerName.includes("text") ||
    lowerName.includes("message") ||
    lowerName.includes("title")
  ) {
    return "string";
  }
  if (
    lowerName.includes("is") ||
    lowerName.includes("has") ||
    lowerName.includes("should")
  ) {
    return "boolean";
  }
  if (
    lowerName.includes("list") ||
    lowerName.includes("items") ||
    lowerName.includes("array")
  ) {
    return "any[]";
  }
  if (
    lowerName.includes("obj") ||
    lowerName.includes("data") ||
    lowerName.includes("config")
  ) {
    return "Record<string, any>";
  }
  if (lowerName.includes("event") || lowerName.includes("e")) {
    return "Event";
  }

  // Default to any if we can't infer
  return "any";
}

/**
 * Infer TypeScript type from a JavaScript value string
 */
function inferTypeFromValueString(value: string): string {
  // Remove quotes to check type
  const trimmed = value.trim();

  // String literal
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return "string";
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return "number";
  }

  // Boolean literal
  if (trimmed === "true" || trimmed === "false") {
    return "boolean";
  }

  // Array literal - try to detect if it contains objects
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    // Check if array contains object literals: [{ id: 1, name: 'test' }]
    const arrayContent = trimmed.slice(1, -1).trim();
    if (arrayContent.startsWith("{") && arrayContent.includes(":")) {
      // Array contains objects - will be handled by AST analysis
      return "any[]";
    }
    return "any[]";
  }

  // Object literal
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    // Return a special marker to indicate this is an object that needs an interface
    return "object";
  }

  // null or undefined
  if (trimmed === "null" || trimmed === "undefined") {
    return "null";
  }

  return "any";
}

/**
 * Infer TypeScript type from an AST node (improved version)
 */
function inferTypeFromAST(astNode: any): string {
  if (!astNode) {
    return "any";
  }

  // Use existing inferTypeFromASTValue for basic types
  const basicType = inferTypeFromASTValue(astNode);
  if (basicType !== "any" && basicType !== "any[]") {
    return basicType;
  }

  // Handle ArrayExpression - check if it contains objects
  if (astNode.type === "ArrayExpression") {
    if (astNode.elements && astNode.elements.length > 0) {
      const firstElement = astNode.elements[0];
      if (firstElement && firstElement.type === "ObjectExpression") {
        // Array of objects - return marker for interface generation
        return "any[]";
      }
    }
    return "any[]";
  }

  // Handle ObjectExpression
  if (astNode.type === "ObjectExpression") {
    return "object";
  }

  // Handle NullLiteral
  if (astNode.type === "NullLiteral" || (astNode.type === "Literal" && astNode.value === null)) {
    return "null";
  }

  return basicType;
}

/**
 * Convert plural property name to singular interface name
 * Examples: items → Item, users → User, products → Product, customItems → CustomItem
 * Handles various plural forms and naming conventions (camelCase, PascalCase, etc.)
 */
function pluralToSingularInterface(pluralName: string): string {
  // Common irregular plurals
  const irregularPlurals: Record<string, string> = {
    children: "Child",
    people: "Person",
    men: "Man",
    women: "Woman",
    feet: "Foot",
    teeth: "Tooth",
    mice: "Mouse",
    geese: "Goose",
    data: "Datum", // Though 'Data' is often used as singular in programming
  };

  const lowerName = pluralName.toLowerCase();

  // Check irregular plurals first
  if (irregularPlurals[lowerName]) {
    return irregularPlurals[lowerName];
  }

  // Handle camelCase/PascalCase: preserve case structure
  // e.g., customItems → CustomItem, userList → UserListItem
  if (/([a-z])([A-Z])/.test(pluralName)) {
    // Has camelCase pattern - preserve the structure
    // Capitalize first letter, keep rest as is
    let result = pluralName.charAt(0).toUpperCase() + pluralName.slice(1);

    // Remove trailing 's' if present (but preserve camelCase structure)
    // customItems → CustomItem (remove 's' at end)
    if (result.endsWith("s") && result.length > 1) {
      // Check if it's a simple 's' at the end or part of a word
      // If the second-to-last char is lowercase, it's likely a plural 's'
      const secondLast = result[result.length - 2];
      if (secondLast && secondLast === secondLast.toLowerCase()) {
        result = result.slice(0, -1);
      }
    }

    return result;
  }

  // Handle lowercase names: convert to lowercase first, then process
  // Handle common patterns: words ending in -ies, -es, -s
  // -ies → -y (cities → City)
  if (lowerName.endsWith("ies") && lowerName.length > 3) {
    const base = lowerName.slice(0, -3);
    return base.charAt(0).toUpperCase() + base.slice(1) + "y";
  }

  // -es → remove (boxes → Box, classes → Class)
  if (lowerName.endsWith("es") && lowerName.length > 2) {
    const base = lowerName.slice(0, -2);
    if (base.length > 0) {
      return base.charAt(0).toUpperCase() + base.slice(1);
    }
  }

  // Simple plural: remove 's' at the end
  if (lowerName.endsWith("s") && lowerName.length > 1) {
    const singular = lowerName.slice(0, -1);
    // Capitalize first letter
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }

  // Default: capitalize first letter
  return pluralName.charAt(0).toUpperCase() + pluralName.slice(1);
}

/**
 * Extract TypeScript properties from an object AST
 * Converts object properties to TypeScript interface properties
 */
function extractObjectProperties(objectAST: any): string[] {
  if (!objectAST || objectAST.type !== "ObjectExpression") {
    return [];
  }

  const properties: string[] = [];
  const props = objectAST.properties || [];

  props.forEach((prop: any) => {
    if (prop && prop.key) {
      const propName = prop.key.name || prop.key.value;
      if (propName) {
        // Infer type from property value
        const propType = inferTypeFromASTValue(prop.value);
        properties.push(`${propName}: ${propType};`);
      }
    }
  });

  return properties;
}

/**
 * Infer TypeScript type from an AST node value
 */
function inferTypeFromASTValue(valueAST: any): string {
  if (!valueAST) {
    return "any";
  }

  // String literal
  if (
    valueAST.type === "StringLiteral" ||
    (valueAST.type === "Literal" && typeof valueAST.value === "string")
  ) {
    return "string";
  }

  // Number literal
  if (
    valueAST.type === "NumericLiteral" ||
    (valueAST.type === "Literal" && typeof valueAST.value === "number")
  ) {
    return "number";
  }

  // Boolean literal
  if (
    valueAST.type === "BooleanLiteral" ||
    (valueAST.type === "Literal" && typeof valueAST.value === "boolean")
  ) {
    return "boolean";
  }

  // Array literal
  if (valueAST.type === "ArrayExpression") {
    return "any[]";
  }

  // Object literal - recursive
  if (valueAST.type === "ObjectExpression") {
    const props = extractObjectProperties(valueAST);
    if (props.length > 0) {
      return `{\n    ${props.join("\n    ")}\n  }`;
    }
    return "Record<string, any>";
  }

  // Null or undefined
  if (
    valueAST.type === "NullLiteral" ||
    (valueAST.type === "Literal" && valueAST.value === null)
  ) {
    return "null";
  }

  // Identifier (could be a variable reference)
  if (valueAST.type === "Identifier") {
    return "any"; // Can't infer from identifier alone
  }

  return "any";
}

/**
 * Infer TypeScript type from an AST expression (for computed return types)
 */
function inferTypeFromASTExpression(expressionAST: any): string {
  if (!expressionAST) {
    return "any";
  }

  // Binary expressions: a + b, a * b, etc.
  if (expressionAST.type === "BinaryExpression") {
    const operator = expressionAST.operator;
    // Arithmetic operations typically return number
    if (["+", "-", "*", "/", "%"].includes(operator)) {
      return "number";
    }
    // Comparison operations return boolean
    if (["==", "===", "!=", "!==", "<", ">", "<=", ">="].includes(operator)) {
      return "boolean";
    }
    // String concatenation
    if (operator === "+") {
      // Could be string or number, check operands
      const leftType = inferTypeFromASTExpression(expressionAST.left);
      const rightType = inferTypeFromASTExpression(expressionAST.right);
      if (leftType === "string" || rightType === "string") {
        return "string";
      }
      return "number";
    }
  }

  // Unary expressions: !a, -a, etc.
  if (expressionAST.type === "UnaryExpression") {
    if (expressionAST.operator === "!") {
      return "boolean";
    }
    if (expressionAST.operator === "-" || expressionAST.operator === "+") {
      return "number";
    }
  }

  // Member expressions: state.count, items.length, user.name, etc.
  if (expressionAST.type === "MemberExpression") {
    const property = expressionAST.property;

    // Check for .length property (arrays)
    if (property && property.name === "length") {
      return "number";
    }

    // Check for property access on objects (e.g., user.name, user.age)
    // If the property is a string literal or identifier, try to infer type
    if (property) {
      const propName = property.name || property.value;

      // Common property names that suggest types
      if (
        propName === "name" ||
        propName === "email" ||
        propName === "title" ||
        propName === "description" ||
        propName === "message"
      ) {
        return "string";
      }
      if (
        propName === "age" ||
        propName === "count" ||
        propName === "id" ||
        propName === "price" ||
        propName === "index"
      ) {
        return "number";
      }
      if (
        propName === "isActive" ||
        propName === "enabled" ||
        propName === "visible" ||
        propName === "isAuthenticated"
      ) {
        return "boolean";
      }
    }

    // For other member expressions, try to infer from the object if possible
    // This is a simple heuristic - could be improved with more context
    return "any";
  }

  // Call expressions: Math.max(), etc.
  if (expressionAST.type === "CallExpression") {
    const callee = expressionAST.callee;
    if (callee && callee.type === "MemberExpression") {
      const object = callee.object;
      const property = callee.property;
      if (object && object.name === "Math" && property) {
        // Math functions typically return numbers
        return "number";
      }
      if (property && (property.name === "map" || property.name === "filter")) {
        return "any[]";
      }
      if (property && property.name === "toString") {
        return "string";
      }
    }
    // Function calls without context default to any
    return "any";
  }

  // Conditional expressions: a ? b : c
  if (expressionAST.type === "ConditionalExpression") {
    // Infer from both branches - take the first non-any type
    const consequentType = inferTypeFromASTExpression(expressionAST.consequent);
    const alternateType = inferTypeFromASTExpression(expressionAST.alternate);
    if (consequentType !== "any") return consequentType;
    if (alternateType !== "any") return alternateType;
    return "any";
  }

  // Literal values
  return inferTypeFromASTValue(expressionAST);
}
