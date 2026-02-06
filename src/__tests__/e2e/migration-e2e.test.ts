/**
 * E2E test: full migration flow (migrate → fix → build)
 * Uses fixtures/vue2-minimal as a minimal Vue 2 project.
 *
 * Run with: npm test -- --testPathPattern=e2e
 * Or: npm run test:e2e (if configured)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import { migrate } from "../../core/migrator";

const FIXTURE_PATH = path.join(__dirname, "../../../fixtures/vue2-minimal");
const TEST_TIMEOUT_MS = 120000; // 2 min for npm install + migrate + build

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", ".git"].includes(entry.name)) {
        await copyDir(srcPath, destPath);
      }
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

describe("E2E: Full migration flow", () => {
  let tempDir: string;

  beforeAll(async () => {
    // Check fixture exists
    try {
      await fs.access(path.join(FIXTURE_PATH, "package.json"));
    } catch {
      throw new Error(
        `Fixture not found at ${FIXTURE_PATH}. Run from project root.`
      );
    }
  }, TEST_TIMEOUT_MS);

  beforeEach(async () => {
    tempDir = path.join(
      require("os").tmpdir(),
      `vue-migrator-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await copyDir(FIXTURE_PATH, tempDir);
  }, TEST_TIMEOUT_MS);

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it(
    "should migrate Vue 2 project and build successfully",
    async () => {
      // 1. Install dependencies (Vue 2)
      execSync("npm install --silent", {
        cwd: tempDir,
        stdio: "pipe",
        timeout: 60000,
      });

      // 2. Run migration (no AI, no rollback for test isolation)
      const result = await migrate({
        projectPath: tempDir,
        dryRun: false,
        useAI: false,
        enableRollback: false,
        validateAfterMigration: false,
        enableTypeScript: false,
        verbose: false,
      });

      expect(result.errors).toHaveLength(0);

      // 3. Reinstall dependencies (Vue 3, Pinia, etc.)
      execSync("npm install --silent", {
        cwd: tempDir,
        stdio: "pipe",
        timeout: 60000,
      });

      // 4. Build
      execSync("npm run build", {
        cwd: tempDir,
        stdio: "pipe",
        timeout: 60000,
      });

      // 5. Verify dist was created
      const distPath = path.join(tempDir, "dist");
      const distExists = await fs
        .access(distPath)
        .then(() => true)
        .catch(() => false);
      expect(distExists).toBe(true);
    },
    TEST_TIMEOUT_MS
  );
});
