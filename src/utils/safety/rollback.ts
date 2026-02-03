import * as fs from "fs/promises";
import * as path from "path";
import { safeReadFile, safeWriteFile } from "./error-handler";

export interface BackupInfo {
  filePath: string;
  originalContent: string;
  timestamp: Date;
}

export class RollbackManager {
  private backups: Map<string, BackupInfo> = new Map();
  private backupDir: string;

  constructor(projectPath: string) {
    this.backupDir = path.join(projectPath, ".vue-migrator-backup");
  }

  /**
   * Create a backup of a file before modification
   * If file doesn't exist, create an empty backup to mark it as "created during migration"
   */
  async backupFile(filePath: string): Promise<void> {
    try {
      const content = await safeReadFile(filePath);
      this.backups.set(filePath, {
        filePath,
        originalContent: content,
        timestamp: new Date(),
      });
    } catch (error) {
      // File doesn't exist - create empty backup to mark it as "created during migration"
      this.backups.set(filePath, {
        filePath,
        originalContent: '', // Empty content = file was created during migration
        timestamp: new Date(),
      });
    }
  }

  /**
   * Restore a file from backup
   * Improved path matching: handles both absolute and relative paths
   */
  async restoreFile(filePath: string): Promise<boolean> {
    // Normalize the file path for comparison
    const normalizedPath = path.normalize(filePath);
    
    // Try exact path first (normalized)
    let backup = this.backups.get(normalizedPath);
    
    // If not found, try to find by matching paths (handles relative/absolute differences)
    if (!backup) {
      // Try exact match with different path formats
      for (const [backupPath, backupInfo] of this.backups.entries()) {
        const normalizedBackupPath = path.normalize(backupPath);
        
        // Match by exact normalized path
        if (normalizedBackupPath === normalizedPath) {
          backup = backupInfo;
          break;
        }
        
        // Match by relative path (if backupPath is relative and filePath is absolute)
        if (!path.isAbsolute(backupPath) && path.isAbsolute(filePath)) {
          const projectRoot = path.dirname(this.backupDir);
          const resolvedBackupPath = path.resolve(projectRoot, backupPath);
          if (path.normalize(resolvedBackupPath) === normalizedPath) {
            backup = backupInfo;
            break;
          }
        }
        
        // Match by filename and parent directory structure
        const fileName = path.basename(filePath);
        const backupFileName = path.basename(backupPath);
        if (fileName === backupFileName) {
          // Also check if parent directories match (more reliable than filename only)
          const fileParent = path.dirname(filePath);
          const backupParent = path.isAbsolute(backupPath) 
            ? path.dirname(backupPath)
            : path.resolve(path.dirname(this.backupDir), path.dirname(backupPath));
          
          if (path.normalize(fileParent) === path.normalize(backupParent)) {
            backup = backupInfo;
            break;
          }
        }
      }
    }

    if (!backup) {
      return false;
    }

    // Special handling for tsconfig.json: if backup is empty, don't restore (file was created during migration)
    const fileName = path.basename(filePath);
    if (fileName === 'tsconfig.json' && (!backup.originalContent || backup.originalContent.trim() === '')) {
      // Don't restore empty backup for tsconfig.json - it will be handled in the TypeScript cleanup section
      return false;
    }

    try {
      await safeWriteFile(filePath, backup.originalContent);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up files created during migration (vite.config.js/ts, .backup files, etc.)
   */
  async cleanupMigrationArtifacts(projectRoot: string): Promise<void> {
    try {
      // Remove Vite config files (created during migration)
      const viteConfigJs = path.join(projectRoot, "vite.config.js");
      const viteConfigTs = path.join(projectRoot, "vite.config.ts");
      
      // Always try to remove vite.config.js (Vue 2 doesn't use it)
      try {
        const stats = await fs.stat(viteConfigJs);
        if (stats.isFile()) {
          await fs.unlink(viteConfigJs);
        }
      } catch {
        // File doesn't exist, ignore
      }
      
      // Always try to remove vite.config.ts (Vue 2 doesn't use it)
      try {
        const stats = await fs.stat(viteConfigTs);
        if (stats.isFile()) {
          await fs.unlink(viteConfigTs);
        }
      } catch {
        // File doesn't exist, ignore
      }

      // Remove empty webpack.config.js if it exists (might have been created empty during migration)
      const webpackConfigJs = path.join(projectRoot, "webpack.config.js");
      try {
        const stats = await fs.stat(webpackConfigJs);
        if (stats.isFile()) {
          const content = await fs.readFile(webpackConfigJs, "utf-8");
          // If empty or just whitespace, remove it (Vue CLI projects don't need empty webpack.config.js)
          if (content.trim().length === 0) {
            await fs.unlink(webpackConfigJs);
          }
        }
      } catch {
        // File doesn't exist or can't be deleted, ignore
      }

      // Remove .backup files created during migration
      try {
        const files = await fs.readdir(projectRoot);
        for (const file of files) {
          if (file.endsWith(".backup")) {
            try {
              await fs.unlink(path.join(projectRoot, file));
            } catch {
              // Ignore errors
            }
          }
        }
      } catch {
        // Ignore errors reading directory
      }

      // Restore index.html from root to public/ if it was migrated (Vue 2 convention)
      const rootIndexHtml = path.join(projectRoot, "index.html");
      const publicIndexHtml = path.join(projectRoot, "public", "index.html");
      
      try {
        const rootExists = await fs.access(rootIndexHtml).then(() => true).catch(() => false);
        const publicExists = await fs.access(publicIndexHtml).then(() => true).catch(() => false);
        
        // If root index.html exists but public/index.html doesn't, it was migrated
        // Restore public/index.html from root (Vue 2 convention)
        if (rootExists && !publicExists) {
          try {
            const rootContent = await fs.readFile(rootIndexHtml, "utf-8");
            // Ensure public directory exists
            await fs.mkdir(path.join(projectRoot, "public"), { recursive: true });
            await fs.writeFile(publicIndexHtml, rootContent, "utf-8");
            // Remove root index.html (Vue 2 uses public/index.html)
            await fs.unlink(rootIndexHtml);
          } catch {
            // Ignore errors
          }
        }
      } catch {
        // Ignore errors
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Restore all backed up files
   * Also handles TypeScript file renames: if a .ts file exists but backup is for .js, restore .js and delete .ts
   */
  async restoreAll(): Promise<{ restored: number; failed: string[] }> {
    const failed: string[] = [];
    let restored = 0;
    const projectRoot = path.dirname(this.backupDir);

    // Clean up migration artifacts first (vite.config.js/ts, .backup files, etc.)
    await this.cleanupMigrationArtifacts(projectRoot);

    // First, restore all files from backups (except tsconfig.json which is handled separately)
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    
    for (const [filePath] of this.backups) {
      // Skip tsconfig.json - it will be handled in the TypeScript cleanup section
      // Check by filename to handle both absolute and relative paths
      const fileName = path.basename(filePath);
      if (fileName === 'tsconfig.json') {
        // Double-check by resolving paths to ensure it's the same file
        const normalizedFilePath = path.normalize(filePath);
        const normalizedTsconfigPath = path.normalize(tsconfigPath);
        
        let isTsconfig = false;
        if (normalizedFilePath === normalizedTsconfigPath) {
          isTsconfig = true;
        } else if (!path.isAbsolute(filePath)) {
          // If backup path is relative, resolve it
          const resolvedFilePath = path.resolve(projectRoot, filePath);
          if (path.normalize(resolvedFilePath) === normalizedTsconfigPath) {
            isTsconfig = true;
          }
        } else if (path.isAbsolute(filePath)) {
          // If backup path is absolute, check if it's the same file
          const fileParent = path.dirname(filePath);
          const tsconfigParent = path.dirname(tsconfigPath);
          if (path.normalize(fileParent) === path.normalize(tsconfigParent)) {
            isTsconfig = true;
          }
        }
        
        if (isTsconfig) {
          continue; // Skip tsconfig.json, it will be handled separately
        }
      }
      
      const success = await this.restoreFile(filePath);
      if (success) {
        restored++;
      } else {
        failed.push(filePath);
      }
    }

    // Then, handle TypeScript file renames: find .ts files that should be .js
    try {
      // First, find all backups that are for .js files
      const jsBackups = new Map<string, string>(); // jsFilePath -> backupPath
      for (const [backupPath] of this.backups) {
        if (backupPath.endsWith('.js') && !backupPath.endsWith('.vue')) {
          const normalizedBackupPath = path.normalize(backupPath);
          jsBackups.set(normalizedBackupPath, backupPath);
        }
      }
      
      // For each .js backup, check if a corresponding .ts file exists
      for (const [normalizedJsPath, backupPath] of jsBackups) {
        const tsFilePath = normalizedJsPath.replace(/\.js$/, '.ts');
        
        // Check if .ts file exists
        try {
          await fs.access(tsFilePath);
          // .ts file exists - it was created during TypeScript migration
          // Restore the .js file and delete the .ts file
          const jsRestored = await this.restoreFile(backupPath);
          if (jsRestored) {
            try {
              await fs.unlink(tsFilePath);
              // Don't increment restored - we already counted the .js restore
            } catch (error) {
              // File might already be deleted, that's okay
            }
          }
        } catch (error) {
          // .ts file doesn't exist, that's fine - file was originally .js
        }
      }
      
      // Also check vue.config.js: remove TypeScript configurations if they were added
      const vueConfigPath = path.join(projectRoot, 'vue.config.js');
      try {
        const vueConfigContent = await fs.readFile(vueConfigPath, 'utf-8');
        let modifiedConfig = vueConfigContent;
        let configModified = false;
        
        // Remove TypeScript entry point
        if (vueConfigContent.includes("entry: './src/main.ts'")) {
          modifiedConfig = modifiedConfig.replace(
            /entry:\s*['"]\.\/src\/main\.ts['"],?\s*\n?\s*/g,
            ''
          );
          configModified = true;
        }
        
        // Remove TypeScript extensions from resolve.extensions
        modifiedConfig = modifiedConfig.replace(
          /extensions:\s*\[([^\]]*)\]/g,
          (match, extensions) => {
            // Remove .ts and .tsx from extensions
            const cleaned = extensions.split(',').map((e: string) => e.trim())
              .filter((e: string) => !e.includes("'.ts'") && !e.includes('".ts"') && !e.includes("'.tsx'") && !e.includes('".tsx"'));
            if (cleaned.length > 0) {
              return `extensions: [${cleaned.join(', ')}]`;
            }
            return match; // Keep original if we can't parse
          }
        );
        
        // Remove ts-loader rule from configureWebpack.module.rules
        modifiedConfig = modifiedConfig.replace(
          /\{\s*test:\s*\/\\\.ts\$\/[\s\S]*?ts-loader[\s\S]*?\},?\s*\n?/g,
          ''
        );
        
        // Remove TypeScript loader from chainWebpack
        modifiedConfig = modifiedConfig.replace(
          /config\.module\s*\.rule\(['"]ts['"]\)[\s\S]*?transpileOnly:\s*true\s*\)\s*\n?/g,
          ''
        );
        
        // Remove TypeScript extension merge from chainWebpack
        modifiedConfig = modifiedConfig.replace(
          /config\.resolve\.extensions\.merge\(\[['"]\.ts['"],\s*['"]\.tsx['"][^\]]*\]\);\s*\n?/g,
          ''
        );
        
        // Clean up empty configureWebpack if it becomes empty
        if (modifiedConfig.match(/configureWebpack:\s*\{\s*\}/)) {
          modifiedConfig = modifiedConfig.replace(
            /configureWebpack:\s*\{\s*\},?\s*\n?/g,
            ''
          );
          configModified = true;
        }
        
        // Clean up empty chainWebpack if it becomes empty (only has mjs rule, keep it)
        // But if chainWebpack is completely empty, remove it
        const chainWebpackMatch = modifiedConfig.match(/chainWebpack:\s*config\s*=>\s*\{([^}]*)\}/);
        if (chainWebpackMatch) {
          const chainWebpackContent = chainWebpackMatch[1].trim();
          // If chainWebpack only has whitespace or comments, remove it
          if (!chainWebpackContent || chainWebpackContent.match(/^\s*$/)) {
            modifiedConfig = modifiedConfig.replace(
              /chainWebpack:\s*config\s*=>\s*\{\s*\},?\s*\n?/g,
              ''
            );
            configModified = true;
          }
        }
        
        if (configModified && modifiedConfig !== vueConfigContent) {
          await fs.writeFile(vueConfigPath, modifiedConfig, 'utf-8');
        }
      } catch (error) {
        // vue.config.js might not exist or be readable
      }
      
      // Remove TypeScript dependency from package.json if it was added
      const packageJsonPath = path.join(projectRoot, 'package.json');
      try {
        const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        
        // Remove TypeScript dependencies if they were added
        if (packageJson.devDependencies?.typescript) {
          delete packageJson.devDependencies.typescript;
        }
        // Remove ts-loader if it was added
        if (packageJson.devDependencies?.['ts-loader']) {
          delete packageJson.devDependencies['ts-loader'];
        }
        // Remove @vue/compiler-sfc if it was added (Vue 3 only)
        if (packageJson.devDependencies?.['@vue/compiler-sfc']) {
          delete packageJson.devDependencies['@vue/compiler-sfc'];
        }
        // Remove devDependencies if it becomes empty
        if (packageJson.devDependencies && Object.keys(packageJson.devDependencies).length === 0) {
          delete packageJson.devDependencies;
        }
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
      } catch (error) {
        // package.json might not exist or be parseable
      }
      
      // Remove tsconfig.json if it was created during migration
      // IMPORTANT: Only handle tsconfig.json if it has a backup (meaning it was touched during migration)
      // If no backup exists, we should NOT touch the file at all (it wasn't part of this migration)
      const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
      
      // Find tsconfig.json backup by checking all backups for tsconfig.json filename
      let tsconfigBackup: { filePath: string; originalContent: string; timestamp: Date } | null = null;
      let tsconfigBackupPath: string | null = null;
      
      for (const [backupPath, backupInfo] of this.backups.entries()) {
        if (path.basename(backupPath) === 'tsconfig.json') {
          // Verify it's the same file by checking parent directory
          const backupParent = path.isAbsolute(backupPath) 
            ? path.dirname(backupPath)
            : path.resolve(projectRoot, path.dirname(backupPath));
          const tsconfigParent = path.dirname(tsconfigPath);
          
          if (path.normalize(backupParent) === path.normalize(tsconfigParent)) {
            tsconfigBackup = backupInfo;
            tsconfigBackupPath = backupPath;
            break;
          }
        }
      }
      
      if (tsconfigBackup) {
        // tsconfig.json has a backup - it was touched during migration
        try {
          const isEmpty = !tsconfigBackup.originalContent || tsconfigBackup.originalContent.trim() === '';
          if (isEmpty) {
            // Backup is empty = file was created during migration, delete it if it exists
            try {
              await fs.unlink(tsconfigPath);
            } catch {
              // File might already be deleted, that's fine
            }
          } else {
            // Backup exists with content = file existed before migration, restore it
            // Use the original backup path to ensure correct restoration
            if (tsconfigBackupPath) {
              await this.restoreFile(tsconfigBackupPath);
            }
          }
        } catch (error) {
          // Silently fail - TypeScript cleanup is optional
        }
      } else {
        // No backup exists - check if file exists and delete it if it matches our pattern
        // This handles the case where tsconfig.json was created but backup wasn't saved properly
        try {
          await fs.access(tsconfigPath);
          const tsconfigContent = await fs.readFile(tsconfigPath, 'utf-8');
          const tsconfig = JSON.parse(tsconfigContent);
          
          // Check if it matches our generated config pattern
          const matchesOurConfig = 
            tsconfig.compilerOptions?.paths?.['@/*']?.[0] === 'src/*' &&
            tsconfig.compilerOptions?.baseUrl === '.' &&
            (tsconfig.include?.includes('src/**/*.vue') || tsconfig.include?.includes('src/**/*.ts')) &&
            tsconfig.exclude?.includes('node_modules');
          
          if (matchesOurConfig) {
            // This looks like our generated config and no backup exists
            // It was likely created during migration, delete it
            try {
              await fs.unlink(tsconfigPath);
            } catch {
              // File might already be deleted
            }
          }
        } catch {
          // File doesn't exist or can't be read, that's fine - nothing to do
        }
      }
    } catch (error) {
      // Silently fail - TypeScript cleanup is optional
    }

    // Final cleanup: remove any remaining migration artifacts
    // This ensures files created during migration are removed even if they weren't tracked
    await this.cleanupMigrationArtifacts(projectRoot);

    return { restored, failed };
  }

  /**
   * Save backups to disk for persistence
   */
  async saveBackups(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      const backupFile = path.join(this.backupDir, `backup-${Date.now()}.json`);
      const backupData = Array.from(this.backups.entries()).map(
        ([filePath, info]) => ({
          filePath,
          originalContent: info.originalContent,
          timestamp: info.timestamp.toISOString(),
        }),
      );
      await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
    } catch (error) {
      // Silently fail - backup saving is optional
    }
  }

  /**
   * Load backups from disk
   */
  async loadBackups(): Promise<void> {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files.filter(
        (f) => f.startsWith("backup-") && f.endsWith(".json"),
      );

      if (backupFiles.length === 0) {
        return;
      }

      // Load all backups and merge them (most recent takes precedence)
      const allBackups = new Map<string, BackupInfo>();
      const projectRoot = path.dirname(this.backupDir);

      for (const backupFile of backupFiles.sort()) {
        try {
          const backupContent = await fs.readFile(
            path.join(this.backupDir, backupFile),
            "utf-8",
          );
          const backupData = JSON.parse(backupContent);

          for (const backup of backupData) {
            // Normalize file path: convert relative paths to absolute paths
            let normalizedPath = backup.filePath;
            
            // If path is relative and contains project name prefix, remove it
            if (!path.isAbsolute(normalizedPath)) {
              // Remove project name prefix if present (e.g., "test-project/src/App.vue" -> "src/App.vue")
              normalizedPath = normalizedPath.replace(/^[^/]+\//, '');
              // Resolve relative to project root
              normalizedPath = path.resolve(projectRoot, normalizedPath);
            }
            
            // Normalize the path (remove redundant separators, resolve . and ..)
            normalizedPath = path.normalize(normalizedPath);
            
            // Use normalized path as key
            if (!allBackups.has(normalizedPath)) {
              allBackups.set(normalizedPath, {
                filePath: normalizedPath, // Store normalized absolute path
                originalContent: backup.originalContent,
                timestamp: new Date(backup.timestamp),
              });
            }
          }
        } catch {
          // Skip corrupted backup files
        }
      }

      // Merge into this.backups (most recent backup wins)
      for (const [filePath, backup] of allBackups) {
        const existing = this.backups.get(filePath);
        if (!existing || backup.timestamp > existing.timestamp) {
          this.backups.set(filePath, backup);
        }
      }
    } catch (error) {
      // Silently fail - backup loading is optional
    }
  }

  /**
   * Clear all backups
   */
  async clearBackups(): Promise<void> {
    try {
      await fs.rm(this.backupDir, { recursive: true, force: true });
      this.backups.clear();
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Get backup count
   */
  getBackupCount(): number {
    return this.backups.size;
  }

  /**
   * Check if a file has a backup
   * Improved: better path matching
   */
  hasBackup(filePath: string): boolean {
    const normalizedPath = path.normalize(filePath);
    
    if (this.backups.has(normalizedPath)) {
      return true;
    }
    
    // Check by normalized path matching
    for (const backupPath of this.backups.keys()) {
      const normalizedBackupPath = path.normalize(backupPath);
      if (normalizedBackupPath === normalizedPath) {
        return true;
      }
      
      // Check by filename and parent directory
      const fileName = path.basename(filePath);
      const backupFileName = path.basename(backupPath);
      if (fileName === backupFileName) {
        const fileParent = path.dirname(filePath);
        const backupParent = path.isAbsolute(backupPath) 
          ? path.dirname(backupPath)
          : path.resolve(path.dirname(this.backupDir), path.dirname(backupPath));
        
        if (path.normalize(fileParent) === path.normalize(backupParent)) {
          return true;
        }
      }
    }
    return false;
  }
}
