/**
 * Rules for SSR-specific fixes (router, asyncData, server)
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

/**
 * Fix: Remove Vue.use(Router) - Vue 3 router doesn't need it
 */
export const routerVueUseRemovalRule: FixRule = {
  id: "router-vue-use-removal",
  description: "Remove Vue.use(Router) from router file",
  priority: 93,
  shouldApply: (filePath, content) => {
    return (filePath.includes("router/") || filePath.endsWith("router.js") || filePath.endsWith("router.ts")) &&
           content.includes("Vue.use(Router)");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const fixed = content.replace(/\s*Vue\.use\s*\(\s*Router\s*\)\s*;?\s*\n?/g, "\n");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed Vue.use(Router)");
    }
    return result;
  },
};

/**
 * Fix: Add createMemoryHistory for SSR (window is not defined)
 */
export const routerSSRHistoryRule: FixRule = {
  id: "router-ssr-history",
  description: "Use createMemoryHistory for SSR when window is undefined",
  priority: 92,
  shouldApply: (filePath, content) => {
    return (filePath.includes("router/") || filePath.endsWith("router.js") || filePath.endsWith("router.ts")) &&
           content.includes("createWebHistory()") &&
           !content.includes("createMemoryHistory");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    let fixed = content;
    if (!fixed.includes("createMemoryHistory")) {
      fixed = fixed.replace(
        /import\s+\{\s*createRouter\s+as\s+createVueRouter\s*,\s*createWebHistory\s*\}\s+from\s+['"]vue-router['"]/,
        "import { createRouter as createVueRouter, createWebHistory, createMemoryHistory } from \"vue-router\""
      );
      fixed = fixed.replace(
        /import\s+\{\s*createRouter\s*,\s*createWebHistory\s*\}\s+from\s+['"]vue-router['"]/,
        "import { createRouter, createWebHistory, createMemoryHistory } from \"vue-router\""
      );
    }
    if (fixed.includes("createWebHistory()") && !/typeof\s+window/.test(fixed)) {
      fixed = fixed.replace(
        /history:\s*createWebHistory\(\)/,
        "history: typeof window !== \"undefined\" ? createWebHistory() : createMemoryHistory()"
      );
    }
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added createMemoryHistory for SSR");
    }
    return result;
  },
};

/**
 * Fix: Add setRoute and currentRoute to store when paginated list uses slice(start, end).
 * Generic: detects listHolder[key].slice(start, end) and perPage ref from content.
 */
export const storeRouteSyncRule: FixRule = {
  id: "store-route-sync",
  description: "Add setRoute and currentRoute for router sync (SSR + paginated list from route)",
  priority: 76,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith("store/index.js") || filePath.endsWith("store/index.ts")) &&
           content.includes("defineStore") &&
           /\w+\[\w+\]\.slice\s*\(\s*start\s*,\s*end\s*\)/.test(content) &&
           /const\s+\w+\s*=\s*ref\s*\(\s*\d+\s*\)/.test(content) &&
           !content.includes("currentRoute.value?.params?.page");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    if (content.includes("setRoute") && content.includes("currentRoute")) return result;

    const sliceMatch = content.match(/(\w+)\[(\w+)\]\.slice\s*\(\s*start\s*,\s*end\s*\)/);
    if (!sliceMatch) return result;

    const [listHolder, typeKey] = sliceMatch.slice(1);
    const computedRe = new RegExp(
      `const\\s+(\\w+)\\s*=\\s*computed\\s*\\([\\s\\S]*?${listHolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[${typeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\.slice\\s*\\(\\s*start\\s*,\\s*end\\s*\\)`
    );
    const computedVarMatch = content.match(computedRe);
    const computedVar = computedVarMatch?.[1] ?? null;
    if (!computedVar) return result;

    const perPageMatch = content.match(/const\s+(\w+)\s*=\s*ref\s*\(\s*\d+\s*\)/);
    if (!perPageMatch) return result;
    const perPageVar = perPageMatch[1];

    let fixed = content;

    // Add currentRoute ref after first ref
    if (!fixed.includes("currentRoute")) {
      const refMatch = fixed.match(/(const \w+ = ref\([^)]+\);\s*\n)/);
      if (refMatch) {
        fixed = fixed.replace(
          refMatch[1],
          refMatch[1] + "  const currentRoute = ref(null);\n"
        );
      }
    }

    // Add setRoute function before return
    if (!fixed.includes("function setRoute") && !fixed.includes("setRoute(to)")) {
      const returnMatch = fixed.match(/(\s+return\s*\{)/);
      if (returnMatch) {
        fixed = fixed.replace(
          returnMatch[1],
          `
  function setRoute(to) {
    currentRoute.value = to;
  }

` + returnMatch[1]
        );
      }
    }

    // Add setRoute and currentRoute to return object
    if (!fixed.includes("setRoute: setRoute") && !/setRoute\s*,?\s*currentRoute/.test(fixed)) {
      const closingMatch = fixed.match(/(\n)(\s*)(\};)(\s*\}\);?)(\s*)$/);
      if (closingMatch) {
        fixed = fixed.replace(
          closingMatch[0],
          closingMatch[1] + closingMatch[2] + "setRoute: setRoute," + closingMatch[2] + "currentRoute: currentRoute," + closingMatch[2] + closingMatch[3] + closingMatch[4] + closingMatch[5]
        );
      }
    }

    // Fix: listHolder[typeKey].slice(start, end) -> use currentRoute for pagination
    const slicePattern = new RegExp(
      `const\\s+${computedVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*computed\\s*\\([\\s\\S]*?${listHolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[${typeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\.slice\\s*\\(\\s*start\\s*,\\s*end\\s*\\)\\s*\\)\\s*;?`,
      "g"
    );
    fixed = fixed.replace(
      slicePattern,
      `const ${computedVar} = computed(() => {
    if (!${typeKey}.value) return [];
    const page = Number(currentRoute.value?.params?.page) || 1;
    const start = (page - 1) * ${perPageVar}.value;
    const end = page * ${perPageVar}.value;
    return ${listHolder}[${typeKey}.value].slice(start, end);
  });`
    );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added setRoute, currentRoute for router sync");
    }
    return result;
  },
};

/**
 * Fix: paginated computed(listHolder[typeKey].slice(start, end)) → use currentRoute for pagination.
 * Runs even when setRoute already exists (second pass).
 */
export const storeActiveIdsRouteRule: FixRule = {
  id: "store-active-ids-route",
  description: "Fix paginated list computed to use currentRoute for pagination",
  priority: 75,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith("store/index.js") || filePath.endsWith("store/index.ts")) &&
           content.includes("defineStore") &&
           content.includes("currentRoute") &&
           /\w+\[\w+\]\.slice\s*\(\s*start\s*,\s*end\s*\)/.test(content) &&
           /const\s+\w+\s*=\s*ref\s*\(\s*\d+\s*\)/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    if (content.includes("currentRoute.value?.params?.page")) return result;

    const sliceMatch = content.match(/(\w+)\[(\w+)\]\.slice\s*\(\s*start\s*,\s*end\s*\)/);
    if (!sliceMatch) return result;

    const [listHolder, typeKey] = sliceMatch.slice(1);
    const computedRe = new RegExp(
      `const\\s+(\\w+)\\s*=\\s*computed\\s*\\([\\s\\S]*?${listHolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[${typeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\.slice\\s*\\(\\s*start\\s*,\\s*end\\s*\\)`
    );
    const computedVarMatch = content.match(computedRe);
    const computedVar = computedVarMatch?.[1] ?? null;
    if (!computedVar) return result;

    const perPageMatch = content.match(/const\s+(\w+)\s*=\s*ref\s*\(\s*\d+\s*\)/);
    if (!perPageMatch) return result;
    const perPageVar = perPageMatch[1];

    const slicePattern = new RegExp(
      `const\\s+${computedVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*computed\\s*\\([\\s\\S]*?${listHolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[${typeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\.slice\\s*\\(\\s*start\\s*,\\s*end\\s*\\)\\s*\\)\\s*;?`,
      "g"
    );
    const fixed = content.replace(
      slicePattern,
      `const ${computedVar} = computed(() => {
    if (!${typeKey}.value) return [];
    const page = Number(currentRoute.value?.params?.page) || 1;
    const start = (page - 1) * ${perPageVar}.value;
    const end = page * ${perPageVar}.value;
    return ${listHolder}[${typeKey}.value].slice(start, end);
  });`
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed paginated list to use currentRoute for pagination");
    }
    return result;
  },
};

/**
 * Fix: dispatch('ACTION') inside store → ACTION() (Pinia self-dispatch)
 */
export const storeSelfDispatchRule: FixRule = {
  id: "store-self-dispatch",
  description: "Replace dispatch('ACTION') with ACTION() inside Pinia store",
  priority: 87,
  shouldApply: (filePath, content) => {
    return (filePath.includes("/store/") || filePath.endsWith("store.js") || filePath.endsWith("store.ts")) &&
           content.includes("defineStore") &&
           /dispatch\s*\(\s*['"][^/'"]+['"]\s*/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    let fixed = content;
    fixed = fixed.replace(
      /dispatch\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g,
      "$1($2)"
    );
    fixed = fixed.replace(
      /dispatch\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      "$1()"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced store self-dispatch with direct method calls");
    }
    return result;
  },
};

/**
 * Fix: Vue 3 SSR - this.$ssrContext is removed. Use inject('ssrContext') + app.provide instead.
 * Applies to mixins (e.g. util/title.js) that set this.$ssrContext.title or similar.
 */
export const ssrContextToInjectRule: FixRule = {
  id: "ssr-context-to-inject",
  description: "Replace this.$ssrContext with inject(ssrContext) for Vue 3 SSR",
  priority: 91,
  shouldApply: (filePath, content) => {
    return (
      (filePath.includes("util/") ||
        filePath.includes("utils/") ||
        filePath.endsWith(".vue") ||
        filePath.includes("mixins/")) &&
      /this\.\$ssrContext\b/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    let fixed = content;

    // Add inject to server mixin/object that uses $ssrContext
    // Pattern: const serverXxxMixin = { created() { this.$ssrContext.xxx = ... } }
    // or: { created() { this.$ssrContext.xxx = ... } }
    if (/this\.\$ssrContext\b/.test(fixed) && !fixed.includes("inject:") && !fixed.includes("from: 'ssrContext'")) {
      // Add inject before created() in the object that has $ssrContext
      fixed = fixed.replace(
        /(\{\s*)(created\s*\(\s*\)\s*\{[^}]*this\.\$ssrContext)/,
        "$1inject: { ssrContext: { from: 'ssrContext', default: null } },\n  $2"
      );
    }

    // Replace this.$ssrContext with this.ssrContext (with null check)
    // this.$ssrContext.title = x → this.ssrContext?.title = x or if (this.ssrContext) this.ssrContext.title = x
    if (/this\.\$ssrContext\b/.test(fixed)) {
      // In assignments: if (title && this.$ssrContext) or just this.$ssrContext.xxx =
      fixed = fixed.replace(
        /if\s*\(\s*title\s*&&\s*this\.\$ssrContext\s*\)/g,
        "if (title && this.ssrContext)"
      );
      fixed = fixed.replace(
        /this\.\$ssrContext\.(\w+)\s*=/g,
        "this.ssrContext.$1 ="
      );
      // Standalone this.$ssrContext.xxx = (without prior if) - add optional chaining or keep as is
      // The inject gives default: null so we need a guard. The pattern "if (title && this.ssrContext)" handles it.
      // For direct assignment without guard: this.$ssrContext.title = x
      // We already replaced with this.ssrContext.title = x. We need to ensure the block has a guard.
      // If the original was: if (title) { this.$ssrContext.title = x } then we need if (title && this.ssrContext)
      fixed = fixed.replace(
        /if\s*\(\s*title\s*\)\s*\{(\s*\n\s*)this\.ssrContext\./g,
        "if (title && this.ssrContext) {$1this.ssrContext."
      );
    }

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced this.$ssrContext with inject(ssrContext) for Vue 3 SSR");
    }
    return result;
  },
};

/**
 * Merge second script block (asyncData/title only) into script setup via defineOptions.
 * Vue 3 idiom: single script setup block. No second block for options.
 * Generic: any .vue with script setup + script { export default { asyncData, title } }
 */
export const mergeAsyncDataIntoDefineOptionsRule: FixRule = {
  id: "merge-async-data-define-options",
  description: "Merge second script block (asyncData/title) into script setup via defineOptions",
  priority: 94,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const scriptRegex = /<script(\s+setup)?(\s+lang=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/script>/gi;
    const blocks: { setup: boolean; content: string; fullMatch: string }[] = [];
    let m;
    while ((m = scriptRegex.exec(content)) !== null) {
      blocks.push({
        setup: !!(m[1] && m[1].includes("setup")),
        content: m[4].trim(),
        fullMatch: m[0],
      });
    }
    if (blocks.length < 2) return false;
    const [first, second] = blocks;
    if (!first.setup || second.setup) return false;
    const secondContent = second.content;
    return (
      /export\s+default\s*\{/i.test(secondContent) &&
      (/\basyncData\s*[:(]/.test(secondContent) ||
        /\btitle\s*[:(]/.test(secondContent))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptRegex = /<script(\s+setup)?(\s+lang=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/script>/gi;
    const blocks: { setup: boolean; content: string; fullMatch: string; index: number }[] = [];
    let m;
    while ((m = scriptRegex.exec(content)) !== null) {
      blocks.push({
        setup: !!(m[1] && m[1].includes("setup")),
        content: m[4].trim(),
        fullMatch: m[0],
        index: m.index,
      });
    }
    if (blocks.length < 2 || !blocks[0].setup || blocks[1].setup) {
      return result;
    }
    const secondContent = blocks[1].content;
    const exportMatch = secondContent.match(/export\s+default\s*\{/i);
    if (!exportMatch) return result;
    const braceStart = secondContent.indexOf("{", exportMatch.index);
    if (braceStart === -1) return result;
    let depth = 1;
    let i = braceStart + 1;
    for (; i < secondContent.length; i++) {
      const c = secondContent[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const optionsObj = secondContent.substring(braceStart, i + 1);
    const defineOptionsLine = `defineOptions(${optionsObj});`;
    const newFirstContent = defineOptionsLine + "\n\n" + blocks[0].content;
    const openTagMatch = blocks[0].fullMatch.match(/<script[^>]*>/);
    const openTag = openTagMatch ? openTagMatch[0] : "<script setup>";
    const newFirstBlock = openTag + "\n" + newFirstContent + "\n</script>";
    let fixed = content.replace(blocks[0].fullMatch, newFirstBlock);
    fixed = fixed.replace(blocks[1].fullMatch, "");
    fixed = fixed.replace(/\n\n\n+/g, "\n\n");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Merged second script block (asyncData/title) into defineOptions");
    }
    return result;
  },
};

/** Params/globals never treated as refs (from asyncData, route, etc.) */
const NOT_REF_NAMES = new Set(["store", "route", "params", "id", "to", "from", "next", "context", "null", "undefined", "true", "false"]);

/**
 * Extract ref/computed var names from script (const X = ref|computed).
 * Excludes useXStore: Pinia stores are reactive objects, not refs (no .value).
 */
function getRefVarNamesFromScript(scriptContent: string): Set<string> {
  const refVars = new Set<string>();
  const re = /\b(?:const|let)\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g;
  let m;
  while ((m = re.exec(scriptContent)) !== null) {
    refVars.add(m[1]);
  }
  return refVars;
}

/**
 * Check if return expr references any setup var (ref/computed or .value)
 */
function titleReferencesSetupVars(
  returnExpr: string,
  refVarNames: Set<string>
): boolean {
  if (/\.value\b/.test(returnExpr)) return true;
  const identMatch = returnExpr.match(/\b([a-zA-Z_]\w*)\b/g);
  if (!identMatch) return false;
  return identMatch.some((id) => refVarNames.has(id) && !NOT_REF_NAMES.has(id));
}

/**
 * Transform return expr to watch source: add ?.value for ref vars
 */
function transformTitleExprToWatchSource(
  returnExpr: string,
  refVarNames: Set<string>
): string {
  const ternaryMatch = returnExpr.match(/^(\w+)\s*\?\s*\1\.(\w+)\s*:\s*["']([^"']*)["']\s*$/);
  if (ternaryMatch && refVarNames.has(ternaryMatch[1])) {
    const [, varName, prop, fallback] = ternaryMatch;
    return `(${varName}?.value && typeof ${varName}.value === "object") ? ${varName}.value.${prop} : ${varName}?.value === false ? "${fallback}" : null`;
  }
  let out = returnExpr;
  const refList = [...refVarNames].filter((x) => !NOT_REF_NAMES.has(x));
  for (const v of refList) {
    out = out.replace(new RegExp(`\\b${v}\\.value\\b`, "g"), `${v}?.value`);
    out = out.replace(new RegExp(`\\b${v}\\.(\\w+)\\b`, "g"), `${v}?.value?.$1`);
  }
  out = out.replace(/(\.value)\.(\w+)/g, "$1?.$2");
  out = out.replace(/\?\.\?\./g, "?.");
  return out;
}

/**
 * Fix: defineOptions title() cannot reference setup variables (hoisted).
 * Generic: detects ref/computed vars from script, converts any title() that references them to watch.
 * Priority 93 (after merge 94).
 */
export const defineOptionsTitleSetupRefRule: FixRule = {
  id: "define-options-title-setup-ref",
  description: "Fix defineOptions title() that references setup vars (use watch instead)",
  priority: 93,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    if (!/defineOptions\s*\(/.test(content) || !/\btitle\s*\(\s*\)\s*\{/.test(content)) return false;
    const titleBody = content.match(/title\s*\(\s*\)\s*\{\s*return\s+([\s\S]*?)\s*;?\s*\}\s*[,}]/);
    if (!titleBody) return false;
    const scriptMatch = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return false;
    const refVars = getRefVarNamesFromScript(scriptMatch[1]);
    return titleReferencesSetupVars(titleBody[1], refVars);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const scriptContent = scriptMatch[1];
    const refVarNames = getRefVarNamesFromScript(scriptContent);
    const defineOptMatch = scriptContent.match(
      /defineOptions\s*\(\s*(\{[\s\S]*\})\s*\)\s*;/
    );
    if (!defineOptMatch) return result;
    const optsStr = defineOptMatch[1];
    const titleMatch = optsStr.match(
      /title\s*\(\s*\)\s*\{\s*return\s+([\s\S]*?)\s*;?\s*\}\s*,?/
    );
    if (!titleMatch) return result;
    const returnExpr = titleMatch[1].trim();
    if (!titleReferencesSetupVars(returnExpr, refVarNames) && !/\.value\b/.test(returnExpr)) {
      return result;
    }

    const watchSource = transformTitleExprToWatchSource(returnExpr, refVarNames);

    const newOpts = optsStr
      .replace(/\s*title\s*\(\s*\)\s*\{\s*return\s+[\s\S]*?;?\s*\}\s*,?/, "")
      .replace(/,\s*,\s*/g, ",")
      .replace(/,(\s*[}\]])/, "$1");
    const defineOptionsFixed = `defineOptions(${newOpts});`;
    const watchBlock = `
// defineOptions title() cannot reference setup vars. Use watch for document.title.
watch(
  () => ${watchSource},
  (t) => {
    if (t && typeof document !== "undefined") {
      document.title = \`Vue HN 2.0 | \${t}\`;
    }
  },
  { immediate: true }
);
`;
    let withWatch = scriptContent.replace(
      /defineOptions\s*\(\s*\{[\s\S]*\}\s*\)\s*;/,
      defineOptionsFixed + "\n" + watchBlock.trim()
    );
    if (!/import\s+\{[^}]*\bwatch\b/.test(withWatch)) {
      withWatch = withWatch.replace(
        /(import\s+\{[^}]+)\}\s+from\s+["']vue["']/,
        (m) => (m.includes("watch") ? m : m.replace(/\}\s+from/, ", watch } from"))
      );
    }
    result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptContent, withWatch));
    result.fixed = true;
    result.fixes.push("Replaced defineOptions title() (setup ref) with watch for document.title");
    return result;
  },
};

/**
 * Fix: defineOptions asyncData cannot reference setup vars (indexStore etc.) - use store param.
 * asyncData({ store, route }) receives store from caller; indexStore.FETCH_X → store.FETCH_X
 */
export const defineOptionsAsyncDataStoreRefRule: FixRule = {
  id: "define-options-async-data-store-ref",
  description: "Replace setup store var with store param in defineOptions asyncData (hoisting)",
  priority: 92,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("defineOptions") || !content.includes("asyncData"))
      return false;
    const storeVars = [...content.matchAll(/(?:const|let)\s+(\w+Store)\s*=\s*use\w+Store\s*\(/g)].map((m) => m[1]);
    return storeVars.length > 0;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    const script = scriptMatch[1];
    const asyncDataStart = script.search(/asyncData\s*\(\s*\{/);
    if (asyncDataStart === -1) return result;
    const openBrace = script.indexOf("{", asyncDataStart);
    const paramsEnd = script.indexOf("}) {", asyncDataStart);
    if (paramsEnd === -1) return result;
    const bodyStart = paramsEnd + 4;
    let depth = 1;
    let i = bodyStart;
    while (i < script.length && depth > 0) {
      if (script[i] === "{") depth++;
      else if (script[i] === "}") depth--;
      i++;
    }
    const body = script.slice(bodyStart, i - 1);
    const origParams = script.slice(openBrace + 1, paramsEnd).trim();
    const storeVars = [...script.matchAll(/(?:const|let)\s+(\w+Store)\s*=\s*use\w+Store\s*\(/g)].map((m) => m[1]);
    let newBody = body;
    let needsStoreInParams = false;
    for (const storeVar of storeVars) {
      if (new RegExp(`\\b${storeVar}\\b`).test(body)) {
        newBody = newBody.replace(new RegExp(`\\b${storeVar}\\b`, "g"), "store");
        result.fixes.push(`Replaced ${storeVar} with store in asyncData (defineOptions hoisting)`);
        needsStoreInParams = true;
      }
    }
    if (newBody !== body) {
      const newParams =
        needsStoreInParams && !origParams.includes("store")
          ? (origParams ? `store, ${origParams}` : "store")
          : origParams;
      const fixedScript =
        script.slice(0, openBrace + 1) +
        newParams +
        script.slice(paramsEnd, bodyStart) +
        newBody +
        script.slice(i - 1);
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixedScript));
      result.fixed = true;
    }
    return result;
  },
};

/**
 * Fix: store.dispatch('ACTION', args) → store.ACTION(args) in asyncData (Pinia)
 */
export const asyncDataStoreDispatchRule: FixRule = {
  id: "async-data-store-dispatch",
  description: "Replace store.dispatch with direct method call in asyncData",
  priority: 88,
  shouldApply: (filePath, content) => {
    return content.includes("asyncData") &&
           /store\.dispatch\s*\(\s*['"][^'"]+['"]\s*/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const fixed = content.replace(
      /store\.dispatch\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g,
      "store.$1($2)"
    ).replace(
      /store\.dispatch\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      "store.$1()"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced store.dispatch with direct method call in asyncData");
    }
    return result;
  },
};

/** Store-like identifiers: never apply plugin fix (varName.store is valid for userStore.store) */
const STORE_LIKE = /^(store|indexStore|mainStore|userStore|[\w]+Store)$/;

/** Fallback: common plugin/progress bar var names when getCurrentInstance not found */
const FALLBACK_PLUGIN_NAMES = /^(bar|progressBar|nprogress|plugin)$/i;

/** Extract script content from .vue file or return full content */
function getScriptContent(filePath: string, content: string): string {
  if (filePath.endsWith(".vue")) {
    const m = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    return m ? m[1] : content;
  }
  return content;
}

/**
 * Detect plugin vars from getCurrentInstance/globalProperties.
 * Returns set of variable names that are assigned from globalProperties (not stores).
 */
function detectPluginVars(content: string, storeLike: RegExp): Set<string> {
  const pluginVars = new Set<string>();
  const script = content;
  // const X = getCurrentInstance()?.appContext.config.globalProperties.$Y (X = var name, exclude if store-like)
  for (const m of script.matchAll(/const\s+(\w+)\s*=\s*getCurrentInstance\s*\([^)]*\)\s*\?\.(?:appContext\.)?config\.globalProperties\.\$\w+/g)) {
    const varName = m[1];
    if (!storeLike.test(varName)) pluginVars.add(varName);
  }
  // globalProperties.$X = Y  (Y is the plugin var - when assigned from createApp().mount, etc.)
  for (const m of script.matchAll(/globalProperties\.\$\w+\s*=\s*(\w+)/g)) {
    const varName = m[1];
    if (!storeLike.test(varName)) pluginVars.add(varName);
  }
  return pluginVars;
}

function isPluginVar(varName: string, pluginVars: Set<string>, fallbackRe: RegExp): boolean {
  return pluginVars.has(varName) || fallbackRe.test(varName);
}

/**
 * Fix: varName.indexStore.X / varName.store.X → varName.X when varName is NOT a store.
 * For plugin vars: use varName?.method?.() since they can be undefined (from getCurrentInstance).
 * Generic: detects plugin vars from getCurrentInstance/globalProperties, fallback to common names.
 */
export const barIndexStoreFixRule: FixRule = {
  id: "bar-index-store-fix",
  description: "Fix varName.indexStore/store to varName (when varName is not a store)",
  priority: 86,
  shouldApply: (filePath, content) => {
    return /\b\w+\.(?:indexStore|store)\.\w+/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptContent = getScriptContent(filePath, content);
    const pluginVars = detectPluginVars(scriptContent, STORE_LIKE);
    let fixed = content.replace(/\b(\w+)\.(?:indexStore|store)\./g, (match, varName) => {
      if (STORE_LIKE.test(varName)) return match;
      return isPluginVar(varName, pluginVars, FALLBACK_PLUGIN_NAMES) ? `${varName}?.` : `${varName}.`;
    });
    // For plugin vars: varName?.start() -> varName?.start?.() (plugin can be undefined)
    if (fixed !== content) {
      const pluginVarNames = [...pluginVars];
      const fallbackNames = "bar|progressBar|nprogress|plugin";
      const allPluginNames = pluginVarNames.length
        ? `${pluginVarNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|${fallbackNames}`
        : fallbackNames;
      fixed = fixed.replace(new RegExp(`\\b(${allPluginNames})\\?\\.(\\w+)\\s*\\(\\s*\\)`, "gi"), "$1?.$2?.()");
    }
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed varName.indexStore/store to varName (non-store plugin)");
    }
    return result;
  },
};

/**
 * Fix: store.indexStore → store, store.state.X → store.X (Pinia: no .state, no .indexStore).
 * Generic: applies when store is the Pinia store (from useXStore()).
 */
export const storePiniaStateFixRule: FixRule = {
  id: "store-pinia-state-fix",
  description: "Fix store.indexStore → store, store.state.X → store.X (Pinia)",
  priority: 86,
  shouldApply: (filePath, content) => {
    return /\.(?:indexStore|state\.\w+)\b/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;
    fixed = fixed.replace(/(\w+)\.indexStore\b/g, "$1");
    // store.state.X → store.X (Pinia: only for store-like identifiers)
    fixed = fixed.replace(/(\b(?:store|indexStore|\w+Store))\.state\.(\w+)/g, "$1.$2");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed store.indexStore and store.state.X for Pinia");
    }
    return result;
  },
};

/**
 * Fix: store.dispatch('ACTION', args) → store.ACTION(args) in any function (Pinia)
 * Generic: applies to doFetchComments(store, item) and similar patterns.
 */
export const storeDispatchToDirectRule: FixRule = {
  id: "store-dispatch-to-direct",
  description: "Replace store.dispatch with direct method call (Pinia)",
  priority: 87,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith(".vue") || filePath.endsWith(".js") || filePath.endsWith(".ts")) &&
      /\.dispatch\s*\(\s*['"][^'"]+['"]\s*/.test(content) &&
      !content.includes("vuex")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;

    // Skip module/action format - handled by storeDispatchModuleActionRule (e.g. indexStore.dispatch('user/fetchUsers'))
    // Replacing would produce invalid indexStore.user/fetchUsers() (division, not method call)
    const moduleActionRe = /(\w+)\.dispatch\s*\(\s*['"]([^'"]+)\/([^'"]+)['"]\s*(?:,\s*([^)]+))?\s*\)/g;
    if (moduleActionRe.test(content)) {
      return result; // Let storeDispatchModuleActionRule handle it
    }

    fixed = fixed
      .replace(
        /(\w+)\.dispatch\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g,
        "$1.$2($3)"
      )
      .replace(
        /(\w+)\.dispatch\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        "$1.$2()"
      );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced store.dispatch with direct method call (Pinia)");
    }
    return result;
  },
};

/**
 * Fix: Add let declaration when cleanup var is assigned in onBeforeMount/onMounted but used in onBeforeUnmount without declaration
 * Generic: any var = fn(...) in mount + var() in onBeforeUnmount (watch, watchEffect, subscribe, watchList, etc.)
 */
export const onBeforeUnmountAddLetDeclarationRule: FixRule = {
  id: "on-before-unmount-add-let",
  description: "Add let declaration for cleanup var used in onBeforeUnmount",
  priority: 63,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("onBeforeUnmount")) return false;
    const assignMatch = content.match(/(\w+)\s*=\s*\w+\s*\(/);
    if (!assignMatch) return false;
    const varName = assignMatch[1];
    if (RESERVED_WORDS.has(varName)) return false;
    const hasDeclaration = new RegExp(`(?:let|var)\\s+${varName}\\s*[;=]`).test(content);
    const hasUnmountCall = new RegExp(`${varName}\\s*\\(\\s*\\)`).test(content);
    const hasLifecycle = /onBeforeMount|onMounted/.test(content);
    return !hasDeclaration && hasUnmountCall && hasLifecycle;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const assignMatch = content.match(/(\w+)\s*=\s*\w+\s*\(/);
    if (!assignMatch) return result;
    const varName = assignMatch[1];
    if (RESERVED_WORDS.has(varName)) return result;
    if (new RegExp(`(?:let|var)\\s+${varName}\\s*[;=]`).test(content)) return result;
    // Insert "let varName;" before onBeforeMount or onMounted (whichever comes first)
    const mountRegex = /(\s*)((?:onBeforeMount|onMounted)\s*\([^)]*\)\s*=>\s*\{)/;
    const insertBeforeMount = content.replace(
      mountRegex,
      `$1let ${varName};$1$2`
    );
    if (insertBeforeMount !== content) {
      result.content = insertBeforeMount;
      result.fixed = true;
      result.fixes.push(`Added let ${varName} for onBeforeUnmount cleanup`);
    }
    return result;
  },
};

/**
 * Fix: onBeforeUnmount cleanup - use optional chaining when variable may be unassigned
 * Pattern: let unwatchList; onBeforeMount may return early; onBeforeUnmount calls unwatchList()
 */
export const onBeforeUnmountOptionalChainingRule: FixRule = {
  id: "on-before-unmount-optional-chaining",
  description: "Use optional chaining in onBeforeUnmount when cleanup var may be unassigned",
  priority: 62,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("onBeforeUnmount")) return false;
    const letMatches = content.matchAll(/let\s+(\w+)\s*;/g);
    for (const m of letMatches) {
      const varName = m[1];
      if ((content.includes("onBeforeMount") || content.includes("onMounted")) && content.includes(`${varName}()`)) {
        const unmountBlock = content.match(/onBeforeUnmount\s*\([^)]*\)\s*=>\s*\{([^}]+)\}/s)?.[1] ?? "";
        if (unmountBlock.includes(`${varName}()`) && !unmountBlock.includes(`${varName}?.()`)) {
          return true;
        }
      }
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const letMatches = [...content.matchAll(/let\s+(\w+)\s*;/g)];
    let fixed = content;
    for (const m of letMatches) {
      const varName = m[1];
      const unmountRegex = new RegExp(
        `(onBeforeUnmount\\s*\\([^)]*\\)\\s*=>\\s*\\{[^}]*?)${varName}\\s*\\(\\s*\\)`,
        "s"
      );
      if (unmountRegex.test(fixed) && !fixed.includes(`${varName}?.()`)) {
        fixed = fixed.replace(unmountRegex, `$1${varName}?.()`);
        result.fixed = true;
      }
    }
    if (result.fixed) {
      result.content = fixed;
      result.fixes.push("Added optional chaining in onBeforeUnmount cleanup");
    }
    return result;
  },
};

const RESERVED_WORDS = new Set(["if", "for", "while", "switch", "catch", "with", "function", "return"]);

/**
 * Fix: Add guard before fn(props.X) when onBeforeMount may run with undefined props.
 * Generic: applies to any function taking props.X as first arg (watchList, loadItems, fetchData, etc.)
 */
export const watchListPropsGuardRule: FixRule = {
  id: "watch-list-props-guard",
  description: "Add guard if (!props.X) return before fn(props.X) in onBeforeMount",
  priority: 61,
  shouldApply: (filePath, content) => {
    const match = content.match(/(\w+)\s*\(\s*props\.(\w+)/);
    return !!(
      filePath.endsWith(".vue") &&
      match &&
      !RESERVED_WORDS.has(match[1]) &&
      !content.includes(`if (!props.${match[2]}) return`) &&
      content.includes("onBeforeMount")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const match = content.match(/(\w+)\s*\(\s*props\.(\w+)/);
    if (!match || RESERVED_WORDS.has(match[1])) return result;
    const [, fnName, propName] = match;
    if (content.includes(`if (!props.${propName}) return`)) return result;
    // Only add guard to onBeforeMount that contains fn(props.propName) (match the block)
    const blockRegex = new RegExp(
      `(onBeforeMount\\s*\\([^)]*\\)\\s*=>\\s*\\{\\s*)([\\s\\S]*?${fnName}\\s*\\(\\s*props\\.${propName})`,
      "s"
    );
    const fixed = content.replace(blockRegex, `$1if (!props.${propName}) return;\n  $2`);
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(`Added guard if (!props.${propName}) return before ${fnName}(props.${propName})`);
    }
    return result;
  },
};

/**
 * Fix: storeVar.anyProp[props.X].length when props.X may be undefined (SSR)
 * Prevents "Cannot read properties of undefined (reading 'length')". Generic for any store/property.
 */
export const listsPropsGuardRule: FixRule = {
  id: "lists-props-guard",
  description: "Add ?? [] for storeVar.prop[props.X] when props may be undefined (SSR)",
  priority: 60,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      /(\w+)\.(\w+)\[props\.\w+\]\.(length|slice)/.test(content) &&
      !/(\w+)\.(\w+)\[props\.\w+\]\s*\?\?/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(
      /(\w+)\.(\w+)\[props\.(\w+)\]\.(length|slice)/g,
      "($1.$2[props.$3] ?? []).$4"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added ?? [] for storeVar.prop[props.X] (SSR guard)");
    }
    return result;
  },
};

// Pattern: fn(ref) - matches loadItems, fetchData, doFetchComments, etc.
const LOAD_LIKE_FN_PATTERN = "(?:(?:do)?(?:[Ll]oad|[Ff]etch|[Ee]nsure|[Rr]efresh)[A-Za-z]\\w*)";

/**
 * Fix: loadItems(ref) / fetchData(ref) etc. in onBeforeMount - pass ref.value to avoid displayedPage corruption.
 * When fn(ref) is called with a ref/computed, the callback receives the ref object; assigning it to displayedPage
 * corrupts the template (v-if="displayedPage > 0" becomes falsy, items disappear). Fix: fn(ref.value).
 * Generic: any fn matching (load|fetch|ensure|get|refresh)* + ref/computed identifier.
 */
export const loadItemsRefValueRule: FixRule = {
  id: "load-items-ref-value",
  description: "Fix loadItems(ref) → loadItems(ref.value) in onBeforeMount (SSR items disappear)",
  priority: 62,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("onBeforeMount")) return false;
    const refComputedVars = [...content.matchAll(/const\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g)].map((m) => m[1]);
    if (refComputedVars.length === 0) return false;
    const loadLikeRe = new RegExp(LOAD_LIKE_FN_PATTERN);
    return refComputedVars.some(
      (v) =>
        loadLikeRe.test(content) &&
        (new RegExp(`${LOAD_LIKE_FN_PATTERN}\\s*\\([^)]*\\b${v}\\b(?!\\.value)[^)]*\\)`).test(content) ||
          new RegExp(`${LOAD_LIKE_FN_PATTERN}\\s*\\(\\s*\\b${v}\\b(?!\\.value)\\s*(?:,|\\))`).test(content)) &&
        !new RegExp(`${LOAD_LIKE_FN_PATTERN}\\s*\\([^)]*\\b${v}\\.value\\b`).test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const refComputedVars = new Set([...content.matchAll(/const\s+(\w+)\s*=\s*(?:ref|computed)\s*\(/g)].map((m) => m[1]));
    let fixed = content;
    for (const v of refComputedVars) {
      // Case 1: ref is first arg - fn(ref, ...) or fn(ref) - NOT in function/const declaration
      const re1 = new RegExp(
        `(?<!function\\s)(\\b${LOAD_LIKE_FN_PATTERN})\\s*\\(\\s*\\b${v}\\b(?!\\s*\\.\\s*value)((?:\\s*,\\s*[^)]*)?)\\s*\\)`,
        "g"
      );
      fixed = fixed.replace(re1, (_, fnName, rest) => `${fnName}(${v}.value${rest})`);
      // Case 2: ref is 2nd+ arg - fn(store, ref) or fn(a, ref, b) - NOT in function/const declaration
      const re2 = new RegExp(
        `(?<!function\\s)(\\b${LOAD_LIKE_FN_PATTERN}\\s*\\([^)]*?),\\s*\\b${v}\\b(?!\\.value)(\\s*(?:,\\s*[^)]*)?)\\)`,
        "g"
      );
      fixed = fixed.replace(re2, (_, fnAndArgs, after) => `${fnAndArgs}, ${v}.value${after})`);
    }
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed loadItems(ref) → loadItems(ref.value) to avoid SSR items disappear");
    }
    return result;
  },
};

/**
 * Fix: onBeforeMount/onMounted calling fetch when data comes from store[route.params.X].
 * Race: asyncData may not have run yet (lazy components). Replace with watch so we run when data is available.
 * Generic: any lifecycle calling a fn that uses computed(() => store.xyz[route.params.*]).
 */
export const onBeforeMountFetchRouteDataRule: FixRule = {
  id: "on-before-mount-fetch-route-data",
  description: "Replace onBeforeMount(fetchFn) with watch when fn uses store[route.params] (asyncData timing)",
  priority: 61,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const lifecycleMatch = content.match(
      /(?:onBeforeMount|onMounted)\s*\(\s*\(\s*\)\s*=>\s*\{\s*(\w+)\s*\(\s*\)\s*;?\s*\}\s*\)/
    );
    if (!lifecycleMatch) return false;
    const fnName = lifecycleMatch[1];
    const computedMatch = content.match(
      new RegExp(
        `const\\s+(\\w+)\\s*=\\s*computed\\s*\\([\\s\\S]*?route\\.params\\.\\w+`,
        "s"
      )
    );
    if (!computedMatch) return false;
    const dataVar = computedMatch[1];
    const fnUsesData = new RegExp(
      `(?:const|function)\\s+${fnName}\\s*[=(\\(][\\s\\S]*?\\b${dataVar}\\b`
    ).test(content);
    const alreadyHasWatch = new RegExp(
      `watch\\s*\\([^)]*${dataVar}\\.value`
    ).test(content);
    return fnUsesData && !alreadyHasWatch && content.includes("useRoute");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const lifecycleMatch = content.match(
      /(?:onBeforeMount|onMounted)\s*\(\s*\(\s*\)\s*=>\s*\{\s*(\w+)\s*\(\s*\)\s*;?\s*\}\s*\)\s*;?/
    );
    if (!lifecycleMatch) return result;
    const fnName = lifecycleMatch[1];
    const fullMatch = lifecycleMatch[0];
    const computedMatch = content.match(
      new RegExp(
        `const\\s+(\\w+)\\s*=\\s*computed\\s*\\([\\s\\S]*?route\\.params\\.\\w+`,
        "s"
      )
    );
    if (!computedMatch) return result;
    const dataVar = computedMatch[1];
    let fixed = content.replace(fullMatch, "");
    const watchCode = `watch(
  () => ${dataVar}.value,
  v => { if (v) ${fnName}(); },
  { immediate: true }
);
`;
    const defineOptIdx = fixed.indexOf("defineOptions(");
    const insertAt = defineOptIdx >= 0 ? defineOptIdx : fixed.lastIndexOf("</script>");
    fixed = fixed.slice(0, insertAt) + watchCode + fixed.slice(insertAt);
    result.content = fixed;
    result.fixed = true;
    result.fixes.push(`Replaced lifecycle with watch on ${dataVar} (store/route data may not be ready at mount)`);
    return result;
  },
};

/**
 * Fix: Add computed fallback when ANY prop used in router-link :to path can be undefined.
 * Prevents "No match found for location /undefined/..." when navigating.
 * Fully generic: works for any prop name (type, category, section, slug, etc.), any store/naming.
 * Fallback: first segment of current route path (e.g. /top/2 → "top").
 */
export const propsTypeFallbackForRouterLinkRule: FixRule = {
  id: "props-type-fallback-router-link",
  description: "Add computed fallback for any prop in router-link path (avoid /undefined/ - generic)",
  priority: 64,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("router-link")) return false;
    const props = extractPropNamesFromDefineProps(content);
    if (props.length === 0) return false;
    const flat = content.replace(/\s+/g, " ");
    const hasPathConcat = props.some((p) =>
      new RegExp(`:to\\s*=[^>]*\\+\\s*(?:props\\.)?${p}\\s*\\+`).test(flat)
    );
    const hasResolved = props.some((p) =>
      new RegExp(`const\\s+${p}Resolved\\s*=\\s*computed\\s*\\(`).test(content)
    );
    return hasPathConcat && !hasResolved;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!scriptMatch || !templateMatch) return result;
    const script = scriptMatch[1];
    const template = templateMatch[1];
    const props = extractPropNamesFromDefineProps(content);
    const propsInPath = props.filter((p) => {
      const re = new RegExp(`:to\\s*=[^>]*\\+\\s*(?:props\\.)?${p}\\s*\\+`);
      return re.test(content.replace(/\s+/g, " "));
    });
    if (propsInPath.length === 0) return result;

    const hasRoute = /const\s+(\w+)\s*=\s*useRoute\s*\(\s*\)/.test(script);
    const routeVar = hasRoute ? script.match(/const\s+(\w+)\s*=\s*useRoute\s*\(\s*\)/)![1] : "_pathRoute";
    const needsRoute = !hasRoute;

    const insertIdx = findInsertIndexForComputed(script);
    const scriptBefore = script.slice(0, insertIdx);
    const scriptAfter = script.slice(insertIdx);

    let newTemplate = template;
    let newScriptBefore = scriptBefore;
    let newScriptAfter = scriptAfter;
    const computedLines: string[] = [];

    for (const prop of propsInPath) {
      const resolvedName = `${prop}Resolved`;
      if (new RegExp(`const\\s+${resolvedName}\\s*=`).test(script)) continue;

      const fallbackExpr = `${routeVar}.path.split('/').filter(Boolean)[0] ?? ''`;
      computedLines.push(`const ${resolvedName} = computed(() => props.${prop} ?? ${fallbackExpr});\n`);

      newTemplate = newTemplate
        .replace(new RegExp(`\\+\\s*${prop}\\s*\\+`, "g"), `+ ${resolvedName} +`)
        .replace(new RegExp(`\\+\\s*props\\.${prop}\\s*\\+`, "g"), `+ ${resolvedName} +`);

      const replaceInScript = (s: string) =>
        s
          .replace(new RegExp(`(\\w+)\\.(\\w+)\\s*\\[\\s*props\\.${prop}\\s*]`, "g"), `$1.$2[${resolvedName}.value]`)
          .replace(new RegExp(`(\\w+)\\.(\\w+)\\s*\\[\\s*${prop}\\s*]`, "g"), `$1.$2[${resolvedName}.value]`)
          .replace(new RegExp(`props\\.${prop}(?!\\w)`, "g"), `${resolvedName}.value`)
          .replace(new RegExp(`\\bif\\s*\\(\\s*!props\\.${prop}\\s*\\)\\s*return`, "g"), `if (!${resolvedName}.value) return`)
          .replace(new RegExp(`\\bif\\s*\\(\\s*!${prop}\\s*\\)\\s*return`, "g"), `if (!${resolvedName}.value) return`)
          .replace(new RegExp(`\\{\\s*${prop}:\\s*props\\.${prop}\\s*\\}`, "g"), `{ ${prop}: ${resolvedName}.value }`)
          .replace(new RegExp(`\\{\\s*${prop}:\\s*${prop}\\s*\\}`, "g"), `{ ${prop}: ${resolvedName}.value }`)
          .replace(new RegExp(`(const\\s+\\w+\\s*=\\s*)props\\.${prop}(\\s*;)`, "g"), `$1${resolvedName}.value$2`);

      newScriptBefore = replaceInScript(newScriptBefore);
      newScriptAfter = replaceInScript(newScriptAfter);
    }

    let routeDecl = "";
    if (needsRoute) {
      routeDecl = `const ${routeVar} = useRoute();\n`;
      if (!/useRoute\b/.test(script)) {
        const routerImport = newScriptBefore.match(/import\s+\{([^}]*)\}\s+from\s+['"]vue-router['"]/);
        if (routerImport) {
          const names = routerImport[1].trim();
          newScriptBefore = newScriptBefore.replace(
            /import\s+\{[^}]*\}\s+from\s+['"]vue-router['"]/,
            `import { useRoute${names ? `, ${names}` : ""} } from 'vue-router'`
          );
        } else {
          newScriptBefore = "import { useRoute } from 'vue-router';\n" + newScriptBefore;
        }
      }
    }

    const newScript = newScriptBefore + routeDecl + computedLines.join("") + newScriptAfter;

    const fixed = content
      .replace(templateMatch[0], templateMatch[0].replace(templateMatch[1], newTemplate))
      .replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], newScript));

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(`Added ${propsInPath.map((p) => `${p}Resolved`).join(", ")} fallback(s) for router-link (generic)`);
    }
    return result;
  },
};

function extractPropNamesFromDefineProps(content: string): string[] {
  const names: string[] = [];
  const objMatch = content.match(/defineProps\s*\(\s*\{([^}]+)\}\s*\)/s);
  if (objMatch) {
    const inner = objMatch[1];
    for (const m of inner.matchAll(/(\w+)\s*[:?]/g)) names.push(m[1]);
  }
  const arrMatch = content.match(/defineProps\s*\(\s*\[([^\]]+)\]\s*\)/s);
  if (arrMatch) {
    for (const m of arrMatch[1].matchAll(/['"](\w+)['"]/g)) names.push(m[1]);
  }
  return [...new Set(names)];
}

function findInsertIndexForComputed(script: string): number {
  const afterProps = script.match(/defineProps\s*\([^)]+\)\s*;?\s*\n/);
  if (afterProps) return (afterProps.index ?? 0) + afterProps[0].length;
  const afterStore = script.match(/(\w+)\s*=\s*use\w+Store\s*\(\s*\)\s*;?\s*\n/);
  if (afterStore) return (afterStore.index ?? 0) + afterStore[0].length;
  const afterRoute = script.match(/use(?:Route|Router)\s*\(\s*\)\s*;?\s*\n/);
  if (afterRoute) return (afterRoute.index ?? 0) + afterRoute[0].length;
  return script.indexOf("const ") >= 0 ? script.indexOf("const ") : 0;
}

/**
 * Fix: entry-server - resolve async route components before calling asyncData.
 * Vue Router 4 matched components are often async loaders (functions); we must resolve them
 * to get the actual component with asyncData. Generic for any SSR project with async routes.
 */
export const entryServerResolveAsyncComponentsRule: FixRule = {
  id: "entry-server-resolve-async-components",
  description: "Resolve async route components before asyncData (Vue Router 4)",
  priority: 91,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith("entry-server.js") || filePath.endsWith("entry-server.ts")) &&
      content.includes("asyncData") &&
      /matchedComponents\s*=\s*router\.currentRoute\.value\.matched/.test(content) &&
      !content.includes("typeof c === 'function'")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };

    // 1. Make isReady callback async
    let fixed = content.replace(
      /router\.isReady\(\)\.then\s*\(\s*\(\)\s*=>\s*\{/,
      "router.isReady().then(async () => {"
    );
    if (fixed === content) return result;

    // 2. Replace matchedComponents extraction with resolution logic
    const newBlock = `const rawComponents = router.currentRoute.value.matched
        .map(m => m.components?.default)
        .filter(Boolean);
      const matchedComponents = (await Promise.all(
        rawComponents.map(c => {
          if (typeof c === 'function') return c().then(x => x?.default ?? x);
          return Promise.resolve(c);
        })
      )).filter(Boolean);`;

    const beforeMatch = fixed;
    fixed = fixed.replace(
      /const matchedComponents = router\.currentRoute\.value\.matched\s*\n\s*\.map\s*\(\s*m\s*=>\s*m\.components\?\.default\s*\)\s*\n\s*\.filter\s*\(\s*Boolean\s*\)\s*;/,
      newBlock
    );
    // Fallback: variant without optional chaining (m.components.default)
    if (fixed === beforeMatch) {
      fixed = fixed.replace(
        /const matchedComponents = router\.currentRoute\.value\.matched\s*\n\s*\.map\s*\(\s*m\s*=>\s*m\.components\.default\s*\)\s*\n\s*\.filter\s*\(\s*Boolean\s*\)\s*;/,
        newBlock
      );
    }

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Resolved async route components before asyncData");
    }
    return result;
  },
};

/**
 * Fix: route: router.currentRoute → route: router.currentRoute.value (Vue Router 4 ref).
 * Generic: applies to any file with asyncData + router.currentRoute pattern (SSR bootstrap).
 */
export const entryServerRouterCurrentRouteRule: FixRule = {
  id: "entry-server-router-current-route",
  description: "Fix router.currentRoute → router.currentRoute.value for asyncData (Vue Router 4 ref)",
  priority: 89,
  shouldApply: (_filePath, content) => {
    return (
      content.includes("asyncData") &&
      /route:\s*router\.currentRoute(?!\.value\b)/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(
      /route:\s*router\.currentRoute(?!\.value\b)/g,
      "route: router.currentRoute.value"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed router.currentRoute → router.currentRoute.value for asyncData");
    }
    return result;
  },
};

/**
 * Fix: (Component).mount() and new Vue(Component).$mount() → createApp(Component).mount(dom).
 * Also adds app.config.globalProperties.$plugin = pluginVar for progress bars, etc.
 * Generic: applies to any file with mount/createApp/plugin pattern (client bootstrap).
 */
export const entryClientMountRule: FixRule = {
  id: "entry-client-mount",
  description: "Fix Component.mount → createApp(Component).mount, add globalProperties",
  priority: 88,
  shouldApply: (_filePath, content) => {
    return (
      content.includes("createApp") ||
      content.includes("mount(") ||
      /\([\w]+\)\.mount\(/.test(content) ||
      /new\s+Vue\s*\([^)]+\)\s*\.\$mount/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;

    // Fix: (Component).mount(dom) → createApp(Component).mount(dom) - Vue 3 requires createApp
    // Use lookbehind to avoid replacing createApp(Component).mount which is already correct
    const componentMountRe = /(?<!createApp\s)\(\s*(\w+)\s*\)\.mount\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/;
    const componentMountMatch = fixed.match(componentMountRe);
    if (componentMountMatch) {
      const [, compName, _mountArg] = componentMountMatch;
      const escapedComp = compName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const innerRe = new RegExp(
        `(?<!createApp)\\(\\s*${escapedComp}\\s*\\)\\.mount\\s*\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)`,
        "g"
      );
      fixed = fixed.replace(innerRe, `createApp(${compName}).mount($1)`);
      const vueImportMatch = fixed.match(/import\s+(?:\*\s+as\s+\w+|\{([^}]*)\}|(\w+))\s+from\s+['"]vue['"]/);
      if (vueImportMatch) {
        const named = vueImportMatch[1];
        const def = vueImportMatch[2];
        const hasCreateApp = named?.includes("createApp") ?? false;
        if (!hasCreateApp && named) {
          const imports = named.split(",").map((s) => s.trim()).filter(Boolean);
          imports.push("createApp");
          fixed = fixed.replace(
            /import\s+\{[^}]*\}\s+from\s+['"]vue['"]/,
            `import { ${imports.join(", ")} } from 'vue'`
          );
        } else if (!hasCreateApp && def) {
          fixed = fixed.replace(
            /import\s+(\w+)\s+from\s+['"]vue['"]/,
            (m, defaultName) =>
              defaultName === "createApp"
                ? m
                : `import ${defaultName}, { createApp } from 'vue'`
          );
        }
      } else if (!/from\s+['"]vue['"]/.test(fixed)) {
        const firstImport = fixed.match(/^(\s*import\s+[^;]+;\s*\n)/m);
        fixed = firstImport
          ? fixed.replace(firstImport[0], firstImport[0] + "import { createApp } from 'vue';\n")
          : "import { createApp } from 'vue';\n" + fixed;
      }
      result.fixed = true;
    }

    // Fix: new Vue(Component).$mount() → createApp(Component).mount(document.createElement('div'))
    const newVueMountMatch = fixed.match(/new\s+Vue\s*\(\s*(\w+)\s*\)\s*\.\$mount\s*\(\s*([^)]*)\s*\)/);
    if (newVueMountMatch) {
      fixed = fixed.replace(
        /new\s+Vue\s*\(\s*(\w+)\s*\)\s*\.\$mount\s*\(\s*([^)]*)\s*\)/g,
        (_, c, a) => `createApp(${c}).mount(${a.trim() || "document.createElement('div')"})`
      );
      result.fixed = true;
    }

    // Ensure factory (createAppFactory, createApp, makeApp, etc.) is called before app.mixin
    const factoryBlockRe = /const\s*\{\s*app[^}]*\}\s*=\s*(\w+)\s*\(\s*\)/;
    const hasAppMixinBeforeFactory = /app\.mixin\s*\(/.test(fixed) &&
      factoryBlockRe.test(fixed) &&
      (fixed.indexOf("app.mixin") < (fixed.match(factoryBlockRe)?.index ?? Infinity));
    if (hasAppMixinBeforeFactory) {
      const factoryName = fixed.match(factoryBlockRe)?.[1];
      const createAppMatch = factoryName
        ? fixed.match(new RegExp(`(const\\s*\\{\\s*app[^}]*\\}\\s*=\\s*${factoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\s*\\)\\s*)`))
        : null;
      const mixinMatch = fixed.match(/(\/\/[^\n]*mixin[^\n]*\s*\n)(app\.mixin\s*\([^)]+\)\s*\{[\s\S]*?\}\s*\)\s*\))/);
      if (createAppMatch && mixinMatch) {
        const factoryBlock = createAppMatch[1];
        const mixinBlock = mixinMatch[0];
        if (fixed.indexOf(mixinBlock) < fixed.indexOf(factoryBlock)) {
          fixed = fixed.replace(mixinBlock, "");
          const insertAfter = fixed.match(/document\.body\.appendChild\s*\([^)]+\)\s*;?\s*\n/);
          if (insertAfter) {
            const insertIdx = fixed.indexOf(insertAfter[0]) + insertAfter[0].length;
            fixed = fixed.slice(0, insertIdx) + "\n" + factoryBlock + "\n" + fixed.slice(insertIdx);
          }
        }
      }
    }

    // Add app.config.globalProperties.$varName = varName after createAppFactory (app must exist before globalProperties)
    const barMatch = fixed.match(/const\s+(\w+)\s*=\s*createApp\s*\(\s*(\w+)\s*\)\.mount\s*\([^)]*(?:\([^)]*\)[^)]*)*\)/);
    if (barMatch && !fixed.includes("globalProperties")) {
      const [, varName, propName] = barMatch;
      const factoryLineRe = /(const\s*\{\s*app[^}]*\}\s*=\s*(?:createAppFactory|createApp)\s*\([^;]+\))\s*;?\s*\n/m;
      const factoryMatch = fixed.match(factoryLineRe);
      if (factoryMatch && !fixed.includes(`globalProperties.$${propName}`)) {
        fixed = fixed.replace(
          factoryLineRe,
          `$1\napp.config.globalProperties.$${propName} = ${varName}\n`
        );
        result.fixed = true;
      }
    }

    if (result.fixed) result.fixes.push("Fixed entry-client mount and globalProperties");
    result.content = fixed;
    return result;
  },
};

/**
 * Fix: entry-server - serialize Pinia state for SSR (refs/reactive → plain values)
 * Generic: applies when context.state = pinia.state.value (state contains refs that don't JSON.stringify)
 */
export const entryServerPiniaSerializeRule: FixRule = {
  id: "entry-server-pinia-serialize",
  description: "Serialize Pinia state for SSR (refs/reactive to plain)",
  priority: 90,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith("entry-server.js") || filePath.endsWith("entry-server.ts")) &&
      /context\.state\s*=\s*pinia\.state\.value/.test(content) &&
      !content.includes("serializePiniaState(")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;
    if (!fixed.includes("import { toRaw }")) {
      fixed = fixed.replace(
        /^import\s+\{\s*createApp\s*\}\s+from\s+['"]\.\/app['"]/,
        'import { toRaw } from "vue";\nimport { createApp } from "./app";'
      );
    }
    const fnBlock = `
function serializePiniaState(state) {
  if (state == null) return state;
  const seen = new WeakSet();
  function traverse(val) {
    if (val == null || typeof val !== "object") return val;
    if (seen.has(val)) return undefined;
    if (val && typeof val === "object" && "__v_isRef" in val) return traverse(val.value);
    if (typeof val === "function") return undefined;
    seen.add(val);
    if (Array.isArray(val)) return val.map(traverse);
    const raw = toRaw(val);
    const result = {};
    for (const k of Object.keys(raw)) {
      if (typeof raw[k] === "function") continue;
      result[k] = traverse(raw[k]);
    }
    return result;
  }
  return traverse(state);
}
`;
    if (!fixed.includes("function serializePiniaState")) {
      fixed = fixed.replace(/(const isDev = [^\n]+\n)\n/, `$1${fnBlock}\n`);
    }
    fixed = fixed.replace(
      /context\.state\s*=\s*pinia\.state\.value/,
      "context.state = serializePiniaState(pinia.state.value)"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added serializePiniaState for SSR state serialization");
    }
    return result;
  },
};

/**
 * Fix: entry-client - pass initialState to createApp for Pinia hydration
 * Generic: createAppFactory() → createAppFactory(null, { initialState: window.__INITIAL_STATE__ })
 */
export const entryClientPiniaHydrateRule: FixRule = {
  id: "entry-client-pinia-hydrate",
  description: "Pass initialState to createApp for Pinia SSR hydration",
  priority: 89,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith("entry-client.js") || filePath.endsWith("entry-client.ts")) &&
      /(?:createAppFactory|createApp)\s*\(\s*\)/.test(content) &&
      content.includes("pinia") &&
      !content.includes("initialState:")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content
      .replace(
        /const\s+\{\s*app,\s*router,\s*store[^}]*\}\s*=\s*(?:createAppFactory|createApp)\s*\(\s*\)/,
        "const { app, router, store, pinia } = createAppFactory(null, { initialState: window.__INITIAL_STATE__ })"
      )
      .replace(/\bpinia\.state\.value\s*=\s*window\.__INITIAL_STATE__\s*;?\s*\n?/g, "")
      .replace(/store\.replaceState\s*\(\s*window\.__INITIAL_STATE__\s*\)\s*;?\s*\n?/g, "");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Pass initialState to createApp for Pinia hydration");
    }
    return result;
  },
};

/**
 * Fix: entry-client - repair syntax corruption (wrong globalProperties value, orphan parens).
 * Runs after entryClientMountRule/entryClientPiniaHydrateRule to fix regressions.
 * Priority 87 (lower than mount 88, pinia 89) so it runs last on entry-client.
 */
export const entryClientSyntaxRepairRule: FixRule = {
  id: "entry-client-syntax-repair",
  description: "Repair entry-client syntax (globalProperties value, router structure)",
  priority: 87,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith("entry-client.js") && !filePath.endsWith("entry-client.ts")) return false;
    const wrongGlobalProp = /globalProperties\.\$\w+\s*=\s*createApp\s*[\s\n)]/.test(content);
    const orphanParenThen = /\n\)\s*\n\s+\.then\s*\(\s*\(\s*\)\s*=>\s*\{/.test(content);
    return wrongGlobalProp || orphanParenThen;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;

    // 1. Fix globalProperties.$bar = createApp → = bar (infer plugin var from const X = createApp(Component).mount)
    const barMatch = fixed.match(/const\s+(\w+)\s*=\s*createApp\s*\(\s*\w+\s*\)\.mount\s*\(/);
    const pluginVar = barMatch?.[1];
    if (pluginVar && /globalProperties\.\$\w+\s*=\s*createApp\b/.test(fixed)) {
      fixed = fixed.replace(
        /(globalProperties\.\$\w+\s*=\s*)createApp\b/,
        `$1${pluginVar}`
      );
      result.fixed = true;
    }

    // 2. Restore broken router structure: orphan ) + .then(() => { bar.finish... }) → router.isReady().then(() => { router.beforeResolve(...) Promise.all(...).then(...)
    const brokenBlock = fixed.match(
      /\n\)\s*\n(\s+)\.then\s*\(\s*\(\s*\)\s*=>\s*\{\s*\n\s+bar\.finish\s*\(\s*\)\s*\n\s+next\s*\(\s*\)\s*\n\s+\}\s*\)\s*\n\s+\.catch\s*\(\s*next\s*\)\s*\n(\s+)\}\s*\)\s*\n\s*\n(\s+\/\/\s*actually mount to DOM[\s\S]*?app\.mount\s*\(\s*['"]#app['"]\s*\)\s*\n\}\s*\))/i
    );
    if (brokenBlock) {
      const indent = brokenBlock[1];
      const rest = brokenBlock[3];
      const restored = `
router.isReady().then(() => {
  router.beforeResolve((to, from, next) => {
    const matched = router.resolve(to).matched.map(m => m.components?.default).filter(Boolean);
    const asyncDataHooks = matched.map(c => c?.asyncData).filter(Boolean);
    if (!asyncDataHooks.length) return next();
    bar.start?.();
    Promise.all(asyncDataHooks.map(hook => hook({ store, route: to })))
${indent}.then(() => {
${indent}  bar.finish()
${indent}  next()
${indent}})
${indent}.catch(next)
  })
${rest}`;
      fixed = fixed.replace(brokenBlock[0], restored);
      result.fixed = true;
    }

    if (result.fixed) result.fixes.push("Repaired entry-client syntax (globalProperties, router structure)");
    result.content = fixed;
    return result;
  },
};

// App factory file patterns (SSR + Pinia)
const APP_FACTORY_FILE = /(?:app|main|index)\.(js|ts)$/i;
// createApp(ssrContext) or createApp(context) or createApp()
const CREATE_APP_SIG = /export\s+function\s+createApp\s*\(\s*(?:\w*)\s*\)\s*\{/;

/**
 * Fix: app.js/main.js/index.js - accept opts.initialState for Pinia SSR hydration
 * Hydrate BEFORE app.use(pinia) so state exists when stores are first accessed (avoids items flash/disappear).
 * Generic: createApp(ssrContext|context|) → createApp(ssrContext, opts = {}) with pinia hydration
 */
export const appInitialStateRule: FixRule = {
  id: "app-initial-state",
  description: "Add opts.initialState for Pinia SSR hydration in createApp",
  priority: 88,
  shouldApply: (filePath, content) => {
    return (
      APP_FACTORY_FILE.test(filePath) &&
      content.includes("createPinia") &&
      CREATE_APP_SIG.test(content) &&
      !content.includes("opts.initialState")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const piniaVar = content.match(/const\s+(\w+)\s*=\s*createPinia/)?.[1];
    if (!piniaVar || !content.includes(`const ${piniaVar} = createPinia`)) return result;
    let fixed = content.replace(
      /export\s+function\s+createApp\s*\(\s*(\w*)\s*\)\s*\{/,
      (_, ctx) => `export function createApp(${ctx || "ssrContext"}, opts = {}) {`
    );
    fixed = fixed.replace(
      new RegExp(
        `(const\\s+${piniaVar}\\s*=\\s*createPinia\\s*\\(\\s*\\)\\s*;?\\s*\\n)(\\s*)(const\\s+\\w+\\s*=)`,
        "m"
      ),
      `$1  if (opts.initialState) ${piniaVar}.state.value = opts.initialState;\n$2$3`
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added opts.initialState for Pinia SSR hydration (before app.use)");
    }
    return result;
  },
};

/**
 * Fix: Move Pinia hydration BEFORE app.use(pinia) (avoids SSR items flash/disappear)
 * When hydration is after app.use, move it before so state exists when plugin initializes
 * Generic: works with any pinia variable name (pinia, piniaStore, etc.)
 */
export const piniaHydrationOrderRule: FixRule = {
  id: "pinia-hydration-order",
  description: "Move pinia.state.value hydration before app.use(pinia)",
  priority: 89,
  shouldApply: (filePath, content) => {
    if (!APP_FACTORY_FILE.test(filePath)) return false;
    const hydrationMatch = content.match(
      /if\s*\(\s*opts\.initialState\s*\)\s*(\w+)\.state\.value\s*=\s*opts\.initialState/
    );
    if (!hydrationMatch) return false;
    const piniaVar = hydrationMatch[1];
    const hydratIdx = content.indexOf(`${piniaVar}.state.value = opts.initialState`);
    const useIdx = content.indexOf(`app.use(${piniaVar})`);
    return useIdx !== -1 && hydratIdx > useIdx;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const hydrationMatch = content.match(
      /\s*if\s*\(\s*opts\.initialState\s*\)\s*(\w+)\.state\.value\s*=\s*opts\.initialState\s*;?\s*\n?/
    );
    if (!hydrationMatch) return result;
    const piniaVar = hydrationMatch[1];
    const piniaBlockMatch = content.match(
      new RegExp(`(const\\s+${piniaVar}\\s*=\\s*createPinia\\s*\\(\\s*\\)\\s*;?\\s*\\n)(\\s*)(const\\s+\\w+\\s*=)`, "m")
    );
    if (!piniaBlockMatch) return result;
    let fixed = content.replace(hydrationMatch[0], "");
    fixed = fixed.replace(
      new RegExp(
        `(const\\s+${piniaVar}\\s*=\\s*createPinia\\s*\\(\\s*\\)\\s*;?\\s*\\n)(\\s*)(const\\s+\\w+\\s*=)`,
        "m"
      ),
      `$1  if (opts.initialState) ${piniaVar}.state.value = opts.initialState;\n$2$3`
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Moved Pinia hydration before app.use(pinia)");
    }
    return result;
  },
};
