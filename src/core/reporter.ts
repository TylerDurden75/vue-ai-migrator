/**
 * Enhanced reporting system for migration
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ClassificationResult } from './classifier';
import { MigrationResult } from './migrator';

export interface FileReport {
  filePath: string;
  classification: ClassificationResult;
  migrated: boolean;
  transformationsApplied: string[];
  errors?: string[];
  warnings?: string[];
  diff?: {
    added: number;
    removed: number;
    unchanged: number;
  };
  explanation?: string;
  timeTaken?: number; // milliseconds
}

export interface MigrationReport {
  summary: {
    totalFiles: number;
    filesAnalyzed: number;
    filesMigrated: number;
    filesSkipped: number;
    totalTime: number; // milliseconds
    estimatedTimeRemaining?: string;
  };
  classification: {
    simple: number;
    medium: number;
    complex: number;
  };
  files: FileReport[];
  errors: string[];
  warnings: string[];
  recommendations: string[];
  timestamp: string;
  vueVersion?: {
    from: string;
    to: string;
  };
}

/**
 * Generate comprehensive migration report
 */
export class MigrationReporter {
  /**
   * Generate report from migration results
   */
  async generateReport(
    result: MigrationResult,
    fileReports: FileReport[],
    outputPath: string
  ): Promise<string> {
    const report: MigrationReport = {
      summary: {
        totalFiles: result.filesAnalyzed,
        filesAnalyzed: result.filesAnalyzed,
        filesMigrated: result.filesModified,
        filesSkipped: result.filesAnalyzed - result.filesModified,
        totalTime: 0, // Time tracking can be added in future versions
      },
      classification: {
        simple: fileReports.filter((f) => f.classification.level === 'simple').length,
        medium: fileReports.filter((f) => f.classification.level === 'medium').length,
        complex: fileReports.filter((f) => f.classification.level === 'complex').length,
      },
      files: fileReports,
      errors: result.errors,
      warnings: result.warnings,
      recommendations: this.generateRecommendations(fileReports),
      timestamp: new Date().toISOString(),
    };

    // Write JSON report
    const jsonPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(jsonPath), { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    // Generate markdown summary
    const mdPath = jsonPath.replace('.json', '.md');
    const mdContent = this.generateMarkdownReport(report);
    await fs.writeFile(mdPath, mdContent, 'utf-8');

    return jsonPath;
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: MigrationReport): string {
    const lines: string[] = [];

    lines.push('# Migration Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date(report.timestamp).toLocaleString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Files | ${report.summary.totalFiles} |`);
    lines.push(`| Files Analyzed | ${report.summary.filesAnalyzed} |`);
    lines.push(`| Files Migrated | ${report.summary.filesMigrated} |`);
    lines.push(`| Files Skipped | ${report.summary.filesSkipped} |`);
    lines.push('');

    // Classification
    lines.push('## Classification');
    lines.push('');
    lines.push('| Complexity | Count |');
    lines.push('|-----------|-------|');
    lines.push(`| 🟢 Simple | ${report.classification.simple} |`);
    lines.push(`| 🟡 Medium | ${report.classification.medium} |`);
    lines.push(`| 🔴 Complex | ${report.classification.complex} |`);
    lines.push('');

    // Files
    if (report.files.length > 0) {
      lines.push('## Files');
      lines.push('');
      lines.push('| File | Classification | Migrated | Transformations |');
      lines.push('|------|---------------|----------|-----------------|');
      for (const file of report.files.slice(0, 50)) {
        // Limit to 50 files in markdown
        const transformations = file.transformationsApplied.join(', ') || 'None';
        const migrated = file.migrated ? '✅' : '❌';
        const level = this.getLevelEmoji(file.classification.level);
        lines.push(
          `| ${file.filePath} | ${level} ${file.classification.level} | ${migrated} | ${transformations} |`
        );
      }
      if (report.files.length > 50) {
        lines.push(`| ... | ${report.files.length - 50} more files | | |`);
      }
      lines.push('');
    }

    // Errors
    if (report.errors.length > 0) {
      lines.push('## Errors');
      lines.push('');
      for (const error of report.errors) {
        lines.push(`- ❌ ${error}`);
      }
      lines.push('');
    }

    // Warnings
    if (report.warnings.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const warning of report.warnings) {
        lines.push(`- ⚠️ ${warning}`);
      }
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      for (const rec of report.recommendations) {
        lines.push(`- 💡 ${rec}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate recommendations based on file reports
   */
  private generateRecommendations(fileReports: FileReport[]): string[] {
    const recommendations: string[] = [];

    const complexFiles = fileReports.filter((f) => f.classification.level === 'complex');
    if (complexFiles.length > 0) {
      recommendations.push(
        `${complexFiles.length} file(s) require AI-assisted migration. Review them carefully.`
      );
    }

    const filesWithErrors = fileReports.filter((f) => f.errors && f.errors.length > 0);
    if (filesWithErrors.length > 0) {
      recommendations.push(
        `${filesWithErrors.length} file(s) had errors during migration. Manual review required.`
      );
    }

    const unmigratedFiles = fileReports.filter((f) => !f.migrated);
    if (unmigratedFiles.length > 0) {
      recommendations.push(
        `${unmigratedFiles.length} file(s) were not migrated. Check if they need manual migration.`
      );
    }

    // Check for common patterns
    const hasMixins = fileReports.some((f) =>
      f.classification.reasons.some((r) => r.includes('Mixins'))
    );
    if (hasMixins) {
      recommendations.push(
        'Mixins detected. Consider converting to composables for better Vue 3 compatibility.'
      );
    }

    const hasVuex = fileReports.some((f) =>
      f.classification.reasons.some((r) => r.includes('Vuex'))
    );
    if (hasVuex) {
      recommendations.push('Vuex detected. Migrate to Pinia for better TypeScript support.');
    }

    return recommendations;
  }

  /**
   * Get emoji for complexity level
   */
  private getLevelEmoji(level: string): string {
    const emojis: Record<string, string> = {
      simple: '🟢',
      medium: '🟡',
      complex: '🔴',
    };
    return emojis[level] || '⚪';
  }
}
