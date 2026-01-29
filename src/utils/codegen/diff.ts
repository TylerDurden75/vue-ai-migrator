/**
 * Diff utilities for showing changes in dry-run mode
 */

import { diffLines } from 'diff';

export interface DiffResult {
  added: number;
  removed: number;
  unchanged: number;
  parts: Array<{
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;
}

/**
 * Generate a diff between two strings
 */
export function generateDiff(oldCode: string, newCode: string): DiffResult {
  const diffResult = diffLines(oldCode, newCode);

  const parts: DiffResult['parts'] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const part of diffResult) {
    const lines = part.value.split('\n');
    const lineCount = lines.length - (part.value.endsWith('\n') ? 0 : 1);

    if (part.added) {
      added += lineCount;
      parts.push({
        value: part.value,
        added: true,
      });
    } else if (part.removed) {
      removed += lineCount;
      parts.push({
        value: part.value,
        removed: true,
      });
    } else {
      unchanged += lineCount;
      parts.push({
        value: part.value,
      });
    }
  }

  return {
    added,
    removed,
    unchanged,
    parts,
  };
}

/**
 * Format diff for console output with colors
 */
export function formatDiffForConsole(diffResult: DiffResult): string {
  const lines: string[] = [];

  for (const part of diffResult.parts) {
    const partLines = part.value.split('\n');

    for (const line of partLines) {
      if (part.added) {
        lines.push(`+ ${line}`);
      } else if (part.removed) {
        lines.push(`- ${line}`);
      } else {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate a summary of changes
 */
export function getDiffSummary(diffResult: DiffResult): string {
  return `+${diffResult.added} -${diffResult.removed} (${diffResult.unchanged} unchanged)`;
}
