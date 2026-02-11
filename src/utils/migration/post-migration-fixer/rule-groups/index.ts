/**
 * Rule groups - organizes fix rules by domain for clarity
 * RuleEngine sorts by priority, so group order doesn't affect execution
 */

import type { FixRule } from "../types";

// Core & SFC
import { scriptSetupTagSpaceRule, removeExportDefaultRule, scriptSetupThisEmitRule, scriptSetupFormattingRule } from "../rules/vue-script/vue-script-setup";
import { scriptStyleInsideTemplateRule } from "../rules/vue-script/vue-structure-fixes";

// Router
import {
  createAppSyntaxRule,
  createRouterConflictRule,
  vue2GlobalApiRule,
  createWebHistoryRule,
  routerGuardPiniaRule,
  catchAllRouteRule,
  routeQueryRedirectGuardRule,
  routerPushNameParamsToPathRule,
  routerDefineAsyncComponentUnwrapRule,
} from "../rules/router/router-fixes";

// SSR
import {
  routerVueUseRemovalRule,
  ssrContextToInjectRule,
  routerSSRHistoryRule,
  asyncDataStoreDispatchRule,
  storeDispatchToDirectRule,
  barIndexStoreFixRule,
  storePiniaStateFixRule,
  onBeforeUnmountAddLetDeclarationRule,
  onBeforeUnmountOptionalChainingRule,
  watchListPropsGuardRule,
  listsPropsGuardRule,
  storeRouteSyncRule,
  storeSelfDispatchRule,
  storeActiveIdsRouteRule,
} from "../rules/ssr/ssr-fixes";

// Store
import {
  asyncFunctionRule,
  storeIndexRemoveObsoleteImportsRule,
  storeIndexNamedExportRule,
  storeCreateStoreToUseIndexRule,
  storeDefineStoreClosingRule,
  storeVuexGettersDispatchRule,
  storeRemoveUnnecessaryAsyncRule,
  storeCommitToDirectRule,
  storeGettersToRefRule,
  storeSetItemsParamShadowRule,
  storeComputedRefMissingValueRule,
  storeComputedResultRule,
  storeAddLoadingRule,
  storeEventTypeRule,
  storeReturnCurrentUserRule,
  duplicateKeysRule,
  piniaStoreCrossStoreDepsRule,
  storeAddMissingAuthMethodsRule,
} from "../rules/store/store-fixes";

// Store script setup
import {
  storeDispatchModuleActionRule,
  fixMalformedStoreDispatchRule,
  storeScriptSetupRule,
  replaceThisRouterRouteRule,
  missingUseRouteImportRule,
  missingUseRouterImportRule,
  watchPropsRefRule,
  storeThemeBindingRule,
  secureRouterPushRule,
  routerPushTypeCheckRule,
  fixStoreMemberMismatchRule,
  storeRefsFromIndexStoreRule,
  thisBarToGetCurrentInstanceRule,
  removeDuplicateStoreGetCurrentInstanceRule,
  indexStoreDuplicateRule,
  thisStoreCommitToStoreRule,
  thisStoreToIndexStoreRule,
  thisRootIsMountedRule,
  thisNextTickRule,
  returnThisInScriptSetupRule,
} from "../rules/store/store-script-setup-fixes";

// Imports
import {
  missingVueImportsRule,
  splitImportsOnSameLineRule,
  removeVuexImportsRule,
  removeVueCompilerMacrosRule,
  mergeDuplicateImportsRule,
  duplicateSameIdentifierImportsRule,
  correctWrongStoreImportsRule,
  addMissingStoreImportsRule,
  vueSetRule,
  dataImportConflictRule,
} from "../rules/import/import-fixes";

// Computed
import { computedValueRule, vueComputedExtraParenRule, malformedComputedRule, computedSyntaxRule } from "../rules/computed/computed-fixes";

// Template
import {
  routerViewTransitionRule,
  componentVariableShadowingRule,
  webpackPublicAliasRule,
  templateAdjacentMustacheSpacingRule,
  templateInterpolationParensRule,
  routerLinkUserContentRule,
  timeAgoWrongArgRule,
  templateCurrencyNonNumericRule,
  missingComponentImportsRule,
  hostWrongArgRule,
  templateFilterFunctionImportsRule,
  missingFilterImportsRule,
  vModelBindingsRule,
} from "../rules/template/template-fixes";

// Vue structure
import {
  duplicateSymbolDeclarationRule,
  scriptSetupUndeclaredVarsRule,
  loadingRefRule,
  fixCorruptedArrowFunctionRule,
  removeErroneousRefForSkippedVarsRule,
} from "../rules/vue-script/vue-structure-fixes";

// Other
import { wrongStorePropertyRule, nullChecksLengthRule, detailViewStoreRule } from "../rules/final/final-fixes";
import { eventBusDetectionRule } from "../rules/event-bus/event-bus-fixes";
import { destructuringKeyValueParamRule, incorrectEventTypeRule, filtersKeyAccessRule, stripTypeScriptAnnotationsRule, typescriptTypeImprovementsRule } from "../rules/type/type-fixes";
import { processEnvToImportMetaRule } from "../rules/env/env-fixes";
import { vueStoreVuexToPiniaRule } from "../rules/store/vue-store-vuex";

// ---------------------------------------------------------------------------
// Rule groups (by domain - for documentation; execution order = by priority)
// ---------------------------------------------------------------------------

/** Core SFC and app bootstrap */
export const coreRules: FixRule[] = [
  scriptSetupTagSpaceRule,
  removeExportDefaultRule,
  createAppSyntaxRule,
  scriptStyleInsideTemplateRule,
  routerVueUseRemovalRule,
  routerSSRHistoryRule,
  ssrContextToInjectRule,
  createRouterConflictRule,
  vue2GlobalApiRule,
  createWebHistoryRule,
  routerGuardPiniaRule,
  catchAllRouteRule,
  routeQueryRedirectGuardRule,
  routerPushNameParamsToPathRule,
  routerDefineAsyncComponentUnwrapRule,
  missingVueImportsRule,
  splitImportsOnSameLineRule,
  dataImportConflictRule,
  asyncFunctionRule,
];

/** Store: Pinia, Vuex migration, dispatch, getters */
export const storeRules: FixRule[] = [
  storeIndexNamedExportRule,
  storeAddMissingAuthMethodsRule,
  storeCreateStoreToUseIndexRule,
  storeRouteSyncRule,
  storeActiveIdsRouteRule,
  storeSelfDispatchRule,
  processEnvToImportMetaRule,
  asyncDataStoreDispatchRule,
  storeDispatchModuleActionRule,
  storeDispatchToDirectRule,
  fixMalformedStoreDispatchRule,
  barIndexStoreFixRule,
  storePiniaStateFixRule,
  storeIndexRemoveObsoleteImportsRule,
  storeDefineStoreClosingRule,
  storeVuexGettersDispatchRule,
  storeRemoveUnnecessaryAsyncRule,
  piniaStoreCrossStoreDepsRule,
  storeCommitToDirectRule,
  storeGettersToRefRule,
  storeSetItemsParamShadowRule,
  storeComputedRefMissingValueRule,
  storeComputedResultRule,
  storeAddLoadingRule,
  storeEventTypeRule,
  storeReturnCurrentUserRule,
  removeVuexImportsRule,
  vueSetRule,
  removeVueCompilerMacrosRule,
  scriptSetupThisEmitRule,
  vueStoreVuexToPiniaRule,
  fixStoreMemberMismatchRule,
  duplicateSameIdentifierImportsRule,
  correctWrongStoreImportsRule,
  addMissingStoreImportsRule,
];

/** Type fixes */
export const typeRules: FixRule[] = [
  destructuringKeyValueParamRule,
  incorrectEventTypeRule,
  filtersKeyAccessRule,
];

/** Computed and script setup */
export const computedAndScriptSetupRules: FixRule[] = [
  computedValueRule,
  vueComputedExtraParenRule,
  malformedComputedRule,
  duplicateSymbolDeclarationRule,
  computedSyntaxRule,
  storeScriptSetupRule,
  replaceThisRouterRouteRule,
  missingUseRouteImportRule,
  missingUseRouterImportRule,
  watchPropsRefRule,
  storeRefsFromIndexStoreRule,
  storeThemeBindingRule,
  removeDuplicateStoreGetCurrentInstanceRule,
  removeErroneousRefForSkippedVarsRule,
  fixCorruptedArrowFunctionRule,
  thisBarToGetCurrentInstanceRule,
  secureRouterPushRule,
  thisStoreToIndexStoreRule,
  thisRootIsMountedRule,
  thisNextTickRule,
  returnThisInScriptSetupRule,
  indexStoreDuplicateRule,
  routerPushTypeCheckRule,
  thisStoreCommitToStoreRule,
  watchListPropsGuardRule,
  listsPropsGuardRule,
  onBeforeUnmountAddLetDeclarationRule,
  scriptSetupUndeclaredVarsRule,
  loadingRefRule,
  onBeforeUnmountOptionalChainingRule,
];

/** Template fixes */
export const templateRules: FixRule[] = [
  routerViewTransitionRule,
  componentVariableShadowingRule,
  missingComponentImportsRule,
  webpackPublicAliasRule,
  templateAdjacentMustacheSpacingRule,
  templateInterpolationParensRule,
  routerLinkUserContentRule,
  timeAgoWrongArgRule,
  hostWrongArgRule,
  templateCurrencyNonNumericRule,
  templateFilterFunctionImportsRule,
  missingFilterImportsRule,
  eventBusDetectionRule,
  vModelBindingsRule,
];

/** Final and formatting - lowest priority */
export const finalRules: FixRule[] = [
  duplicateKeysRule,
  mergeDuplicateImportsRule,
  typescriptTypeImprovementsRule,
  stripTypeScriptAnnotationsRule,
  wrongStorePropertyRule,
  nullChecksLengthRule,
  detailViewStoreRule,
  scriptSetupFormattingRule,
];

/** All rules in one flat array */
export const allRules: FixRule[] = [
  ...coreRules,
  ...storeRules,
  ...typeRules,
  ...computedAndScriptSetupRules,
  ...templateRules,
  ...finalRules,
];
