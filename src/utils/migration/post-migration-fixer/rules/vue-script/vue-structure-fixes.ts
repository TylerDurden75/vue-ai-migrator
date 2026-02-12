/**
 * Rules for fixing malformed Vue SFC structure (script/style inside template, duplicate symbols)
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

/**
 * Extract root template block (handles nested <template v-if>)
 */
function extractRootTemplateBlock(
  content: string
): { full: string; attrs: string; inner: string } | null {
  const openMatch = content.match(/<template([^>]*)>/i);
  if (!openMatch) return null;
  const attrs = openMatch[1];
  const startIdx = openMatch.index! + openMatch[0].length;
  let depth = 1;
  let i = startIdx;
  const len = content.length;
  while (i < len && depth > 0) {
    const open = content.indexOf("<template", i);
    const close = content.indexOf("</template>", i);
    if (close === -1) return null;
    if (open !== -1 && open < close) {
      depth++;
      i = open + 9;
    } else {
      depth--;
      if (depth === 0) {
        const inner = content.slice(startIdx, close).trim();
        const full = content.slice(openMatch.index!, close + 11);
        return { full, attrs, inner };
      }
      i = close + 11;
    }
  }
  return null;
}

/**
 * Fix: Remove orphan HTML/template content after </style> in SFC.
 * Migration can leave duplicated/corrupted markup (e.g. if="...", | filter) after the last block.
 * Generic: detects content after </style> that looks like template (tags, {{ }}, v-if, etc.) and removes it.
 */
export const orphanContentAfterStyleRule: FixRule = {
  id: "orphan-content-after-style",
  description: "Remove orphan template/HTML content after </style> in Vue SFC",
  priority: 95,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const lastStyleClose = content.lastIndexOf("</style>");
    if (lastStyleClose === -1) return false;
    const after = content.slice(lastStyleClose + 9).trim();
    if (!after) return false;
    // Orphan content: HTML tags, mustaches, or corrupted Vue directives (if=, | filter)
    return (
      /<[a-zA-Z]/.test(after) ||
      /\{\{/.test(after) ||
      /\bif\s*=\s*["']/.test(after) ||
      /\|\s*\w+/.test(after)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const lastStyleClose = content.lastIndexOf("</style>");
    if (lastStyleClose === -1) return result;
    const before = content.slice(0, lastStyleClose + 9);
    const after = content.slice(lastStyleClose + 9);
    const orphanMatch = after.match(/^[\s\n]*(.+)$/s);
    if (!orphanMatch) return result;
    const orphan = orphanMatch[1].trim();
    if (!orphan) return result;
    if (
      !/<[a-zA-Z]/.test(orphan) &&
      !/\{\{/.test(orphan) &&
      !/\bif\s*=\s*["']/.test(orphan) &&
      !/\|\s*\w+/.test(orphan)
    ) {
      return result;
    }
    result.content = before + (after.match(/^([\s\n]*)/)?.[1] ?? "\n");
    result.fixed = true;
    result.fixes.push("Removed orphan template/HTML content after </style>");
    return result;
  },
};

/**
 * Fix: Remove orphan/corrupted script content: stray "; and malformed defineOptions blocks.
 * Pattern: "; followed by defineOptions or comment - residue from broken import fix.
 */
export const orphanScriptContentRule: FixRule = {
  id: "orphan-script-content",
  description: "Remove orphan semicolon-quote and malformed defineOptions in script",
  priority: 93,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    return /";\s*\n\s*(?:\/\/|defineOptions)/.test(script) ||
           /";\s*$/.test(script) ||
           (/defineOptions\s*\(\s*\{[\s\S]*asyncData\s*\(/.test(script) && content.includes("<script setup"));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let script = scriptMatch[2];
    const original = script;
    script = script.replace(/\s*";\s*\n\s*\/\/[^\n]*\n\s*defineOptions\s*\(\s*\{[\s\S]*?\}\s*\)\s*;?\s*\n?/g, "\n");
    script = script.replace(/\s*";\s*\n/g, "\n");
    if (script !== original) {
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + script + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push("Removed orphan script content (stray \";, malformed defineOptions)");
    }
    return result;
  },
};

/**
 * Fix: Remove { functional: true } from component options (removed in Vue 3)
 */
export const functionalOptionRemovalRule: FixRule = {
  id: "functional-option-removal",
  description: "Remove functional: true from component options (Vue 3)",
  priority: 94,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith(".vue") ||
        filePath.endsWith(".js") ||
        filePath.endsWith(".ts")) &&
      /functional\s*:\s*true/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };

    const fixed = content.replace(/functional\s*:\s*true\s*,?\s*/g, "");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed functional: true option");
    }

    return result;
  },
};

/**
 * Warn: binding.expression was removed in Vue 3 custom directive API.
 * Used in v-directive="expr" - Vue 3 no longer passes the expression string.
 * Consider using binding.arg or evaluating the expression at usage site.
 */
export const bindingExpressionDirectiveRule: FixRule = {
  id: "binding-expression-directive-warn",
  description: "Warn when binding.expression is used (removed in Vue 3 directives)",
  priority: 50,
  shouldApply: (filePath, content) => {
    if (!/\.(vue|js|ts)$/.test(filePath)) return false;
    return /\bbinding\.expression\b/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    if (/\bbinding\.expression\b/.test(content)) {
      result.issues.push(
        "binding.expression was removed in Vue 3; use binding.value (evaluated result) or pass the expression explicitly"
      );
    }
    return result;
  },
};

/**
 * Fix: Script and style blocks nested inside template - move to correct position
 * Malformed: <template><div>...<script>...</script><style>...</style></div></template>
 */
export const scriptStyleInsideTemplateRule: FixRule = {
  id: "script-style-inside-template",
  description:
    "Move script/style blocks from inside template to correct SFC structure",
  priority: 96,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const block = extractRootTemplateBlock(content);
    if (!block) return false;
    return block.inner.includes("<script") || block.inner.includes("<style");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };

    const block = extractRootTemplateBlock(content);
    if (!block) return result;

    const fullTemplateContent = block.inner;

    const scriptMatch = fullTemplateContent.match(
      /<script([^>]*)>([\s\S]*?)<\/script>/i
    );
    const styleMatch = fullTemplateContent.match(
      /<style([^>]*)>([\s\S]*?)<\/style>/is
    );

    if (!scriptMatch && !styleMatch) return result;

    let templateOnly = fullTemplateContent;
    if (scriptMatch) {
      templateOnly = templateOnly.replace(scriptMatch[0], "").trim();
    }
    if (styleMatch) {
      templateOnly = templateOnly.replace(styleMatch[0], "").trim();
    }

    const scriptBlock = scriptMatch
      ? (() => {
          const scriptAttrs = scriptMatch[1];
          const normalized =
            scriptAttrs.includes("setup") && !scriptAttrs.startsWith(" ")
              ? " " + scriptAttrs.trim()
              : scriptAttrs.startsWith(" ")
                ? scriptAttrs
                : scriptAttrs
                  ? " " + scriptAttrs
                  : scriptAttrs;
          return `<script${normalized}>${scriptMatch[2]}</script>`;
        })()
      : "";
    const styleBlock = styleMatch
      ? `<style${styleMatch[1]}>${styleMatch[2]}</style>`
      : "";

    const rootTemplate = `<template${block.attrs}>\n${templateOnly}\n</template>`;
    const fixed = content.replace(
      block.full,
      rootTemplate +
        (scriptBlock ? "\n\n" + scriptBlock : "") +
        (styleBlock ? "\n\n" + styleBlock : "")
    );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(
        "Moved script/style from inside template to correct SFC structure"
      );
    }

    return result;
  },
};

/** Identifiers that are never the target of undeclared-var fix (refs, API objects, etc.) */
const SKIP_UNDECLARED = new Set([
  "ref",
  "computed",
  "reactive",
  "watch",
  "api",
  "percent",
  "show",
  "canSuccess",
  "duration",
  "height",
  "color",
  "failedColor",
  "increase",
  "decrease",
  "finish",
  "pause",
  "hide",
  "fail",
  "set",
  "get",
  "start",
  "nextTick",
  "defineExpose",
  "value", // common property access (percent.value = 0) - avoid false positive
  "v", // v-model, v-if, v-for param - avoid false positive from directive names
  "to",
  "from",
  "next", // route/watch callback params - avoid false positive (to, from, next) =>
]);

/**
 * Infer initial value for ref() based on variable name (loading, isLoading → false; count → 0).
 */
function inferRefInitialValue(varName: string): string {
  if (/loading|fetching|busy|show|visible|^is[A-Z]/.test(varName))
    return "false";
  if (/count|index|page|size|step/.test(varName)) return "0";
  return "null";
}

/**
 * Fix: Add let declaration for variables assigned but not declared in script setup.
 * Pattern: _timer = setInterval(...), clearInterval(_timer), if (_timer) - no let _timer.
 * Generic: detects any identifier in assignment (id = expr) that isn't declared.
 */
export const scriptSetupUndeclaredVarsRule: FixRule = {
  id: "script-setup-undeclared-vars",
  description:
    "Add let declaration for variables used/assigned but not declared in script setup",
  priority: 64,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup>"))
      return false;
    const scriptMatch = content.match(
      /<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i
    );
    if (!scriptMatch) return false;
    const script = scriptMatch[1];
    // Find assignments to simple identifiers (not a.b): id = expr. Exclude destructuring.
    // Use negative lookbehind to exclude .value = (property assignment)
    const assignRe =
      /(?<![.\w])(\w+)\s*=\s*(?:setInterval|setTimeout|null|\d|\d+\s*\/|[\w.]+)/g;
    let m;
    const template =
      content.match(/<template[^>]*>([\s\S]*?)<\/template>/s)?.[1] ?? "";
    while ((m = assignRe.exec(script)) !== null) {
      const id = m[1];
      if (SKIP_UNDECLARED.has(id)) continue;
      if (template && new RegExp(`[\\s"':(]${id}\\b`).test(template)) continue;
      const hasDecl = new RegExp(`(?:let|const|var)\\s+${id}\\b`).test(script);
      if (!hasDecl) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const scriptMatch = content.match(
      /<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i
    );
    if (!scriptMatch) return result;

    const script = scriptMatch[1];
    const toDeclare = new Set<string>();
    const assignRe =
      /(?:^|[^\w])(\w+)\s*=\s*(?:setInterval|setTimeout|null|\d|[\w.]+\s*[/(])/g;
    let m;
    const template =
      content.match(/<template[^>]*>([\s\S]*?)<\/template>/s)?.[1] ?? "";
    while ((m = assignRe.exec(script)) !== null) {
      const id = m[1];
      if (SKIP_UNDECLARED.has(id)) continue;
      if (template && new RegExp(`[\\s"':(]${id}\\b`).test(template)) continue;
      if (new RegExp(`(?:let|const|var)\\s+${id}\\b`).test(script)) continue;
      toDeclare.add(id);
    }
    if (toDeclare.size === 0) return result;

    const defaults = Array.from(toDeclare).map((id) => {
      if (id === "_cut" || id.toLowerCase().includes("cut"))
        return `let ${id} = 0`;
      return `let ${id} = null`;
    });
    const declBlock = defaults.join(";\n") + ";\n";

    const importMatches = [...script.matchAll(/^import\s+[^;]+;/gm)];
    const lastImport = importMatches[importMatches.length - 1];
    const insertPoint = lastImport
      ? lastImport.index! + lastImport[0].length
      : 0;
    const insertAfterImports =
      script.slice(0, insertPoint) +
      "\n" +
      declBlock +
      script.slice(insertPoint);
    const fixedContent = content.replace(
      scriptMatch[0],
      scriptMatch[0].replace(scriptMatch[1], insertAfterImports)
    );

    result.content = fixedContent;
    result.fixed = true;
    result.fixes.push(
      `Added let declaration for ${Array.from(toDeclare).join(", ")}`
    );
    return result;
  },
};

/**
 * Fix: Add const varName = ref(initial) when varName is assigned and used in template.
 * Replaces varName = expr with varName.value = expr. Generic: any variable (loading, isLoading, etc).
 */
export const loadingRefRule: FixRule = {
  id: "loading-ref",
  description: "Add ref for variables assigned and used in template",
  priority: 65,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup"))
      return false;
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const templateMatch = content.match(
      /<template[^>]*>([\s\S]*?)<\/template>/s
    );
    if (!scriptMatch || !templateMatch) return false;
    const script = scriptMatch[1];
    const template = templateMatch[1];
    const assignRe = /(?:^|[^\w.])(\w+)\s*=\s*(?!>)/g;
    let m;
    while ((m = assignRe.exec(script)) !== null) {
      const varName = m[1];
      if (SKIP_UNDECLARED.has(varName)) continue;
      if (new RegExp(`(?:let|const|var)\\s+${varName}\\b`).test(script))
        continue;
      if (new RegExp(`${varName}\\.value\\s*=`).test(script)) continue;
      if (new RegExp(`[\\s"':(]${varName}\\b`).test(template)) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const templateMatch = content.match(
      /<template[^>]*>([\s\S]*?)<\/template>/s
    );
    if (!scriptMatch || !templateMatch) return result;

    let script = scriptMatch[1];
    const template = templateMatch[1];
    const toFix = new Set<string>();
    const assignRe = /(?:^|[^\w.])(\w+)\s*=\s*(?!>)/g;
    let m;
    while ((m = assignRe.exec(script)) !== null) {
      const varName = m[1];
      if (SKIP_UNDECLARED.has(varName)) continue;
      if (new RegExp(`(?:let|const|var)\\s+${varName}\\b`).test(script))
        continue;
      if (new RegExp(`${varName}\\.value\\s*=`).test(script)) continue;
      if (new RegExp(`[\\s"':(]${varName}\\b`).test(template))
        toFix.add(varName);
    }

    for (const varName of toFix) {
      const initialValue = inferRefInitialValue(varName);
      const decl = `const ${varName} = ref(${initialValue})`;
      // Replace "varName = " but NOT: "varName =>" (arrow param), "const/let/var varName =" (declaration)
      script = script.replace(
        new RegExp(`(?<!const |let |var )\\b${varName}\\s*=\\s*(?!>)`, "g"),
        `${varName}.value = `
      );
      if (!/ref\b/.test(script)) {
        const vueImport = script.match(
          /import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/
        );
        if (vueImport && !/ref\b/.test(vueImport[1])) {
          script = script.replace(
            /import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/,
            (_, s) => `import { ${s.trim()}, ref } from "vue"`
          );
        } else if (!vueImport) {
          script = 'import { ref } from "vue";\n' + script;
        }
      }
      const importMatches = [...script.matchAll(/^import\s+[^;]+;/gm)];
      const lastImport = importMatches[importMatches.length - 1];
      const insertPoint = lastImport
        ? lastImport.index! + lastImport[0].length
        : 0;
      script =
        script.slice(0, insertPoint) +
        "\n" +
        decl +
        ";\n" +
        script.slice(insertPoint);
      result.fixed = true;
      result.fixes.push(`Added ${decl} for template binding`);
    }
    if (result.fixed) {
      result.content = content.replace(
        scriptMatch[0],
        scriptMatch[0].replace(scriptMatch[1], script)
      );
    }
    return result;
  },
};

/**
 * Fix: Corrupted arrow function syntax from loadingRefRule - varName.value = > → varName =>
 * Pattern: set: v.value = > or const fn = product.value = > (should be =>)
 */
export const fixCorruptedArrowFunctionRule: FixRule = {
  id: "fix-corrupted-arrow-function",
  description:
    "Fix varName.value = > to varName => (corrupted by loadingRefRule)",
  priority: 67,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && /\.value\s*=\s*>\s*/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const script = scriptMatch[1];
    const fixed = script.replace(/(\w+)\.value\s*=\s*>\s*/g, "$1 => ");
    if (fixed !== script) {
      result.content = content.replace(
        scriptMatch[0],
        scriptMatch[0].replace(scriptMatch[1], fixed)
      );
      result.fixed = true;
      result.fixes.push(
        "Fixed corrupted arrow function syntax (varName.value = > → varName =>)"
      );
    }
    return result;
  },
};

/** Var names that are from Vue directives (v-model, v-if) - never real refs */
const DIRECTIVE_LIKE_VARS = new Set(["v"]);

/**
 * Fix: Remove erroneous ref declarations for directive-like vars (e.g. v from v-model).
 * Pattern: const v = ref(null) when v is only from directive names, not a real variable.
 */
export const removeErroneousRefForSkippedVarsRule: FixRule = {
  id: "remove-erroneous-ref-for-skipped-vars",
  description:
    "Remove const v = ref(null) when v is from v-model/v-if (not a real var)",
  priority: 66,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    for (const skip of DIRECTIVE_LIKE_VARS) {
      if (new RegExp(`const\\s+${skip}\\s*=\\s*ref\\(`).test(content))
        return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    let script = scriptMatch[1];
    for (const skip of DIRECTIVE_LIKE_VARS) {
      const re = new RegExp(
        `const\\s+${skip}\\s*=\\s*ref\\([^)]+\\)\\s*;?\\s*\\n?`,
        "g"
      );
      script = script.replace(re, "");
    }
    if (script !== scriptMatch[1]) {
      result.content = content.replace(
        scriptMatch[0],
        scriptMatch[0].replace(scriptMatch[1], script)
      );
      result.fixed = true;
      result.fixes.push("Removed erroneous ref for directive-like identifier");
    }
    return result;
  },
};

/**
 * Fix: Duplicate symbol declaration - function X and const X = ...
 * Renames the standalone function to doX to avoid conflict
 */
export const duplicateSymbolDeclarationRule: FixRule = {
  id: "duplicate-symbol-declaration",
  description:
    "Fix duplicate symbol (function X + const X) by renaming helper to doX",
  priority: 75,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script"))
      return false;
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return false;
    const script = scriptMatch[1];
    const funcDecl = script.match(/function\s+(\w+)\s*\([^)]*\)\s*\{/);
    if (!funcDecl) return false;
    const name = funcDecl[1];
    const constPattern = new RegExp(
      `(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s+)?(?:\\(\\)\\s*=>|function)`
    );
    return constPattern.test(script);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;

    const script = scriptMatch[1];
    const funcDecl = script.match(/function\s+(\w+)\s*\([^)]*\)\s*\{/);
    if (!funcDecl) return result;

    const name = funcDecl[1];
    const constPattern = new RegExp(
      `(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s+)?(?:\\(\\)\\s*=>|function)`
    );
    const methodPattern = new RegExp(`[,\\{]\\s*${name}\\s*\\([^)]*\\)\\s*\\{`);
    if (!constPattern.test(script) && !methodPattern.test(script))
      return result;
    const newName = "do" + name.charAt(0).toUpperCase() + name.slice(1);

    // Replace function declaration
    let fixed = script.replace(
      new RegExp(`\\bfunction\\s+${name}\\s*\\(`, "g"),
      `function ${newName}(`
    );
    // Replace call sites only - not method definitions like fetchComments() {
    // Match name( when ( is NOT followed by )
    const callSiteRegex = new RegExp(`\\b${name}\\s*\\(\\s*(?!\\s*\\))`, "g");
    fixed = fixed.replace(callSiteRegex, `${newName}(`);

    if (fixed !== script) {
      result.content = content.replace(
        scriptMatch[0],
        scriptMatch[0].replace(scriptMatch[1], fixed)
      );
      result.fixed = true;
      result.fixes.push(`Renamed duplicate symbol ${name} to ${newName}`);
    }

    return result;
  },
};

/** Find matching closing brace for { at startIdx, return end index or -1 */
function findMatchingBrace(content: string, startIdx: number): number {
  let depth = 1;
  for (let i = startIdx + 1; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Fix: Pass ref.value instead of ref when calling functions from lifecycle hooks
 * Generic: fn(refName) → fn(refName.value) when refName is ref/computed
 */
export const refInLifecycleCallRule: FixRule = {
  id: "ref-in-lifecycle-call",
  description: "Pass ref.value instead of ref in lifecycle hook function calls",
  priority: 68,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup")) return false;
    const script = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!script) return false;
    const refComputedRe = /(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g;
    const refNames = new Set<string>();
    let r;
    while ((r = refComputedRe.exec(script)) !== null) refNames.add(r[1]);
    if (refNames.size === 0) return false;
    const lifecycleRe = /(?:onBeforeMount|onMounted|onBeforeUnmount|onUnmounted)\s*\(\s*\(\s*\)\s*=>\s*\{/g;
    let m;
    while ((m = lifecycleRe.exec(script)) !== null) {
      const end = findMatchingBrace(script, m.index + m[0].length - 1);
      if (end === -1) continue;
      const body = script.slice(m.index, end + 1);
      for (const id of refNames) {
        const callRe = new RegExp(`\\b\\w+\\s*\\(\\s*\\b${id}\\b\\s*\\)`);
        if (callRe.test(body) && !new RegExp(`${id}\\.value`).test(body)) return true;
      }
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const script = scriptMatch[1];
    const refComputedRe = /(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g;
    const refNames = new Set<string>();
    let r;
    while ((r = refComputedRe.exec(script)) !== null) refNames.add(r[1]);
    const lifecycleRe = /((?:onBeforeMount|onMounted|onBeforeUnmount|onUnmounted)\s*\(\s*(?:async\s+)?\(\s*\)\s*=>\s*\{)/g;
    let fixed = script;
    let m;
    const replacements: { start: number; end: number; replacement: string }[] = [];
    while ((m = lifecycleRe.exec(script)) !== null) {
      const openIdx = m.index + m[1].length - 1;
      const closeIdx = findMatchingBrace(script, openIdx);
      if (closeIdx === -1) continue;
      const body = script.slice(openIdx + 1, closeIdx);
      let newBody = body;
      for (const id of refNames) {
        const callRe = new RegExp(`\\b(\\w+)\\s*\\(\\s*\\b${id}\\b\\s*\\)`, "g");
        newBody = newBody.replace(callRe, (_, fn) => `${fn}(${id}.value)`);
      }
      if (newBody !== body) {
        replacements.push({
          start: openIdx + 1,
          end: closeIdx,
          replacement: newBody,
        });
      }
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { start, end, replacement } = replacements[i];
      fixed = fixed.slice(0, start) + replacement + fixed.slice(end);
    }
    if (fixed !== script) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixed));
      result.fixed = true;
      result.fixes.push("Pass ref.value in lifecycle hook calls");
    }
    return result;
  },
};

/**
 * Fix: Vue 3 slots unification - Composition API uses useSlots(), not this.$scopedSlots
 * Migration: this.$scopedSlots.xxx → slots?.xxx?.() with const slots = useSlots()
 * Slots are now functions: slots.default({ msg: 'Hello' }) for scoped slots
 * See: https://v3-migration.vuejs.org/breaking-changes/slots-unification
 */
export const scopedSlotsToSlotsRule: FixRule = {
  id: "scoped-slots-to-slots",
  description: "Replace this.$scopedSlots with useSlots() (Composition API target)",
  priority: 82,
  shouldApply: (_filePath, content) => content.includes("$scopedSlots"),
  apply: async (_filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;

    let scriptContent = scriptMatch[2];
    let modified = false;

    // this.$scopedSlots.xxx(args) → slots?.xxx?.(args) - preserve slot props for scoped slots
    scriptContent = scriptContent.replace(
      /this\.\$scopedSlots\??\.(\w+)\s*\(([\s\S]*?)\)/g,
      (_, slotName, args) => {
        modified = true;
        return `slots?.${slotName}?.(${args})`;
      }
    );
    // this.$scopedSlots?.xxx (property) → slots?.xxx?.()
    scriptContent = scriptContent.replace(
      /this\.\$scopedSlots\?\.(\w+)(?!\s*\()/g,
      (_, slotName) => {
        modified = true;
        return `slots?.${slotName}?.()`;
      }
    );
    // this.$scopedSlots.xxx (property) → slots.xxx?.()
    scriptContent = scriptContent.replace(
      /this\.\$scopedSlots\.(\w+)(?!\s*\()/g,
      (_, slotName) => {
        modified = true;
        return `slots?.${slotName}?.()`;
      }
    );

    if (!modified) return result;

    // Add useSlots import if missing
    const vueImportRegex = /import\s*\{([^}]*)\}\s*from\s*['"]vue['"]\s*;?/;
    const vueImportMatch = scriptContent.match(vueImportRegex);
    if (vueImportMatch && !/\buseSlots\b/.test(vueImportMatch[1])) {
      const names = vueImportMatch[1].trim().split(/\s*,\s*/).filter(Boolean);
      names.push("useSlots");
      scriptContent = scriptContent.replace(
        vueImportRegex,
        `import { ${[...new Set(names)].join(", ")} } from 'vue';`
      );
    } else if (!vueImportMatch) {
      const firstImportMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
      const insertPos = firstImportMatch ? firstImportMatch[0].length : 0;
      scriptContent =
        scriptContent.slice(0, insertPos) +
        `import { useSlots } from 'vue';\n` +
        scriptContent.slice(insertPos);
    }

    // Add const slots = useSlots() if missing
    if (!/\bconst\s+slots\s*=\s*useSlots\s*\(\)/.test(scriptContent)) {
      const afterImportsMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
      const insertPos = afterImportsMatch ? afterImportsMatch[0].length : 0;
      scriptContent =
        scriptContent.slice(0, insertPos) +
        `\nconst slots = useSlots();\n` +
        scriptContent.slice(insertPos);
    }

    result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push("Replaced $scopedSlots with useSlots() (Composition API)");
    return result;
  },
};

/** Store ref-like props that need .value in numeric context (Pinia setup stores) */
const STORE_REF_PROPS = ["itemsPerPage", "pageSize", "limit"];

/**
 * Fix: Add .value when accessing store ref props in numeric context (division, Math.ceil)
 * Generic: indexStore.itemsPerPage → indexStore.itemsPerPage.value when used in /
 */
export const storeRefInNumericContextRule: FixRule = {
  id: "store-ref-in-numeric-context",
  description: "Add .value to store ref properties in numeric context (avoids NaN)",
  priority: 69,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    for (const prop of STORE_REF_PROPS) {
      const re = new RegExp(`\\b\\w+Store\\.${prop}\\b(?!\\.value)`);
      if (re.test(content)) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;
    for (const prop of STORE_REF_PROPS) {
      const re = new RegExp(`\\b(\\w+Store)\\.${prop}\\b(?!\\.value)`, "g");
      fixed = fixed.replace(re, `$1.${prop}.value`);
    }
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Add .value to store ref in numeric context");
    }
    return result;
  },
};
