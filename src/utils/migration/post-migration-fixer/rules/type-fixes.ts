/**
 * Rules for fixing TypeScript type issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";

/**
 * Fix: Wrong destructuring in params - { key: any, value } renames key to "any".
 * Replace with { key, value }: { key: string; value: unknown } so key and value are both defined.
 */
export const destructuringKeyValueParamRule: FixRule = {
  id: "destructuring-key-value-param",
  description: "Fix { key: any, value } param to proper destructuring with type",
  priority: 86,
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") || filePath.endsWith(".ts") || filePath.endsWith(".vue")) &&
           /\{\s*key\s*:\s*any\s*,\s*value\s*\}/.test(content);
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(
      /\{\s*key\s*:\s*any\s*,\s*value\s*\}\s*:\s*any/g,
      "{ key, value }: { key: string; value: unknown }"
    );
    const fixed2 = fixed.replace(
      /\{\s*key\s*:\s*any\s*,\s*value\s*\}(?!\s*:)/g,
      "{ key, value }: { key: string; value: unknown }"
    );
    if (fixed2 !== content) {
      result.content = fixed2;
      result.fixed = true;
      result.fixes.push("Fixed destructuring param { key: any, value } → { key, value } with type");
    }
    return result;
  }
};

/**
 * Fix: Fix incorrect Event types in function parameters
 */
export const incorrectEventTypeRule: FixRule = {
  id: "incorrect-event-type",
  description: "Fix incorrect Event types in function parameters",
  priority: 88,
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") || filePath.endsWith(".ts") || filePath.endsWith(".js")) &&
           content.includes("Event") &&
           content.includes("function");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: function SET_XXX(event: Event) → function SET_XXX(value: any) or appropriate type
    // Pattern: function SET_XXX(event: Event) or function SET_XXX(event: Event, ...)
    const eventTypePattern = getCachedRegex(
      "function\\s+(SET_\\w+|\\w+)\\s*\\([^)]*event\\s*:\\s*Event[^)]*\\)",
      "g"
    );
    
    let match;
    const fixes: string[] = [];
    
    while ((match = eventTypePattern.exec(content)) !== null) {
      const funcName = match[1];
      const fullMatch = match[0];
      
      // Determine appropriate type based on function name
      let replacementType = "any";
      if (funcName.startsWith("SET_")) {
        // SET_XXX functions usually take a value, not an event
        replacementType = "any";
      } else if (funcName.includes("Filter") || funcName.includes("filter")) {
        // Filter functions might take an object
        replacementType = "{ key: string; value: any }";
      }
      
      // Replace Event with appropriate type
      const fixedMatch = fullMatch.replace(/event\s*:\s*Event/g, `value: ${replacementType}`);
      fixed = fixed.replace(fullMatch, fixedMatch);
      fixes.push(`Fixed incorrect Event type in function ${funcName} parameters`);
    }

    // Fix: const functionName = (event: Event) => → const functionName = (value: any) =>
    const arrowEventPattern = getCachedRegex(
      "const\\s+(\\w+)\\s*=\\s*\\([^)]*event\\s*:\\s*Event[^)]*\\)\\s*=>",
      "g"
    );
    
    while ((match = arrowEventPattern.exec(content)) !== null) {
      const funcName = match[1];
      const fullMatch = match[0];
      
      let replacementType = "any";
      if (funcName.includes("Filter") || funcName.includes("filter")) {
        replacementType = "{ key: string; value: any }";
      }
      
      const fixedMatch = fullMatch.replace(/event\s*:\s*Event/g, `value: ${replacementType}`);
      fixed = fixed.replace(fullMatch, fixedMatch);
      fixes.push(`Fixed incorrect Event type in arrow function ${funcName} parameters`);
    }

    if (fixes.length > 0) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(...fixes);
    }

    return result;
  }
};

/**
 * Fix: Fix filters[key] access with type assertion
 */
export const filtersKeyAccessRule: FixRule = {
  id: "filters-key-access",
  description: "Fix filters[key] access with type assertion for TypeScript compatibility",
  priority: 87,
  dependencies: ["incorrect-event-type"],
  shouldApply: (filePath, content) => {
    return content.includes("filters[") && content.includes("key");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: filters[key] → filters[key as keyof typeof filters] or (filters as any)[key]
    // Pattern: filters[key] where key is a variable
    const filtersKeyPattern = getCachedRegex(
      "filters\\s*\\[\\s*(\\w+)\\s*\\]",
      "g"
    );
    
    let match;
    const fixes: string[] = [];
    
    while ((match = filtersKeyPattern.exec(content)) !== null) {
      const keyVar = match[1];
      const fullMatch = match[0];
      
      // Use type assertion for TypeScript compatibility
      const fixedMatch = `(filters as any)[${keyVar}]`;
      fixed = fixed.replace(fullMatch, fixedMatch);
      fixes.push(`Fixed filters[${keyVar}] access with type assertion for TypeScript compatibility`);
    }

    if (fixes.length > 0) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(...fixes);
    }

    return result;
  }
};

/**
 * Fix: TypeScript type improvements
 */
export const typescriptTypeImprovementsRule: FixRule = {
  id: "typescript-type-improvements",
  description: "Improve TypeScript type annotations",
  priority: 12,
  dependencies: ["filters-key-access"],
  shouldApply: (filePath, content) => {
    return content.includes(": any") || content.includes("as any");
  },
  apply: async (filePath, content, context) => {
    // Only apply if TypeScript is enabled
    if (!context.enableTypeScript) {
      return {
        content,
        fixed: false,
        fixes: [],
        issues: []
      };
    }

    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // This rule can be extended to improve type annotations
    // For now, it's a placeholder for future improvements
    
    // Example: Could improve computed<any>() to computed<ReturnType>()
    // Example: Could improve ref<any> to ref<SpecificType>()
    
    return result;
  }
};
