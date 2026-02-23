/**
 * AST-based mixin → composable transformation
 * Extracts data, methods, computed from mixin and generates real composable code
 */

import jscodeshift from "jscodeshift";
import type { MixinAnalysis } from "./mixin-analyzer";
import { mixinNameToComposable } from "./composable-gen";
import {
  getStoreMethodMap,
  getStoreConfigForModule,
  getMainStoreInfo,
} from "../post-migration-fixer/utils/store-analysis-cache";

export interface MixinTransformResult {
  success: boolean;
  code?: string;
  analysis: MixinAnalysis;
  error?: string;
}

function findProperty(properties: any[] | undefined, name: string) {
  return properties?.find((prop: any) => prop.key && prop.key.name === name);
}

/** Check if node is this.$store.getters.XXX */
function isStoreGettersChain(node: any): { getter: string } | null {
  if (
    node?.type !== "MemberExpression" ||
    node?.property?.type !== "Identifier"
  ) {
    return null;
  }
  const obj = node.object;
  if (obj?.type !== "MemberExpression" || obj?.property?.name !== "getters") {
    return null;
  }
  const storeObj = obj.object;
  if (
    storeObj?.type !== "MemberExpression" ||
    storeObj?.property?.name !== "$store" ||
    storeObj?.object?.type !== "ThisExpression"
  ) {
    return null;
  }
  return { getter: node.property.name };
}

function transformStoreRefs(
  j: any,
  root: any,
  storeReplacements: Map<string, { storeVar: string; storeName: string; importPath: string }>
) {
  root.find(j.MemberExpression).forEach((path: any) => {
    const info = isStoreGettersChain(path.value);
    if (!info) return;
    const config = storeReplacements.get(info.getter) ?? storeReplacements.get("__default") ?? {
      storeVar: "userStore",
      storeName: "useUserStore",
      importPath: "@/store/modules/user",
    };
    const { storeVar } = config;
    // Pinia store properties are refs - use .value to get the unwrapped value
    j(path).replaceWith(
      j.memberExpression(
        j.memberExpression(j.identifier(storeVar), j.identifier(info.getter)),
        j.identifier("value")
      )
    );
  });
}

function transformThisRefs(
  j: any,
  root: any,
  dataProps: Set<string>,
  computedProps: Set<string>,
  methodNames: Set<string>,
  injectNames: Set<string>
) {
  root.find(j.MemberExpression).forEach((path: any) => {
    const node = path.value;
    if (
      !node.object ||
      node.object.type !== "ThisExpression" ||
      !node.property ||
      node.property.type !== "Identifier"
    ) {
      return;
    }
    const name = node.property.name;
    if (name.startsWith("$")) return;

    if (injectNames.has(name)) {
      j(path).replaceWith(j.identifier(name));
    } else if (dataProps.has(name)) {
      j(path).replaceWith(
        j.memberExpression(j.identifier(name), j.identifier("value"))
      );
    } else if (computedProps.has(name) || methodNames.has(name)) {
      j(path).replaceWith(j.identifier(name));
    }
  });
}

/**
 * Transform mixin content to composable using AST.
 * Returns generated code or fallback to stub generation if parsing fails.
 */
export async function transformMixinToComposableAST(
  content: string,
  mixinName: string,
  enableTypeScript: boolean,
  projectRoot?: string
): Promise<MixinTransformResult> {
  const analysis: MixinAnalysis = {
    dataKeys: [],
    methodNames: [],
    computedNames: [],
    hasLifecycle: false,
  };

  const j = jscodeshift.withParser(enableTypeScript ? "tsx" : "babel");
  let root: any;
  try {
    root = j(content);
  } catch {
    return { success: false, analysis, error: "Parse failed" };
  }

  const imports = new Set<string>();
  const storeImportLines: Array<{ storeName: string; importPath: string }> = [];
  const statements: any[] = [];
  const dataProps = new Set<string>();
  const computedProps = new Set<string>();
  const methodNames = new Set<string>();
  const injectNames = new Set<string>();

  let componentObj: any = null;

  // export default { ... } or export default defineComponent({ ... })
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const decl = path.value.declaration;
    if (decl?.type === "ObjectExpression") {
      componentObj = decl;
    } else if (
      decl?.type === "CallExpression" &&
      decl.callee?.name === "defineComponent" &&
      decl.arguments?.[0]?.type === "ObjectExpression"
    ) {
      componentObj = decl.arguments[0];
    }
  });

  // export const X = { ... } (named export)
  if (!componentObj) {
    root.find(j.ExportNamedDeclaration).forEach((path: any) => {
      const decl = path.value.declaration;
      if (decl?.type === "VariableDeclaration" && decl.declarations?.length > 0) {
        const init = decl.declarations[0]?.init;
        if (init?.type === "ObjectExpression") {
          componentObj = init;
        } else if (
          init?.type === "CallExpression" &&
          init.callee?.name === "defineComponent" &&
          init.arguments?.[0]?.type === "ObjectExpression"
        ) {
          componentObj = init.arguments[0];
        }
      }
    });
  }

  if (!componentObj?.properties) {
    return { success: false, analysis, error: "No export default or named mixin object" };
  }

  const props = componentObj.properties;

  // Resolve store getters used in mixin (this.$store.getters.XXX → useUserStore)
  const storeReplacements = new Map<
    string,
    { storeVar: string; storeName: string; importPath: string }
  >();
  if (projectRoot) {
    try {
      const storeMethodMap = await getStoreMethodMap(projectRoot);
      const mainStoreInfo = await getMainStoreInfo(projectRoot);
      const gettersUsed = new Set<string>();
      j(componentObj).find(j.MemberExpression).forEach((path: any) => {
        const info = isStoreGettersChain(path.value);
        if (info) gettersUsed.add(info.getter);
      });
      for (const getter of gettersUsed) {
        const module = storeMethodMap[getter] ?? "user";
        const config = getStoreConfigForModule(module, mainStoreInfo);
        storeReplacements.set(getter, config);
      }
    } catch {
      /* store analysis may fail */
    }
  }

  // Store init statements (before other statements)
  const storeStatements: any[] = [];
  const seenStores = new Set<string>();
  for (const [, config] of storeReplacements) {
    if (seenStores.has(config.storeVar)) continue;
    seenStores.add(config.storeVar);
    storeImportLines.push({ storeName: config.storeName, importPath: config.importPath });
    storeStatements.push(
      j.variableDeclaration("const", [
        j.variableDeclarator(
          j.identifier(config.storeVar),
          j.callExpression(j.identifier(config.storeName), [])
        ),
      ])
    );
  }
  statements.push(...storeStatements);

  // Inject (first - may be used in data/computed/methods)
  const injectProp = findProperty(props, "inject");
  const injectValue = injectProp?.value ?? (injectProp?.params ? injectProp : null);
  if (injectProp && injectValue) {
    if (injectValue.type === "ArrayExpression" && injectValue.elements) {
      injectValue.elements.forEach((el: any) => {
        const key = el?.value ?? el?.name;
        if (key) {
          const varName = typeof key === "string" ? key : String(key);
          injectNames.add(varName);
          statements.push(
            j.variableDeclaration("const", [
              j.variableDeclarator(
                j.identifier(varName),
                j.callExpression(j.identifier("inject"), [j.literal(key)])
              ),
            ])
          );
        }
      });
    } else if (injectValue.type === "ObjectExpression" && injectValue.properties) {
      injectValue.properties.forEach((prop: any) => {
        const localName = prop.key?.name ?? prop.key?.value;
        if (!localName) return;
        const val = prop.value;
        let keyStr = localName;
        let defaultArg: any = null;
        if (val?.type === "ObjectExpression" && val.properties) {
          const fromProp = val.properties.find(
            (p: any) => p.key?.name === "from" || p.key?.value === "from"
          );
          const defaultProp = val.properties.find(
            (p: any) => p.key?.name === "default" || p.key?.value === "default"
          );
          if (fromProp?.value?.value) keyStr = fromProp.value.value;
          if (fromProp?.value?.name) keyStr = fromProp.value.name;
          if (defaultProp?.value) defaultArg = defaultProp.value;
        } else if (val?.type === "StringLiteral" || val?.type === "Literal") {
          keyStr = val.value;
        } else if (val?.type === "Identifier") {
          keyStr = val.name;
        }
        injectNames.add(localName);
        const injectArgs: any[] = [j.literal(keyStr)];
        if (defaultArg) {
          injectArgs.push(defaultArg);
          if (
            defaultArg.type === "ArrowFunctionExpression" ||
            defaultArg.type === "FunctionExpression"
          ) {
            injectArgs.push(j.booleanLiteral(true));
          }
        }
        statements.push(
          j.variableDeclaration("const", [
            j.variableDeclarator(
              j.identifier(localName),
              j.callExpression(j.identifier("inject"), injectArgs)
            ),
          ])
        );
      });
    }
    if (injectNames.size > 0) imports.add("inject");
  }

  // Data
  const dataProp = findProperty(props, "data");
  const dataValue = dataProp?.value ?? (dataProp?.params ? dataProp : null);
  if (dataProp && dataValue) {
    const body = dataValue.type === "ObjectMethod" ? dataValue.body : dataValue.body;
    const returnStmt = body?.body?.find((s: any) => s?.type === "ReturnStatement");
    const arg = returnStmt?.argument;

    if (arg?.type === "ObjectExpression" && arg.properties?.length) {
      arg.properties.forEach((prop: any) => {
        if (!prop.key?.name) return;
        const name = prop.key.name;
        analysis.dataKeys.push(name);
        dataProps.add(name);
        statements.push(
          j.variableDeclaration("const", [
            j.variableDeclarator(
              j.identifier(name),
              j.callExpression(j.identifier("ref"), [prop.value || j.literal(null)])
            ),
          ])
        );
        imports.add("ref");
      });
    }
  }

  // Computed
  const computedProp = findProperty(props, "computed");
  const computedValue =
    computedProp?.value ?? (computedProp?.type === "ObjectMethod" ? computedProp : null);
  if (computedProp && computedValue?.type === "ObjectExpression" && computedValue.properties) {
    computedValue.properties.forEach((compProp: any) => {
      if (compProp.type === "SpreadElement") return;
      const compVal = compProp.value ?? (compProp.type === "ObjectMethod" ? compProp : null);
      const name = compProp.key?.name ?? "computed";
      if (!compVal) return;

      analysis.computedNames.push(name);
      computedProps.add(name);

      const compBody = compVal.type === "ObjectMethod" ? compVal.body : compVal.body;
      let arrowArg: any;

      if (compBody?.type === "BlockStatement" && compBody.body) {
        // Use full body when multiple statements (e.g. const x = this.$store...; return x)
        const hasMultipleStmts = compBody.body.filter((s: any) => s?.type).length > 1;
        arrowArg = hasMultipleStmts
          ? compBody
          : (compBody.body.find((s: any) => s?.type === "ReturnStatement")?.argument ?? j.identifier("undefined"));
      } else {
        arrowArg = compBody ?? j.identifier("undefined");
      }

      statements.push(
        j.variableDeclaration("const", [
          j.variableDeclarator(
            j.identifier(name),
            j.callExpression(j.identifier("computed"), [
              j.arrowFunctionExpression([], arrowArg),
            ])
          ),
        ])
      );
      imports.add("computed");
    });
  }

  // Methods
  const methodsProp = findProperty(props, "methods");
  const methodsValue =
    methodsProp?.value ?? (methodsProp?.type === "ObjectMethod" ? methodsProp : null);
  if (methodsProp && methodsValue?.type === "ObjectExpression" && methodsValue.properties) {
    methodsValue.properties.forEach((methProp: any) => {
      if (methProp.type === "SpreadElement") return;
      const methVal = methProp.value ?? (methProp.type === "ObjectMethod" ? methProp : null);
      const name = methProp.key?.name ?? "method";
      if (!methVal) return;

      const isMethod =
        methVal.type === "FunctionExpression" ||
        methVal.type === "ArrowFunctionExpression" ||
        methVal.type === "ObjectMethod";

      if (!isMethod) return;

      analysis.methodNames.push(name);
      methodNames.add(name);

      const params = methVal.params ?? [];
      const body =
        methVal.type === "ObjectMethod" ? methVal.body : methVal.body ?? j.blockStatement([]);

      statements.push(
        j.variableDeclaration("const", [
          j.variableDeclarator(
            j.identifier(name),
            j.arrowFunctionExpression(params, body)
          ),
        ])
      );
    });
  }

  // Watch
  const watchProp = findProperty(props, "watch");
  const watchValue =
    watchProp?.value ?? (watchProp?.type === "ObjectMethod" ? watchProp : null);
  if (watchProp && watchValue?.type === "ObjectExpression" && watchValue.properties) {
    watchValue.properties.forEach((watchPropItem: any) => {
      const watchKey =
        watchPropItem.key?.name ?? watchPropItem.key?.value ?? null;
      const watchHandler =
        watchPropItem.value ??
        (watchPropItem.type === "ObjectMethod" ? watchPropItem : null);

      if (!watchKey) return;

      if (
        watchHandler &&
        (watchHandler.type === "FunctionExpression" ||
          watchHandler.type === "ArrowFunctionExpression" ||
          watchHandler.type === "ObjectMethod")
      ) {
        const getter = j.arrowFunctionExpression(
          [],
          j.memberExpression(j.identifier(watchKey), j.identifier("value"))
        );
        const handlerParams =
          watchHandler.type === "ObjectMethod"
            ? watchHandler.params
            : watchHandler.params ?? [];
        const handlerBody =
          watchHandler.type === "ObjectMethod"
            ? watchHandler.body
            : watchHandler.body ?? j.blockStatement([]);
        const callback = j.arrowFunctionExpression(handlerParams, handlerBody);
        statements.push(
          j.expressionStatement(
            j.callExpression(j.identifier("watch"), [getter, callback])
          )
        );
        imports.add("watch");
      } else if (
        watchHandler?.type === "ObjectExpression" &&
        watchHandler.properties
      ) {
        const handlerProp = watchHandler.properties.find(
          (p: any) => p.key?.name === "handler" || p.key?.value === "handler"
        );
        const immediateProp = watchHandler.properties.find(
          (p: any) => p.key?.name === "immediate" || p.key?.value === "immediate"
        );
        const deepProp = watchHandler.properties.find(
          (p: any) => p.key?.name === "deep" || p.key?.value === "deep"
        );
        const handler =
          handlerProp?.value ??
          (handlerProp?.type === "ObjectMethod" ? handlerProp : null);

        if (handler) {
          const getter = j.arrowFunctionExpression(
            [],
            j.memberExpression(j.identifier(watchKey), j.identifier("value"))
          );
          const handlerParams =
            handler.type === "ObjectMethod" ? handler.params : handler.params ?? [];
          const handlerBody =
            handler.type === "ObjectMethod"
              ? handler.body
              : handler.body ?? j.blockStatement([]);
          const callback = j.arrowFunctionExpression(handlerParams, handlerBody);

          const options: any[] = [];
          if (immediateProp?.value) {
            options.push(
              j.objectProperty(
                j.identifier("immediate"),
                immediateProp.value
              )
            );
          }
          if (deepProp?.value) {
            options.push(
              j.objectProperty(j.identifier("deep"), deepProp.value)
            );
          }

          const watchCall =
            options.length > 0
              ? j.callExpression(j.identifier("watch"), [
                  getter,
                  callback,
                  j.objectExpression(options),
                ])
              : j.callExpression(j.identifier("watch"), [getter, callback]);
          statements.push(j.expressionStatement(watchCall));
          imports.add("watch");
        }
      }
    });
  }

  // Lifecycle hooks
  const lifecycleHookNames = [
    "beforeCreate",
    "created",
    "beforeMount",
    "mounted",
    "beforeUpdate",
    "updated",
    "beforeDestroy",
    "destroyed",
    "beforeUnmount",
    "unmounted",
    "activated",
    "deactivated",
    "errorCaptured",
  ];
  const hookMap: Record<string, string> = {
    beforeCreate: "onBeforeMount",
    created: "onMounted",
    beforeMount: "onBeforeMount",
    mounted: "onMounted",
    beforeUpdate: "onBeforeUpdate",
    updated: "onUpdated",
    beforeDestroy: "onBeforeUnmount",
    destroyed: "onUnmounted",
    beforeUnmount: "onBeforeUnmount",
    unmounted: "onUnmounted",
    activated: "onActivated",
    deactivated: "onDeactivated",
    errorCaptured: "onErrorCaptured",
  };

  const lifecycleHooks = props.filter(
    (p: any) => p.key && lifecycleHookNames.includes(p.key.name)
  );
  analysis.hasLifecycle = lifecycleHooks.length > 0;

  lifecycleHooks.forEach((hook: any) => {
    const hookName = hook.key.name;
    const vue3Hook = hookMap[hookName] ?? hookName;
    const hookBody = hook.value ?? (hook.type === "ObjectMethod" ? hook : null);

    if (
      hookBody &&
      (hookBody.type === "FunctionExpression" ||
        hookBody.type === "ArrowFunctionExpression" ||
        hookBody.type === "ObjectMethod")
    ) {
      let callback: any;
      if (hookBody.body?.type === "BlockStatement") {
        callback = j.arrowFunctionExpression([], hookBody.body);
      } else if (hookBody.body) {
        callback = j.arrowFunctionExpression(
          [],
          j.blockStatement([j.returnStatement(hookBody.body)])
        );
      } else {
        callback = j.arrowFunctionExpression([], j.blockStatement([]));
      }
      statements.push(
        j.expressionStatement(
          j.callExpression(j.identifier(vue3Hook), [callback])
        )
      );
      imports.add(vue3Hook);
    }
  });

  if (statements.length === 0) {
    return { success: false, analysis, error: "No data/methods/computed/inject/watch/lifecycle found" };
  }

  // Transform this.$store.getters.XXX and this.xxx references in all statements
  const tempProgram = j.program([...statements]);
  const tempCollection = j(tempProgram);
  if (storeReplacements.size > 0) {
    transformStoreRefs(j, tempCollection, storeReplacements);
  }
  transformThisRefs(j, tempCollection, dataProps, computedProps, methodNames, injectNames);
  const transformedStatements = tempProgram.body;

  const composableName = mixinNameToComposable(mixinName);
  const returnKeys = [
    ...Array.from(injectNames),
    ...analysis.dataKeys,
    ...analysis.computedNames,
    ...analysis.methodNames,
  ];
  const returnProps = returnKeys.map((k) =>
    j.objectProperty(j.identifier(k), j.identifier(k))
  );
  const returnExpr =
    returnKeys.length > 0
      ? j.returnStatement(j.objectExpression(returnProps))
      : j.returnStatement(j.objectExpression([]));

  const fnBody = j.blockStatement([...transformedStatements, returnExpr]);
  const fnDecl = j.functionDeclaration(j.identifier(composableName), [], fnBody);

  const importSpecs = Array.from(imports).map((name) =>
    j.importSpecifier(j.identifier(name), j.identifier(name))
  );
  const vueImportDecl = j.importDeclaration(importSpecs, j.literal("vue"));
  const storeImportDecls = storeImportLines.map(({ storeName, importPath }) =>
    j.importDeclaration(
      [j.importSpecifier(j.identifier(storeName), j.identifier(storeName))],
      j.literal(importPath)
    )
  );
  const exportDecl = j.exportNamedDeclaration(fnDecl, []);

  const outProgram = j.program([...storeImportDecls, vueImportDecl, exportDecl]);

  let code: string;
  try {
    code = j(outProgram).toSource({ quote: "single" });
  } catch {
    return { success: false, analysis, error: "Code generation failed" };
  }

  return { success: true, code, analysis };
}
