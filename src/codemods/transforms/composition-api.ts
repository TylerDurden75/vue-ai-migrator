import { Transform, FileInfo, API } from "jscodeshift";

/**
 * Comprehensive transformation from Options API to Composition API with <script setup>
 * Uses AST manipulation to properly transform components
 *
 * Transforms:
 * - data() → ref()/reactive()
 * - computed → computed()
 * - methods → functions
 * - props → defineProps()
 * - emits → defineEmits()
 * - watch → watch()
 * - lifecycle hooks → onMounted(), onUpdated(), etc.
 * - this.xxx → direct variable access
 */
export const compositionApiTransform: Transform = (
  fileInfo: FileInfo,
  api: API,
  options: any = {},
) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const enableTypeScript = options?.enableTypeScript || false;

  let hasChanges = false;
  const imports = new Set<string>();
  const statements: any[] = [];
  let componentFound = false;
  let exportDefaultPath: any = null;

  // Track created variables for this. transformation
  const dataProperties = new Set<string>(); // Properties from data() → ref()
  const computedProperties = new Set<string>(); // Properties from computed → computed()
  const computedReturnTypes = new Map<string, string>(); // Computed property name → return type
  const methodNames = new Set<string>(); // Methods → functions
  const methodSignatures = new Map<
    string,
    { params: string[]; returnType: string }
  >(); // Method name → signature
  const propNames = new Set<string>(); // Props → props.xxx
  const propInterfaces: string[] = []; // Generated TypeScript interfaces for props
  const emittedEvents = new Set<string>(); // Events emitted via this.$emit
  const injectNames = new Set<string>(); // Injected keys → direct variable (this.x → x)

  // Find Vue component - check both export default and regular objects
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;
    exportDefaultPath = path;

    // Handle both ObjectExpression and other types
    let componentObj = declaration;
    if (declaration && declaration.type === "ObjectExpression") {
      componentObj = declaration;
    } else if (
      declaration &&
      declaration.type === "CallExpression" &&
      declaration.callee &&
      declaration.callee.name === "defineComponent"
    ) {
      // Handle defineComponent({ ... })
      if (
        declaration.arguments &&
        declaration.arguments[0] &&
        declaration.arguments[0].type === "ObjectExpression"
      ) {
        componentObj = declaration.arguments[0];
      }
    }

    if (componentObj && componentObj.type === "ObjectExpression") {
      // Check if it's a Vue component - be more permissive
      const properties = componentObj.properties || [];
      // If it's an export default object, assume it's a Vue component
      const isVue = isVueComponent(componentObj) || properties.length > 0;

      if (isVue) {
        componentFound = true;

        // Transform props using AST
        const propsProp = findProperty(properties, "props");
        if (propsProp && propsProp.value) {
          const propsResult = transformPropsAST(
            j,
            propsProp.value,
            propNames,
            enableTypeScript,
            propInterfaces,
          );
          if (propsResult) {
            statements.push(propsResult);
            hasChanges = true;
          }
        }

        // Transform emits using AST
        const emitsProp = findProperty(properties, "emits");
        if (emitsProp && emitsProp.value) {
          const emitsAst = transformEmitsAST(
            j,
            emitsProp.value,
            enableTypeScript,
          );
          if (emitsAst) {
            statements.push(emitsAst);
            hasChanges = true;
          }
        }

        // Transform inject (early - injected values may be used in data/computed)
        const injectProp = findProperty(properties, "inject");
        if (injectProp && injectProp.value) {
          const injectStatements = transformInjectAST(
            j,
            injectProp.value,
            imports,
            injectNames,
          );
          if (injectStatements.length > 0) {
            statements.push(...injectStatements);
            hasChanges = true;
          }
        }

        // Transform data() to ref/reactive using AST
        const dataProp = findProperty(properties, "data");
        // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
        // In jscodeshift AST, ObjectProperty has 'value', ObjectMethod has the function directly
        const dataValue =
          dataProp?.value ||
          ((dataProp as any)?.kind === "method" ? dataProp : null);
        if (dataProp && dataValue) {
          const dataStatements = transformDataAST(
            j,
            dataValue,
            imports,
            dataProperties,
            enableTypeScript,
          );
          if (dataStatements.length > 0) {
            statements.push(...dataStatements);
            hasChanges = true;
          }
        }

        // Transform computed using AST
        const computedProp = findProperty(properties, "computed");
        // Handle both ObjectProperty (has 'value') and ObjectMethod
        const computedValue =
          computedProp?.value ||
          ((computedProp as any)?.kind === "method" ? computedProp : null);
        if (computedProp && computedValue) {
          const computedStatements = transformComputedAST(
            j,
            computedValue,
            imports,
            computedProperties,
            computedReturnTypes,
            enableTypeScript,
            emittedEvents,
          );
          if (computedStatements.length > 0) {
            statements.push(...computedStatements);
            hasChanges = true;
          }
        }

        // Transform methods to functions using AST
        const methodsProp = findProperty(properties, "methods");
        // Handle both ObjectProperty (has 'value') and ObjectMethod
        const methodsValue =
          methodsProp?.value ||
          ((methodsProp as any)?.kind === "method" ? methodsProp : null);
        if (methodsProp && methodsValue) {
          // Detect this.$emit calls in methods to auto-create defineEmits
          detectEmittedEvents(j, methodsValue, emittedEvents);
          
          const methodStatements = transformMethodsAST(
            j,
            methodsValue,
            methodNames,
            undefined,
            enableTypeScript,
          );
          if (methodStatements.length > 0) {
            statements.push(...methodStatements);
            hasChanges = true;
          }
        }
        
        // If we detected emitted events but no emits prop, create defineEmits
        if (emittedEvents.size > 0 && !emitsProp) {
          const emitArray = Array.from(emittedEvents).map(e => j.literal(e));
          const emitsAst = transformEmitsAST(
            j,
            j.arrayExpression(emitArray),
            enableTypeScript,
          );
          if (emitsAst) {
            // Insert after props if exists, otherwise at the beginning
            const propsIndex = statements.findIndex((s: any) => 
              s && s.declarations && s.declarations[0] && 
              s.declarations[0].id && s.declarations[0].id.name === 'props'
            );
            if (propsIndex !== -1) {
              statements.splice(propsIndex + 1, 0, emitsAst);
            } else {
              statements.unshift(emitsAst);
            }
            hasChanges = true;
          }
        }

        // Transform watch using AST
        const watchProp = findProperty(properties, "watch");
        // Handle both ObjectProperty (has 'value') and ObjectMethod
        const watchValue =
          watchProp?.value ||
          ((watchProp as any)?.kind === "method" ? watchProp : null);
        if (watchProp && watchValue) {
          const watchStatements = transformWatchAST(
            j,
            watchValue,
            imports,
            enableTypeScript,
          );
          if (watchStatements.length > 0) {
            statements.push(...watchStatements);
            hasChanges = true;
          }
        }

        // Transform provide (after data - provide can use refs)
        const provideProp = findProperty(properties, "provide");
        const provideValue =
          provideProp?.value ??
          ((provideProp as any)?.params !== undefined ? provideProp : null);
        if (provideProp && provideValue) {
          const provideStatements = transformProvideAST(
            j,
            provideValue,
            imports,
            dataProperties,
          );
          if (provideStatements.length > 0) {
            statements.push(...provideStatements);
            hasChanges = true;
          }
        }

        // Transform lifecycle hooks using AST
        const lifecycleHooks = findLifecycleHooks(properties);
        if (lifecycleHooks.length > 0) {
          const hooksStatements = transformLifecycleHooksAST(
            j,
            lifecycleHooks,
            imports,
          );
          if (hooksStatements.length > 0) {
            statements.push(...hooksStatements);
            hasChanges = true;
          }
        }

        // Preserve asyncData and title (SSR options) via defineOptions
        // Single script setup block - no second block needed
        const defineOptionsProps: any[] = [];
        const asyncDataProp = findProperty(properties, "asyncData");
        const titleProp = findProperty(properties, "title");
        if (asyncDataProp) {
          const val =
            (asyncDataProp as any).value ??
            ((asyncDataProp as any).params ? asyncDataProp : null);
          if (val) {
            if (val.type === "ObjectMethod") {
              defineOptionsProps.push(
                j.objectMethod(
                  "method",
                  j.identifier("asyncData"),
                  val.params,
                  val.body,
                ),
              );
            } else {
              defineOptionsProps.push(
                j.objectProperty(j.identifier("asyncData"), j.clone(val)),
              );
            }
          }
        }
        if (titleProp) {
          const titleVal =
            (titleProp as any).value ??
            ((titleProp as any).params ? titleProp : null);
          if (titleVal) {
            if (titleVal.type === "ObjectMethod") {
              defineOptionsProps.push(
                j.objectMethod(
                  "method",
                  j.identifier("title"),
                  titleVal.params,
                  titleVal.body,
                ),
              );
            } else {
              defineOptionsProps.push(
                j.objectProperty(
                  j.identifier("title"),
                  j.clone(titleVal),
                ),
              );
            }
          }
        }
        if (defineOptionsProps.length > 0) {
          statements.unshift(
            j.expressionStatement(
              j.callExpression(j.identifier("defineOptions"), [
                j.objectExpression(defineOptionsProps),
              ]),
            ),
          );
          hasChanges = true;
        }
      }
    }
  });

  // Lifecycle hooks are now transformed via transformLifecycleHooksAST above
  // This ensures they are converted to Composition API functions (onMounted, etc.)
  // as per Vue 3 <script setup> documentation

  // Transform this.$listeners (removed in Vue 3)
  root.find(j.MemberExpression).forEach((path: any) => {
    if (
      path.value.object.type === "ThisExpression" &&
      path.value.property.type === "Identifier" &&
      path.value.property.name === "$listeners"
    ) {
      path.value.property.name = "$attrs";
      hasChanges = true;
    }
  });

  // If we have statements, replace export default with Composition API code
  // Also handle case where component is found but statements might be empty (mark for AI)

  if (componentFound && exportDefaultPath) {
    // Get the program body
    const program = root.get().node.program;
    const body = program.body;

    // Find the export default index
    const exportIndex = body.findIndex(
      (node: any) => node.type === "ExportDefaultDeclaration",
    );

    if (exportIndex !== -1) {
      if (statements.length > 0) {
        // Add imports at the top
        const importStatements = generateImportStatements(j, imports);

        // Remove export default
        body.splice(exportIndex, 1);

        // Add imports at the beginning (if not already present)
        if (importStatements.length > 0) {
          // Check if import from 'vue' already exists
          const existingVueImport = body.findIndex(
            (node: any) =>
              node.type === "ImportDeclaration" &&
              node.source &&
              node.source.value === "vue",
          );

          if (existingVueImport !== -1) {
            // Merge with existing import
            const existingImport = body[existingVueImport];
            const newImport = importStatements[0];
            if (newImport && newImport.specifiers) {
              const existingSpecifiers = existingImport.specifiers || [];
              const newSpecifiers = newImport.specifiers || [];
              // Merge specifiers
              const mergedSpecifiers = [...existingSpecifiers];
              newSpecifiers.forEach((spec: any) => {
                const exists = mergedSpecifiers.some(
                  (s: any) =>
                    s.imported &&
                    spec.imported &&
                    s.imported.name === spec.imported.name,
                );
                if (!exists) {
                  mergedSpecifiers.push(spec);
                }
              });
              existingImport.specifiers = mergedSpecifiers;
            }
          } else {
            // Add new import
            body.unshift(...importStatements);
          }
        }

        // Add Composition API statements
        body.push(...statements);

        // Transform all this. references after adding statements
        transformThisReferences(
          j,
          root,
          dataProperties,
          computedProperties,
          methodNames,
          propNames,
          injectNames,
        );

        // Transform this.$emit('event', ...) → emit('event', ...) for script setup
        root.find(j.CallExpression).forEach((path: any) => {
          const callee = path.value.callee;
          if (
            callee.type === "MemberExpression" &&
            callee.object?.type === "ThisExpression" &&
            callee.property?.type === "Identifier" &&
            callee.property.name === "$emit"
          ) {
            j(path).replaceWith(
              j.callExpression(j.identifier("emit"), path.value.arguments || []),
            );
            hasChanges = true;
          }
        });

        hasChanges = true;
      } else if (componentFound) {
        // Component found but no statements generated
        // Check if it's a lifecycle-only component - if so, transform hooks
        const declaration = exportDefaultPath.value.declaration;
        if (declaration && declaration.type === "ObjectExpression") {
          const properties = declaration.properties || [];
          const lifecycleHooks = findLifecycleHooks(properties);

          // Check if component has only lifecycle hooks (no data, computed, methods, etc.)
          const hasOnlyHooks =
            lifecycleHooks.length > 0 &&
            !findProperty(properties, "data") &&
            !findProperty(properties, "computed") &&
            !findProperty(properties, "methods") &&
            !findProperty(properties, "props") &&
            !findProperty(properties, "emits") &&
            !findProperty(properties, "watch");

          if (hasOnlyHooks && lifecycleHooks.length > 0) {
            const hooksStatements = transformLifecycleHooksAST(
              j,
              lifecycleHooks,
              imports,
            );
            if (hooksStatements.length > 0) {
              const importStatements = generateImportStatements(j, imports);

              // Remove export default
              body.splice(exportIndex, 1);

              // Add imports
              if (importStatements.length > 0) {
                body.unshift(...importStatements);
              }

              // Add lifecycle hooks
              body.push(...hooksStatements);
              hasChanges = true;
            }
          }
        }

        // If still no changes, don't modify code (will be handled by runner)
        // Component was detected but couldn't be transformed automatically
      }
    }
  }

  let resultCode = hasChanges ? root.toSource() : fileInfo.source;

  // Post-process to add TypeScript types if enabled
  if (enableTypeScript && hasChanges) {
    resultCode = addTypeScriptTypes(resultCode, {
      dataProperties: Array.from(dataProperties),
      computedProperties: Array.from(computedProperties),
      computedReturnTypes: Object.fromEntries(computedReturnTypes),
      methodNames: Array.from(methodNames),
      methodSignatures: Object.fromEntries(methodSignatures),
      propNames: Array.from(propNames),
      propInterfaces: propInterfaces, // Pass interfaces to be inserted inside script setup
    });
  }

  return resultCode;
};

/**
 * Post-process generated code to add TypeScript type annotations
 */
function addTypeScriptTypes(
  code: string,
  context: {
    dataProperties: string[];
    computedProperties: string[];
    computedReturnTypes?: Record<string, string>;
    methodNames: string[];
    methodSignatures?: Record<string, { params: string[]; returnType: string }>;
    propNames: string[];
    propInterfaces?: string[];
  },
): string {
  let result = code;

  // Add types to ref() calls: ref(0) → ref<number>(0)
  context.dataProperties.forEach((prop) => {
    // Match: const propName = ref(value) - but avoid matching if already has type
    // Use a simpler pattern that works for most cases
    // Match ref( but not ref<type>( to avoid duplicates
    const refPattern = new RegExp(
      `(const\\s+${prop}\\s*=\\s*ref)(?!<[^>]+>)\\(([^)]+)\\)`,
      "g",
    );
    result = result.replace(refPattern, (match, before, value) => {
      // Infer type from value - handle strings properly
      const type = inferTypeFromValueString(value.trim());
      return `${before}<${type}>(${value})`;
    });
  });

  // Add types to computed() calls: computed(() => ...) → computed<string>(() => ...)
  context.computedProperties.forEach((prop) => {
    // Match: const propName = computed(() => ...)
    // FIX: Don't capture the opening parenthesis in 'before' to avoid computed(<type>() => ...)
    const computedPattern = new RegExp(
      `(const\\s+${prop}\\s*=\\s*computed)(\\()([^)]+)(\\))`,
      "g",
    );
    result = result.replace(computedPattern, (_match, before, openParen, fn, closeParen) => {
      // Use inferred return type if available
      const type = context.computedReturnTypes?.[prop] || "any";
      // Correct format: computed<type>(() => ...) not computed(<type>() => ...)
      return `${before}<${type}>${openParen}${fn}${closeParen}`;
    });
  });

  // Add return types and parameter types to functions
  context.methodNames.forEach((method) => {
    const signature = context.methodSignatures?.[method];
    const returnType = signature?.returnType || "void";
    const params = signature?.params || [];

    // Match: function methodName(param1, param2) { - but avoid matching if already has types
    // Use a more specific pattern to avoid duplicates and nested function matches
    const functionPattern = new RegExp(
      `(^|\\n|;|\\s)(function\\s+${method}\\s*\\(([^)]*)\\)\\s*\\{)`,
      "gm",
    );
    result = result.replace(functionPattern, (match, prefix, paramList) => {
      // Skip if already has return type annotation (check for ): pattern)
      if (match.includes("):")) {
        return match;
      }
      // Skip if this looks like a nested function declaration (duplicate)
      // This prevents matching "function increment(function increment() {"
      if (match.includes(`function ${method}(function`)) {
        return match;
      }
      // Skip if paramList already contains a function declaration (another duplicate check)
      if (paramList && paramList.includes(`function ${method}`)) {
        return match;
      }
      // Add types to parameters
      let typedParams = paramList || "";
      if (params.length > 0 && paramList && paramList.trim()) {
        const paramNames = paramList
          .split(",")
          .map((p: string) => p.trim())
          .filter((p: string) => p);
        typedParams = paramNames
          .map((paramName: string) => {
            // Skip if already has type annotation
            if (paramName.includes(":")) {
              return paramName;
            }
            // Try to infer type from parameter name or use any
            const paramType = inferParameterType(paramName);
            return `${paramName}: ${paramType}`;
          })
          .join(", ");
      }
      // Add return type annotation
      return `${prefix}function ${method}(${typedParams}): ${returnType} {`;
    });

    // Match: const methodName = function(param1, param2) {
    const functionExprPattern = new RegExp(
      `(const\\s+${method}\\s*=\\s*function)\\s*\\(([^)]*)\\)\\s*(?::\\s*[^\\s{]+)?\\s*\\{`,
      "g",
    );
    result = result.replace(functionExprPattern, (match, before, paramList) => {
      // Skip if already has return type annotation
      if (match.includes("):")) {
        return match;
      }
      let typedParams = paramList || "";
      if (params.length > 0 && paramList && paramList.trim()) {
        const paramNames = paramList
          .split(",")
          .map((p: string) => p.trim())
          .filter((p: string) => p);
        typedParams = paramNames
          .map((paramName: string) => {
            if (paramName.includes(":")) {
              return paramName;
            }
            const paramType = inferParameterType(paramName);
            return `${paramName}: ${paramType}`;
          })
          .join(", ");
      }
      return `${before}(${typedParams}): ${returnType} {`;
    });

    // Match: const methodName = (param1, param2) => {
    // This is now the primary pattern since we generate arrow functions
    const arrowPattern = new RegExp(
      `(const\\s+${method}\\s*=\\s*\\()([^)]*)(\\)\\s*(?::\\s*[^\\s=>]+)?\\s*=>\\s*\\{)`,
      "g",
    );
    result = result.replace(arrowPattern, (match, before, paramList, after) => {
      // Skip if already has return type annotation
      if (match.includes("):")) {
        return match;
      }
      let typedParams = paramList || "";
      if (params.length > 0 && paramList && paramList.trim()) {
        const paramNames = paramList
          .split(",")
          .map((p: string) => p.trim())
          .filter((p: string) => p);
        typedParams = paramNames
          .map((paramName: string) => {
            if (paramName.includes(":")) {
              return paramName;
            }
            const paramType = inferParameterType(paramName);
            return `${paramName}: ${paramType}`;
          })
          .join(", ");
      }
      // For arrow functions, add return type before =>
      if (returnType !== "void") {
        return `${before}${typedParams}): ${returnType} => {`;
      }
      return `${before}${typedParams}${after}`;
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

  // Array literal
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return "any[]";
  }

  // Object literal
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return "Record<string, any>";
  }

  // null or undefined
  if (trimmed === "null" || trimmed === "undefined") {
    return "null";
  }

  return "any";
}

// TypeScript type inference utilities

/**
 * Infers TypeScript type from Vue 2 prop definition
 * Examples:
 * - String → string
 * - Number → number
 * - Boolean → boolean
 * - Array → any[]
 * - Object → Record<string, any>
 * - { type: String, required: true } → string
 * - { type: Number, default: 0 } → number | undefined
 */
function inferTypeFromPropDefinition(propValue: any): string {
  if (!propValue) {
    return "any";
  }

  // Handle runtime prop definition: { type: String, required: true, default: ... }
  if (propValue.type === "ObjectExpression" && propValue.properties) {
    let typeNode: any = null;
    let required = false;
    let hasDefault = false;

    propValue.properties.forEach((prop: any) => {
      if (prop.key && prop.key.name === "type") {
        typeNode = prop.value;
      } else if (prop.key && prop.key.name === "required") {
        required = prop.value.value === true || prop.value.value === "true";
      } else if (prop.key && prop.key.name === "default") {
        hasDefault = true;
      }
    });

    if (typeNode) {
      const baseType = inferTypeFromConstructor(typeNode);
      // If not required and no default, make it optional
      if (!required && !hasDefault) {
        return `${baseType} | undefined`;
      }
      return baseType;
    }
  }

  // Handle direct constructor reference: String, Number, Boolean, etc.
  return inferTypeFromConstructor(propValue);
}

/**
 * Infers TypeScript type from JavaScript constructor or value
 */
function inferTypeFromConstructor(constructor: any): string {
  if (!constructor) {
    return "any";
  }

  // Handle Identifier (e.g., String, Number, Boolean)
  if (constructor.type === "Identifier") {
    const name = constructor.name;
    switch (name) {
      case "String":
        return "string";
      case "Number":
        return "number";
      case "Boolean":
        return "boolean";
      case "Array":
        return "any[]";
      case "Object":
        return "Record<string, any>";
      case "Function":
        return "(...args: any[]) => any";
      case "Date":
        return "Date";
      default:
        return name; // Custom type, keep as is
    }
  }

  // Handle ArrayExpression: [String] → string[]
  if (
    constructor.type === "ArrayExpression" &&
    constructor.elements &&
    constructor.elements.length > 0
  ) {
    const elementType = inferTypeFromConstructor(constructor.elements[0]);
    return `${elementType}[]`;
  }

  // Handle Literal values
  if (constructor.type === "StringLiteral" || constructor.type === "Literal") {
    const value = constructor.value;
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
  }

  // Handle ObjectExpression: { ... } → Record<string, any>
  if (constructor.type === "ObjectExpression") {
    return "Record<string, any>";
  }

  return "any";
}

/**
 * Infers TypeScript type from a JavaScript value (for refs)
 */
function inferTypeFromValue(value: any): string {
  if (!value) {
    return "any";
  }

  // Handle Literal values
  if (
    value.type === "StringLiteral" ||
    (value.type === "Literal" && typeof value.value === "string")
  ) {
    return "string";
  }
  if (
    value.type === "NumericLiteral" ||
    (value.type === "Literal" && typeof value.value === "number")
  ) {
    return "number";
  }
  if (
    value.type === "BooleanLiteral" ||
    (value.type === "Literal" && typeof value.value === "boolean")
  ) {
    return "boolean";
  }

  // Handle ArrayExpression
  if (value.type === "ArrayExpression") {
    return "any[]";
  }

  // Handle ObjectExpression
  if (value.type === "ObjectExpression") {
    return "Record<string, any>";
  }

  // Handle null/undefined
  if (
    value.type === "NullLiteral" ||
    (value.type === "Literal" && value.value === null)
  ) {
    return "null";
  }

  return "any";
}

/**
 * Infers return type from a computed function body
 * Reserved for future use when implementing advanced TypeScript typing
 */
// Reserved for future use when implementing advanced TypeScript typing
function inferComputedReturnType(computedBody: any): string {
  if (!computedBody) {
    return "any";
  }

  // Try to find return statement
  if (computedBody.type === "BlockStatement" && computedBody.body) {
    const returnStmt = computedBody.body.find(
      (stmt: any) => stmt && stmt.type === "ReturnStatement",
    );
    if (returnStmt && returnStmt.argument) {
      return inferTypeFromValue(returnStmt.argument);
    }
  }

  // If it's an expression (arrow function), infer from the expression
  if (computedBody.type !== "BlockStatement") {
    return inferTypeFromValue(computedBody);
  }

  return "any";
}

/**
 * Helper to generate TypeScript code as a string that can be inserted into script setup
 * This is used when enableTypeScript is true to generate typed code
 * Note: jscodeshift cannot parse TypeScript generics directly, so we return null
 * and use post-processing instead
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateTypeScriptCode(_code: string, _j: any): any {
  // jscodeshift cannot parse TypeScript generics like defineProps<{...}>()
  // We'll use post-processing to add types instead
  return null;
}

// AST-based transformation functions

function transformPropsAST(
  j: any,
  propsValue: any,
  propNames?: Set<string>,
  enableTypeScript: boolean = false,
  propInterfaces?: string[],
): any {
  if (!propsValue || !propsValue.type) {
    return null;
  }

  if (propsValue.type === "ArrayExpression") {
    // Array of prop names: ['prop1', 'prop2']
    propsValue.elements?.forEach((elem: any) => {
      if (elem.type === "StringLiteral" || elem.type === "Literal") {
        propNames?.add(elem.value || elem.name);
      }
    });

    if (enableTypeScript) {
      // For array props, generate: defineProps<{ prop1?: any; prop2?: any }>()
      const propTypes: string[] = [];
      propsValue.elements?.forEach((elem: any) => {
        if (elem.type === "StringLiteral" || elem.type === "Literal") {
          const propName = elem.value || elem.name;
          propTypes.push(`${propName}?: any`);
        }
      });

      if (propTypes.length > 0) {
        const interfaceType = `{ ${propTypes.join("; ")} }`;
        // Generate TypeScript code as string: const props = defineProps<{ prop1?: any; prop2?: any }>()
        const tsCode = `const props = defineProps<${interfaceType}>()`;
        // Try to parse and return as AST, fallback to runtime if parsing fails
        const parsed = generateTypeScriptCode(tsCode, j);
        if (parsed) return parsed;
      }
    }

    return j.variableDeclaration("const", [
      j.variableDeclarator(
        j.identifier("props"),
        j.callExpression(j.identifier("defineProps"), [propsValue]),
      ),
    ]);
  } else if (propsValue.type === "ObjectExpression") {
    // Object with prop definitions: { prop1: String, prop2: Number }
    propsValue.properties?.forEach((prop: any) => {
      if (prop.key && prop.key.type === "Identifier") {
        propNames?.add(prop.key.name);
      }
    });

    if (enableTypeScript) {
      // Generate TypeScript interface and typed defineProps
      const interfaceProps: string[] = [];
      let hasComplexTypes = false;

      propsValue.properties?.forEach((prop: any) => {
        if (prop.key && prop.key.type === "Identifier") {
          const propName = prop.key.name;
          const propType = inferTypeFromPropDefinition(prop.value);
          // Check if required (for runtime props: { type: String, required: true })
          let required = true;
          if (
            prop.value &&
            prop.value.type === "ObjectExpression" &&
            prop.value.properties
          ) {
            const requiredProp = prop.value.properties.find(
              (p: any) => p.key && p.key.name === "required",
            );
            if (requiredProp) {
              required =
                requiredProp.value.value === true ||
                requiredProp.value.value === "true";
            }
            // If there's a default, it's optional
            const hasDefault = prop.value.properties.some(
              (p: any) => p.key && p.key.name === "default",
            );
            if (hasDefault) {
              required = false;
            }
          }

          // Check if type is complex (not primitive)
          if (
            propType.includes("Record") ||
            propType.includes("[]") ||
            propType.includes("=>")
          ) {
            hasComplexTypes = true;
          }

          interfaceProps.push(`${propName}${required ? "" : "?"}: ${propType}`);
        }
      });

      if (interfaceProps.length > 0) {
        const shouldGenerateInterface =
          interfaceProps.length > 2 || // More than 2 props
          hasComplexTypes || // Has complex types
          interfaceProps.some((p) => p.includes("Record") || p.includes("[]")); // Has arrays or objects

        if (shouldGenerateInterface && propInterfaces) {
          // Generate separate interface
          const interfaceName = "Props";
          const interfaceCode = `interface ${interfaceName} {\n  ${interfaceProps.join(";\n  ")};\n}`;
          propInterfaces.push(interfaceCode);

          // Use interface name in defineProps
          const tsCode = `const props = defineProps<${interfaceName}>()`;
          const parsed = generateTypeScriptCode(tsCode, j);
          if (parsed) return parsed;
        } else {
          // Use inline type for simple cases
          const interfaceType = `{ ${interfaceProps.join("; ")} }`;
          const tsCode = `const props = defineProps<${interfaceType}>()`;
          const parsed = generateTypeScriptCode(tsCode, j);
          if (parsed) return parsed;
        }
      }
    }

    return j.variableDeclaration("const", [
      j.variableDeclarator(
        j.identifier("props"),
        j.callExpression(j.identifier("defineProps"), [propsValue]),
      ),
    ]);
  }
  return null;
}

function transformEmitsAST(
  j: any,
  emitsValue: any,
  enableTypeScript: boolean = false,
): any {
  if (!emitsValue || !emitsValue.type) {
    return null;
  }

  if (
    emitsValue.type === "ArrayExpression" ||
    emitsValue.type === "ObjectExpression"
  ) {
    if (enableTypeScript) {
      // Generate typed defineEmits
      const emitTypes: string[] = [];
      if (emitsValue.type === "ArrayExpression") {
        emitsValue.elements?.forEach((elem: any) => {
          if (elem.type === "StringLiteral" || elem.type === "Literal") {
            const eventName = elem.value || elem.name;
            emitTypes.push(`${eventName}: [payload?: any]`);
          }
        });
      } else if (emitsValue.type === "ObjectExpression") {
        emitsValue.properties?.forEach((prop: any) => {
          if (prop.key && prop.key.type === "Identifier") {
            const eventName = prop.key.name;
            emitTypes.push(`${eventName}: [payload?: any]`);
          }
        });
      }

      if (emitTypes.length > 0) {
        const emitType = `{ ${emitTypes.join("; ")} }`;
        // Generate: const emit = defineEmits<{ event1: [payload?: any]; event2: [payload?: any] }>()
        const tsCode = `const emit = defineEmits<${emitType}>()`;
        const parsed = generateTypeScriptCode(tsCode, j);
        if (parsed) return parsed;
      }
    }

    return j.variableDeclaration("const", [
      j.variableDeclarator(
        j.identifier("emit"),
        j.callExpression(j.identifier("defineEmits"), [emitsValue]),
      ),
    ]);
  }
  return null;
}

function transformDataAST(
  j: any,
  dataValue: any,
  imports: Set<string>,
  dataProperties?: Set<string>,
  // Reserved for future TypeScript support
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _enableTypeScript?: boolean,
): any[] {
  const statements: any[] = [];

  if (!dataValue || !dataValue.type) {
    return statements;
  }

  // Note: TypeScript types for ref() will be added via post-processing
  // because jscodeshift cannot parse TypeScript generics directly

  // Handle ObjectMethod (shorthand method syntax: data() { ... })
  // ObjectMethod has 'body' directly, not 'value.body'
  if (dataValue.type === "ObjectMethod") {
    const body = dataValue.body;

    if (body && body.type === "BlockStatement" && body.body) {
      const returnStmt = body.body.find(
        (stmt: any) => stmt && stmt.type === "ReturnStatement",
      );

      if (returnStmt && returnStmt.argument) {
        if (returnStmt.argument.type === "ObjectExpression") {
          const objProps = returnStmt.argument.properties || [];

          // Handle empty object - no transformation needed
          if (objProps.length === 0) {
            return statements; // Empty data() returns {} - no transformation needed
          }

          // Convert each property to ref()
          objProps.forEach((prop: any) => {
            if (prop && prop.key) {
              let propName: any;
              let propNameStr: string;
              if (prop.key.type === "Identifier") {
                propName = j.identifier(prop.key.name);
                propNameStr = prop.key.name;
              } else {
                propName = prop.key;
                propNameStr = prop.key.name || "";
              }

              statements.push(
                j.variableDeclaration("const", [
                  j.variableDeclarator(
                    propName,
                    j.callExpression(j.identifier("ref"), [prop.value]),
                  ),
                ]),
              );
              imports.add("ref");
              if (propNameStr) {
                dataProperties?.add(propNameStr);
              }
            }
          });
        } else if (returnStmt.argument) {
          // Complex return - use reactive
          statements.push(
            j.variableDeclaration("const", [
              j.variableDeclarator(
                j.identifier("state"),
                j.callExpression(j.identifier("reactive"), [
                  returnStmt.argument,
                ]),
              ),
            ]),
          );
          imports.add("reactive");
        }
      }
    }
  } else if (
    dataValue.type === "FunctionExpression" ||
    dataValue.type === "ArrowFunctionExpression"
  ) {
    // Handle FunctionExpression and ArrowFunctionExpression (from ObjectProperty.value)
    const body = dataValue.body;

    if (body && body.type === "BlockStatement" && body.body) {
      const returnStmt = body.body.find(
        (stmt: any) => stmt && stmt.type === "ReturnStatement",
      );

      if (returnStmt && returnStmt.argument) {
        if (returnStmt.argument.type === "ObjectExpression") {
          const objProps = returnStmt.argument.properties || [];

          // Handle empty object - no transformation needed
          if (objProps.length === 0) {
            return statements; // Empty data() returns {} - no transformation needed
          }

          // Convert each property to ref()
          objProps.forEach((prop: any) => {
            if (prop && prop.key) {
              let propName: any;
              let propNameStr: string;
              if (prop.key.type === "Identifier") {
                propName = j.identifier(prop.key.name);
                propNameStr = prop.key.name;
              } else {
                propName = prop.key;
                propNameStr = prop.key.name || "";
              }

              statements.push(
                j.variableDeclaration("const", [
                  j.variableDeclarator(
                    propName,
                    j.callExpression(j.identifier("ref"), [prop.value]),
                  ),
                ]),
              );
              imports.add("ref");
              if (propNameStr) {
                dataProperties?.add(propNameStr);
              }
            }
          });
        } else if (returnStmt.argument) {
          // Complex return - use reactive
          statements.push(
            j.variableDeclaration("const", [
              j.variableDeclarator(
                j.identifier("state"),
                j.callExpression(j.identifier("reactive"), [
                  returnStmt.argument,
                ]),
              ),
            ]),
          );
          imports.add("reactive");
        }
      }
    }
  } else if (dataValue.type === "ObjectExpression") {
    // data: { ... } → convert each property to ref
    const objProps = dataValue.properties || [];
    if (objProps.length > 0) {
      objProps.forEach((prop: any) => {
        if (prop && prop.key) {
          const propName =
            prop.key.type === "Identifier"
              ? j.identifier(prop.key.name)
              : prop.key;
          const propNameStr =
            prop.key.type === "Identifier"
              ? prop.key.name
              : prop.key.name || "";
          statements.push(
            j.variableDeclaration("const", [
              j.variableDeclarator(
                propName,
                j.callExpression(j.identifier("ref"), [prop.value]),
              ),
            ]),
          );
          imports.add("ref");
          if (propNameStr) {
            dataProperties?.add(propNameStr);
          }
        }
      });
    } else {
      // Empty object - no transformation needed
      return statements;
    }
  }

  return statements;
}

function transformComputedAST(
  j: any,
  computedValue: any,
  imports: Set<string>,
  computedProperties?: Set<string>,
  computedReturnTypes?: Map<string, string>,
  enableTypeScript: boolean = false,
  emittedEvents?: Set<string>,
): any[] {
  const statements: any[] = [];

  if (
    !computedValue ||
    computedValue.type !== "ObjectExpression" ||
    !computedValue.properties
  ) {
    return statements;
  }

  computedValue.properties.forEach((compProp: any) => {
    // Handle SpreadElement (e.g., ...mapGetters('module', ['getter1']))
    if (compProp.type === "SpreadElement" && compProp.argument) {
      const spreadArg = compProp.argument;
      if (spreadArg.type === "CallExpression" && spreadArg.callee) {
        const helperName = spreadArg.callee.name;
        if (["mapGetters", "mapState"].includes(helperName)) {
          // Mark for vuex-pinia-components transformation
          // This will be handled by vuex-pinia-components transform
          return;
        }
      }
    }

    // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
    const compValue =
      compProp.value || (compProp.type === "ObjectMethod" ? compProp : null);

    // Writable computed: { get(), set(v) } → computed({ get: () => ..., set: (v) => ... })
    if (
      compProp &&
      compValue &&
      compValue.type === "ObjectExpression" &&
      compValue.properties
    ) {
      const getProp = compValue.properties.find(
        (p: any) => p.key?.name === "get" || p.key?.value === "get",
      );
      const setProp = compValue.properties.find(
        (p: any) => p.key?.name === "set" || p.key?.value === "set",
      );
      if (getProp || setProp) {
        const compName =
          compProp.key?.name ?? compProp.key?.value ?? "computed";
        computedProperties?.add(compName);
        const computedOpts: any[] = [];
        if (getProp) {
          const getVal = getProp.value || getProp;
          const getBody =
            getVal.body?.type === "BlockStatement"
              ? (() => {
                  const ret = getVal.body.body.find(
                    (s: any) => s?.type === "ReturnStatement",
                  );
                  return ret?.argument
                    ? j.arrowFunctionExpression([], ret.argument)
                    : j.arrowFunctionExpression([], getVal.body);
                })()
              : j.arrowFunctionExpression([], getVal.body || getVal);
          computedOpts.push(
            j.objectProperty(j.identifier("get"), getBody),
          );
        }
        if (setProp) {
          const setVal = setProp.value || setProp;
          let setBody = setVal.body;
          // Detect this.$emit in setter for v-model proxy pattern
          if (emittedEvents && setBody) {
            j(setBody)
              .find(j.CallExpression)
              .forEach((p: any) => {
                const callee = p.value.callee;
                if (
                  callee?.type === "MemberExpression" &&
                  callee.object?.type === "ThisExpression" &&
                  callee.property?.name === "$emit" &&
                  p.value.arguments?.[0]?.value
                ) {
                  emittedEvents.add(String(p.value.arguments[0].value));
                }
              });
          }
          const setParams = setVal.params?.length
            ? setVal.params
            : [j.identifier("v")];
          if (setBody?.type !== "BlockStatement") {
            setBody = j.blockStatement([
              j.expressionStatement(setBody || j.identifier("undefined")),
            ]);
          }
          computedOpts.push(
            j.objectProperty(
              j.identifier("set"),
              j.arrowFunctionExpression(setParams, setBody),
            ),
          );
        }
        if (computedOpts.length > 0) {
          statements.push(
            j.variableDeclaration("const", [
              j.variableDeclarator(
                j.identifier(compName),
                j.callExpression(j.identifier("computed"), [
                  j.objectExpression(computedOpts),
                ]),
              ),
            ]),
          );
          imports.add("computed");
        }
        return;
      }
    }

    if (
      compProp &&
      compValue &&
      compValue.type &&
      (compValue.type === "FunctionExpression" ||
        compValue.type === "ArrowFunctionExpression" ||
        compValue.type === "ObjectMethod")
    ) {
      const compName =
        compProp.key && compProp.key.name ? compProp.key.name : "computed";
      // For ObjectMethod, body is directly on compValue; for ObjectProperty, it's on compValue.body
      const compBody =
        compValue.type === "ObjectMethod" ? compValue.body : compValue.body;

      // Track computed property name
      if (compProp.key && compProp.key.name) {
        computedProperties?.add(compProp.key.name);
      }

      // Infer return type if TypeScript is enabled
      if (enableTypeScript && computedReturnTypes && compBody) {
        const returnType = inferComputedReturnType(compBody);
        computedReturnTypes.set(compName, returnType);
      }

      let computedBody: any = null;

      if (compBody && compBody.type === "BlockStatement" && compBody.body) {
        const returnStmt = compBody.body.find(
          (stmt: any) => stmt && stmt.type === "ReturnStatement",
        );
        if (returnStmt && returnStmt.argument) {
          computedBody = j.arrowFunctionExpression([], returnStmt.argument);
        } else {
          computedBody = j.arrowFunctionExpression([], compBody);
        }
      } else if (compBody) {
        computedBody = j.arrowFunctionExpression([], compBody);
      }

      if (!computedBody) {
        return;
      }

      statements.push(
        j.variableDeclaration("const", [
          j.variableDeclarator(
            j.identifier(compName),
            j.callExpression(j.identifier("computed"), [computedBody]),
          ),
        ]),
      );
      imports.add("computed");
    }
  });

  return statements;
}

/**
 * Transform Options API inject to Composition API inject()
 * - inject: ['key'] → const key = inject('key')
 * - inject: { local: 'remoteKey' } → const local = inject('remoteKey')
 * - inject: { local: { from: 'key', default: val } } → const local = inject('key', val)
 * - inject: { local: { from: 'key', default: () => x } } → inject('key', () => x, true) (factory)
 */
function transformInjectAST(
  j: any,
  injectValue: any,
  imports: Set<string>,
  injectNames: Set<string>,
): any[] {
  const statements: any[] = [];
  if (!injectValue) return statements;

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
              j.callExpression(j.identifier("inject"), [j.literal(key)]),
            ),
          ]),
        );
      }
    });
    if (statements.length > 0) imports.add("inject");
  } else if (
    injectValue.type === "ObjectExpression" &&
    injectValue.properties
  ) {
    injectValue.properties.forEach((prop: any) => {
      const localName = prop.key?.name ?? prop.key?.value;
      if (!localName) return;
      const val = prop.value;
      let keyStr = localName;
      let defaultArg: any = null;
      if (val?.type === "ObjectExpression" && val.properties) {
        const fromProp = val.properties.find(
          (p: any) => p.key?.name === "from" || p.key?.value === "from",
        );
        const defaultProp = val.properties.find(
          (p: any) => p.key?.name === "default" || p.key?.value === "default",
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
        // Vue 3: inject(key, factory, true) when default is a function
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
            j.callExpression(j.identifier("inject"), injectArgs),
          ),
        ]),
      );
    });
    if (statements.length > 0) imports.add("inject");
  }
  return statements;
}

/**
 * Transform Options API provide to Composition API provide()
 * - provide: { key: value } → provide('key', value) for each
 * - provide() { return { key: this.ref } } → provide('key', ref) - this.ref → ref
 */
function transformProvideAST(
  j: any,
  provideValue: any,
  imports: Set<string>,
  dataProperties?: Set<string>,
): any[] {
  const statements: any[] = [];
  if (!provideValue) return statements;

  if (provideValue.type === "ObjectExpression" && provideValue.properties) {
    provideValue.properties.forEach((prop: any) => {
      const key = prop.key?.name ?? prop.key?.value;
      if (!key) return;
      const value = prop.value;
      statements.push(
        j.expressionStatement(
          j.callExpression(j.identifier("provide"), [
            j.literal(key),
            value ? j.clone(value) : j.identifier("undefined"),
          ]),
        ),
      );
    });
    if (statements.length > 0) imports.add("provide");
  } else if (
    provideValue.type === "FunctionExpression" ||
    provideValue.type === "ArrowFunctionExpression" ||
    (provideValue.type === "ObjectMethod" && provideValue.body)
  ) {
    const body = provideValue.body;
    if (body?.type === "BlockStatement" && body.body) {
      const returnStmt = body.body.find(
        (s: any) => s?.type === "ReturnStatement",
      );
      if (returnStmt?.argument?.type === "ObjectExpression") {
        (returnStmt.argument.properties || []).forEach((prop: any) => {
          const key = prop.key?.name ?? prop.key?.value;
          if (!key) return;
          let value = prop.value;
          if (
            value?.type === "MemberExpression" &&
            value.object?.type === "ThisExpression"
          ) {
            const propName = value.property?.name;
            value = j.identifier(propName || "undefined");
          }
          statements.push(
            j.expressionStatement(
              j.callExpression(j.identifier("provide"), [
                j.literal(key),
                value ? j.clone(value) : j.identifier("undefined"),
              ]),
            ),
          );
        });
        if (statements.length > 0) imports.add("provide");
      }
    }
  }
  return statements;
}

/**
 * Detect emitted events from this.$emit calls in methods
 */
function detectEmittedEvents(
  j: any,
  methodsValue: any,
  emittedEvents: Set<string>,
): void {
  if (
    !methodsValue ||
    methodsValue.type !== "ObjectExpression" ||
    !methodsValue.properties
  ) {
    return;
  }

  methodsValue.properties.forEach((methodProp: any) => {
    const methodValue =
      methodProp.value ||
      (methodProp.type === "ObjectMethod" ? methodProp : null);

    if (
      methodValue &&
      (methodValue.type === "FunctionExpression" ||
        methodValue.type === "ArrowFunctionExpression" ||
        methodValue.type === "ObjectMethod")
    ) {
      const methodBody =
        methodValue.type === "ObjectMethod"
          ? methodValue.body
          : methodValue.body;

      if (methodBody) {
        // Find all this.$emit('eventName', ...) calls
        j(methodBody).find(j.CallExpression).forEach((path: any) => {
          const callee = path.value.callee;
          if (
            callee &&
            callee.type === "MemberExpression" &&
            callee.object &&
            callee.object.type === "ThisExpression" &&
            callee.property &&
            callee.property.type === "Identifier" &&
            callee.property.name === "$emit"
          ) {
            // Extract event name from first argument
            const args = path.value.arguments || [];
            if (args.length > 0) {
              const firstArg = args[0];
              if (
                firstArg.type === "StringLiteral" ||
                firstArg.type === "Literal"
              ) {
                const eventName = firstArg.value || firstArg.name;
                if (eventName) {
                  emittedEvents.add(eventName);
                }
              }
            }
          }
        });
      }
    }
  });
}

function transformMethodsAST(
  j: any,
  methodsValue: any,
  methodNames?: Set<string>,
  methodSignatures?: Map<string, { params: string[]; returnType: string }>,
  enableTypeScript: boolean = false,
): any[] {
  const statements: any[] = [];

  if (
    !methodsValue ||
    methodsValue.type !== "ObjectExpression" ||
    !methodsValue.properties
  ) {
    return statements;
  }

  methodsValue.properties.forEach((methodProp: any) => {
    // Handle SpreadElement (e.g., ...mapActions('module', ['action1']))
    if (methodProp.type === "SpreadElement" && methodProp.argument) {
      const spreadArg = methodProp.argument;
      if (spreadArg.type === "CallExpression" && spreadArg.callee) {
        const helperName = spreadArg.callee.name;
        if (["mapActions", "mapMutations"].includes(helperName)) {
          // Mark for vuex-pinia-components transformation
          // This will be handled by vuex-pinia-components transform
          return;
        }
      }
    }

    // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
    // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
    const methodValue =
      methodProp.value ||
      (methodProp.type === "ObjectMethod" ? methodProp : null);

    if (
      methodProp &&
      methodValue &&
      methodValue.type &&
      (methodValue.type === "FunctionExpression" ||
        methodValue.type === "ArrowFunctionExpression" ||
        methodValue.type === "ObjectMethod")
    ) {
      const methodName =
        methodProp.key && methodProp.key.name ? methodProp.key.name : "method";
      // For ObjectMethod, params and body are directly on methodValue; for ObjectProperty, they're on methodValue.params/body
      const methodParams =
        methodValue.type === "ObjectMethod"
          ? methodValue.params
          : methodValue.params || [];
      const methodBody =
        methodValue.type === "ObjectMethod"
          ? methodValue.body
          : methodValue.body || j.blockStatement([]);

      // Extract parameter names and infer types if TypeScript is enabled
      if (enableTypeScript && methodSignatures) {
        const paramNames: string[] = [];
        methodParams.forEach((param: any) => {
          if (param.type === "Identifier") {
            paramNames.push(param.name);
          }
        });

        // Infer return type from method body
        const returnType = inferMethodReturnType(methodBody);
        methodSignatures.set(methodName, { params: paramNames, returnType });
      }

      // Transform to arrow function: const methodName = (params) => { ... }
      // This is more idiomatic for <script setup> in Vue 3
      statements.push(
        j.variableDeclaration("const", [
          j.variableDeclarator(
            j.identifier(methodName),
            j.arrowFunctionExpression(methodParams, methodBody),
          ),
        ]),
      );
      // Track method name
      if (methodProp.key && methodProp.key.name) {
        methodNames?.add(methodProp.key.name);
      }
    }
  });

  return statements;
}

/**
 * Infers return type from a method body
 */
function inferMethodReturnType(methodBody: any): string {
  if (!methodBody) {
    return "void";
  }

  // Check if method has a return statement
  if (methodBody.type === "BlockStatement" && methodBody.body) {
    const returnStmt = methodBody.body.find(
      (stmt: any) => stmt && stmt.type === "ReturnStatement",
    );
    if (returnStmt && returnStmt.argument) {
      return inferTypeFromValue(returnStmt.argument);
    }
    // No return statement or return without value → void
    return "void";
  }

  // Expression body (arrow function) → infer from expression
  if (methodBody.type !== "BlockStatement") {
    return inferTypeFromValue(methodBody);
  }

  return "void";
}

function transformWatchAST(
  j: any,
  watchValue: any,
  imports: Set<string>,
  // Reserved for future TypeScript support
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _enableTypeScript?: boolean,
): any[] {
  const statements: any[] = [];

  if (
    !watchValue ||
    watchValue.type !== "ObjectExpression" ||
    !watchValue.properties
  ) {
    return statements;
  }

  watchValue.properties.forEach((watchProp: any) => {
    const watchKey =
      watchProp.key && watchProp.key.name ? watchProp.key.name : null;
    // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
    const watchHandler =
      watchProp.value || (watchProp.type === "ObjectMethod" ? watchProp : null);

    if (!watchKey) return;

    if (
      watchHandler &&
      watchHandler.type &&
      (watchHandler.type === "FunctionExpression" ||
        watchHandler.type === "ArrowFunctionExpression" ||
        watchHandler.type === "ObjectMethod")
    ) {
      // For watch, we need to watch the ref value, not the ref itself
      // So we use () => watchKey.value instead of () => watchKey
      const getter = j.arrowFunctionExpression(
        [],
        j.memberExpression(j.identifier(watchKey), j.identifier("value")),
      );
      // For ObjectMethod, params and body are directly on watchHandler; for ObjectProperty, they're on watchHandler.params/body
      const handlerParams =
        watchHandler.type === "ObjectMethod"
          ? watchHandler.params
          : watchHandler.params || [];
      const handlerBody =
        watchHandler.type === "ObjectMethod"
          ? watchHandler.body
          : watchHandler.body || j.blockStatement([]);
      const callback = j.arrowFunctionExpression(handlerParams, handlerBody);

      statements.push(
        j.expressionStatement(
          j.callExpression(j.identifier("watch"), [getter, callback]),
        ),
      );
      imports.add("watch");
    } else if (watchHandler && watchHandler.type === "ObjectExpression") {
      // Watch options object: { handler: fn, immediate: true, deep: true }
      const handlerProp = watchHandler.properties.find(
        (p: any) => p.key && p.key.name === "handler",
      );
      const immediateProp = watchHandler.properties.find(
        (p: any) => p.key && p.key.name === "immediate",
      );
      const deepProp = watchHandler.properties.find(
        (p: any) => p.key && p.key.name === "deep",
      );

      // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
      const handler =
        handlerProp?.value ||
        (handlerProp?.type === "ObjectMethod" ? handlerProp : null);

      if (handler) {
        // For watch, we need to watch the ref value, not the ref itself
        // So we use () => watchKey.value instead of () => watchKey
        const getter = j.arrowFunctionExpression(
          [],
          j.memberExpression(j.identifier(watchKey), j.identifier("value")),
        );

        // For ObjectMethod, params and body are directly on handler; for ObjectProperty, they're on handler.params/body
        const handlerParams =
          handler.type === "ObjectMethod"
            ? handler.params
            : handler.params || [];
        const handlerBody =
          handler.type === "ObjectMethod"
            ? handler.body
            : handler.body || j.blockStatement([]);
        const callback = j.arrowFunctionExpression(handlerParams, handlerBody);

        const options: any[] = [];
        if (immediateProp && immediateProp.value) {
          options.push(
            j.property("init", j.identifier("immediate"), immediateProp.value),
          );
        }
        if (deepProp && deepProp.value) {
          options.push(
            j.property("init", j.identifier("deep"), deepProp.value),
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

  return statements;
}

function transformLifecycleHooksAST(
  j: any,
  hooks: any[],
  imports: Set<string>,
): any[] {
  const statements: any[] = [];

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

  hooks.forEach((hook: any) => {
    const hookName = hook.key.name;
    const vue3Hook = hookMap[hookName] || hookName;
    // Handle both ObjectProperty (has 'value') and ObjectMethod (function is the prop itself)
    const hookBody = hook.value || (hook.type === "ObjectMethod" ? hook : null);

    if (
      hookBody &&
      hookBody.type &&
      (hookBody.type === "FunctionExpression" ||
        hookBody.type === "ArrowFunctionExpression" ||
        hookBody.type === "ObjectMethod")
    ) {
      // Create callback function with the hook body
      let callback;
      if (hookBody.body && hookBody.body.type === "BlockStatement") {
        // Use the block statement directly
        callback = j.arrowFunctionExpression([], hookBody.body);
      } else if (hookBody.body) {
        // Wrap in block statement if needed
        callback = j.arrowFunctionExpression(
          [],
          j.blockStatement([j.returnStatement(hookBody.body)]),
        );
      } else {
        callback = j.arrowFunctionExpression([], j.blockStatement([]));
      }

      statements.push(
        j.expressionStatement(
          j.callExpression(j.identifier(vue3Hook), [callback]),
        ),
      );
      imports.add(vue3Hook);
    }
  });

  return statements;
}

function generateImportStatements(j: any, imports: Set<string>): any[] {
  const statements: any[] = [];
  const vueImports: string[] = [];

  imports.forEach((imp) => {
    if (
      [
        "ref",
        "reactive",
        "computed",
        "watch",
        "onMounted",
        "onUpdated",
        "onBeforeMount",
        "onBeforeUpdate",
        "onBeforeUnmount",
        "onUnmounted",
        "onActivated",
        "onDeactivated",
        "onErrorCaptured",
      ].includes(imp)
    ) {
      vueImports.push(imp);
    }
  });

  if (vueImports.length > 0) {
    statements.push(
      j.importDeclaration(
        vueImports
          .sort()
          .map((imp: string) => j.importSpecifier(j.identifier(imp))),
        j.literal("vue"),
      ),
    );
  }

  return statements;
}

function isVueComponent(obj: any): boolean {
  if (!obj || obj.type !== "ObjectExpression") return false;

  // Check if it has any Vue component properties
  const vueKeys = [
    "props",
    "data",
    "methods",
    "computed",
    "setup",
    "created",
    "mounted",
    "emits",
    "watch",
    "beforeCreate",
    "beforeMount",
    "beforeUpdate",
    "beforeDestroy",
    "destroyed",
    "beforeUnmount",
    "unmounted",
    "activated",
    "deactivated",
    "errorCaptured",
    "name",
    "components",
    "directives",
    "filters",
    "mixins",
    "provide",
    "inject",
  ];

  // If it's an export default object, it's likely a Vue component
  // Check if it has any Vue-specific properties
  if (obj.properties && obj.properties.length > 0) {
    // Check for Vue component properties
    const hasVueProperty = obj.properties.some(
      (prop: any) =>
        prop && prop.key && prop.key.name && vueKeys.includes(prop.key.name),
    );

    // Also consider it a Vue component if it has data() function (common pattern)
    const hasDataFunction = obj.properties.some(
      (prop: any) =>
        prop &&
        prop.key &&
        prop.key.name === "data" &&
        prop.value &&
        (prop.value.type === "FunctionExpression" ||
          prop.value.type === "ArrowFunctionExpression"),
    );

    // If it's an export default with properties, assume it's a Vue component
    // This is more permissive but safer for migration
    return hasVueProperty || hasDataFunction || obj.properties.length > 0;
  }

  return false;
}

function findProperty(properties: any[], name: string) {
  return properties.find((prop: any) => prop.key && prop.key.name === name);
}

/**
 * Transform all this.xxx references to Composition API equivalents
 * - this.propName → props.propName
 * - this.dataProperty → dataProperty.value (for refs)
 * - this.computedProperty → computedProperty (computed already returns ref)
 * - this.methodName → methodName (direct function call)
 */
function transformThisReferences(
  j: any,
  root: any,
  dataProperties: Set<string>,
  computedProperties: Set<string>,
  methodNames: Set<string>,
  propNames: Set<string>,
  injectNames?: Set<string>,
): void {
  root.find(j.MemberExpression).forEach((path: any) => {
    const node = path.value;

    // Check if it's a this.xxx expression
    if (
      node.object &&
      node.object.type === "ThisExpression" &&
      node.property &&
      node.property.type === "Identifier"
    ) {
      const propertyName = node.property.name;

      // Skip Vue internal properties
      if (propertyName.startsWith("$")) {
        return;
      }

      // Transform based on what type of property it is
      if (injectNames?.has(propertyName)) {
        j(path).replaceWith(j.identifier(propertyName));
      } else if (propNames.has(propertyName)) {
        // Props: this.propName → props.propName
        const newExpression = j.memberExpression(
          j.identifier("props"),
          j.identifier(propertyName),
        );
        j(path).replaceWith(newExpression);
      } else if (dataProperties.has(propertyName)) {
        // Data properties: this.dataProperty → dataProperty.value
        // Replace the entire MemberExpression with dataProperty.value
        const newExpression = j.memberExpression(
          j.identifier(propertyName),
          j.identifier("value"),
        );
        j(path).replaceWith(newExpression);
      } else if (computedProperties.has(propertyName)) {
        // Computed properties: this.computedProperty → computedProperty
        // Computed already returns a ref, so just use the name directly
        j(path).replaceWith(j.identifier(propertyName));
      } else if (methodNames.has(propertyName)) {
        // Methods: this.methodName → methodName
        j(path).replaceWith(j.identifier(propertyName));
      }
    }
  });
}

function findLifecycleHooks(properties: any[]): any[] {
  const hooks = [
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
  return properties.filter(
    (prop: any) => prop.key && hooks.includes(prop.key.name),
  );
}
