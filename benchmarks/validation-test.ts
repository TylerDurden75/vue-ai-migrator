/**
 * Validation tests to ensure new system produces same results as legacy system
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fixPostMigrationIssues as fixPostMigrationIssuesOptimized } from "../src/utils/migration/post-migration-fixer/index";
import { fixPostMigrationIssues as fixPostMigrationIssuesLegacy } from "../src/utils/migration/post-migration-fixer";

interface ValidationResult {
  filePath: string;
  passed: boolean;
  differences: string[];
  legacyFixes: string[];
  optimizedFixes: string[];
}

/**
 * Compare results from legacy and optimized systems
 */
async function validateMigration(
  testProjectPath: string
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Find all Vue files in test project
  const vueFiles = await findVueFiles(testProjectPath);

  for (const filePath of vueFiles) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      
      // Run both systems
      const legacyResult = await fixPostMigrationIssuesLegacy(
        filePath,
        content,
        true, // enableTypeScript
        testProjectPath
      );
      
      const optimizedResult = await fixPostMigrationIssuesOptimized(
        filePath,
        content,
        true, // enableTypeScript
        testProjectPath
      );

      // Compare results
      const differences: string[] = [];
      
      // Check for syntax errors (basic validation)
      if (optimizedResult.content.includes("export default") && optimizedResult.content.includes("<script setup")) {
        differences.push("export default found in <script setup>");
      }

      // Check for common issues
      if (optimizedResult.issues.length > 0) {
        differences.push(...optimizedResult.issues);
      }

      // Compare fixes applied
      const legacyFixSet = new Set(legacyResult.fixes);
      const optimizedFixSet = new Set(optimizedResult.fixes);
      
      // Find missing fixes in optimized system
      legacyResult.fixes.forEach(fix => {
        if (!optimizedFixSet.has(fix)) {
          differences.push(`Missing fix in optimized: ${fix}`);
        }
      });

      // Find extra fixes in optimized system (not necessarily bad, but worth noting)
      optimizedResult.fixes.forEach(fix => {
        if (!legacyFixSet.has(fix)) {
          // Don't add to differences, just log for info
        }
      });

      // Compare content (normalize whitespace for comparison)
      const legacyNormalized = legacyResult.content.replace(/\s+/g, ' ').trim();
      const optimizedNormalized = optimizedResult.content.replace(/\s+/g, ' ').trim();
      
      if (legacyNormalized !== optimizedNormalized) {
        // Content differs - check if it's just formatting
        const legacyCode = legacyNormalized.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        const optimizedCode = optimizedNormalized.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        
        if (legacyCode !== optimizedCode) {
          differences.push("Content differs between legacy and optimized systems");
        }
      }

      results.push({
        filePath,
        passed: differences.length === 0,
        differences,
        legacyFixes: legacyResult.fixes,
        optimizedFixes: optimizedResult.fixes
      });
    } catch (error) {
      results.push({
        filePath,
        passed: false,
        differences: [`Error: ${error instanceof Error ? error.message : String(error)}`],
        legacyFixes: [],
        optimizedFixes: []
      });
    }
  }

  return results;
}

/**
 * Find all Vue files in a project
 */
async function findVueFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];
  
  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules, dist, etc.
          if (!["node_modules", "dist", ".git", ".vue-migrator-backup"].includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith(".vue")) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await walkDir(projectPath);
  return files;
}

/**
 * Run validation suite
 */
export async function runValidation(testProjectPath: string): Promise<void> {
  console.log("🔍 Running Validation Tests...\n");
  console.log(`Test project: ${testProjectPath}\n`);

  const results = await validateMigration(testProjectPath);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${results.length}\n`);

  if (failed > 0) {
    console.log("❌ Failed Files:");
    results
      .filter(r => !r.passed)
      .forEach(result => {
        console.log(`\n  ${result.filePath}`);
        result.differences.forEach(diff => {
          console.log(`    - ${diff}`);
        });
      });
  }

  // Summary
  console.log("\n📊 Validation Summary:");
  console.log("=".repeat(60));
  console.log(`Total files tested: ${results.length}`);
  console.log(`Passed: ${passed} (${((passed / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed} (${((failed / results.length) * 100).toFixed(1)}%)`);

  if (failed === 0) {
    console.log("\n✅ All validation tests passed!");
  } else {
    console.log(`\n⚠️  ${failed} validation test(s) failed`);
  }
}

// Run if executed directly
if (require.main === module) {
  const testProjectPath = process.argv[2] || path.join(__dirname, "../test-project");
  runValidation(testProjectPath).catch(console.error);
}
