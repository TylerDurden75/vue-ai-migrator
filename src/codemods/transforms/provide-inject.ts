import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transforms Vue 2 provide/inject to Vue 3 format
 * Vue 3 provide/inject API is mostly the same but has some improvements
 * Main changes:
 * - provide/inject can be functions in Vue 3 (better for reactivity)
 * - No changes needed for basic usage, but we can suggest improvements
 */
export const provideInjectTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;

  // Transform provide in component options
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const declaration = path.value.declaration;
    
    if (
      declaration &&
      declaration.type === 'ObjectExpression' &&
      isVueComponent(declaration)
    ) {
      const provideProp = findProperty(declaration, 'provide');
      
      if (provideProp) {
        // Vue 2: provide can be object or function
        // Vue 3: Same, but function is preferred for reactivity
        // If it's an object, we can suggest converting to function
        if (provideProp.value.type === 'ObjectExpression') {
          // Mark for suggestion - object provide works but function is better
          hasChanges = true;
        }
      }

      const injectProp = findProperty(declaration, 'inject');
      
      if (injectProp) {
        // Vue 2: inject can be array or object
        // Vue 3: Same, but object with default values is preferred
        if (injectProp.value.type === 'ArrayExpression') {
          // Array syntax works in Vue 3, but object is preferred
          // We can suggest conversion but it's not required
          hasChanges = true;
        }
      }
    }
  });

  // Note: provide/inject API is mostly compatible between Vue 2 and 3
  // This transform mainly marks usage for potential improvements
  // Actual conversion would require understanding the context

  return hasChanges ? root.toSource() : fileInfo.source;
};

function isVueComponent(obj: any): boolean {
  if (obj.type !== 'ObjectExpression') return false;
  
  const vueKeys = ['props', 'data', 'methods', 'provide', 'inject', 'setup'];
  return obj.properties.some((prop: any) => 
    prop.key && vueKeys.includes(prop.key.name)
  );
}

function findProperty(obj: any, name: string) {
  return obj.properties.find((prop: any) => 
    prop.key && prop.key.name === name
  );
}

