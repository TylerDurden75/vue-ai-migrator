import { Transform, FileInfo, API } from 'jscodeshift';

/** Convert Vue 2 event name to Vue 3 handler prop: click → onClick */
function toVue3EventProp(name: string): string {
  const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return "on" + camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Flatten Vue 2 VNode props to Vue 3 format.
 * attrs, domProps → spread; on → onClick etc; staticClass+class → class[]; staticStyle+style → style[]
 */
function flattenVNodeProps(j: any, propsObj: any): any[] {
  if (!propsObj || propsObj.type !== "ObjectExpression" || !propsObj.properties) {
    return [];
  }

  const props = propsObj.properties as any[];
  const getProp = (key: string) => props.find((p: any) => (p.key?.name ?? p.key?.value) === key);

  const hasVue2Props =
    getProp("attrs") || getProp("domProps") || getProp("on") || getProp("staticClass") || getProp("staticStyle");
  if (!hasVue2Props) return [];

  const newProps: any[] = [];
  const skipKeys = new Set(["attrs", "domProps", "on", "staticClass", "staticStyle", "class", "style"]);

  for (const prop of props) {
    const key = prop.key?.name ?? prop.key?.value;
    if (skipKeys.has(key)) continue;

    if (key === "class" || key === "style") continue; // handled below
    newProps.push(prop);
  }

  // class: merge staticClass + class
  const staticClass = getProp("staticClass");
  const classProp = getProp("class");
  if (staticClass || classProp) {
    const classEls: any[] = [];
    if (staticClass) classEls.push(staticClass.value);
    if (classProp) classEls.push(classProp.value);
    newProps.push(
      j.property("init", j.identifier("class"), classEls.length === 1 ? classEls[0] : j.arrayExpression(classEls))
    );
  }

  // style: merge staticStyle + style
  const staticStyle = getProp("staticStyle");
  const styleProp = getProp("style");
  if (staticStyle || styleProp) {
    const styleEls: any[] = [];
    if (staticStyle) styleEls.push(staticStyle.value);
    if (styleProp) styleEls.push(styleProp.value);
    newProps.push(
      j.property("init", j.identifier("style"), styleEls.length === 1 ? styleEls[0] : j.arrayExpression(styleEls))
    );
  }

  // attrs → spread
  const attrs = getProp("attrs");
  if (attrs?.value?.type === "ObjectExpression" && attrs.value.properties?.length) {
    attrs.value.properties.forEach((p: any) => newProps.push(p));
  }

  // domProps → spread
  const domProps = getProp("domProps");
  if (domProps?.value?.type === "ObjectExpression" && domProps.value.properties?.length) {
    domProps.value.properties.forEach((p: any) => newProps.push(p));
  }

  // on → onClick, onUpdate:modelValue, etc.
  const on = getProp("on");
  if (on?.value?.type === "ObjectExpression" && on.value.properties?.length) {
    on.value.properties.forEach((p: any) => {
      const eventKey = p.key?.name ?? p.key?.value;
      const propName = toVue3EventProp(eventKey);
      const keyNode = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(propName)
        ? j.identifier(propName)
        : j.stringLiteral(propName);
      newProps.push(j.property("init", keyNode, p.value));
    });
  }

  return newProps;
}

/**
 * Transform render functions for Vue 3 (script setup / Composition API compatible):
 * - render(h) → render() + import { h } from 'vue'
 * - h('Component') → h(resolveComponent('Component'))
 * - Vue 2 VNode props → Vue 3 flat props (attrs, domProps, on, staticClass, staticStyle)
 */
export const renderFunctionsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let hasChanges = false;
  const imports = new Set<string>();

  // Flatten Vue 2 VNode props (attrs, domProps, on, staticClass, staticStyle) across entire file
  root.find(j.CallExpression).forEach((callPath: any) => {
    const callee = callPath.value.callee;
    if (callee.type !== "Identifier" || callee.name !== "h") return;
    const args = callPath.value.arguments || [];
    if (args.length < 2 || args[1].type !== "ObjectExpression") return;

    const flatProps = flattenVNodeProps(j, args[1]);
    if (flatProps.length > 0) {
      callPath.value.arguments[1] = j.objectExpression(flatProps);
      hasChanges = true;
    }
  });

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
