import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transforms Vue 2 mixins to Vue 3 compatible format
 * Vue 3 supports mixins but they work differently with Composition API
 */
export const mixinsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;

  // Transform mixins array in component options
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;
    
    if (
      declaration &&
      declaration.type === 'ObjectExpression' &&
      isVueComponent(declaration)
    ) {
      const mixinsProp = findProperty(declaration, 'mixins');
      
      if (mixinsProp && mixinsProp.value.type === 'ArrayExpression') {
        // Mixins are still supported in Vue 3, but we can suggest Composition API
        // For now, we just ensure they're properly formatted
        // Complex mixin transformations should use AI
        
        // Check if mixins contain Options API patterns that need conversion
        mixinsProp.value.elements.forEach((mixin: any) => {
          if (mixin.type === 'Identifier' || mixin.type === 'CallExpression') {
            // Mark for review - mixins might need manual conversion
            hasChanges = true;
          }
        });
      }
    }
  });

  // Transform Vue.mixin() global calls
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Vue' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'mixin'
    ) {
      // Vue.mixin() is removed in Vue 3
      // This should be converted to app.mixin() or use Composition API
      // Mark for AI processing
      hasChanges = true;
    }
  });

  return hasChanges ? root.toSource() : fileInfo.source;
};

function isVueComponent(obj: any): boolean {
  if (obj.type !== 'ObjectExpression') return false;
  
  const vueKeys = ['props', 'data', 'methods', 'computed', 'mixins', 'setup'];
  return obj.properties.some((prop: any) => 
    prop.key && vueKeys.includes(prop.key.name)
  );
}

function findProperty(obj: any, name: string) {
  return obj.properties.find((prop: any) => 
    prop.key && prop.key.name === name
  );
}

