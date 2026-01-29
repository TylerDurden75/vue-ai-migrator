import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CacheEntry {
  filePath: string;
  hash: string;
  timestamp: number;
  transformations: string[];
}

export class CacheManager {
  private cacheDir: string;
  private cacheFile: string;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(projectPath: string) {
    this.cacheDir = path.join(projectPath, '.vue-migrator-cache');
    this.cacheFile = path.join(this.cacheDir, 'cache.json');
  }

  /**
   * Calculate hash of file content
   */
  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Check if file needs processing
   */
  needsProcessing(filePath: string, content: string, transformations: string[]): boolean {
    const hash = this.calculateHash(content);
    const entry = this.cache.get(filePath);

    if (!entry) {
      return true;
    }

    // Check if content changed
    if (entry.hash !== hash) {
      return true;
    }

    // Check if transformations changed
    const transformationsStr = transformations.sort().join(',');
    const entryTransformationsStr = entry.transformations.sort().join(',');
    
    if (transformationsStr !== entryTransformationsStr) {
      return true;
    }

    return false;
  }

  /**
   * Mark file as processed
   */
  markProcessed(filePath: string, content: string, transformations: string[]): void {
    const hash = this.calculateHash(content);
    this.cache.set(filePath, {
      filePath,
      hash,
      timestamp: Date.now(),
      transformations: [...transformations],
    });
  }

  /**
   * Load cache from disk
   */
  async loadCache(): Promise<void> {
    try {
      const content = await fs.readFile(this.cacheFile, 'utf-8');
      const data = JSON.parse(content);
      
      this.cache.clear();
      for (const entry of data.entries || []) {
        this.cache.set(entry.filePath, entry);
      }
    } catch (error) {
      // Cache doesn't exist or is invalid, start fresh
      this.cache.clear();
    }
  }

  /**
   * Save cache to disk
   */
  async saveCache(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      
      const data = {
        version: '1.0',
        timestamp: Date.now(),
        entries: Array.from(this.cache.values()),
      };
      
      await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // Silently fail - cache is optional
    }
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      this.cache.clear();
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Get cache stats
   */
  getStats(): { entries: number; oldestEntry: number | null; newestEntry: number | null } {
    if (this.cache.size === 0) {
      return { entries: 0, oldestEntry: null, newestEntry: null };
    }

    const timestamps = Array.from(this.cache.values()).map(e => e.timestamp);
    return {
      entries: this.cache.size,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
    };
  }
}

