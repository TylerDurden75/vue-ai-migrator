import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transform async components to use defineAsyncComponent
 * Vue 2: const AsyncComponent = () => import('./Component.vue')
 * Vue 3: const AsyncComponent = defineAsyncComponent(() => import('./Component.vue'))
 */
export const asyncComponentsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let hasChanges = false;
  const imports = new Set<string>();

  // Find arrow functions that return dynamic imports (async components)
  root.find(j.VariableDeclarator).forEach((path: any) => {
    const init = path.value.init;

    // Pattern: const Component = () => import('./Component.vue')
    if (init && init.type === 'ArrowFunctionExpression' && init.body) {
      // Check if body is a CallExpression with import
      // Note: import() is parsed with callee.type === 'Import' (not Identifier)
      let isImportCall = false;

      if (init.body.type === 'CallExpression' && init.body.callee) {
        // Check for Import type (dynamic import) - this is the correct type
        if (init.body.callee.type === 'Import') {
          isImportCall = true;
        }
        // Also check for Identifier 'import' (fallback for edge cases)
        else if (init.body.callee.type === 'Identifier' && init.body.callee.name === 'import') {
          isImportCall = true;
        }
      }
      // Also check for parenthesized expressions: () => (import('./Comp.vue'))
      else if (
        init.body.type === 'ParenthesizedExpression' &&
        init.body.expression &&
        init.body.expression.type === 'CallExpression' &&
        init.body.expression.callee
      ) {
        if (
          init.body.expression.callee.type === 'Import' ||
          (init.body.expression.callee.type === 'Identifier' &&
            init.body.expression.callee.name === 'import')
        ) {
          isImportCall = true;
        }
      }

      // Debug: log if we're checking but not finding
      if (!isImportCall && init.body.type === 'CallExpression') {
        // Try string-based detection as fallback
        const bodySource = j(init.body).toSource();
        if (bodySource.includes('import(') && bodySource.match(/import\s*\(/)) {
          isImportCall = true;
        }
      }

      if (isImportCall) {
        // Wrap with defineAsyncComponent
        path.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [init]);

        imports.add('defineAsyncComponent');
        hasChanges = true;
      }
    }

    // Pattern: const Component = () => ({ component: import('./Component.vue') })
    if (
      init &&
      init.type === 'ArrowFunctionExpression' &&
      init.body &&
      init.body.type === 'ObjectExpression'
    ) {
      const properties = init.body.properties || [];
      const componentProp = properties.find(
        (p: any) =>
          p.key &&
          p.key.name === 'component' &&
          p.value &&
          p.value.type === 'CallExpression' &&
          p.value.callee &&
          (p.value.callee.type === 'Import' ||
            (p.value.callee.type === 'Identifier' && p.value.callee.name === 'import'))
      );

      if (componentProp) {
        // Transform to: defineAsyncComponent(() => import('./Component.vue'))
        const importCall = componentProp.value;
        path.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [
          j.arrowFunctionExpression([], importCall),
        ]);

        imports.add('defineAsyncComponent');
        hasChanges = true;
      }
    }
  });

  // Find object expressions with component property (async component definition)
  root.find(j.ObjectExpression).forEach((path: any) => {
    const properties = path.value.properties || [];
    const componentProp = properties.find(
      (p: any) =>
        p.key &&
        p.key.name === 'component' &&
        p.value &&
        p.value.type === 'CallExpression' &&
        p.value.callee &&
        (p.value.callee.type === 'Import' ||
          (p.value.callee.type === 'Identifier' && p.value.callee.name === 'import'))
    );

    if (componentProp) {
      // Check if this is in a variable declaration or component definition
      const parent = path.parent;
      if (parent && parent.value.type === 'VariableDeclarator') {
        const importCall = componentProp.value;
        parent.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [
          j.arrowFunctionExpression([], importCall),
        ]);

        imports.add('defineAsyncComponent');
        hasChanges = true;
      }
    }
  });

  // Add import for defineAsyncComponent if needed
  if (hasChanges && imports.has('defineAsyncComponent')) {
    const existingImports = root.find(j.ImportDeclaration);
    let vueImportFound = false;

    existingImports.forEach((path: any) => {
      if (path.value.source.value === 'vue' && path.value.specifiers) {
        // Check if defineAsyncComponent is already imported
        const hasDefineAsyncComponent = path.value.specifiers.some(
          (spec: any) => spec.imported && spec.imported.name === 'defineAsyncComponent'
        );

        if (!hasDefineAsyncComponent) {
          // Add defineAsyncComponent to existing vue import
          path.value.specifiers.push(j.importSpecifier(j.identifier('defineAsyncComponent')));
          vueImportFound = true;
        } else {
          vueImportFound = true;
        }
      }
    });

    // If no vue import exists, create one
    if (!vueImportFound) {
      const program = root.get().node.program;
      if (program && program.body) {
        const importStatement = j.importDeclaration(
          [j.importSpecifier(j.identifier('defineAsyncComponent'))],
          j.literal('vue')
        );
        program.body.unshift(importStatement);
      }
    }
  }

  return hasChanges ? root.toSource() : fileInfo.source;
};
