import * as fs from 'fs/promises';
import * as path from 'path';
import { safeReadFile, safeWriteFile } from './error-handler';

export interface BackupInfo {
  filePath: string;
  originalContent: string;
  timestamp: Date;
}

export class RollbackManager {
  private backups: Map<string, BackupInfo> = new Map();
  private backupDir: string;

  constructor(projectPath: string) {
    this.backupDir = path.join(projectPath, '.vue-migrator-backup');
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
   */
  async restoreFile(filePath: string): Promise<boolean> {
    const backup = this.backups.get(filePath);
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
      const backupData = Array.from(this.backups.entries()).map(([filePath, info]) => ({
        filePath,
        originalContent: info.originalContent,
        timestamp: info.timestamp.toISOString(),
      }));
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
      const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.json'));
      
      if (backupFiles.length === 0) {
        return;
      }

      // Load the most recent backup
      backupFiles.sort().reverse();
      const latestBackup = backupFiles[0];
      const backupContent = await fs.readFile(
        path.join(this.backupDir, latestBackup),
        'utf-8'
      );
      const backupData = JSON.parse(backupContent);

      for (const backup of backupData) {
        this.backups.set(backup.filePath, {
          filePath: backup.filePath,
          originalContent: backup.originalContent,
          timestamp: new Date(backup.timestamp),
        });
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
}

