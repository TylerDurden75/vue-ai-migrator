/**
 * Centralized store analysis cache
 * Provides a shared cache across all rules to avoid redundant store analysis
 */

import { analyzePiniaStores, analyzeMainStore, type MainStoreInfo } from "./store-analyzer";

// Cache for store analysis to avoid re-analyzing on every file
let storeAnalysisCache: Map<string, string> | null = null;
let storeAnalysisProjectRoot: string | null = null;

// Cache for main store info (useXStore, @/store/index, etc.)
let mainStoreInfoCache: MainStoreInfo | null = null;
let mainStoreInfoProjectRoot: string | null = null;

/**
 * Get store analysis for a project, using cache if available
 */
export async function getStoreAnalysis(
  projectRoot: string
): Promise<Map<string, string> | null> {
  // Use cache if available and for same project
  if (!storeAnalysisCache || storeAnalysisProjectRoot !== projectRoot) {
    try {
      storeAnalysisCache = await analyzePiniaStores(projectRoot);
      storeAnalysisProjectRoot = projectRoot;
    } catch (error) {
      // If analysis fails, return null
      storeAnalysisCache = null;
      storeAnalysisProjectRoot = null;
      return null;
    }
  }

  return storeAnalysisCache;
}

/**
 * Get store method map as a Record for easier use
 */
export async function getStoreMethodMap(
  projectRoot: string
): Promise<Record<string, string>> {
  const analysis = await getStoreAnalysis(projectRoot);
  
  if (!analysis || analysis.size === 0) {
    return {};
  }

  const storeMethodMap: Record<string, string> = {};
  analysis.forEach((module, method) => {
    storeMethodMap[method] = module;
  });

  return storeMethodMap;
}

/**
 * Get main store info (useXStore, storeVar, importPath) - cached per project
 */
export async function getMainStoreInfo(
  projectRoot?: string
): Promise<MainStoreInfo> {
  if (!projectRoot) {
    const { analyzeMainStore } = await import("./store-analyzer");
    return analyzeMainStore(process.cwd());
  }
  if (mainStoreInfoCache && mainStoreInfoProjectRoot === projectRoot) {
    return mainStoreInfoCache;
  }
  mainStoreInfoCache = await analyzeMainStore(projectRoot);
  mainStoreInfoProjectRoot = projectRoot;
  return mainStoreInfoCache;
}

/**
 * Get store config (storeVar, storeName, importPath) for a module name.
 * When module is "index" (main store), uses mainStoreInfo if available for project-agnostic naming.
 * Otherwise derives from module name (user → useUserStore, userStore, @/store/modules/user).
 */
export function getStoreConfigForModule(
  module: string,
  mainStoreInfo?: MainStoreInfo | null
): { storeVar: string; storeName: string; importPath: string } {
  if (module === "index" && mainStoreInfo) {
    return {
      storeVar: mainStoreInfo.storeVar,
      storeName: mainStoreInfo.storeName,
      importPath: mainStoreInfo.importPath,
    };
  }
  if (module === "index") {
    return { storeVar: "indexStore", storeName: "useIndexStore", importPath: "@/store/index" };
  }
  const storeVar = `${module}Store`;
  const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
  const importPath = `@/store/modules/${module}`;
  return { storeVar, storeName, importPath };
}

/**
 * Clear the store analysis cache
 * Useful for testing or when stores are modified
 */
export function clearStoreAnalysisCache(): void {
  storeAnalysisCache = null;
  storeAnalysisProjectRoot = null;
  mainStoreInfoCache = null;
  mainStoreInfoProjectRoot = null;
}

/**
 * Check if cache is available for a project
 */
export function hasStoreAnalysisCache(projectRoot: string): boolean {
  return storeAnalysisCache !== null && storeAnalysisProjectRoot === projectRoot;
}
