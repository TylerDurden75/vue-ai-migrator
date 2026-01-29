import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transforms Vue Router 3 to Vue Router 4
 * Key changes:
 * - new Router() → createRouter()
 * - mode: 'history' → history: createWebHistory()
 * - base option → history: createWebHistory({ base: '...' })
 * - router-link/router-view props changes
 */
export const routerTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;

  // Transform new Router({ ... }) to createRouter({ ... })
  root.find(j.NewExpression).forEach((path: any) => {
    if (
      path.value.callee.type === 'Identifier' &&
      path.value.callee.name === 'Router'
    ) {
      const args = path.value.arguments;
      
      if (args.length > 0 && args[0].type === 'ObjectExpression') {
        const config = args[0];
        const properties = config.properties || [];
        
        // Transform mode to history
        properties.forEach((prop: any) => {
          if (prop.key && prop.key.name === 'mode') {
            const modeValue = prop.value.value;
            
            if (modeValue === 'history' || modeValue === 'hash' || modeValue === 'abstract') {
              // Remove mode property
              j(prop).remove();
              
              // Add history property
              const historyFunction = modeValue === 'history' 
                ? 'createWebHistory'
                : modeValue === 'hash'
                ? 'createWebHashHistory'
                : 'createMemoryHistory';
              
              // Check if base exists
              const baseProp = properties.find((p: any) => p.key && p.key.name === 'base');
              let historyArgs: any[] = [];
              
              if (baseProp) {
                // Combine base into history
                historyArgs = [
                  j.objectExpression([
                    j.property('init', j.identifier('base'), baseProp.value)
                  ])
                ];
                j(baseProp).remove();
              }
              
              const historyCall = j.callExpression(
                j.identifier(historyFunction),
                historyArgs
              );
              
              config.properties.push(
                j.property('init', j.identifier('history'), historyCall)
              );
              
              hasChanges = true;
            }
          }
        });
        
        // Transform to createRouter call
        const createRouterCall = j.callExpression(
          j.identifier('createRouter'),
          [config]
        );
        
        j(path).replaceWith(createRouterCall);
        hasChanges = true;
      }
    }
  });

  // Transform router-link props
  // router-link :to="{ name: 'route' }" → router-link :to="{ name: 'route' }" (same, but handle v-slot)
  // This is mostly handled in templates, but we can detect router-link usage in JS

  // Transform router.push/replace with string to object
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    
    if (
      callee.type === 'MemberExpression' &&
      callee.property.type === 'Identifier' &&
      ['push', 'replace'].includes(callee.property.name)
    ) {
      const args = path.value.arguments;
      
      // If first arg is a string literal, convert to object with path
      if (args.length > 0 && args[0].type === 'Literal' && typeof args[0].value === 'string') {
        const pathValue = args[0].value;
        
        // Only convert if it looks like a path (starts with /)
        if (pathValue.startsWith('/')) {
          args[0] = j.objectExpression([
            j.property('init', j.identifier('path'), args[0])
          ]);
          hasChanges = true;
        }
      }
    }
  });

  // Add import for createRouter and history functions if needed
  if (hasChanges) {
    const imports = root.find(j.ImportDeclaration);
    let hasRouterImport = false;
    
    imports.forEach((path: any) => {
      if (path.value.source.value === 'vue-router') {
        hasRouterImport = true;
        const specifiers = path.value.specifiers || [];
        
        // Check if createRouter is already imported
        const hasCreateRouter = specifiers.some((s: any) => 
          s.imported && s.imported.name === 'createRouter'
        );
        
        if (!hasCreateRouter) {
          specifiers.push(j.importSpecifier(j.identifier('createRouter')));
          path.value.specifiers = specifiers;
        }
      }
    });
    
    // Add import if it doesn't exist
    if (!hasRouterImport) {
      const importStatement = j.importDeclaration(
        [j.importSpecifier(j.identifier('createRouter'))],
        j.literal('vue-router')
      );
      root.get().node.program.body.unshift(importStatement);
    }
  }

  return hasChanges ? root.toSource() : fileInfo.source;
};

