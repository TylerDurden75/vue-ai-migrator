/**
 * Rules for fixing TypeScript type issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";
import { getCachedRegex } from "../../utils/regex-cache";

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
  apply: async (filePath, content, _context: FixContext) => {
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
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: function SET_XXX(event: Event) → function SET_XXX(value: any)
    const eventTypePattern = getCachedRegex(
      "function\\s+(SET_\\w+|\\w+)\\s*\\([^)]*event\\s*:\\s*Event[^)]*\\)",
      "g"
    );
    let match;
    const fixes: string[] = [];

    while ((match = eventTypePattern.exec(content)) !== null) {
      const funcName = match[1];
      const fullMatch = match[0];
      let replacementType = "any";
      if (funcName.startsWith("SET_")) replacementType = "any";
      else if (funcName.includes("Filter") || funcName.includes("filter")) replacementType = "{ key: string; value: any }";
      const fixedMatch = fullMatch.replace(/event\s*:\s*Event/g, `value: ${replacementType}`);
      fixed = fixed.replace(fullMatch, fixedMatch);
      fixes.push(`Fixed incorrect Event type in function ${funcName} parameters`);
    }

    // Fix: object method SET_XXX(event: Event) { → SET_XXX(value: any) {
    const methodEventPattern = getCachedRegex(
      "(SET_\\w+|\\w+)\\s*\\(\\s*event\\s*:\\s*Event\\s*\\)\\s*\\{",
      "g"
    );
    let methodMatch;
    while ((methodMatch = methodEventPattern.exec(fixed)) !== null) {
      const funcName = methodMatch[1];
      const fullMatch = methodMatch[0];
      const replacementType = funcName.startsWith("SET_") ? "any" : (funcName.includes("Filter") || funcName.includes("filter") ? "{ key: string; value: any }" : "any");
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
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // Type assertion (filters as any)[key] is only valid in TypeScript; in JS leave filters[key]
    if (!_context.enableTypeScript) {
      return result;
    }

    let fixed = content;

    // Fix: filters[key] → (filters as any)[key] for TypeScript
    const filtersKeyPattern = getCachedRegex(
      "filters\\s*\\[\\s*(\\w+)\\s*\\]",
      "g"
    );
    
    let match;
    const fixes: string[] = [];
    
    while ((match = filtersKeyPattern.exec(content)) !== null) {
      const keyVar = match[1];
      const fullMatch = match[0];
      
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
 * Strip TypeScript annotations from JS/plain script when migration was run without --typescript.
 * Runs only when enableTypeScript is false; removes param types, return types, ref<T>, computed<T>, etc.
 */
export const stripTypeScriptAnnotationsRule: FixRule = {
  id: "strip-typescript-annotations",
  description: "Remove TypeScript syntax from JS/plain script when not using --typescript",
  priority: 11,
  shouldApply: (filePath, content) => {
    const hasTsSyntax =
      /ref\s*<[^>]+>\s*\(/.test(content) ||
      /computed\s*<[^>]+>\s*\(/.test(content) ||
      /\w+\s*:\s*(?:string|number|boolean|void|any|unknown|object)\s*[),]/.test(content) ||
      /\)\s*:\s*(?:void|string|number|boolean|any|Promise\s*<)/.test(content) ||
      /\)\s*:\s*void\s*=>/.test(content) ||
      /\s+as\s+any\b/.test(content);
    if (!hasTsSyntax) return false;
    if (filePath.endsWith(".ts")) return false;
    if (filePath.endsWith(".js")) return true;
    if (filePath.endsWith(".vue")) {
      const hasPlainScript = /<script(\s[^>]*)?>/.test(content) && !/<script[^>]*\blang\s*=\s*["']ts["'][^>]*>/.test(content);
      return hasPlainScript;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    if (_context.enableTypeScript) {
      return { content, fixed: false, fixes: [], issues: [] };
    }
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };

    const stripParamTypes = (params: string): string =>
      params.replace(/(\w+)\s*:\s*(?:string|number|boolean|void|any|unknown|object)\b[^),]*/g, "$1");

    const stripFromScript = (script: string): string => {
      let out = script;
      // ref<Type>(...) → ref(...)
      out = out.replace(/ref\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>\s*\(/g, "ref(");
      // computed<Type>(...) → computed(...)
      out = out.replace(/computed\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>\s*\(/g, "computed(");
      // function name(param: Type, ...): ReturnType { → function name(param, ...) {
      out = out.replace(/function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*[\w<>[\]\s|&,]+)?\s*\{/g, (_m, name, params) => {
        return `function ${name}(${stripParamTypes(params)}) {`;
      });
      // ): ReturnType => { → ) => {
      out = out.replace(/(\))\s*:\s*(?:void|[\w<>[\]\s|&,]+)\s*=>\s*\{/g, "$1) => {");
      // Arrow params: (a: string, b: number) => → (a, b) =>
      out = out.replace(/\b(?:const|let|var)\s+\w+\s*=\s*\(([^)]*)\)\s*=>/g, (m, params) => {
        return m.replace(params, stripParamTypes(params));
      });
      // set: (v: string) => → set: (v) =>
      out = out.replace(/(\w+)\s*:\s*\((\w+)\s*:\s*[^)]+\)\s*=>/g, "$1: ($2) =>");
      // (v: string) => or (value: boolean) => (standalone arrow)
      out = out.replace(/(\()(\w+)\s*:\s*[^)]+(\))\s*=>/g, "$1$2$3) =>");
      // (filters as any)[key] or (expr as any) → filters[key] / expr (invalid in JS)
      out = out.replace(/\((\w+)\s+as\s+any\)/g, "$1");
      return out;
    };

    if (filePath.endsWith(".js")) {
      const fixed = stripFromScript(content);
      if (fixed !== content) {
        result.content = fixed;
        result.fixed = true;
        result.fixes.push("Stripped TypeScript annotations (JS project)");
      }
      return result;
    }

    if (filePath.endsWith(".vue")) {
      const scriptMatch = content.match(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/);
      if (!scriptMatch) return result;
      const [, attrs, scriptContent] = scriptMatch;
      if (/lang\s*=\s*["']ts["']/.test(attrs || "")) return result;
      const fixedScript = stripFromScript(scriptContent);
      if (fixedScript === scriptContent) return result;
      result.content = content.replace(scriptMatch[0], `<script${attrs || ""}>${fixedScript}</script>`);
      result.fixed = true;
      result.fixes.push("Stripped TypeScript annotations from script (no --typescript)");
      return result;
    }

    return result;
  }
};

/**
 * Fix: TypeScript type improvements
 * - computed<any>(() => ...) → computed(() => ...) when inference works
 * - ref<any>(...) → ref(...) when inference works
 */
export const typescriptTypeImprovementsRule: FixRule = {
  id: "typescript-type-improvements",
  description: "Improve TypeScript type annotations (remove redundant any when inferrable)",
  priority: 12,
  dependencies: ["filters-key-access"],
  shouldApply: (filePath, content) => {
    return (
      content.includes("computed<any>") ||
      content.includes("ref<any>") ||
      content.includes("reactive<any>")
    );
  },
  apply: async (filePath, content, context: FixContext) => {
    if (!context.enableTypeScript) {
      return { content, fixed: false, fixes: [], issues: [] };
    }

    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // computed<any>(() => ...) → computed(() => ...) - TypeScript infers from callback
    if (fixed.includes("computed<any>")) {
      fixed = fixed.replace(/computed<any>\s*\(/g, "computed(");
      result.fixed = true;
    }

    // ref<any>(...) → ref(...) when value allows inference (e.g. ref(0), ref([]))
    if (fixed.includes("ref<any>")) {
      fixed = fixed.replace(/ref<any>\s*\(/g, "ref(");
      result.fixed = true;
    }

    // reactive<any>(...) → reactive(...)
    if (fixed.includes("reactive<any>")) {
      fixed = fixed.replace(/reactive<any>\s*\(/g, "reactive(");
      result.fixed = true;
    }

    if (result.fixed) {
      result.content = fixed;
      result.fixes.push("Removed redundant any from computed/ref/reactive (TypeScript infers)");
    }

    return result;
  }
};
