/**
 * Fixes import paths to use the @ alias for src/ directory.
 * Converts relative imports (e.g. ../../store/) to alias imports (e.g. @/store/).
 * Standalone util used by the post-migration fixer.
 */

import * as path from "path";

export function fixImportPaths(
  content: string,
  projectRoot: string,
  filePath: string
): string {
  let fixed = content;

  const relativeImportPattern = /from\s+['"](\.\.\/)+store\//g;
  if (relativeImportPattern.test(fixed)) {
    const srcPath = path.join(projectRoot, "src");
    if (filePath.startsWith(srcPath)) {
      fixed = fixed.replace(/from\s+['"](\.\.\/)+store\//g, 'from "@/store/');
      fixed = fixed.replace(/from\s+['"]\.\.\/store\//g, 'from "@/store/');
    }
  }

  return fixed;
}
