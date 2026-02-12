/**
 * Rules for fixing computed properties issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";
import { getCachedRegex } from "../../utils/regex-cache";

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

/** File is a Vue SFC or Pinia store */
function isVueOrStoreFile(filePath: string): boolean {
  return (
    filePath.endsWith(".vue") ||
    filePath.includes("/store/") ||
    filePath.endsWith("store.js") ||
    filePath.endsWith("store.ts")
  );
}

/**
 * Fix: Extra closing paren in computed - applies to .vue and store files.
 * - })); → });  (two ) before ;)
 * - });); → }); (}); followed by extra ); - common in migrated Pinia stores)
 */
export const vueComputedExtraParenRule: FixRule = {
  id: "vue-computed-extra-paren",
  description: "Fix computed closing })); and });); → }); in .vue and store files",
  priority: 72,
  shouldApply: (filePath, content) => {
    if (!isVueOrStoreFile(filePath) || !content.includes("computed")) return false;
    return /\}\)\)\s*;/.test(content) || /\}\);\s*\)\s*;/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    let fixed = content;
    if (/\}\)\)\s*;/.test(fixed)) {
      // Don't replace })); when it's from .then(x => Fn({ ... })); - the second ) closes .then(
      let fixedCount = 0;
      fixed = fixed.replace(/\}\)\)\s*;/g, (match, offset, fullString) => {
        const before = fullString.slice(Math.max(0, offset - 100), offset + match.length);
        if (/\.then\s*\(\s*\w+\s*=>\s*[\s\S]*\}\s*\)\s*\)\s*;/.test(before)) return match;
        fixedCount++;
        return "});";
      });
      if (fixedCount > 0) result.fixes.push("Fixed computed extra paren (})); → });)");
    }
    if (/\}\);\s*\)\s*;/.test(fixed)) {
      fixed = fixed.replace(/\}\);\s*\)\s*;/g, "});");
      result.fixes.push("Fixed computed extra paren (});); → });)");
    }
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
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

/**
 * Fix: ref/computed comparison without .value in computed callback
 * Generic: computed(() => refA < refB) → computed(() => refA.value < refB.value)
 */
export const computedRefComparisonRule: FixRule = {
  id: "computed-ref-comparison",
  description: "Add .value when comparing refs/computed inside computed()",
  priority: 79,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("computed")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!script) return false;
    const refComputedRe = /(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g;
    const refNames = new Set<string>();
    let r;
    while ((r = refComputedRe.exec(script)) !== null) refNames.add(r[1]);
    if (refNames.size < 2) return false;
    const compareRe = /computed\s*\(\s*\(\s*\)\s*=>\s*(\w+)\s*(<|>|<=|>=|==|===|!=|!==)\s*(\w+)\s*\)/;
    const m = script.match(compareRe);
    if (!m) return false;
    const [, left, , right] = m;
    // Only fix when both are refs/computed - pattern already ensures no .value in this comparison
    return refNames.has(left) && refNames.has(right);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const script = scriptMatch[1];
    const refComputedRe = /(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g;
    const refNames = new Set<string>();
    let r;
    while ((r = refComputedRe.exec(script)) !== null) refNames.add(r[1]);
    const compareRe = /computed\s*\(\s*\(\s*\)\s*=>\s*(\w+)\s*(<|>|<=|>=|==|===|!=|!==)\s*(\w+)\s*\)/g;
    const fixed = script.replace(compareRe, (_, left, op, right) => {
      const leftVal = refNames.has(left) ? `${left}.value` : left;
      const rightVal = refNames.has(right) ? `${right}.value` : right;
      return `computed(() => ${leftVal} ${op} ${rightVal})`;
    });
    if (fixed !== script) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixed));
      result.fixed = true;
      result.fixes.push("Add .value to ref/computed in comparison");
    }
    return result;
  },
};

/**
 * Fix: ref/computed comparison without .value in if/.then() (pagination hasMore, bounds check)
 * Generic: if (page < 0 || page > maxPage) → if (page.value < 0 || page.value > maxPage.value)
 */
export const refComparisonInCallbackRule: FixRule = {
  id: "ref-comparison-in-callback",
  description: "Add .value to ref/computed in if/then comparisons (pagination disabled)",
  priority: 78,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!script) return false;
    const refNames = new Set(
      [...script.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g)].map((m) => m[1])
    );
    if (refNames.size === 0) return false;
    for (const name of refNames) {
      if (new RegExp(`\\b${name}\\b(?!\\.value)\\s*(<|>|<=|>=|==|===|!=|!==)`).test(script))
        return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const script = scriptMatch[1];
    const refNames = new Set(
      [...script.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g)].map((m) => m[1])
    );
    let fixed = script;
    const refList = [...refNames];
    for (const name of refNames) {
      const rightAlt = refList.length
        ? `(?:\\d+|\\b(?:${refList.join("|")})\\b)`
        : "\\d+";
      const re = new RegExp(
        `\\b(${name})\\b(?!\\.value)(\\s*)(<|>|<=|>=|==|===|!=|!==)(\\s*)(${rightAlt})`,
        "g"
      );
      fixed = fixed.replace(re, (_, n, sp1, op, sp2, right) => {
        const rVal = refNames.has(right) ? `${right}.value` : right;
        return `${n}.value${sp1}${op}${sp2}${rVal}`;
      });
    }
    if (fixed !== script) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixed));
      result.fixed = true;
      result.fixes.push("Add .value to ref/computed in callback comparisons (pagination)");
    }
    return result;
  },
};
