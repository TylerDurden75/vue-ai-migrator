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
 * Fix: Add setRoute and currentRoute to store when activeIds uses route pagination.
 * Required for app.js router.afterEach(store.setRoute) and SSR.
 */
export const storeRouteSyncRule: FixRule = {
  id: "store-route-sync",
  description: "Add setRoute and currentRoute to store for router sync (SSR + activeIds pagination)",
  priority: 76,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith("store/index.js") || filePath.endsWith("store/index.ts")) &&
           content.includes("defineStore") &&
           content.includes("activeIds") &&
           /\.slice\s*\(\s*start\s*,\s*end\s*\)/.test(content) &&
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

    let fixed = content;

    // Add currentRoute ref after itemsPerPage (or after first ref)
    if (!fixed.includes("currentRoute")) {
      const refMatch = fixed.match(/(const itemsPerPage = ref\(\d+\);\s*\n)/);
      if (refMatch) {
        fixed = fixed.replace(
          refMatch[1],
          refMatch[1] + "  const currentRoute = ref(null);\n"
        );
      } else {
        const firstRef = fixed.match(/(const \w+ = ref\([^)]+\);\s*\n)/);
        if (firstRef) {
          fixed = fixed.replace(firstRef[1], firstRef[1] + "  const currentRoute = ref(null);\n");
        }
      }
    }

    // Add setRoute function before return
    if (!fixed.includes("function setRoute") && !fixed.includes("setRoute(to)")) {
      const returnMatch = fixed.match(/(\s+return\s*\{)/);
      if (returnMatch) {
        const setRouteFn = `
  function setRoute(to) {
    currentRoute.value = to;
  }

`;
        fixed = fixed.replace(returnMatch[1], setRouteFn + returnMatch[1]);
      }
    }

    // Add setRoute and currentRoute to return object (generic: before closing }; of store return)
    if (!fixed.includes("setRoute: setRoute") && !/setRoute\s*,?\s*currentRoute/.test(fixed)) {
      let added = fixed.replace(
        /(FETCH_USER:\s*FETCH_USER)(\s*)(\};?\s*\}\);?)/,
        "$1,$2setRoute: setRoute,\n    currentRoute: currentRoute,$2$3"
      );
      if (added === fixed) {
        added = fixed.replace(
          /(\n)(\s*)(\};)(\s*\}\);?)(\s*)$/,
          "$1$2,$2setRoute: setRoute,$2currentRoute: currentRoute$2$3$4"
        );
      }
      if (added !== fixed) fixed = added;
    }

    // Fix activeIds: lists[activeType].slice(start, end) -> use currentRoute for page
    if (/lists\[activeType\]\.slice\s*\(\s*start\s*,\s*end\s*\)/.test(fixed)) {
      fixed = fixed.replace(
        /const activeIds = computed\(\(\) => \(?lists\[activeType\]\.slice\(start, end\)\)?\);?/,
        `const activeIds = computed(() => {
    if (!activeType.value) return [];
    const page = Number(currentRoute.value?.params?.page) || 1;
    const start = (page - 1) * itemsPerPage.value;
    const end = page * itemsPerPage.value;
    return lists[activeType.value].slice(start, end);
  });`
      );
    }

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added setRoute, currentRoute for router sync");
    }
    return result;
  },
};

/**
 * Fix: activeIds using slice(start, end) with undefined vars → use currentRoute for pagination.
 * Runs even when setRoute already exists (fixes activeIds in second pass).
 */
export const storeActiveIdsRouteRule: FixRule = {
  id: "store-active-ids-route",
  description: "Fix activeIds to use currentRoute for pagination",
  priority: 75,
  shouldApply: (filePath, content) => {
    return (filePath.endsWith("store/index.js") || filePath.endsWith("store/index.ts")) &&
           content.includes("defineStore") &&
           content.includes("currentRoute") &&
           /lists\[activeType\]\.slice\s*\(\s*start\s*,\s*end\s*\)/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    if (content.includes("currentRoute.value?.params?.page")) return result;
    const fixed = content.replace(
      /const activeIds = computed\(\(\) => \(?lists\[activeType\]\.slice\(start, end\)\)?\);?/,
      `const activeIds = computed(() => {
    if (!activeType.value) return [];
    const page = Number(currentRoute.value?.params?.page) || 1;
    const start = (page - 1) * itemsPerPage.value;
    const end = page * itemsPerPage.value;
    return lists[activeType.value].slice(start, end);
  });`
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed activeIds to use currentRoute for pagination");
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

/**
 * Fix: varName.indexStore.X / varName.store.X → varName.X when varName is NOT a store.
 * Generic: plugin/bar from getCurrentInstance().$xxx has no .store/.indexStore - applies to any varName.
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
    const fixed = content.replace(/\b(\w+)\.(?:indexStore|store)\./g, (match, varName) =>
      STORE_LIKE.test(varName) ? match : `${varName}.`
    );
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
 * Pattern: unwatchList = watchList(...) in onBeforeMount or onMounted, unwatchList() in onBeforeUnmount, but no let unwatchList
 */
export const onBeforeUnmountAddLetDeclarationRule: FixRule = {
  id: "on-before-unmount-add-let",
  description: "Add let declaration for cleanup var used in onBeforeUnmount",
  priority: 63,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("onBeforeUnmount")) return false;
    const assignMatch = content.match(/(\w+)\s*=\s*(?:watchList|watch)\s*\(/);
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
    const assignMatch = content.match(/(\w+)\s*=\s*(?:watchList|watch)\s*\(/);
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
 * Fix: storeVar.lists[props.X].length when props.X may be undefined (SSR)
 * Prevents "Cannot read properties of undefined (reading 'length')". Generic for any store.
 */
export const listsPropsGuardRule: FixRule = {
  id: "lists-props-guard",
  description: "Add ?? [] for storeVar.lists[props.X] when props may be undefined (SSR)",
  priority: 60,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      /(\w+)\.lists\[props\.\w+\]\.(length|slice)/.test(content) &&
      !/\.lists\[props\.\w+\]\s*\?\?/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(
      /(\w+)\.lists\[props\.(\w+)\]\.(length|slice)/g,
      "($1.lists[props.$2] ?? []).$3"
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added ?? [] for storeVar.lists[props.X] (SSR guard)");
    }
    return result;
  },
};
