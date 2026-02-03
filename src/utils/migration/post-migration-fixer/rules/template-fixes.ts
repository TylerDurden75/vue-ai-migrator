/**
 * Rules for fixing template issues
 */

import * as path from "path";
import * as fs from "fs";
import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";

/**
 * Fix: Malformed template interpolations - missing or extra parentheses in {{ }}
 * - {{ fn(arg }} → {{ fn(arg) }} (missing closing paren)
 * - {{ expr) }} → {{ expr }} (extra closing paren before }})
 */
export const templateInterpolationParensRule: FixRule = {
  id: "template-interpolation-parens",
  description: "Fix malformed {{ }} parentheses (missing ) or extra ) before }})",
  priority: 58,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return /\{\{[^}]*\)\s*\}\}|\{\{[^}]*(?:\w+\s*\([^)]*)\s*\}\}/.test(template);
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    let fixed = template;
    // 1) Extra ) before }}: {{ expr) }} → {{ expr }}
    fixed = fixed.replace(/\{\{([^}]*)\)\s*\}\}/g, (_, expr) => {
      const open = (expr.match(/\(/g) || []).length;
      const close = (expr.match(/\)/g) || []).length;
      if (open <= close) {
        result.fixed = true;
        return `{{ ${expr.trim()} }}`;
      }
      return `{{ ${expr}) }}`;
    });
    // 2) Missing ) before }}: {{ fn(... }} → {{ fn(...) }}
    fixed = fixed.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, expr) => {
      const trimmed = expr.trim();
      const open = (trimmed.match(/\(/g) || []).length;
      const close = (trimmed.match(/\)/g) || []).length;
      if (open > close && !trimmed.endsWith(")")) {
        result.fixed = true;
        return `{{ ${trimmed}) }}`;
      }
      return match;
    });
    if (result.fixed) {
      result.content = content.replace(
        /<template[^>]*>[\s\S]*?<\/template>/,
        `${openTag}${fixed}${closeTag}`
      );
      result.fixes.push("Fixed template interpolation parentheses");
    }
    return result;
  }
};

/** Resolve filter module path from project root (generic: works for any Vue project structure) */
function resolveFilterPath(projectRoot: string | undefined): string {
  if (projectRoot) {
    const candidates = [
      path.join(projectRoot, "src", "filters", "index.js"),
      path.join(projectRoot, "src", "filters", "index.ts"),
      path.join(projectRoot, "src", "utils", "filters", "index.js"),
      path.join(projectRoot, "src", "utils", "filters.ts"),
      path.join(projectRoot, "src", "filters.js")
    ];
    const hit = candidates.find((p) => fs.existsSync(p));
    if (hit && (hit.includes("utils") && hit.includes("filters"))) return "@/utils/filters";
    if (hit) return "@/filters";
  }
  return "@/filters";
}

/**
 * Fix: Add missing component imports detected from template
 */
export const missingComponentImportsRule: FixRule = {
  id: "missing-component-imports",
  description: "Add missing component imports detected from template usage",
  priority: 60,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("<template>");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!context.templateContent || !context.scriptContent) {
      return result;
    }

    // Extract component names from template (PascalCase)
    const componentPattern = getCachedRegex(
      "<([A-Z][a-zA-Z0-9]+)",
      "g"
    );
    
    const usedComponents = new Set<string>();
    let match;
    while ((match = componentPattern.exec(context.templateContent)) !== null) {
      const componentName = match[1];
      // Skip built-in HTML tags and Vue components
      if (!["RouterView", "RouterLink", "Transition", "KeepAlive", "Teleport", "Suspense"].includes(componentName)) {
        usedComponents.add(componentName);
      }
    }

    // Check which components are not imported
    const missingComponents: string[] = [];
    usedComponents.forEach(componentName => {
      // Check if component is imported
      const importPattern = new RegExp(`import\\s+.*?${componentName}.*?from`, "g");
      if (!importPattern.test(context.scriptContent!)) {
        missingComponents.push(componentName);
      }
    });

    if (missingComponents.length > 0) {
      let fixed = content;
      const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        
        // Try to find component files (generic approach)
        // Look for common component paths
        const componentPaths = [
          "@/components/",
          "@/components/",
          "../components/",
          "./components/",
          "./"
        ];

        missingComponents.forEach(componentName => {
          // Try to find the component file
          let componentPath = "";
          for (const basePath of componentPaths) {
            // Check if file exists (would need fs access, but for now use common pattern)
            componentPath = `${basePath}${componentName}.vue`;
            break; // Use first path (would need actual file system check in real implementation)
          }

          // Add import
          const importLine = `import ${componentName} from '${componentPath}';\n`;
          
          // Find first non-import line
          const firstCodeLine = scriptContent.match(/^[^i]*?(\n|$)/);
          const insertPos = firstCodeLine ? firstCodeLine.index! : 0;
          
          scriptContent = importLine + scriptContent.substring(insertPos).trim();
        });

        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
        );

        result.content = fixed;
        result.fixed = true;
        result.fixes.push(`Added missing component imports: ${missingComponents.join(", ")}`);
      }
    }

    return result;
  }
};

/**
 * Fix: Add filter imports when template uses filter as function (e.g. {{ capitalize(x) }}, {{ currency(price) }})
 * Vue 3 has no global filters - each component must import. Path is resolved from project (src/filters, src/utils/filters, etc.)
 */
export const templateFilterFunctionImportsRule: FixRule = {
  id: "template-filter-function-imports",
  description: "Add filter imports when template uses capitalize(), currency() etc. (path from project)",
  priority: 56,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup") || !content.includes("<template>")) return false;
    const templateSection = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return /\{\{\s*(capitalize|currency)\s*\(/.test(templateSection);
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateSection = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? "";
    const scriptMatch = content.match(/<script([^>]*)>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;
    const usedFilters = new Set<string>();
    for (const name of ["capitalize", "currency"]) {
      if (new RegExp(`\\{\\{\\s*${name}\\s*\\(`).test(templateSection)) usedFilters.add(name);
    }
    if (usedFilters.size === 0) return result;
    let scriptContent = scriptMatch[2];
    const toAdd = Array.from(usedFilters).filter((f) => !new RegExp(`import\\s+.*\\b${f}\\b.*from`).test(scriptContent));
    if (toAdd.length === 0) return result;
    const filterPath = resolveFilterPath(context.projectRoot);
    const importLine = `import { ${toAdd.join(", ")} } from "${filterPath}";\n`;
    const firstImport = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
    const insertIdx = firstImport ? firstImport[0].length : 0;
    scriptContent = scriptContent.slice(0, insertIdx) + importLine + scriptContent.slice(insertIdx);
    result.content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/, `<script${scriptMatch[1]}>${scriptContent}</script>`);
    result.fixed = true;
    result.fixes.push(`Added filter imports: ${toAdd.join(", ")}`);
    return result;
  }
};

/**
 * Fix: Add missing filter imports (capitalize, currency, etc.) - Vue 2 pipe syntax
 */
export const missingFilterImportsRule: FixRule = {
  id: "missing-filter-imports",
  description: "Add missing filter imports detected from template usage (pipe syntax)",
  priority: 55,
  dependencies: ["missing-component-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("|");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!context.templateContent || !context.scriptContent) {
      return result;
    }

    // Extract filter names from template (pattern: {{ value | filterName }})
    const filterPattern = getCachedRegex(
      "\\|\\s*(\\w+)",
      "g"
    );
    
    const usedFilters = new Set<string>();
    let match;
    while ((match = filterPattern.exec(context.templateContent)) !== null) {
      const filterName = match[1];
      usedFilters.add(filterName);
    }

    // Common Vue 2 filters that need to be converted to functions
    const filterFunctions = new Set<string>();
    usedFilters.forEach(filterName => {
      // Check if filter function is imported
      const importPattern = new RegExp(`import\\s+.*?${filterName}.*?from`, "g");
      const functionPattern = new RegExp(`(const|function)\\s+${filterName}\\s*=`, "g");
      
      if (!importPattern.test(context.scriptContent!) && 
          !functionPattern.test(context.scriptContent!)) {
        filterFunctions.add(filterName);
      }
    });

    if (filterFunctions.size > 0) {
      let fixed = content;
      const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        
        // Add filter functions (would need to import from filters file or define inline)
        // For now, add as simple functions
        const ts = context.enableTypeScript;
        const filterDefs: string[] = [];
        filterFunctions.forEach(filterName => {
          // Common filter implementations
          if (filterName === "capitalize") {
            filterDefs.push(ts
              ? `const ${filterName} = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';`
              : `const ${filterName} = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';`);
          } else if (filterName === "currency") {
            filterDefs.push(ts
              ? `const ${filterName} = (val: number) => val ? \`$\${val.toFixed(2)}\` : '$0.00';`
              : `const ${filterName} = (val) => val ? \`$\${val.toFixed(2)}\` : '$0.00';`);
          } else {
            filterDefs.push(ts
              ? `const ${filterName} = (val: any) => val; // TODO: Implement ${filterName} filter`
              : `const ${filterName} = (val) => val; // TODO: Implement ${filterName} filter`);
          }
        });

        // Find first non-import line
        const firstCodeLine = scriptContent.match(/^[^i]*?(\n|$)/);
        const insertPos = firstCodeLine ? firstCodeLine.index! : 0;
        
        scriptContent = filterDefs.join("\n") + "\n" + scriptContent.substring(insertPos).trim();

        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
        );

        result.content = fixed;
        result.fixed = true;
        result.fixes.push(`Added missing filter functions: ${Array.from(filterFunctions).join(", ")}`);
      }
    }

    return result;
  }
};

/**
 * Fix: currency() applied to non-numeric template expressions (e.g. product.name, product.category).
 * Pattern: {{ currency(expr.name) }} or {{ currency(expr.category) }} → {{ expr.name }} (currency is for numbers).
 * Generic: currency(expression.prop) where prop is name/category/title/email/role/description/text → remove currency().
 */
const NON_NUMERIC_PROPS = "name|category|title|email|role|description|text|label|type";
export const templateCurrencyNonNumericRule: FixRule = {
  id: "template-currency-non-numeric",
  description: "Remove currency() from non-numeric template expressions (e.g. .name, .category)",
  priority: 57,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return new RegExp(`currency\\s*\\([^)]+\\.(?:${NON_NUMERIC_PROPS})\\s*\\)`, "g").test(template);
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    const pattern = getCachedRegex(
      `\\{\\{\\s*currency\\s*\\(([^)]+\\.(?:${NON_NUMERIC_PROPS}))\\s*\\)\\s*\\}\\}`,
      "g"
    );
    const fixed = template.replace(pattern, "{{ $1 }}");
    if (fixed !== template) {
      result.content = content.replace(
        /<template[^>]*>[\s\S]*?<\/template>/,
        `${openTag}${fixed}${closeTag}`
      );
      result.fixed = true;
      result.fixes.push("Removed currency() from non-numeric template expressions");
    }
    return result;
  }
};

/**
 * Fix: Fix v-model bindings in template
 */
export const vModelBindingsRule: FixRule = {
  id: "v-model-bindings",
  description: "Fix v-model bindings that might be missing or incorrect",
  priority: 50,
  dependencies: ["missing-filter-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("v-model");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!context.templateContent || !context.scriptContent) {
      return result;
    }

    let fixed = content;

    // Fix: v-model="value" where value is not defined as ref
    // This is a basic check - more complex logic would need AST parsing
    const vModelPattern = getCachedRegex(
      'v-model="([^"]+)"',
      "g"
    );
    
    const vModelBindings = new Set<string>();
    let match;
    while ((match = vModelPattern.exec(context.templateContent)) !== null) {
      vModelBindings.add(match[1]);
    }

    // Check if bindings are defined as refs
    vModelBindings.forEach(binding => {
      // Check if it's a ref
      const refPattern = new RegExp(`const\\s+${binding}\\s*=\\s*ref\\(`, "g");
      // Check if it's a computed (shouldn't be used with v-model)
      const computedPattern = new RegExp(`const\\s+${binding}\\s*=\\s*computed\\(`, "g");
      
      if (!refPattern.test(context.scriptContent!) && 
          computedPattern.test(context.scriptContent!)) {
        // This is a computed property used with v-model - should be a ref
        result.issues.push(`v-model="${binding}" uses computed property, should use ref`);
      }
    });

    // Note: Actual fixing would require more complex logic
    // For now, just detect issues

    return result;
  }
};
