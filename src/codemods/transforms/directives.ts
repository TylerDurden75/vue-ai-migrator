import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transforms Vue 2 custom directives to Vue 3 format
 * Vue 3 directive API has some changes in hook names and parameters
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
            
            // Vue 2 hooks: bind, inserted, update, componentUpdated, unbind
            // Vue 3 hooks: created, beforeMount, mounted, beforeUpdate, updated, beforeUnmount, unmounted
            
            properties.forEach((hookProp: any) => {
              if (hookProp.key && hookProp.key.name) {
                const hookName = hookProp.key.name;
                
                // Map Vue 2 hooks to Vue 3
                const hookMap: Record<string, string> = {
                  'bind': 'beforeMount',      // Called before element is inserted
                  'inserted': 'mounted',       // Called when element is inserted
                  'update': 'beforeUpdate',    // Called when VNode updates
                  'componentUpdated': 'updated', // Called after VNode and children updated
                  'unbind': 'unmounted',       // Called when element is removed
                };
                
                if (hookMap[hookName]) {
                  hookProp.key.name = hookMap[hookName];
                  hasChanges = true;
                }
              }
            });
          }
        });
      }
    }
  });

  // Transform Vue.directive() global registration
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Vue' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'directive'
    ) {
      // Vue.directive('name', definition) → app.directive('name', definition)
      // This requires app context - mark for AI processing
      hasChanges = true;
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

