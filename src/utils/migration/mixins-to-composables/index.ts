/**
 * Mixins → composables migration
 */

export {
  analyzeMixin,
  looksLikeMixin,
  type MixinAnalysis,
} from "./mixin-analyzer";
export {
  mixinNameToComposable,
  composableNameToProvideKey,
  getMixinReturnKeys,
  generateComposableFromMixin,
} from "./composable-gen";
export {
  setMixinComposablesMap,
  getMixinComposablesMap,
  clearMixinComposablesMap,
  type MixinComposableInfo,
} from "./cache";
