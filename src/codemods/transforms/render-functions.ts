import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transform render functions to use resolveComponent for registered components
 * Vue 3: Use resolveComponent() for components registered globally
 *
 * Also handles removal of contextual h from render
 * Vue 2: render(h) { return h('div') }
 * Vue 3: render() { return h('div') } and import { h } from 'vue'
 */
export const renderFunctionsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let hasChanges = false;
  const imports = new Set<string>();

  // Find render functions
  root.find(j.ObjectMethod).forEach((path: any) => {
    if (path.value.key && path.value.key.name === 'render') {
      const params = path.value.params || [];
      const body = path.value.body;

      // Remove h parameter if present (Vue 2: render(h) → Vue 3: render())
      if (params.length > 0 && params[0].type === 'Identifier' && params[0].name === 'h') {
        path.value.params = [];
        hasChanges = true;
        imports.add('h');
      }

      // Transform component references in render body to use resolveComponent
      // Also add h import if h is used (even without h parameter)
      if (body && body.type === 'BlockStatement') {
        // Check if h is used in the body
        const bodySource = j(body).toSource();
        if (bodySource.match(/\bh\(/)) {
          imports.add('h');
        }

        j(body)
          .find(j.CallExpression)
          .forEach((callPath: any) => {
            const callee = callPath.value.callee;

            // Pattern: h('ComponentName') where ComponentName is capitalized (likely a component)
            if (
              callee.type === 'Identifier' &&
              callee.name === 'h' &&
              callPath.value.arguments.length > 0
            ) {
              const firstArg = callPath.value.arguments[0];

              // Check if it's a string literal with capitalized name (component)
              if (
                firstArg.type === 'StringLiteral' &&
                firstArg.value &&
                firstArg.value[0] === firstArg.value[0].toUpperCase() &&
                firstArg.value !== 'Transition' &&
                firstArg.value !== 'TransitionGroup' &&
                firstArg.value !== 'KeepAlive'
              ) {
                // Transform to: h(resolveComponent('ComponentName'))
                callPath.value.arguments[0] = j.callExpression(j.identifier('resolveComponent'), [
                  firstArg,
                ]);

                imports.add('resolveComponent');
                hasChanges = true;
              }
            }
          });
      }
    }
  });

  // Find render function expressions
  root.find(j.ObjectProperty).forEach((path: any) => {
    if (
      path.value.key &&
      path.value.key.name === 'render' &&
      path.value.value &&
      (path.value.value.type === 'FunctionExpression' ||
        path.value.value.type === 'ArrowFunctionExpression')
    ) {
      const renderFn = path.value.value;
      const params = renderFn.params || [];

      // Remove h parameter
      if (params.length > 0 && params[0].type === 'Identifier' && params[0].name === 'h') {
        renderFn.params = [];
        hasChanges = true;
        imports.add('h');
      }

      // Transform component references
      if (renderFn.body) {
        j(renderFn.body)
          .find(j.CallExpression)
          .forEach((callPath: any) => {
            const callee = callPath.value.callee;

            if (
              callee.type === 'Identifier' &&
              callee.name === 'h' &&
              callPath.value.arguments.length > 0
            ) {
              const firstArg = callPath.value.arguments[0];

              if (
                firstArg.type === 'StringLiteral' &&
                firstArg.value &&
                firstArg.value[0] === firstArg.value[0].toUpperCase() &&
                firstArg.value !== 'Transition' &&
                firstArg.value !== 'TransitionGroup' &&
                firstArg.value !== 'KeepAlive'
              ) {
                callPath.value.arguments[0] = j.callExpression(j.identifier('resolveComponent'), [
                  firstArg,
                ]);

                imports.add('resolveComponent');
                hasChanges = true;
              }
            }
          });
      }
    }
  });

  // Add imports if needed
  if (hasChanges) {
    const existingImports = root.find(j.ImportDeclaration);
    let vueImportFound = false;

    existingImports.forEach((path: any) => {
      if (path.value.source.value === 'vue' && path.value.specifiers) {
        const specifiers = path.value.specifiers || [];

        // Add h if needed
        if (imports.has('h')) {
          const hasH = specifiers.some((spec: any) => spec.imported && spec.imported.name === 'h');
          if (!hasH) {
            specifiers.push(j.importSpecifier(j.identifier('h')));
          }
        }

        // Add resolveComponent if needed
        if (imports.has('resolveComponent')) {
          const hasResolveComponent = specifiers.some(
            (spec: any) => spec.imported && spec.imported.name === 'resolveComponent'
          );
          if (!hasResolveComponent) {
            specifiers.push(j.importSpecifier(j.identifier('resolveComponent')));
          }
        }

        vueImportFound = true;
      }
    });

    // Create new import if vue import doesn't exist
    if (!vueImportFound) {
      const program = root.get().node.program;
      if (program && program.body) {
        const importSpecifiers: any[] = [];
        if (imports.has('h')) {
          importSpecifiers.push(j.importSpecifier(j.identifier('h')));
        }
        if (imports.has('resolveComponent')) {
          importSpecifiers.push(j.importSpecifier(j.identifier('resolveComponent')));
        }

        if (importSpecifiers.length > 0) {
          const importStatement = j.importDeclaration(importSpecifiers, j.literal('vue'));
          program.body.unshift(importStatement);
        }
      }
    }
  }

  return hasChanges ? root.toSource() : fileInfo.source;
};
