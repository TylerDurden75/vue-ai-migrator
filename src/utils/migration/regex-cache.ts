/**
 * Regex cache for post-migration fixer
 * Compiles and caches frequently used regex patterns for better performance
 */

class RegexCache {
  private cache = new Map<string, RegExp>();

  /**
   * Get or create a regex pattern
   */
  get(pattern: string, flags?: string): RegExp {
    const key = `${pattern}::${flags || ''}`;
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

// Pre-compile common patterns for immediate use
export const commonPatterns = {
  // Vue imports
  vueImport: regexCache.get('import\\s+.*\\{([^}]+)\\}\s+from\\s+[\'"]vue[\'"]'),
  vueImportMatch: regexCache.get('import\\s+.*\\{([^}]+)\\}\s+from\\s+[\'"]vue[\'"]'),
  
  // Store patterns
  storeDeclaration: regexCache.get('const\\s+(\\w+Store)\\s*=\\s*(use\\w+Store)\\(\\)', 'g'),
  storeImport: regexCache.get('import\\s+.*\\{([^}]*)\\}\s+from\\s+[\'"]@/store'),
  
  // Script setup
  scriptSetup: regexCache.get('<script\\s+setup[^>]*>'),
  
  // This.$store patterns
  thisStoreDispatch: regexCache.get('this\\.\\$store\\.dispatch\\([\'"]([^\'"]+)/([^\'"]+)[\'"]', 'g'),
  thisStoreGetters: regexCache.get('this\\.\\$store\\.getters\\[[\'"]([^\'"]+)/([^\'"]+)[\'"]\\]', 'g'),
  
  // Computed patterns
  computedPattern: regexCache.get('const\\s+(\\w+)\\s*=\\s*computed\\s*\\(', 'g'),
  arrayFromPattern: regexCache.get('Array\\.from\\s*\\(\\s*(\\w+)\\s*\\)', 'g'),
};
