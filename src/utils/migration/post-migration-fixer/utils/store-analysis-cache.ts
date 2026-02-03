/**
 * Centralized store analysis cache
 * Provides a shared cache across all rules to avoid redundant store analysis
 */

import { analyzePiniaStores } from "./store-analyzer";

// Cache for store analysis to avoid re-analyzing on every file
let storeAnalysisCache: Map<string, string> | null = null;
let storeAnalysisProjectRoot: string | null = null;

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
 * Clear the store analysis cache
 * Useful for testing or when stores are modified
 */
export function clearStoreAnalysisCache(): void {
  storeAnalysisCache = null;
  storeAnalysisProjectRoot = null;
}

/**
 * Check if cache is available for a project
 */
export function hasStoreAnalysisCache(projectRoot: string): boolean {
  return storeAnalysisCache !== null && storeAnalysisProjectRoot === projectRoot;
}
