/**
 * Rule groups - organizes fix rules by domain for clarity
 * RuleEngine sorts by priority, so group order doesn't affect execution
 */

import type { FixRule } from "../types";

// Core & SFC
import {
  scriptSetupTagSpaceRule,
  removeExportDefaultRule,
  scriptSetupThisEmitRule,
  scriptSetupFormattingRule,
  scriptSetupOrganizationRule,
} from "../rules/vue-script/vue-script-setup";
import {
  vModelEmitRule,
  vModelPropsRule,
  vModelRemoveModelOptionRule,
} from "../rules/vue-script/v-model-fixes";
import {
  scriptStyleInsideTemplateRule,
  orphanContentAfterStyleRule,
  functionalOptionRemovalRule,
  bindingExpressionDirectiveRule,
  scopedSlotsToSlotsRule,
} from "../rules/vue-script/vue-structure-fixes";

// Router
import { mainFileOrganizationRule } from "../rules/main/main-file-organization";
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
  mergeAsyncDataIntoDefineOptionsRule,
  defineOptionsTitleSetupRefRule,
  defineOptionsAsyncDataStoreRefRule,
  entryServerResolveAsyncComponentsRule,
  entryServerRouterCurrentRouteRule,
  entryClientMountRule,
  asyncDataStoreDispatchRule,
  storeDispatchToDirectRule,
  barIndexStoreFixRule,
  storePiniaStateFixRule,
  onBeforeUnmountAddLetDeclarationRule,
  onBeforeUnmountOptionalChainingRule,
  watchListPropsGuardRule,
  listsPropsGuardRule,
  loadItemsRefValueRule,
  onBeforeMountFetchRouteDataRule,
  propsTypeFallbackForRouterLinkRule,
  storeRouteSyncRule,
  storeSelfDispatchRule,
  storeActiveIdsRouteRule,
  entryServerPiniaSerializeRule,
  entryClientPiniaHydrateRule,
  entryClientSyntaxRepairRule,
  appInitialStateRule,
  piniaHydrationOrderRule,
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
  storeListBeforeItemsFlashRule,
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
  addMissingComposableDeclarationsRule,
  replaceThisRouterRouteRule,
  missingUseRouteImportRule,
  missingUseRouterImportRule,
  watchPropsRefRule,
  storeThemeBindingRule,
  secureRouterPushRule,
  routerPushTypeCheckRule,
  fixStoreMemberMismatchRule,
  storeRefsFromIndexStoreRule,
  thisStoreNameToUseStoreRule,
  childrenRemovedRule,
  thisBarToGetCurrentInstanceRule,
  removeDuplicateStoreGetCurrentInstanceRule,
  indexStoreDuplicateRule,
  storeIndexStoreRedundantRule,
  storeCommitToDirectInVueRule,
  thisStoreCommitToStoreRule,
  thisStoreToIndexStoreRule,
  nextTickFromGlobalPropertiesRule,
  rootIsMountedRule,
  thisRootIsMountedRule,
  thisNextTickRule,
  returnThisInScriptSetupRule,
} from "../rules/store/store-script-setup-fixes";

// Imports
import {
  fixConcatenatedImportsRule,
  missingVueImportsRule,
  splitImportsOnSameLineRule,
  removeVuexImportsRule,
  removeVueCompilerMacrosRule,
  mergeDuplicateImportsRule,
  duplicateSameIdentifierImportsRule,
  correctWrongStoreImportsRule,
  addMissingStoreImportsRule,
  vueSetRule,
  vueGlobalApiTreeshakeRule,
  fixMalformedDefineAsyncComponentRule,
  asyncComponentOptionsRule,
  dataImportConflictRule,
} from "../rules/import/import-fixes";

// Computed
import {
  computedValueRule,
  vueComputedExtraParenRule,
  malformedComputedRule,
  computedSyntaxRule,
  computedRefComparisonRule,
  refComparisonInCallbackRule,
  refPropertyAccessInGuardRule,
} from "../rules/computed/computed-fixes";

// Template
import {
  transitionGroupVue3Rule,
  vue2FilterPipeToFunctionRule,
  routerViewTransitionRule,
  transitionAsRootRule,
  functionalComponentRule,
  nativeModifierRemovalRule,
  vBindMergeOrderRule,
  vForVIfPrecedenceRule,
  keyAttributesRule,
  componentVariableShadowingRule,
  componentTagPascalCaseRule,
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
  overlayPointerEventsWhenHiddenRule,
  vModelBindingsRule,
  vitePublicPathRule,
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
import {
  concatenatedStatementsRule,
  missingCallParenRepairRule,
  removeDoubleSemicolonsRule,
  wrongStorePropertyRule,
  nullChecksLengthRule,
  detailViewStoreRule,
  mathCeilPaginationFallbackRule,
} from "../rules/final/final-fixes";
import { eventBusDetectionRule } from "../rules/event-bus/event-bus-fixes";
import { mixinsToComposablesRule } from "../rules/mixins/mixins-to-composables";
import {
  destructuringKeyValueParamRule,
  incorrectEventTypeRule,
  filtersKeyAccessRule,
  stripTypeScriptAnnotationsRule,
  typescriptTypeImprovementsRule,
} from "../rules/type/type-fixes";
import { processEnvToImportMetaRule } from "../rules/env/env-fixes";
import { vueStoreVuexToPiniaRule } from "../rules/store/vue-store-vuex";

// ---------------------------------------------------------------------------
// Rule groups (by domain - for documentation; execution order = by priority)
// ---------------------------------------------------------------------------

/** Core SFC and app bootstrap */
export const coreRules: FixRule[] = [
  scriptSetupTagSpaceRule,
  fixConcatenatedImportsRule,
  fixMalformedDefineAsyncComponentRule,
  removeExportDefaultRule,
  scriptSetupOrganizationRule,
  functionalOptionRemovalRule,
  bindingExpressionDirectiveRule,
  createAppSyntaxRule,
  scriptStyleInsideTemplateRule,
  orphanContentAfterStyleRule,
  scopedSlotsToSlotsRule,
  routerVueUseRemovalRule,
  routerSSRHistoryRule,
  ssrContextToInjectRule,
  createRouterConflictRule,
  vue2GlobalApiRule,
  mainFileOrganizationRule,
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
  mergeAsyncDataIntoDefineOptionsRule,
  defineOptionsTitleSetupRefRule,
  defineOptionsAsyncDataStoreRefRule,
  asyncDataStoreDispatchRule,
  storeDispatchModuleActionRule,
  storeDispatchToDirectRule,
  fixMalformedStoreDispatchRule,
  entryServerResolveAsyncComponentsRule,
  entryServerRouterCurrentRouteRule,
  entryServerPiniaSerializeRule,
  entryClientMountRule,
  entryClientPiniaHydrateRule,
  entryClientSyntaxRepairRule,
  appInitialStateRule,
  piniaHydrationOrderRule,
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
  storeListBeforeItemsFlashRule,
  storeComputedRefMissingValueRule,
  storeComputedResultRule,
  storeAddLoadingRule,
  storeEventTypeRule,
  storeReturnCurrentUserRule,
  removeVuexImportsRule,
  vueSetRule,
  vueGlobalApiTreeshakeRule,
  asyncComponentOptionsRule,
  removeVueCompilerMacrosRule,
  vModelEmitRule,
  vModelPropsRule,
  vModelRemoveModelOptionRule,
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
  computedRefComparisonRule,
  refComparisonInCallbackRule,
  refPropertyAccessInGuardRule,
  duplicateSymbolDeclarationRule,
  computedSyntaxRule,
  storeScriptSetupRule,
  mixinsToComposablesRule,
  addMissingComposableDeclarationsRule,
  replaceThisRouterRouteRule,
  missingUseRouteImportRule,
  missingUseRouterImportRule,
  watchPropsRefRule,
  storeRefsFromIndexStoreRule,
  thisStoreNameToUseStoreRule,
  storeThemeBindingRule,
  removeDuplicateStoreGetCurrentInstanceRule,
  removeErroneousRefForSkippedVarsRule,
  fixCorruptedArrowFunctionRule,
  childrenRemovedRule,
  thisBarToGetCurrentInstanceRule,
  secureRouterPushRule,
  thisStoreToIndexStoreRule,
  nextTickFromGlobalPropertiesRule,
  rootIsMountedRule,
  thisRootIsMountedRule,
  thisNextTickRule,
  returnThisInScriptSetupRule,
  indexStoreDuplicateRule,
  storeIndexStoreRedundantRule,
  routerPushTypeCheckRule,
  storeCommitToDirectInVueRule,
  thisStoreCommitToStoreRule,
  watchListPropsGuardRule,
  listsPropsGuardRule,
  loadItemsRefValueRule,
  onBeforeMountFetchRouteDataRule,
  propsTypeFallbackForRouterLinkRule,
  onBeforeUnmountAddLetDeclarationRule,
  scriptSetupUndeclaredVarsRule,
  loadingRefRule,
  onBeforeUnmountOptionalChainingRule,
];

/** Template fixes */
export const templateRules: FixRule[] = [
  transitionGroupVue3Rule,
  vue2FilterPipeToFunctionRule,
  routerViewTransitionRule,
  transitionAsRootRule,
  functionalComponentRule,
  nativeModifierRemovalRule,
  vBindMergeOrderRule,
  vForVIfPrecedenceRule,
  keyAttributesRule,
  componentVariableShadowingRule,
  componentTagPascalCaseRule,
  missingComponentImportsRule,
  webpackPublicAliasRule,
  vitePublicPathRule,
  templateAdjacentMustacheSpacingRule,
  templateInterpolationParensRule,
  routerLinkUserContentRule,
  timeAgoWrongArgRule,
  hostWrongArgRule,
  templateCurrencyNonNumericRule,
  templateFilterFunctionImportsRule,
  missingFilterImportsRule,
  eventBusDetectionRule,
  overlayPointerEventsWhenHiddenRule,
  vModelBindingsRule,
];

/** Final and formatting - lowest priority */
export const finalRules: FixRule[] = [
  concatenatedStatementsRule,
  missingCallParenRepairRule,
  removeDoubleSemicolonsRule,
  duplicateKeysRule,
  mergeDuplicateImportsRule,
  typescriptTypeImprovementsRule,
  stripTypeScriptAnnotationsRule,
  wrongStorePropertyRule,
  nullChecksLengthRule,
  detailViewStoreRule,
  mathCeilPaginationFallbackRule,
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
