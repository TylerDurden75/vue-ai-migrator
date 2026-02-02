import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transforms Vue 2 mixins to Vue 3 compatible format
 * This transform prepares mixins for conversion to composables in post-migration-fixer
 * Vue 3 supports mixins but the recommended approach is to use composables
 */
export const mixinsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;

  // Transform Vue.mixin() global calls to app.mixin() (will be handled by post-migration-fixer)
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
      // Transform to app.mixin() - post-migration-fixer will handle composable conversion
      if (path.value.arguments && path.value.arguments.length > 0) {
        const mixinArg = path.value.arguments[0];
        // Replace Vue with app
        j(path).replaceWith(
          j.callExpression(
            j.memberExpression(
              j.identifier('app'),
              j.identifier('mixin')
            ),
            [mixinArg]
          )
        );
        hasChanges = true;
      }
    }
  });

  // Note: mixins: [mixinName] in components will be transformed to composables
  // by post-migration-fixer.ts, so we just mark them here for processing
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;
    
    if (
      declaration &&
      declaration.type === 'ObjectExpression' &&
      isVueComponent(declaration)
    ) {
      const mixinsProp = findProperty(declaration, 'mixins');
      
      if (mixinsProp && mixinsProp.value.type === 'ArrayExpression') {
        // Mixins will be converted to composables in post-migration-fixer
        // This transform just ensures they're detected
        hasChanges = true;
      }
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

