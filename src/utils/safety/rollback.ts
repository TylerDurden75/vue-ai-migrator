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
      // Silently fail - backup is optional
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

    try {
      await safeWriteFile(filePath, backup.originalContent);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Restore all backed up files
   */
  async restoreAll(): Promise<{ restored: number; failed: string[] }> {
    const failed: string[] = [];
    let restored = 0;

    for (const [filePath] of this.backups) {
      const success = await this.restoreFile(filePath);
      if (success) {
        restored++;
      } else {
        failed.push(filePath);
      }
    }

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
