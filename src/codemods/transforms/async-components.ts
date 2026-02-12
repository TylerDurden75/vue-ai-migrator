import { Transform, FileInfo, API } from 'jscodeshift';

function isImportCall(node: any): boolean {
  if (!node || node.type !== 'CallExpression' || !node.callee) return false;
  return (
    node.callee.type === 'Import' ||
    (node.callee.type === 'Identifier' && node.callee.name === 'import')
  );
}

function getLoaderFromComponent(componentValue: any): any {
  if (componentValue.type === 'CallExpression' && isImportCall(componentValue)) {
    return componentValue;
  }
  if (componentValue.type === 'ArrowFunctionExpression' && componentValue.body) {
    const body = componentValue.body;
    if (body.type === 'CallExpression' && isImportCall(body)) return body;
    if (body.type === 'ParenthesizedExpression' && body.expression && isImportCall(body.expression)) {
      return body.expression;
    }
  }
  return null;
}

/** Check if function uses Vue 2 (resolve, reject) async component pattern - must return Promise in Vue 3.
 * Only match when first param is 'resolve' - avoid false positives like (to, from) from route watchers.
 */
function isResolveRejectLoader(node: any): boolean {
  if (!node || (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression')) {
    return false;
  }
  const params = node.params || [];
  if (params.length !== 2) return false;
  const first = params[0];
  const firstName = first?.name ?? first?.left?.name;
  return firstName === 'resolve';
}

function wrapResolveRejectInPromise(j: any, fn: any): any {
  const params = fn.params || [];
  const body = fn.body;
  const promiseCallback = j.arrowFunctionExpression(
    params,
    body.type === 'BlockStatement' ? body : j.blockStatement([j.returnStatement(body)])
  );
  return j.arrowFunctionExpression(
    [],
    j.newExpression(j.identifier('Promise'), [promiseCallback])
  );
}

/**
 * Transform async components to use defineAsyncComponent (Vue 3)
 * - () => import('./X.vue') → defineAsyncComponent(() => import('./X.vue'))
 * - { component: () => import(...), delay, timeout, error, loading } →
 *   defineAsyncComponent({ loader: () => import(...), delay, timeout, errorComponent, loadingComponent })
 */
export const asyncComponentsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let hasChanges = false;
  const imports = new Set<string>();

  // Find arrow functions that return dynamic imports (async components)
  root.find(j.VariableDeclarator).forEach((path: any) => {
    const init = path.value.init;

    // Pattern: const Component = (resolve, reject) => { ... } - Vue 2 async component factory
    if (init && isResolveRejectLoader(init)) {
      path.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [
        wrapResolveRejectInPromise(j, init),
      ]);
      imports.add('defineAsyncComponent');
      hasChanges = true;
    }

    // Pattern: const Component = () => import('./Component.vue')
    if (init && init.type === 'ArrowFunctionExpression' && init.body && !isResolveRejectLoader(init)) {
      let isImportCallResult = false;
      let importCallNode: any = null;

      if (init.body.type === 'CallExpression' && isImportCall(init.body)) {
        isImportCallResult = true;
        importCallNode = init.body;
      } else if (
        init.body.type === 'ParenthesizedExpression' &&
        init.body.expression &&
        isImportCall(init.body.expression)
      ) {
        isImportCallResult = true;
        importCallNode = init.body.expression;
      } else if (init.body.type === 'CallExpression') {
        const bodySource = j(init.body).toSource();
        if (bodySource.includes('import(') && bodySource.match(/import\s*\(/)) {
          isImportCallResult = true;
          importCallNode = init.body;
        }
      }

      if (isImportCallResult && importCallNode) {
        path.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [
          j.arrowFunctionExpression([], importCallNode),
        ]);
        imports.add('defineAsyncComponent');
        hasChanges = true;
      }
    }

    // Pattern: const Component = () => ({ component: import('./X.vue'), delay, ... })
    if (
      init &&
      init.type === 'ArrowFunctionExpression' &&
      init.body &&
      init.body.type === 'ObjectExpression'
    ) {
      const props = init.body.properties || [];
      const componentProp = props.find(
        (p: any) => p.key && (p.key.name === 'component' || p.key.value === 'component')
      );
      if (!componentProp) return;

      let loaderNode: any = getLoaderFromComponent(componentProp.value);
      if (!loaderNode && isResolveRejectLoader(componentProp.value)) {
        loaderNode = wrapResolveRejectInPromise(j, componentProp.value);
      } else if (loaderNode) {
        loaderNode = j.arrowFunctionExpression([], loaderNode);
      }
      if (!loaderNode) return;

      const newProps = props
        .filter((p: any) => p !== componentProp)
        .map((p: any) => {
          const key = p.key?.name || p.key?.value;
          if (key === 'error') return j.property('init', j.identifier('errorComponent'), p.value);
          if (key === 'loading') return j.property('init', j.identifier('loadingComponent'), p.value);
          return p;
        });
      newProps.unshift(j.property('init', j.identifier('loader'), loaderNode));

      path.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [
        j.objectExpression(newProps),
      ]);
      imports.add('defineAsyncComponent');
      hasChanges = true;
    }
  });

  // Find object expressions with component property (direct object, not arrow return)
  root.find(j.ObjectExpression).forEach((path: any) => {
    const properties = path.value.properties || [];
    const componentProp = properties.find(
      (p: any) => p.key && (p.key.name === 'component' || p.key.value === 'component')
    );
    if (!componentProp) return;

    let loaderNode: any = getLoaderFromComponent(componentProp.value);
    if (!loaderNode && isResolveRejectLoader(componentProp.value)) {
      loaderNode = wrapResolveRejectInPromise(j, componentProp.value);
    } else if (loaderNode) {
      loaderNode = j.arrowFunctionExpression([], loaderNode);
    }
    if (!loaderNode) return;

    const parent = path.parent?.value;
    if (parent?.type !== 'VariableDeclarator') return;

    const newProps = properties
      .filter((p: any) => p !== componentProp)
      .map((p: any) => {
        const key = p.key?.name || p.key?.value;
        if (key === 'error') return j.property('init', j.identifier('errorComponent'), p.value);
        if (key === 'loading') return j.property('init', j.identifier('loadingComponent'), p.value);
        return p;
      });
    newProps.unshift(j.property('init', j.identifier('loader'), loaderNode));

    path.parent.value.init = j.callExpression(j.identifier('defineAsyncComponent'), [
      j.objectExpression(newProps),
    ]);
    imports.add('defineAsyncComponent');
    hasChanges = true;
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
