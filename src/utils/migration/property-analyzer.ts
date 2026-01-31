/**
 * Property Analyzer - Dynamic property detection from codebase
 * 
 * This module provides utilities to dynamically analyze object properties
 * from the codebase instead of hardcoding property names.
 * This improves genericity and makes the migrator work with any project structure.
 */

import jscodeshift from 'jscodeshift';

export interface PropertyAnalysis {
  /** Properties found in objects of this type */
  properties: Set<string>;
  /** Most common property used for categorization */
  categoryProperty?: string;
  /** Most common property used for search/filtering */
  searchProperty?: string;
  /** Sample objects analyzed */
  sampleCount: number;
}

/**
 * Analyze object properties from array items in the codebase
 * This dynamically detects what properties exist on objects instead of hardcoding
 */
export function analyzeArrayItemProperties(
  code: string,
  arrayVarName: string,
  projectRoot?: string
): PropertyAnalysis {
  const result: PropertyAnalysis = {
    properties: new Set<string>(),
    sampleCount: 0,
  };

  try {
    // Parse code using jscodeshift
    const j = jscodeshift;
    const root = j(code);
    
    // Find array variable usage: arrayVar.value.map(), arrayVar.filter(), etc.
    root.find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          type: 'MemberExpression',
          object: { name: arrayVarName },
          property: { name: 'value' }
        },
        property: { name: (name: string) => ['map', 'filter', 'forEach', 'find', 'some'].includes(name) }
      }
    }).forEach((path: any) => {
      const callback = path.value.arguments[0];
      if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')) {
        const itemParam = callback.params[0]?.name || 'item';
        
        // Find property accesses in callback: item.property
        j(callback.body).find(j.MemberExpression, {
          object: { name: itemParam }
        }).forEach((propPath: any) => {
          const propName = propPath.value.property?.name;
          if (propName) {
            result.properties.add(propName);
            result.sampleCount++;
          }
        });
      }
    });
    
    // Also find direct arrayVar.map() (without .value)
    root.find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: { name: arrayVarName },
        property: { name: (name: string) => ['map', 'filter', 'forEach', 'find', 'some'].includes(name) }
      }
    }).forEach((path: any) => {
      const callback = path.value.arguments[0];
      if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression')) {
        const itemParam = callback.params[0]?.name || 'item';
        
        j(callback.body).find(j.MemberExpression, {
          object: { name: itemParam }
        }).forEach((propPath: any) => {
          const propName = propPath.value.property?.name;
          if (propName) {
            result.properties.add(propName);
            result.sampleCount++;
          }
        });
      }
    });
    
    // Find direct property access patterns: item.category, post.title, etc.
    const itemNames = ['item', 'post', 'product', 'user', 'data', 'element', 'entry', 'obj'];
    root.find(j.MemberExpression, {
      object: { name: (name: string) => itemNames.includes(name) }
    }).forEach((path: any) => {
      const propName = path.value.property?.name;
      if (propName) {
        result.properties.add(propName);
        result.sampleCount++;
      }
    });
    
  } catch (error) {
    // If parsing fails, fall back to regex analysis
    return analyzeArrayItemPropertiesRegex(code, arrayVarName);
  }

  // Infer category and search properties from found properties
  inferCategoryAndSearchProperties(result);

  return result;
}

/**
 * Fallback regex-based analysis when AST parsing fails
 */
function analyzeArrayItemPropertiesRegex(
  code: string,
  arrayVarName: string
): PropertyAnalysis {
  const result: PropertyAnalysis = {
    properties: new Set<string>(),
    sampleCount: 0,
  };

  // Find patterns like: arrayVar.value.map(item => item.property)
  const mapPattern = new RegExp(
    `${arrayVarName}\\.value\\.(map|filter|forEach)\\s*\\([^)]*=>\\s*\\w+\\.(\\w+)`,
    'g'
  );
  
  let match;
  while ((match = mapPattern.exec(code)) !== null) {
    const property = match[2];
    if (property) {
      result.properties.add(property);
      result.sampleCount++;
    }
  }

  // Find patterns like: item.property, post.property, etc.
  const propertyPattern = /\b(item|post|product|user|data|element|entry)\.(\w+)/g;
  while ((match = propertyPattern.exec(code)) !== null) {
    const property = match[2];
    if (property) {
      result.properties.add(property);
      result.sampleCount++;
    }
  }

  inferCategoryAndSearchProperties(result);
  return result;
}

/**
 * Infer category and search properties from found properties
 */
function inferCategoryAndSearchProperties(analysis: PropertyAnalysis): void {
  const props = Array.from(analysis.properties);
  
  // Common category property names (ordered by likelihood)
  const categoryCandidates = ['category', 'type', 'tag', 'kind', 'group', 'class', 'role', 'status'];
  for (const candidate of categoryCandidates) {
    if (props.includes(candidate)) {
      analysis.categoryProperty = candidate;
      break;
    }
  }
  
  // Common search property names (ordered by likelihood)
  const searchCandidates = ['title', 'name', 'content', 'description', 'text', 'label'];
  for (const candidate of searchCandidates) {
    if (props.includes(candidate)) {
      analysis.searchProperty = candidate;
      break;
    }
  }
  
  // If no specific search property found, use first text-like property
  if (!analysis.searchProperty) {
    const textLikeProps = props.filter(p => 
      ['title', 'name', 'content', 'description', 'text', 'label', 'author'].includes(p)
    );
    if (textLikeProps.length > 0) {
      analysis.searchProperty = textLikeProps[0];
    }
  }
}

/**
 * Analyze filter object properties from the codebase
 */
export function analyzeFilterProperties(code: string): {
  categoryFilter?: string;
  searchFilter?: string;
  allFilters: Set<string>;
} {
  const result = {
    allFilters: new Set<string>(),
    categoryFilter: undefined as string | undefined,
    searchFilter: undefined as string | undefined,
  };

  try {
    // Find filters object definition: filters: { category: null, search: '' }
    const filtersMatch = code.match(/filters\s*:\s*\{([^}]+)\}/);
    if (filtersMatch) {
      const filtersContent = filtersMatch[1];
      
      // Extract property names
      const propertyPattern = /(\w+)\s*:/g;
      let match;
      while ((match = propertyPattern.exec(filtersContent)) !== null) {
        const propName = match[1];
        result.allFilters.add(propName);
      }
    }
    
    // Also check reactive(filters) pattern
    const reactiveFiltersMatch = code.match(/reactive\s*\(\s*\{([^}]+)\}\s*\)/);
    if (reactiveFiltersMatch) {
      const filtersContent = reactiveFiltersMatch[1];
      const propertyPattern = /(\w+)\s*:/g;
      let match;
      while ((match = propertyPattern.exec(filtersContent)) !== null) {
        const propName = match[1];
        result.allFilters.add(propName);
      }
    }
    
    // Infer category and search filters
    const filters = Array.from(result.allFilters);
    const categoryCandidates = ['category', 'type', 'tag', 'kind', 'group'];
    const searchCandidates = ['search', 'query', 'term', 'filter'];
    
    for (const candidate of categoryCandidates) {
      if (filters.includes(candidate)) {
        result.categoryFilter = candidate;
        break;
      }
    }
    
    for (const candidate of searchCandidates) {
      if (filters.includes(candidate)) {
        result.searchFilter = candidate;
        break;
      }
    }
  } catch (error) {
    // Fallback to simple regex if parsing fails
  }

  return result;
}

/**
 * Analyze store structure to find array properties and their item structures
 */
export async function analyzeStoreStructure(
  storeCode: string,
  projectRoot?: string
): Promise<Map<string, PropertyAnalysis>> {
  const result = new Map<string, PropertyAnalysis>();
  
  // Find all ref/reactive array declarations
  const arrayPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:ref|reactive)\s*\(/g;
  let match;
  
  while ((match = arrayPattern.exec(storeCode)) !== null) {
    const arrayName = match[1];
    
    // Analyze properties of items in this array
    const analysis = analyzeArrayItemProperties(storeCode, arrayName, projectRoot);
    if (analysis.properties.size > 0 || analysis.sampleCount > 0) {
      result.set(arrayName, analysis);
    }
  }
  
  return result;
}

/**
 * Analyze template to find property usage patterns
 * This helps detect which properties are actually used in templates
 */
export function analyzeTemplateProperties(templateCode: string): Set<string> {
  const properties = new Set<string>();
  
  // Find {{ property }} patterns
  const interpolationPattern = /\{\{\s*(\w+)\s*\}\}/g;
  let match;
  while ((match = interpolationPattern.exec(templateCode)) !== null) {
    properties.add(match[1]);
  }
  
  // Find v-for="item in items" and then item.property patterns
  const vForPattern = /v-for=["']\s*(\w+)\s+in\s+(\w+)/g;
  while ((match = vForPattern.exec(templateCode)) !== null) {
    const itemName = match[1];
    const arrayName = match[2];
    
    // Find item.property in template
    const itemPropertyPattern = new RegExp(`${itemName}\\.(\\w+)`, 'g');
    let propMatch;
    while ((propMatch = itemPropertyPattern.exec(templateCode)) !== null) {
      properties.add(propMatch[1]);
    }
  }
  
  // Find :key="item.id" or :prop="item.property" patterns
  const bindingPattern = /[:@](\w+)=["'](\w+)\.(\w+)/g;
  while ((match = bindingPattern.exec(templateCode)) !== null) {
    properties.add(match[3]);
  }
  
  return properties;
}
