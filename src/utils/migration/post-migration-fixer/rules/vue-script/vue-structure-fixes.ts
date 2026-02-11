/**
 * Rules for fixing malformed Vue SFC structure (script/style inside template, duplicate symbols)
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

/**
 * Extract root template block (handles nested <template v-if>)
 */
function extractRootTemplateBlock(content: string): { full: string; attrs: string; inner: string } | null {
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
 * Fix: Remove { functional: true } from component options (removed in Vue 3)
 */
export const functionalOptionRemovalRule: FixRule = {
  id: "functional-option-removal",
  description: "Remove functional: true from component options (Vue 3)",
  priority: 94,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith(".vue") || filePath.endsWith(".js") || filePath.endsWith(".ts")) &&
      /functional\s*:\s*true/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const fixed = content.replace(
      /functional\s*:\s*true\s*,?\s*/g,
      ""
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed functional: true option");
    }

    return result;
  }
};

/**
 * Fix: Script and style blocks nested inside template - move to correct position
 * Malformed: <template><div>...<script>...</script><style>...</style></div></template>
 */
export const scriptStyleInsideTemplateRule: FixRule = {
  id: "script-style-inside-template",
  description: "Move script/style blocks from inside template to correct SFC structure",
  priority: 96,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const block = extractRootTemplateBlock(content);
    if (!block) return false;
    return (
      block.inner.includes("<script") || block.inner.includes("<style")
    );
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
      ? `<script${scriptMatch[1]}>${scriptMatch[2]}</script>`
      : "";
    const styleBlock = styleMatch
      ? `<style${styleMatch[1]}>${styleMatch[2]}</style>`
      : "";

    const rootTemplate = `<template${block.attrs}>\n${templateOnly}\n</template>`;
    const fixed = content.replace(block.full, rootTemplate + (scriptBlock ? "\n\n" + scriptBlock : "") + (styleBlock ? "\n\n" + styleBlock : ""));

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Moved script/style from inside template to correct SFC structure");
    }

    return result;
  },
};

/** Identifiers that are never the target of undeclared-var fix (refs, API objects, etc.) */
const SKIP_UNDECLARED = new Set([
  "ref", "computed", "reactive", "watch", "api", "percent", "show", "canSuccess",
  "duration", "height", "color", "failedColor", "increase", "decrease", "finish",
  "pause", "hide", "fail", "set", "get", "start", "nextTick", "defineExpose",
  "value", // common property access (percent.value = 0) - avoid false positive
  "v",    // v-model, v-if, v-for param - avoid false positive from directive names
]);

/**
 * Infer initial value for ref() based on variable name (loading, isLoading → false; count → 0).
 */
function inferRefInitialValue(varName: string): string {
  if (/loading|fetching|busy|show|visible|^is[A-Z]/.test(varName)) return "false";
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
  description: "Add let declaration for variables used/assigned but not declared in script setup",
  priority: 64,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup>")) return false;
    const scriptMatch = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return false;
    const script = scriptMatch[1];
    // Find assignments to simple identifiers (not a.b): id = expr. Exclude destructuring.
    // Use negative lookbehind to exclude .value = (property assignment)
    const assignRe = /(?<![.\w])(\w+)\s*=\s*(?:setInterval|setTimeout|null|\d|\d+\s*\/|[\w.]+)/g;
    let m;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/s)?.[1] ?? "";
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
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;

    const script = scriptMatch[1];
    const toDeclare = new Set<string>();
    const assignRe = /(?:^|[^\w])(\w+)\s*=\s*(?:setInterval|setTimeout|null|\d|[\w.]+\s*[/(])/g;
    let m;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/s)?.[1] ?? "";
    while ((m = assignRe.exec(script)) !== null) {
      const id = m[1];
      if (SKIP_UNDECLARED.has(id)) continue;
      if (template && new RegExp(`[\\s"':(]${id}\\b`).test(template)) continue;
      if (new RegExp(`(?:let|const|var)\\s+${id}\\b`).test(script)) continue;
      toDeclare.add(id);
    }
    if (toDeclare.size === 0) return result;

    const defaults = Array.from(toDeclare).map((id) => {
      if (id === "_cut" || id.toLowerCase().includes("cut")) return `let ${id} = 0`;
      return `let ${id} = null`;
    });
    const declBlock = defaults.join(";\n") + ";\n";

    const importMatches = [...script.matchAll(/^import\s+[^;]+;/gm)];
    const lastImport = importMatches[importMatches.length - 1];
    const insertPoint = lastImport
      ? lastImport.index! + lastImport[0].length
      : 0;
    const insertAfterImports =
      script.slice(0, insertPoint) + "\n" + declBlock + script.slice(insertPoint);
    const fixedContent = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], insertAfterImports));

    result.content = fixedContent;
    result.fixed = true;
    result.fixes.push(`Added let declaration for ${Array.from(toDeclare).join(", ")}`);
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
    if (!filePath.endsWith(".vue") || !content.includes("<script setup")) return false;
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/s);
    if (!scriptMatch || !templateMatch) return false;
    const script = scriptMatch[1];
    const template = templateMatch[1];
    const assignRe = /(?:^|[^\w.])(\w+)\s*=\s*(?!>)/g;
    let m;
    while ((m = assignRe.exec(script)) !== null) {
      const varName = m[1];
      if (SKIP_UNDECLARED.has(varName)) continue;
      if (new RegExp(`(?:let|const|var)\\s+${varName}\\b`).test(script)) continue;
      if (new RegExp(`${varName}\\.value\\s*=`).test(script)) continue;
      if (new RegExp(`[\\s"':(]${varName}\\b`).test(template)) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/s);
    if (!scriptMatch || !templateMatch) return result;

    let script = scriptMatch[1];
    const template = templateMatch[1];
    const toFix = new Set<string>();
    const assignRe = /(?:^|[^\w.])(\w+)\s*=\s*(?!>)/g;
    let m;
    while ((m = assignRe.exec(script)) !== null) {
      const varName = m[1];
      if (SKIP_UNDECLARED.has(varName)) continue;
      if (new RegExp(`(?:let|const|var)\\s+${varName}\\b`).test(script)) continue;
      if (new RegExp(`${varName}\\.value\\s*=`).test(script)) continue;
      if (new RegExp(`[\\s"':(]${varName}\\b`).test(template)) toFix.add(varName);
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
        const vueImport = script.match(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/);
        if (vueImport && !/ref\b/.test(vueImport[1])) {
          script = script.replace(
            /import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/,
            (_, s) => `import { ${s.trim()}, ref } from "vue"`
          );
        } else if (!vueImport) {
          script = "import { ref } from \"vue\";\n" + script;
        }
      }
      const importMatches = [...script.matchAll(/^import\s+[^;]+;/gm)];
      const lastImport = importMatches[importMatches.length - 1];
      const insertPoint = lastImport ? lastImport.index! + lastImport[0].length : 0;
      script = script.slice(0, insertPoint) + "\n" + decl + ";\n" + script.slice(insertPoint);
      result.fixed = true;
      result.fixes.push(`Added ${decl} for template binding`);
    }
    if (result.fixed) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], script));
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
  description: "Fix varName.value = > to varName => (corrupted by loadingRefRule)",
  priority: 67,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && /\.value\s*=\s*>\s*/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const script = scriptMatch[1];
    const fixed = script.replace(/(\w+)\.value\s*=\s*>\s*/g, "$1 => ");
    if (fixed !== script) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixed));
      result.fixed = true;
      result.fixes.push("Fixed corrupted arrow function syntax (varName.value = > → varName =>)");
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
  description: "Remove const v = ref(null) when v is from v-model/v-if (not a real var)",
  priority: 66,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    for (const skip of DIRECTIVE_LIKE_VARS) {
      if (new RegExp(`const\\s+${skip}\\s*=\\s*ref\\(`).test(content)) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    let script = scriptMatch[1];
    for (const skip of DIRECTIVE_LIKE_VARS) {
      const re = new RegExp(`const\\s+${skip}\\s*=\\s*ref\\([^)]+\\)\\s*;?\\s*\\n?`, "g");
      script = script.replace(re, "");
    }
    if (script !== scriptMatch[1]) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], script));
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
  description: "Fix duplicate symbol (function X + const X) by renaming helper to doX",
  priority: 75,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
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
    const methodPattern = new RegExp(
      `[,\\{]\\s*${name}\\s*\\([^)]*\\)\\s*\\{`
    );
    if (!constPattern.test(script) && !methodPattern.test(script)) return result;
    const newName = "do" + name.charAt(0).toUpperCase() + name.slice(1);

    // Replace function declaration
    let fixed = script.replace(
      new RegExp(`\\bfunction\\s+${name}\\s*\\(`, "g"),
      `function ${newName}(`
    );
    // Replace call sites only - not method definitions like fetchComments() {
    // Match name( when ( is NOT followed by )
    const callSiteRegex = new RegExp(
      `\\b${name}\\s*\\(\\s*(?!\\s*\\))`,
      "g"
    );
    fixed = fixed.replace(callSiteRegex, `${newName}(`);

    if (fixed !== script) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixed));
      result.fixed = true;
      result.fixes.push(`Renamed duplicate symbol ${name} to ${newName}`);
    }

    return result;
  },
};
