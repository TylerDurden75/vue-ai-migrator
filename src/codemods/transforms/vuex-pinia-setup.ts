import { Transform, FileInfo, API } from "jscodeshift";
import {
  transformStateReferencesInBody,
  transformStateReferencesInExpression,
  transformCommitCalls,
} from "./vuex-pinia-helpers";
import {
  addTypeScriptTypesToStore,
  inferTypeFromAST,
  inferTypeFromValueString,
} from "./vuex-pinia-type-helpers";

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
        // For store/modules/cart/index.js → "cart"; for store/modules/cart.js → "cart"
        const fileName = fileInfo.path || "module";
        const parts = fileName.replace(/\.(js|ts)$/, "").split("/");
        const basename = parts[parts.length - 1] || "module";
        const moduleName =
          basename === "index" && parts.length > 1
            ? parts[parts.length - 2]
            : basename;

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

        // Extract store name from filename (store/index.js → "store" for root)
        const fileName = fileInfo.path || "store";
        const parts = fileName.replace(/\.(js|ts)$/, "").split("/");
        const basename = parts[parts.length - 1] || "main";
        const storeId =
          basename === "index" && parts.length > 1
            ? parts[parts.length - 2] // store/index.js → "store"
            : basename;
        const storeName = storeId.charAt(0).toUpperCase() + storeId.slice(1);
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
        const defineStoreId = j.literal(storeId);
        const defineStoreCall = j.callExpression(j.identifier("defineStore"), [
          defineStoreId,
          setupFunction,
        ]);

        // Replace new Vuex.Store() - convert export default to export const useXStore
        const parent = path.parent?.value;
        if (parent && parent.type === "ExportDefaultDeclaration") {
          j(path.parent).replaceWith(
            j.exportNamedDeclaration(
              j.variableDeclaration("const", [
                j.variableDeclarator(
                  j.identifier(useStoreName),
                  defineStoreCall,
                ),
              ])
            )
          );
        } else {
          j(path).replaceWith(defineStoreCall);
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

  // Normalize defineStore closing: }; }; }); → } }); (any whitespace between, allow trailing newline)
  if (resultCode.includes("defineStore")) {
    resultCode = resultCode.replace(
      /\}\s*;\s*\s+\}\s*;\s*\s+\}\s*\)\s*;\s*\s*$/m,
      "  }\n});"
    );
  }

  return resultCode;
};
