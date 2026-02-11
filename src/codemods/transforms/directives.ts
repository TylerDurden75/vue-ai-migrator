import { Transform, FileInfo, API } from 'jscodeshift';

/** Vue 2 → Vue 3 directive hook names (Custom Directives breaking) */
const DIRECTIVE_HOOK_MAP: Record<string, string> = {
  bind: "beforeMount",
  inserted: "mounted",
  update: "updated", // Vue 3: update removed, use updated instead
  componentUpdated: "updated",
  unbind: "unmounted",
};

/**
 * Transforms Vue 2 custom directives to Vue 3 format (Composition API / script setup compatible)
 * Vue 3 directive API: hook renames, vnode.context → binding.instance
 * Applies to component directives and Vue.directive() definitions.
 */
export const directivesTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;

  // Transform directives in component options
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;
    
    if (
      declaration &&
      declaration.type === 'ObjectExpression' &&
      isVueComponent(declaration)
    ) {
      const directivesProp = findProperty(declaration, 'directives');
      
      if (directivesProp && directivesProp.value.type === 'ObjectExpression') {
        // Transform directive definitions
        directivesProp.value.properties.forEach((dirProp: any) => {
          if (dirProp.value.type === 'ObjectExpression') {
            const dirDef = dirProp.value;
            const properties = dirDef.properties || [];
            
            properties.forEach((hookProp: any) => {
              if (hookProp.key && hookProp.key.name) {
                const hookName = hookProp.key.name;
                if (DIRECTIVE_HOOK_MAP[hookName]) {
                  hookProp.key.name = DIRECTIVE_HOOK_MAP[hookName];
                  hasChanges = true;
                }
                // Vue 3: vnode.context → binding.instance (component instance access)
                const hookValue = hookProp.value || hookProp;
                const body = hookValue.body;
                if (body) {
                  j(body)
                    .find(j.MemberExpression, {
                      object: { type: "Identifier", name: "vnode" },
                      property: { type: "Identifier", name: "context" },
                    })
                    .replaceWith(() =>
                      j.memberExpression(
                        j.identifier("binding"),
                        j.identifier("instance")
                      )
                    )
                    .forEach(() => {
                      hasChanges = true;
                    });
                }
              }
            });
          }
        });
      }
    }
  });

  // Transform Vue.directive() definitions (hook names + vnode.context)
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    const args = path.value.arguments || [];
    if (
      callee.type === "MemberExpression" &&
      callee.object?.name === "Vue" &&
      callee.property?.name === "directive" &&
      args.length >= 2
    ) {
      hasChanges = true; // Vue.directive → app.directive (handled by post-fixer)
      const def = args[1];
      if (def.type === "ObjectExpression") {
        (def.properties || []).forEach((hookProp: any) => {
          if (hookProp.key?.name && DIRECTIVE_HOOK_MAP[hookProp.key.name]) {
            hookProp.key.name = DIRECTIVE_HOOK_MAP[hookProp.key.name];
          }
          const hookValue = hookProp.value || hookProp;
          const body = hookValue?.body;
          if (body) {
            j(body)
              .find(j.MemberExpression, {
                object: { type: "Identifier", name: "vnode" },
                property: { type: "Identifier", name: "context" },
              })
              .replaceWith(() =>
                j.memberExpression(
                  j.identifier("binding"),
                  j.identifier("instance")
                )
              )
              .forEach(() => {
                hasChanges = true;
              });
          }
        });
      }
    }
  });

  return hasChanges ? root.toSource() : fileInfo.source;
};

function isVueComponent(obj: any): boolean {
  if (obj.type !== 'ObjectExpression') return false;
  
  const vueKeys = ['props', 'data', 'methods', 'directives', 'setup'];
  return obj.properties.some((prop: any) => 
    prop.key && vueKeys.includes(prop.key.name)
  );
}

function findProperty(obj: any, name: string) {
  return obj.properties.find((prop: any) => 
    prop.key && prop.key.name === name
  );
}

