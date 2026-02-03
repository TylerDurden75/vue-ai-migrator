/**
 * Validation tests for the post-migration fixer (single-pass rule engine)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fixPostMigrationIssues } from "../src/utils/migration/post-migration-fixer/index";

interface ValidationResult {
  filePath: string;
  passed: boolean;
  differences: string[];
  fixes: string[];
}

/**
 * Validate fixer results for a set of files
 */
async function validateMigration(
  testProjectPath: string
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const vueFiles = await findVueFiles(testProjectPath);

  for (const filePath of vueFiles) {
    try {
      const content = await fs.readFile(filePath, "utf-8");

      const fixResult = await fixPostMigrationIssues(
        filePath,
        content,
        true, // enableTypeScript
        testProjectPath
      );

      const differences: string[] = [];

      if (fixResult.content.includes("export default") && fixResult.content.includes("<script setup")) {
        differences.push("export default found in <script setup>");
      }

      if (fixResult.issues.length > 0) {
        differences.push(...fixResult.issues);
      }

      results.push({
        filePath,
        passed: differences.length === 0,
        differences,
        fixes: fixResult.fixes
      });
    } catch (error) {
      results.push({
        filePath,
        passed: false,
        differences: [`Error: ${error instanceof Error ? error.message : String(error)}`],
        fixes: []
      });
    }
  }

  return results;
}

async function findVueFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!["node_modules", "dist", ".git", ".vue-migrator-backup"].includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith(".vue")) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walkDir(projectPath);
  return files;
}

export async function runValidation(testProjectPath: string): Promise<void> {
  console.log("🔍 Running Validation Tests...\n");
  console.log(`Test project: ${testProjectPath}\n`);

  const results = await validateMigration(testProjectPath);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${results.length}\n`);

  if (failed > 0) {
    console.log("❌ Failed Files:");
    results
      .filter((r) => !r.passed)
      .forEach((result) => {
        console.log(`\n  ${result.filePath}`);
        result.differences.forEach((diff) => console.log(`    - ${diff}`));
      });
  }

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

if (require.main === module) {
  const testProjectPath = process.argv[2] || path.join(__dirname, "../test-project");
  runValidation(testProjectPath).catch(console.error);
}
