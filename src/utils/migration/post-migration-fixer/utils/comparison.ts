/**
 * Comparison utilities for testing new vs old fixer system
 */

import type { FixResult } from "../types";

export interface ComparisonResult {
  filePath: string;
  oldResult: FixResult;
  newResult: FixResult;
  differences: {
    fixes: {
      onlyInOld: string[];
      onlyInNew: string[];
      inBoth: string[];
    };
    issues: {
      onlyInOld: string[];
      onlyInNew: string[];
      inBoth: string[];
    };
    contentChanged: boolean;
    contentDiff?: string; // Simple diff representation
  };
}

/**
 * Compare results from old and new fixer systems
 */
export function compareResults(
  filePath: string,
  oldResult: FixResult,
  newResult: FixResult
): ComparisonResult {
  const oldFixes = new Set(oldResult.fixes);
  const newFixes = new Set(newResult.fixes);
  const oldIssues = new Set(oldResult.issues);
  const newIssues = new Set(newResult.issues);

  const onlyInOldFixes = oldResult.fixes.filter(f => !newFixes.has(f));
  const onlyInNewFixes = newResult.fixes.filter(f => !oldFixes.has(f));
  const inBothFixes = oldResult.fixes.filter(f => newFixes.has(f));

  const onlyInOldIssues = oldResult.issues.filter(i => !newIssues.has(i));
  const onlyInNewIssues = newResult.issues.filter(i => !oldIssues.has(i));
  const inBothIssues = oldResult.issues.filter(i => newIssues.has(i));

  const contentChanged = oldResult.content !== newResult.content;
  
  // Simple diff: count lines changed
  let contentDiff: string | undefined;
  if (contentChanged) {
    const oldLines = oldResult.content.split("\n");
    const newLines = newResult.content.split("\n");
    const maxLines = Math.max(oldLines.length, newLines.length);
    const diffLines: string[] = [];
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] || "";
      const newLine = newLines[i] || "";
      if (oldLine !== newLine) {
        diffLines.push(`Line ${i + 1}: -${oldLine} +${newLine}`);
      }
    }
    
    contentDiff = diffLines.slice(0, 10).join("\n"); // Limit to first 10 differences
    if (diffLines.length > 10) {
      contentDiff += `\n... and ${diffLines.length - 10} more differences`;
    }
  }

  return {
    filePath,
    oldResult,
    newResult,
    differences: {
      fixes: {
        onlyInOld: onlyInOldFixes,
        onlyInNew: onlyInNewFixes,
        inBoth: inBothFixes,
      },
      issues: {
        onlyInOld: onlyInOldIssues,
        onlyInNew: onlyInNewIssues,
        inBoth: inBothIssues,
      },
      contentChanged,
      contentDiff,
    },
  };
}

/**
 * Generate summary report from comparison results
 */
export function generateComparisonReport(
  comparisons: ComparisonResult[]
): string {
  const totalFiles = comparisons.length;
  const filesWithDifferences = comparisons.filter(c => c.differences.contentChanged).length;
  const filesWithNewFixes = comparisons.filter(c => c.differences.fixes.onlyInNew.length > 0).length;
  const filesWithMissingFixes = comparisons.filter(c => c.differences.fixes.onlyInOld.length > 0).length;

  let report = `# Comparison Report: Old vs New Fixer System\n\n`;
  report += `## Summary\n`;
  report += `- Total files compared: ${totalFiles}\n`;
  report += `- Files with content differences: ${filesWithDifferences}\n`;
  report += `- Files with new fixes: ${filesWithNewFixes}\n`;
  report += `- Files with missing fixes: ${filesWithMissingFixes}\n\n`;

  report += `## Detailed Differences\n\n`;
  
  comparisons.forEach(comparison => {
    if (comparison.differences.contentChanged) {
      report += `### ${comparison.filePath}\n\n`;
      
      if (comparison.differences.fixes.onlyInNew.length > 0) {
        report += `**New fixes:**\n`;
        comparison.differences.fixes.onlyInNew.forEach(fix => {
          report += `- ${fix}\n`;
        });
        report += `\n`;
      }
      
      if (comparison.differences.fixes.onlyInOld.length > 0) {
        report += `**Missing fixes:**\n`;
        comparison.differences.fixes.onlyInOld.forEach(fix => {
          report += `- ${fix}\n`;
        });
        report += `\n`;
      }
      
      if (comparison.differences.contentDiff) {
        report += `**Content diff:**\n\`\`\`\n${comparison.differences.contentDiff}\n\`\`\`\n\n`;
      }
    }
  });

  return report;
}
