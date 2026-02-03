/**
 * Regex cache for performance optimization
 * Compiles regex patterns once and reuses them
 */

class RegexCache {
  private cache: Map<string, RegExp> = new Map();

  /**
   * Get or create a regex pattern
   */
  get(pattern: string, flags?: string): RegExp {
    const key = `${pattern}::${flags || ""}`;
    
    if (!this.cache.has(key)) {
      this.cache.set(key, new RegExp(pattern, flags));
    }
    
    return this.cache.get(key)!;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

// Singleton instance
export const regexCache = new RegexCache();

/**
 * Helper function to get cached regex
 */
export function getCachedRegex(pattern: string, flags?: string): RegExp {
  return regexCache.get(pattern, flags);
}
