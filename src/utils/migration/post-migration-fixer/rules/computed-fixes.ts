/**
 * Rules for fixing computed properties issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";

/**
 * Fix: Add .value to computed properties in <script setup>
 */
export const computedValueRule: FixRule = {
  id: "computed-value",
  description: "Add .value to computed properties when accessing in <script setup>",
  priority: 80,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("computed");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.scriptContent) {
      return result;
    }

    let fixed = content;
    let hasChanges = false;

    // Extract computed property names
    const computedPattern = getCachedRegex(
      "const\\s+(\\w+)\\s*=\\s*computed\\s*\\(",
      "g"
    );
    
    const computedNames = new Set<string>();
    let match;
    while ((match = computedPattern.exec(_context.scriptContent)) !== null) {
      computedNames.add(match[1]);
    }

    // Fix: computedName.length → computedName.value.length
    computedNames.forEach(computedName => {
      // Don't add .value if it's already there
      const pattern = new RegExp(`\\b${computedName}\\.(length|map|filter|find|forEach|reduce|some|every|includes)\\b`, "g");
      const replacement = `${computedName}.value.$1`;
      
      if (pattern.test(_context.scriptContent!)) {
        const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        if (scriptMatch) {
          let scriptContent = scriptMatch[1];
          scriptContent = scriptContent.replace(pattern, replacement);
          fixed = fixed.replace(
            /<script[^>]*>([\s\S]*?)<\/script>/,
            `<script${scriptMatch[0].match(/<script\s+([^>]+)>/)?.[1] || ""}>${scriptContent}</script>`
          );
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added .value to computed properties in <script setup>");
    }

    return result;
  }
};

/**
 * Fix: Fix malformed computed syntax (computed<any>() => ...)
 */
export const malformedComputedRule: FixRule = {
  id: "malformed-computed",
  description: "Fix malformed computed syntax like computed<any>() => ...",
  priority: 75,
  dependencies: ["computed-value"],
  shouldApply: (filePath, content) => {
    return content.includes("computed<any>()") || content.includes("computed() =>");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: computed<any>() => ... → computed<any>(() => ...)
    fixed = fixed.replace(
      /computed\s*<[^>]*>\s*\(\)\s*=>/g,
      "computed<any>(() =>"
    );

    // Fix: computed() => ... → computed(() => ...)
    fixed = fixed.replace(
      /computed\s*\(\s*\)\s*=>/g,
      "computed(() =>"
    );

    // Fix: computed<any>() => (expression) → computed<any>(() => expression)
    fixed = fixed.replace(
      /computed\s*<[^>]*>\s*\(\s*\)\s*=>\s*\(([^)]+)\)/g,
      "computed<any>(() => ($1))"
    );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed malformed computed syntax");
    }

    return result;
  }
};

/**
 * Fix: Extra closing paren in computed in .vue (})); → });).
 * Fixes "Expected ';' but found ')'" in script setup.
 */
export const vueComputedExtraParenRule: FixRule = {
  id: "vue-computed-extra-paren",
  description: "Fix computed closing })); → }); in .vue files",
  priority: 72,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && content.includes("computed") && /\}\)\)\s*;/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(/\}\)\)\s*;/g, "});");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed computed extra paren (})); → });)");
    }
    return result;
  }
};

/**
 * Fix: Fix computed properties without proper return or parentheses
 */
export const computedSyntaxRule: FixRule = {
  id: "computed-syntax",
  description: "Fix computed properties with missing parentheses or return statements",
  priority: 70,
  dependencies: ["malformed-computed"],
  shouldApply: (filePath, content) => {
    return content.includes("computed") && (
      content.includes("computed(() =>") ||
      content.includes("computed<any>(() =>")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: computed(() => expression.length); → computed(() => expression.value.length);
    // But only if expression is a computed property
    if (_context.scriptContent) {
      const computedPattern = /const\s+(\w+)\s*=\s*computed\s*\(/g;
      const computedNames = new Set<string>();
      let match;
      while ((match = computedPattern.exec(_context.scriptContent)) !== null) {
        computedNames.add(match[1]);
      }

      computedNames.forEach(computedName => {
        // Fix: computed(() => computedName.length) → computed(() => computedName.value.length)
        const pattern = new RegExp(
          `computed\\(\\s*\\(\\)\\s*=>\\s*${computedName}\\.(length|map|filter|find)`,
          "g"
        );
        fixed = fixed.replace(pattern, `computed(() => ${computedName}.value.$1`);
      });
    }

    // Fix: computed(() => store.property || [].length) → computed(() => (store.property || []).length)
    fixed = fixed.replace(
      /computed\s*\([^)]*\)\s*=>\s*([^|]+)\s*\|\|\s*\[\]\s*\.length/g,
      "computed(() => ($1 || []).length"
    );

    // Fix: computed<any>(() => (expr); → computed<any>(() => expr);
    // Generic: extra opening paren after => with ); at end causes "Expected ')' but found ';'"
    fixed = fixed.replace(
      /computed\s*<[^>]*>\s*\(\s*\(\s*\)\s*=>\s*\(([^)]+)\)\s*;/g,
      "computed<any>(() => $1);"
    );

    // Same fix for computed(() => (expr); without type param
    fixed = fixed.replace(
      /computed\s*\(\s*\(\s*\)\s*=>\s*\(([^)]+)\)\s*;/g,
      "computed(() => $1);"
    );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed computed syntax issues");
    }

    return result;
  }
};
