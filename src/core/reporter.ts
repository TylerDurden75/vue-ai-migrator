/**
 * Enhanced reporting system for migration
 */

import * as fs from "fs/promises";
import * as path from "path";
import { ClassificationResult } from "./classifier";
import { MigrationResult } from "./migrator";

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
    outputPath: string,
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
        simple: fileReports.filter((f) => f.classification.level === "simple")
          .length,
        medium: fileReports.filter((f) => f.classification.level === "medium")
          .length,
        complex: fileReports.filter((f) => f.classification.level === "complex")
          .length,
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
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");

    // Generate markdown summary
    const mdPath = jsonPath.replace(".json", ".md");
    const mdContent = this.generateMarkdownReport(report);
    await fs.writeFile(mdPath, mdContent, "utf-8");

    return jsonPath;
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: MigrationReport): string {
    const lines: string[] = [];

    lines.push("# Migration Report");
    lines.push("");
    lines.push(`**Generated:** ${new Date(report.timestamp).toLocaleString()}`);
    lines.push("");

    // Summary
    lines.push("## Summary");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Total Files | ${report.summary.totalFiles} |`);
    lines.push(`| Files Analyzed | ${report.summary.filesAnalyzed} |`);
    lines.push(`| Files Migrated | ${report.summary.filesMigrated} |`);
    lines.push(`| Files Skipped | ${report.summary.filesSkipped} |`);
    lines.push("");

    // Dependencies Checklist
    const packageChanges = this.extractPackageChanges(report.warnings);
    if (packageChanges.length > 0) {
      lines.push("## 📦 Dependencies Update Checklist");
      lines.push("");
      lines.push("| Dependency | Old Version | New Version | Status |");
      lines.push("|------------|------------|-------------|--------|");
      for (const change of packageChanges) {
        const status = change.removed
          ? "❌ Removed"
          : change.added
            ? "✅ Added"
            : "✅ Updated";
        lines.push(
          `| ${change.name} | ${change.from || "-"} | ${change.to || "-"} | ${status} |`,
        );
      }
      lines.push("");
      lines.push(
        "> **Note:** Run `npm install` to install the new dependencies.",
      );
      lines.push("");
    }

    // Classification
    lines.push("## Classification");
    lines.push("");
    lines.push("| Complexity | Count |");
    lines.push("|-----------|-------|");
    lines.push(`| 🟢 Simple | ${report.classification.simple} |`);
    lines.push(`| 🟡 Medium | ${report.classification.medium} |`);
    lines.push(`| 🔴 Complex | ${report.classification.complex} |`);
    lines.push("");

    // Main Files Section
    const mainFiles = this.identifyMainFiles(report.files);
    if (mainFiles.length > 0) {
      lines.push("## 📄 Main Files to Review");
      lines.push("");
      lines.push(
        "| File | Type | Classification | Migrated | Transformations |",
      );
      lines.push(
        "|------|------|---------------|----------|-----------------|",
      );
      for (const file of mainFiles) {
        const transformations =
          file.transformationsApplied.join(", ") || "None";
        const migrated = file.migrated ? "✅" : "❌";
        const level = this.getLevelEmoji(file.classification.level);
        const fileType = this.getFileType(file.filePath);
        lines.push(
          `| ${file.filePath} | ${fileType} | ${level} ${file.classification.level} | ${migrated} | ${transformations} |`,
        );
      }
      lines.push("");
    }

    // All Files
    if (report.files.length > 0) {
      lines.push("## 📁 All Files");
      lines.push("");
      lines.push("| File | Classification | Migrated | Transformations |");
      lines.push("|------|---------------|----------|-----------------|");
      for (const file of report.files.slice(0, 50)) {
        // Limit to 50 files in markdown
        const transformations =
          file.transformationsApplied.join(", ") || "None";
        const migrated = file.migrated ? "✅" : "❌";
        const level = this.getLevelEmoji(file.classification.level);
        lines.push(
          `| ${file.filePath} | ${level} ${file.classification.level} | ${migrated} | ${transformations} |`,
        );
      }
      if (report.files.length > 50) {
        lines.push(`| ... | ${report.files.length - 50} more files | | |`);
      }
      lines.push("");
    }

    // Errors
    if (report.errors.length > 0) {
      lines.push("## Errors");
      lines.push("");
      for (const error of report.errors) {
        lines.push(`- ❌ ${error}`);
      }
      lines.push("");
    }

    // Warnings - Separate package warnings from other warnings
    const packageWarnings = report.warnings.filter((w) =>
      w.startsWith("Package:"),
    );
    const otherWarnings = report.warnings.filter(
      (w) => !w.startsWith("Package:"),
    );

    if (otherWarnings.length > 0) {
      lines.push("## ⚠️ Items to Review");
      lines.push("");
      lines.push("The following items require manual review or adaptation:");
      lines.push("");
      for (const warning of otherWarnings) {
        lines.push(`- ⚠️ ${warning}`);
      }
      lines.push("");
    }

    if (packageWarnings.length > 0 && packageChanges.length === 0) {
      lines.push("## ⚠️ Dependency Warnings");
      lines.push("");
      for (const warning of packageWarnings) {
        lines.push(`- ⚠️ ${warning}`);
      }
      lines.push("");
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (const rec of report.recommendations) {
        lines.push(`- 💡 ${rec}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Generate recommendations based on file reports
   */
  private generateRecommendations(fileReports: FileReport[]): string[] {
    const recommendations: string[] = [];

    const complexFiles = fileReports.filter(
      (f) => f.classification.level === "complex",
    );
    if (complexFiles.length > 0) {
      recommendations.push(
        `${complexFiles.length} file(s) require AI-assisted migration. Review them carefully.`,
      );
    }

    const filesWithErrors = fileReports.filter(
      (f) => f.errors && f.errors.length > 0,
    );
    if (filesWithErrors.length > 0) {
      recommendations.push(
        `${filesWithErrors.length} file(s) had errors during migration. Manual review required.`,
      );
    }

    const unmigratedFiles = fileReports.filter((f) => !f.migrated);
    if (unmigratedFiles.length > 0) {
      recommendations.push(
        `${unmigratedFiles.length} file(s) were not migrated. Check if they need manual migration.`,
      );
    }

    // Check for common patterns
    const hasMixins = fileReports.some((f) =>
      f.classification.reasons.some((r) => r.includes("Mixins")),
    );
    if (hasMixins) {
      recommendations.push(
        "Mixins detected. Consider converting to composables for better Vue 3 compatibility.",
      );
    }

    const hasVuex = fileReports.some((f) =>
      f.classification.reasons.some((r) => r.includes("Vuex")),
    );
    if (hasVuex) {
      recommendations.push(
        "Vuex detected. Migrate to Pinia for better TypeScript support.",
      );
    }

    return recommendations;
  }

  /**
   * Get emoji for complexity level
   */
  private getLevelEmoji(level: string): string {
    const emojis: Record<string, string> = {
      simple: "🟢",
      medium: "🟡",
      complex: "🔴",
    };
    return emojis[level] || "⚪";
  }

  /**
   * Extract package changes from warnings
   */
  private extractPackageChanges(warnings: string[]): Array<{
    name: string;
    from?: string;
    to?: string;
    added?: boolean;
    removed?: boolean;
  }> {
    const changes: Array<{
      name: string;
      from?: string;
      to?: string;
      added?: boolean;
      removed?: boolean;
    }> = [];

    for (const warning of warnings) {
      // Match patterns like "Package: Vue: ^2.7.14 → ^3.4.0"
      const packageMatch = warning.match(
        /Package:\s*(.+?):\s*(.+?)\s*→\s*(.+)/,
      );
      if (packageMatch) {
        changes.push({
          name: packageMatch[1].trim(),
          from: packageMatch[2].trim(),
          to: packageMatch[3].trim(),
        });
        continue;
      }

      // Match patterns like "Package: Removed Vuex: ^3.6.2"
      const removedMatch = warning.match(/Package:\s*Removed\s+(.+?):\s*(.+)/);
      if (removedMatch) {
        changes.push({
          name: removedMatch[1].trim(),
          from: removedMatch[2].trim(),
          removed: true,
        });
        continue;
      }

      // Match patterns like "Package: Added Pinia: ^2.1.0"
      const addedMatch = warning.match(/Package:\s*Added\s+(.+?):\s*(.+)/);
      if (addedMatch) {
        changes.push({
          name: addedMatch[1].trim(),
          to: addedMatch[2].trim(),
          added: true,
        });
        continue;
      }
    }

    return changes;
  }

  /**
   * Identify main files (main.js/ts, router.js/ts, store.js/ts, App.vue)
   */
  private identifyMainFiles(files: FileReport[]): FileReport[] {
    const mainFilePatterns = [
      /main\.(js|ts)$/i,
      /router\/.*\.(js|ts)$/i,
      /store\/.*\.(js|ts)$/i,
      /App\.vue$/i,
    ];

    return files.filter((file) =>
      mainFilePatterns.some((pattern) => pattern.test(file.filePath)),
    );
  }

  /**
   * Get file type for display
   */
  private getFileType(filePath: string): string {
    if (/main\.(js|ts)$/i.test(filePath)) return "Entry Point";
    if (/router\/.*\.(js|ts)$/i.test(filePath)) return "Router";
    if (/store\/.*\.(js|ts)$/i.test(filePath)) return "Store";
    if (/App\.vue$/i.test(filePath)) return "Main Component";
    return "Other";
  }
}
