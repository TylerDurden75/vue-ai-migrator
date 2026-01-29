import { Transform, FileInfo, API } from 'jscodeshift';
import { compositionApiTransform } from './composition-api';

/**
 * Complete transformation to <script setup lang="ts">
 * This transform converts Options API components to <script setup> format
 *
 * Features:
 * - Converts export default to <script setup>
 * - Transforms all Options API to Composition API
 * - Adds TypeScript types
 * - Removes export default statement
 * - Generates proper script setup code
 */
export const scriptSetupTransform: Transform = async (
  fileInfo: FileInfo,
  api: API,
  options: any = {}
) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const enableTypeScript = options?.enableTypeScript || false;

  let hasChanges = false;
  const imports = new Set<string>();
  const setupStatements: string[] = [];
  let componentFound = false;

  // Check if code is already transformed (has imports from vue and no export default)
  // Check for both single and double quotes, and also check for 'vue' in import statement
  const hasVueImport =
    fileInfo.source.includes('import') &&
    (fileInfo.source.includes("from 'vue'") ||
      fileInfo.source.includes('from "vue"') ||
      fileInfo.source.match(/from\s+['"]vue['"]/));

  const isAlreadyTransformed = hasVueImport && !fileInfo.source.includes('export default');

  let transformedCode = fileInfo.source;

  // CRITICAL FIX: If code is already transformed (has Composition API patterns),
  // don't re-apply composition-api, just use the input directly
  // This prevents losing the already-transformed code
  if (isAlreadyTransformed) {
    // Code is already transformed, use it directly
    transformedCode = fileInfo.source;
  } else {
    // Always try to apply composition-api first to ensure we have transformed code
    // If it's already transformed, composition-api will return it as-is
    try {
      const compositionResult = compositionApiTransform(fileInfo, api, { enableTypeScript });
      // Handle Promise if async
      if (compositionResult instanceof Promise) {
        const result = await compositionResult;
        transformedCode = typeof result === 'string' ? result : fileInfo.source;
      } else {
        transformedCode =
          typeof compositionResult === 'string' ? compositionResult : fileInfo.source;
      }
    } catch (error) {
      // If composition-api fails, use original source
      transformedCode = fileInfo.source;
    }
  }

  // If composition API transform didn't work or code wasn't transformed, try direct transformation
  // BUT: Skip this if code is already transformed (isAlreadyTransformed) to avoid losing the transformation
  if (transformedCode === fileInfo.source && !isAlreadyTransformed) {
    // Try to find and transform the component directly
    root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
      const declaration = path.value.declaration;

      if (declaration && declaration.type === 'ObjectExpression') {
        componentFound = true;
        const properties = declaration.properties || [];

        // Transform all Options API features
        transformComponentToScriptSetup(j, properties, imports, setupStatements);
        hasChanges = true;
      }
    });

    // If component was found but no statements generated, still mark as changed
    // This will trigger the needsAI flag in the runner
    if (componentFound && setupStatements.length === 0) {
      hasChanges = true;
    }
  }

  // CRITICAL: If code is already transformed (isAlreadyTransformed), skip extraction
  // and go directly to return logic to preserve the full transformed code

  // Always try to extract from transformed code if it was transformed
  if (transformedCode !== fileInfo.source) {
    // Composition API transform worked or code is already transformed, extract the code
    // Parse the transformed code to extract imports and setup code
    try {
      // Re-parse the transformed code to ensure we have a fresh AST
      const transformedRoot = j(transformedCode);

      // Extract imports
      transformedRoot.find(j.ImportDeclaration).forEach((path: any) => {
        if (path.value.source && path.value.source.value === 'vue') {
          path.value.specifiers?.forEach((spec: any) => {
            if (spec.imported) {
              imports.add(spec.imported.name);
            }
          });
        }
      });

      // Extract all top-level statements from program body
      const program = transformedRoot.get().node.program;
      if (program && program.body) {
        program.body.forEach((stmt: any) => {
          // Skip import declarations (handled separately)
          if (stmt.type === 'ImportDeclaration') {
            return;
          }

          // Extract VariableDeclarations (const, let, var)
          if (stmt.type === 'VariableDeclaration') {
            const code = j(stmt).toSource();
            if (code && !code.includes('export default')) {
              setupStatements.push(code);
            }
          }
          // Extract FunctionDeclarations
          else if (stmt.type === 'FunctionDeclaration') {
            const code = j(stmt).toSource();
            if (code) {
              setupStatements.push(code);
            }
          }
          // Extract ExpressionStatements (watch(), onMounted(), etc.)
          else if (stmt.type === 'ExpressionStatement') {
            const code = j(stmt).toSource();
            if (code) {
              setupStatements.push(code);
            }
          }
        });
      }

      // If we didn't extract anything from program.body, try using find() as fallback
      if (setupStatements.length === 0) {
        // Fallback: use find() method to extract all statements
        transformedRoot.find(j.VariableDeclaration).forEach((path: any) => {
          const code = j(path).toSource();
          if (code && !code.includes('export default')) {
            setupStatements.push(code);
          }
        });

        transformedRoot.find(j.FunctionDeclaration).forEach((path: any) => {
          const code = j(path).toSource();
          if (code) {
            setupStatements.push(code);
          }
        });

        transformedRoot.find(j.ExpressionStatement).forEach((path: any) => {
          const code = j(path).toSource();
          if (code) {
            setupStatements.push(code);
          }
        });
      }

      hasChanges = true;
      componentFound = true;
    } catch (error) {
      // If parsing fails, try to extract code manually
      // Split by lines and extract meaningful statements
      const lines = transformedCode.split('\n');
      let inImport = false;
      const importLines: string[] = [];

      lines.forEach((line: string) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('import ')) {
          inImport = true;
          importLines.push(line);
          if (trimmed.endsWith(';')) {
            inImport = false;
          }
        } else if (inImport && trimmed.endsWith(';')) {
          importLines.push(line);
          inImport = false;
        } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
          if (
            trimmed.includes('defineProps') ||
            trimmed.includes('const ') ||
            trimmed.includes('function ') ||
            trimmed.includes('watch(') ||
            trimmed.includes('onMounted') ||
            trimmed.includes('computed(') ||
            trimmed.includes('ref(')
          ) {
            setupStatements.push(line);
          }
        }
      });

      if (importLines.length > 0) {
        const importCode = importLines.join('\n');
        importCode.match(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"]/g)?.forEach((imp: string) => {
          const matches = imp.match(/\{([^}]+)\}/);
          if (matches) {
            matches[1].split(',').forEach((name: string) => {
              imports.add(name.trim());
            });
          }
        });
      }

      hasChanges = true;
      componentFound = true;
    }
  }

  // Generate script setup code
  // CRITICAL: Always return transformedCode if it was transformed, even if extraction failed
  // This ensures we don't lose the transformation from composition-api
  // If code was transformed by composition-api, it already contains all the ref/computed/watch/etc.

  // Check if transformedCode contains Composition API patterns (ref, computed, watch, etc.)
  const hasCompositionAPI =
    transformedCode.includes('ref(') ||
    transformedCode.includes('computed(') ||
    transformedCode.includes('watch(') ||
    transformedCode.includes('onMounted') ||
    transformedCode.includes('onBeforeUnmount');

  // CRITICAL FIX: If code is already Composition API (either from composition-api transform
  // or already transformed), return it directly without trying to extract statements
  // This is the most reliable way to preserve all the transformations
  // IMPORTANT: Check hasCompositionAPI first, and if true, always return transformedCode
  // regardless of whether transformedCode === fileInfo.source (because composition-api
  // may return the same code but we still want to preserve it)
  if (hasCompositionAPI) {
    // Code has Composition API patterns, return it directly
    return transformedCode;
  }

  // If code was transformed but doesn't have Composition API patterns, try extraction
  if (transformedCode !== fileInfo.source) {
    // Otherwise, try to use extracted statements if available
    if (setupStatements.length > 0) {
      const importStatements = generateImports(imports);
      const setupCode = setupStatements.join('\n');
      return importStatements + (importStatements ? '\n\n' : '') + setupCode;
    }

    // Fallback: return transformed code anyway
    return transformedCode;
  }

  // If component was found but code wasn't transformed, try direct transformation
  if (hasChanges && componentFound) {
    if (setupStatements.length > 0) {
      const importStatements = generateImports(imports);
      const setupCode = setupStatements.join('\n');
      return importStatements + (importStatements ? '\n\n' : '') + setupCode;
    }
  }

  // If no changes were made, return original
  return fileInfo.source;
};

function transformComponentToScriptSetup(
  j: any,
  properties: any[],
  imports: Set<string>,
  setupStatements: string[]
): void {
  // Transform props
  const propsProp = properties.find((p: any) => p.key && p.key.name === 'props');
  if (propsProp && propsProp.value) {
    if (propsProp.value.type === 'ArrayExpression' || propsProp.value.type === 'ObjectExpression') {
      setupStatements.push(`const props = defineProps(${j(propsProp.value).toSource()});`);
    }
  }

  // Transform emits
  const emitsProp = properties.find((p: any) => p.key && p.key.name === 'emits');
  if (emitsProp && emitsProp.value) {
    if (emitsProp.value.type === 'ArrayExpression' || emitsProp.value.type === 'ObjectExpression') {
      setupStatements.push(`const emit = defineEmits(${j(emitsProp.value).toSource()});`);
    }
  }

  // Transform data
  const dataProp = properties.find((p: any) => p.key && p.key.name === 'data');
  if (dataProp && dataProp.value) {
    transformDataToRefs(j, dataProp.value, imports, setupStatements);
  }

  // Transform computed
  const computedProp = properties.find((p: any) => p.key && p.key.name === 'computed');
  if (computedProp && computedProp.value) {
    transformComputedToComputed(j, computedProp.value, imports, setupStatements);
  }

  // Transform methods
  const methodsProp = properties.find((p: any) => p.key && p.key.name === 'methods');
  if (methodsProp && methodsProp.value) {
    transformMethodsToFunctions(j, methodsProp.value, setupStatements);
  }

  // Transform watch
  const watchProp = properties.find((p: any) => p.key && p.key.name === 'watch');
  if (watchProp && watchProp.value) {
    transformWatchToWatch(j, watchProp.value, imports, setupStatements);
  }

  // Transform lifecycle hooks
  const lifecycleHooks = [
    'beforeCreate',
    'created',
    'beforeMount',
    'mounted',
    'beforeUpdate',
    'updated',
    'beforeDestroy',
    'destroyed',
    'beforeUnmount',
    'unmounted',
    'activated',
    'deactivated',
    'errorCaptured',
  ];

  lifecycleHooks.forEach((hookName) => {
    const hookProp = properties.find((p: any) => p.key && p.key.name === hookName);
    if (hookProp && hookProp.value) {
      transformLifecycleHook(j, hookName, hookProp.value, imports, setupStatements);
    }
  });
}

function transformDataToRefs(
  j: any,
  dataValue: any,
  imports: Set<string>,
  statements: string[]
): void {
  if (!dataValue || !dataValue.type) return;

  if (dataValue.type === 'FunctionExpression' || dataValue.type === 'ArrowFunctionExpression') {
    const body = dataValue.body;

    if (body && body.type === 'BlockStatement' && body.body) {
      const returnStmt = body.body.find((stmt: any) => stmt && stmt.type === 'ReturnStatement');

      if (returnStmt && returnStmt.argument) {
        if (returnStmt.argument.type === 'ObjectExpression') {
          const objProps = returnStmt.argument.properties || [];

          if (objProps.length > 0) {
            objProps.forEach((prop: any) => {
              if (prop && prop.key) {
                const propName =
                  prop.key.type === 'Identifier' ? prop.key.name : j(prop.key).toSource();
                const propValue = prop.value ? j(prop.value).toSource() : 'undefined';
                statements.push(`const ${propName} = ref(${propValue});`);
                imports.add('ref');
              }
            });
          } else {
            statements.push(`const state = reactive(${j(returnStmt.argument).toSource()});`);
            imports.add('reactive');
          }
        } else {
          statements.push(`const state = reactive(${j(returnStmt.argument).toSource()});`);
          imports.add('reactive');
        }
      }
    }
  } else if (dataValue.type === 'ObjectExpression') {
    const objProps = dataValue.properties || [];
    if (objProps.length > 0) {
      objProps.forEach((prop: any) => {
        if (prop && prop.key) {
          const propName = prop.key.type === 'Identifier' ? prop.key.name : j(prop.key).toSource();
          const propValue = prop.value ? j(prop.value).toSource() : 'undefined';
          statements.push(`const ${propName} = ref(${propValue});`);
          imports.add('ref');
        }
      });
    } else {
      statements.push(`const state = reactive(${j(dataValue).toSource()});`);
      imports.add('reactive');
    }
  }
}

function transformComputedToComputed(
  j: any,
  computedValue: any,
  imports: Set<string>,
  statements: string[]
): void {
  if (!computedValue || computedValue.type !== 'ObjectExpression' || !computedValue.properties)
    return;

  computedValue.properties.forEach((compProp: any) => {
    if (
      compProp &&
      compProp.value &&
      compProp.value.type &&
      (compProp.value.type === 'FunctionExpression' ||
        compProp.value.type === 'ArrowFunctionExpression')
    ) {
      const compName = compProp.key && compProp.key.name ? compProp.key.name : 'computed';
      const compBody = compProp.value.body;

      if (compBody && compBody.type === 'BlockStatement' && compBody.body) {
        const returnStmt = compBody.body.find(
          (stmt: any) => stmt && stmt.type === 'ReturnStatement'
        );
        if (returnStmt && returnStmt.argument) {
          statements.push(
            `const ${compName} = computed(() => ${j(returnStmt.argument).toSource()});`
          );
        } else {
          statements.push(`const ${compName} = computed(() => { ${j(compBody).toSource()} });`);
        }
      } else if (compBody) {
        statements.push(`const ${compName} = computed(() => ${j(compBody).toSource()});`);
      }
      imports.add('computed');
    }
  });
}

function transformMethodsToFunctions(j: any, methodsValue: any, statements: string[]): void {
  if (!methodsValue || methodsValue.type !== 'ObjectExpression' || !methodsValue.properties) return;

  methodsValue.properties.forEach((methodProp: any) => {
    if (
      methodProp &&
      methodProp.value &&
      methodProp.value.type &&
      (methodProp.value.type === 'FunctionExpression' ||
        methodProp.value.type === 'ArrowFunctionExpression')
    ) {
      const methodName = methodProp.key && methodProp.key.name ? methodProp.key.name : 'method';
      const params = methodProp.value.params
        ? methodProp.value.params.map((p: any) => j(p).toSource()).join(', ')
        : '';
      const body = methodProp.value.body ? j(methodProp.value.body).toSource() : '{}';

      statements.push(`function ${methodName}(${params}) ${body}`);
    }
  });
}

function transformWatchToWatch(
  j: any,
  watchValue: any,
  imports: Set<string>,
  statements: string[]
): void {
  if (!watchValue || watchValue.type !== 'ObjectExpression' || !watchValue.properties) return;

  watchValue.properties.forEach((watchProp: any) => {
    const watchKey =
      watchProp.key && watchProp.key.name ? watchProp.key.name : j(watchProp.key).toSource();
    const watchHandler = watchProp.value;

    if (
      watchHandler &&
      watchHandler.type &&
      (watchHandler.type === 'FunctionExpression' ||
        watchHandler.type === 'ArrowFunctionExpression')
    ) {
      const params = watchHandler.params
        ? watchHandler.params.map((p: any) => j(p).toSource()).join(', ')
        : '';
      const body = watchHandler.body ? j(watchHandler.body).toSource() : '{}';
      statements.push(`watch(() => ${watchKey}, (${params}) => ${body});`);
      imports.add('watch');
    }
  });
}

function transformLifecycleHook(
  j: any,
  hookName: string,
  hookValue: any,
  imports: Set<string>,
  statements: string[]
): void {
  const hookMap: Record<string, string> = {
    beforeCreate: 'onBeforeMount',
    created: 'onMounted',
    beforeMount: 'onBeforeMount',
    mounted: 'onMounted',
    beforeUpdate: 'onBeforeUpdate',
    updated: 'onUpdated',
    beforeDestroy: 'onBeforeUnmount',
    destroyed: 'onUnmounted',
    beforeUnmount: 'onBeforeUnmount',
    unmounted: 'onUnmounted',
    activated: 'onActivated',
    deactivated: 'onDeactivated',
    errorCaptured: 'onErrorCaptured',
  };

  const vue3Hook = hookMap[hookName] || hookName;

  if (
    hookValue &&
    hookValue.type &&
    (hookValue.type === 'FunctionExpression' || hookValue.type === 'ArrowFunctionExpression')
  ) {
    const body = hookValue.body ? j(hookValue.body).toSource() : '{}';
    statements.push(`${vue3Hook}(() => ${body});`);
    imports.add(vue3Hook);
  }
}

function generateImports(imports: Set<string>): string {
  const vueImports: string[] = [];

  imports.forEach((imp) => {
    if (
      [
        'ref',
        'reactive',
        'computed',
        'watch',
        'onMounted',
        'onUpdated',
        'onBeforeMount',
        'onBeforeUpdate',
        'onBeforeUnmount',
        'onUnmounted',
        'onActivated',
        'onDeactivated',
        'onErrorCaptured',
      ].includes(imp)
    ) {
      vueImports.push(imp);
    }
  });

  if (vueImports.length > 0) {
    return `import { ${vueImports.sort().join(', ')} } from 'vue';`;
  }

  return '';
}
