/**
 * AST Cache for performance optimization
 * Parses script/template content once and reuses for all rules
 */

export interface ASTCache {
  scriptContent?: string;
  templateContent?: string;
  scriptAST?: any; // Can be extended with actual AST parser if needed
  templateAST?: any;
  lastModified: number;
}

class ASTCacheManager {
  private cache: Map<string, ASTCache> = new Map();

  /**
   * Get or create AST cache for a file
   */
  get(filePath: string, content: string): ASTCache {
    const key = filePath;
    
    if (!this.cache.has(key)) {
      const cache: ASTCache = {
        lastModified: Date.now()
      };
      
      // Extract script and template content
      if (filePath.endsWith(".vue")) {
        const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        cache.scriptContent = scriptMatch ? scriptMatch[1] : undefined;
        
        const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
        cache.templateContent = templateMatch ? templateMatch[1] : undefined;
      }
      
      this.cache.set(key, cache);
    }
    
    return this.cache.get(key)!;
  }

  /**
   * Update cache when content changes
   */
  update(filePath: string, content: string): void {
    const key = filePath;
    const cache: ASTCache = {
      lastModified: Date.now()
    };
    
    if (filePath.endsWith(".vue")) {
      const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      cache.scriptContent = scriptMatch ? scriptMatch[1] : undefined;
      
      const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
      cache.templateContent = templateMatch ? templateMatch[1] : undefined;
    }
    
    this.cache.set(key, cache);
  }

  /**
   * Clear cache for a specific file
   */
  clear(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
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
export const astCache = new ASTCacheManager();
