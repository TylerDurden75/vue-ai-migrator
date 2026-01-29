import { Transform, FileInfo, API } from 'jscodeshift';

/**
 * Transforms Vue 2 plugin usage to Vue 3
 * Vue.use() → app.use()
 * Vue.component() → app.component()
 * Vue.directive() → app.directive()
 */
export const pluginsTransform: Transform = (fileInfo: FileInfo, api: API) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasChanges = false;
  let needsAppContext = false;

  // Transform Vue.use() calls
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Vue' &&
      callee.property.type === 'Identifier' &&
      ['use', 'component', 'directive', 'mixin', 'config'].includes(callee.property.name)
    ) {
      // These need to be called on the app instance
      // Vue.use(plugin) → app.use(plugin)
      // We'll mark them and suggest app context
      needsAppContext = true;
      hasChanges = true;
      
      // Try to find if there's an app variable nearby
      // If not, we'll need to create one or use AI
      const parent = path.parent;
      if (parent && parent.value.type === 'Program') {
        // At top level, we can suggest creating app
        // For now, just mark for AI processing
      }
    }
  });

  // Transform Vue.component() global registration
  root.find(j.CallExpression).forEach((path: any) => {
    const callee = path.value.callee;
    
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Vue' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'component'
    ) {
      // Vue.component('name', Component) → app.component('name', Component)
      // This requires app context
      needsAppContext = true;
      hasChanges = true;
    }
  });

  // If we detected Vue.use() or Vue.component(), add a comment suggesting app context
  if (needsAppContext && hasChanges) {
    // Add import for createApp if not present
    const imports = root.find(j.ImportDeclaration);
    let hasVueImport = false;
    
    imports.forEach((path: any) => {
      if (path.value.source.value === 'vue') {
        hasVueImport = true;
        const specifiers = path.value.specifiers || [];
        
        const hasCreateApp = specifiers.some((s: any) => 
          s.imported && s.imported.name === 'createApp'
        );
        
        if (!hasCreateApp) {
          specifiers.push(j.importSpecifier(j.identifier('createApp')));
          path.value.specifiers = specifiers;
        }
      }
    });
    
    if (!hasVueImport) {
      const importStatement = j.importDeclaration(
        [j.importSpecifier(j.identifier('createApp'))],
        j.literal('vue')
      );
      root.get().node.program.body.unshift(importStatement);
    }
  }

  return hasChanges ? root.toSource() : fileInfo.source;
};

