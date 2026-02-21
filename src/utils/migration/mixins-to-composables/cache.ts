/**
 * Cache for mixin → composable mapping (set by migrator, read by fix rule)
 */

export interface MixinComposableInfo {
  composableName: string;
  returnKeys: string[];
  composablePath: string;
}

let mixinMapCache: Map<string, MixinComposableInfo> | null = null;
let mixinMapProjectRoot: string | null = null;

export function setMixinComposablesMap(
  projectRoot: string,
  map: Map<string, MixinComposableInfo>
): void {
  mixinMapCache = map;
  mixinMapProjectRoot = projectRoot;
}

export function getMixinComposablesMap(
  projectRoot?: string
): Map<string, MixinComposableInfo> | null {
  if (!projectRoot) return null;
  if (mixinMapCache && mixinMapProjectRoot === projectRoot) {
    return mixinMapCache;
  }
  return null;
}

export function clearMixinComposablesMap(): void {
  mixinMapCache = null;
  mixinMapProjectRoot = null;
}
