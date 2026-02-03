/**
 * Main entry point for post-migration fixer
 * Uses optimized rule engine for single-pass execution
 */

import { RuleEngine } from "./rule-engine";
import type { FixResult, FixContext } from "./types";
import { scriptSetupTagSpaceRule, removeExportDefaultRule, scriptSetupThisEmitRule, scriptSetupFormattingRule } from "./rules/vue-script-setup";
import {
  asyncFunctionRule,
  storeIndexRemoveObsoleteImportsRule,
  storeIndexNamedExportRule,
  storeDefineStoreClosingRule,
  storeVuexGettersDispatchRule,
  storeCommitToDirectRule,
  storeGettersToRefRule,
  storeComputedResultRule,
  storeAddLoadingRule,
  storeEventTypeRule,
  storeReturnCurrentUserRule,
  duplicateKeysRule,
  piniaStoreCrossStoreDepsRule
} from "./rules/store-fixes";
import { createAppSyntaxRule, vue2GlobalApiRule, createWebHistoryRule, routerGuardPiniaRule, catchAllRouteRule, routeQueryRedirectGuardRule, routerPushNameParamsToPathRule } from "./rules/router-fixes";
import { missingVueImportsRule, splitImportsOnSameLineRule, removeVuexImportsRule, removeVueCompilerMacrosRule, mergeDuplicateImportsRule, duplicateSameIdentifierImportsRule, correctWrongStoreImportsRule, addMissingStoreImportsRule } from "./rules/import-fixes";
import { computedValueRule, vueComputedExtraParenRule, malformedComputedRule, computedSyntaxRule } from "./rules/computed-fixes";
import { templateInterpolationParensRule, templateCurrencyNonNumericRule, missingComponentImportsRule, templateFilterFunctionImportsRule, missingFilterImportsRule, vModelBindingsRule } from "./rules/template-fixes";
import { wrongStorePropertyRule, nullChecksLengthRule, detailViewStoreRule } from "./rules/final-fixes";
import { destructuringKeyValueParamRule, incorrectEventTypeRule, filtersKeyAccessRule, stripTypeScriptAnnotationsRule, typescriptTypeImprovementsRule } from "./rules/type-fixes";
import { vueStoreVuexToPiniaRule } from "./rules/vue-store-vuex";
import { storeScriptSetupRule, replaceThisRouterRouteRule, missingUseRouteImportRule, missingUseRouterImportRule, watchPropsRefRule, storeThemeBindingRule, secureRouterPushRule, routerPushTypeCheckRule, fixStoreMemberMismatchRule } from "./rules/store-script-setup-fixes";
import { formatWithPrettier } from "../prettier-formatter";
import { astCache } from "./utils/ast-cache";

// Initialize rule engine with all rules
const ruleEngine = new RuleEngine();

// Register all rules in priority order (higher priority = runs first)
ruleEngine.registerRules([
  // High priority: Core fixes that other rules depend on
  scriptSetupTagSpaceRule,         // Priority 99 (<scriptsetup → <script setup)
  removeExportDefaultRule,        // Priority 100 (remove export default in script setup)
  createAppSyntaxRule,            // Priority 95
  vue2GlobalApiRule,              // Priority 94 (Vue.filter, app.mixin when not imported, etc.)
  createWebHistoryRule,           // Priority 94
  routerGuardPiniaRule,           // Priority 93 (router.app.$store → Pinia in guard)
  catchAllRouteRule,              // Priority 93
  routeQueryRedirectGuardRule,   // Priority 92 (route.query.redirect → typeof check)
  routerPushNameParamsToPathRule, // Priority 91 (router.push name+params → path)
  missingVueImportsRule,          // Priority 91 (add ref/computed/watch when used but not imported)
  splitImportsOnSameLineRule,      // Priority 92 (split ';import on same line)
  asyncFunctionRule,              // Priority 90
  storeIndexNamedExportRule,      // Priority 78 (store/index: add useIndexStore export)
  storeIndexRemoveObsoleteImportsRule, // Priority 79 (remove default module imports + Vue)
  storeDefineStoreClosingRule,    // Priority 79 (}; }; }); → } });)
  storeVuexGettersDispatchRule,   // Priority 89 (getters/dispatch → storeVar in stores)
  piniaStoreCrossStoreDepsRule,   // Priority 88 (store using another store)
  storeCommitToDirectRule,        // Priority 87 (commit → SET_LOADING etc.)
  storeGettersToRefRule,          // Priority 86 (getters.xxx → xxx.value)
  storeComputedResultRule,        // Priority 85 (computed(() => result) → filter logic)
  storeAddLoadingRule,            // Priority 84 (add loading + SET_LOADING if missing)
  storeEventTypeRule,             // Priority 83 (Event → any in params)
  storeReturnCurrentUserRule,     // Priority 82 (key: keyComputed in return, generic)
  removeVuexImportsRule,          // Priority 85
  removeVueCompilerMacrosRule,   // Priority 86 (defineProps/defineEmits)
  scriptSetupThisEmitRule,       // Priority 85 (this.$emit → emit in script setup)
  vueStoreVuexToPiniaRule,       // Priority 84 (this.$store.getters/dispatch → Pinia in .vue)
  fixStoreMemberMismatchRule,    // Priority 80 (indexStore.fetchUser → userStore when member belongs to other store)
  duplicateSameIdentifierImportsRule, // Priority 84 (same identifier from different paths + duplicate const)
  correctWrongStoreImportsRule,   // Priority 82
  addMissingStoreImportsRule,     // Priority 81

  // Type fixes
  destructuringKeyValueParamRule, // Priority 86 ({ key: any, value } → proper destructuring)
  incorrectEventTypeRule,         // Priority 88
  filtersKeyAccessRule,           // Priority 87
  
  // Computed fixes
  computedValueRule,               // Priority 80
  vueComputedExtraParenRule,       // Priority 72 (})); → });)
  malformedComputedRule,          // Priority 75
  computedSyntaxRule,             // Priority 70
  
  // Store script setup fixes
  storeScriptSetupRule,           // Priority 70
  replaceThisRouterRouteRule,     // Priority 68 (this.$router/this.$route → useRouter/useRoute)
  missingUseRouteImportRule,       // Priority 69 (useRoute() used but not imported → add to vue-router)
  missingUseRouterImportRule,      // Priority 69 (useRouter() used but not imported → add to vue-router)
  watchPropsRefRule,              // Priority 67 (watch(() => prop.value) → watch(() => props.prop))
  storeThemeBindingRule,         // Priority 66 (currentTheme from appStore when v-model currentTheme)
  secureRouterPushRule,           // Priority 65
  routerPushTypeCheckRule,        // Priority 64
  
  // Template fixes
  missingComponentImportsRule,     // Priority 60
  templateInterpolationParensRule,  // Priority 58 ({{ expr) }} / {{ fn(arg }} → fix parens)
  templateCurrencyNonNumericRule,   // Priority 57 (currency(.name/.category) → remove currency)
  templateFilterFunctionImportsRule, // Priority 56 ({{ capitalize() }} → import from @/filters)
  missingFilterImportsRule,        // Priority 55
  vModelBindingsRule,             // Priority 50
  
  // Medium priority: Dependent fixes
  duplicateKeysRule,              // Priority 20
  mergeDuplicateImportsRule,      // Priority 15
  typescriptTypeImprovementsRule, // Priority 12 (only when --typescript)
  stripTypeScriptAnnotationsRule, // Priority 11: strip TS annotations when not --typescript
  
  // Low priority: Final fixes (runs near end)
  wrongStorePropertyRule,         // Priority 5
  nullChecksLengthRule,           // Priority 4
  detailViewStoreRule,            // Priority 3
  
  // Very low priority: Formatting (runs last)
  scriptSetupFormattingRule,      // Priority 10
]);

/**
 * Main function: Fix post-migration issues using optimized rule engine
 * This replaces the old fixPostMigrationIssues function
 */
export async function fixPostMigrationIssues(
  filePath: string,
  content: string,
  enableTypeScript: boolean = false,
  projectRoot?: string
): Promise<FixResult> {
  const isVueFile = filePath.endsWith(".vue");
  
  // Use AST cache for performance (parse once, reuse for all rules)
  const cachedAST = astCache.get(filePath, content);
  
  const context: FixContext = {
    enableTypeScript,
    projectRoot,
    isVueFile,
    scriptContent: cachedAST.scriptContent,
    templateContent: cachedAST.templateContent,
    astCache: cachedAST
  };

  // Execute all rules in a single optimized pass
  const result = await ruleEngine.execute(filePath, content, context);

  // Update AST cache if content changed
  if (result.fixed) {
    astCache.update(filePath, result.content);
  }

  // Final formatting with Prettier
  if (result.fixed) {
    try {
      const prettierFormatted = await formatWithPrettier(filePath, result.content, projectRoot);
      if (prettierFormatted !== result.content) {
        result.content = prettierFormatted;
        if (!result.fixes.some(f => f.includes("Prettier"))) {
          result.fixes.push("Formatted code with Prettier");
        }
      }
    } catch {
      // Prettier not available, continue
    }
  }

  return result;
}

/**
 * Export rule engine for testing and advanced usage
 */
export { ruleEngine };

/**
 * Export parallel processor utilities
 */
export { processFilesInParallel, getOptimalConcurrency } from "./utils/parallel-processor";

/**
 * Clear store analysis cache (for compatibility)
 */
export { clearStoreAnalysisCache } from "./utils/store-analysis-cache";

/**
 * Re-export fixImportPaths for migration pipeline compatibility
 */
export { fixImportPaths } from "../import-paths";
