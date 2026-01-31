import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface DependencyConflict {
  packageName: string;
  versions: string[];
  conflictType: "multiple-versions" | "incompatible-versions" | "missing-peer";
  severity: "error" | "warning";
  message: string;
}

export interface DependencyCheckResult {
  hasConflicts: boolean;
  conflicts: DependencyConflict[];
  warnings: string[];
  recommendations: string[];
}

export interface CleanupResult {
  cleaned: boolean;
  removedFiles: string[];
  warnings: string[];
}

/**
 * Known incompatible dependency pairs for Vue 2 → Vue 3 migration
 */
const INCOMPATIBLE_PAIRS: Array<{
  vue2: { name: string; version: string };
  vue3: { name: string; version: string };
  reason: string;
}> = [
  {
    vue2: { name: "vue-loader", version: "^15" },
    vue3: { name: "vue-loader", version: "^17" },
    reason: "vue-loader 15 requires webpack 4, vue-loader 17 requires webpack 5",
  },
  {
    vue2: { name: "vue-template-compiler", version: "^2" },
    vue3: { name: "@vue/compiler-sfc", version: "^3" },
    reason: "vue-template-compiler is Vue 2 only, replaced by @vue/compiler-sfc in Vue 3",
  },
  {
    vue2: { name: "vuex", version: "^3" },
    vue3: { name: "pinia", version: "^2" },
    reason: "Vuex 3 is Vue 2 only, Pinia is the recommended state management for Vue 3",
  },
];

/**
 * Check for dependency conflicts before migration
 */
export async function checkDependencyConflicts(
  projectPath: string,
): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    hasConflicts: false,
    conflicts: [],
    warnings: [],
    recommendations: [],
  };

  const packageJsonPath = path.join(projectPath, "package.json");
  const packageLockPath = path.join(projectPath, "package-lock.json");

  try {
    // Read package.json
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    // Check for Vue 2 → Vue 3 incompatible pairs
    for (const pair of INCOMPATIBLE_PAIRS) {
      const hasVue2Dep = allDeps[pair.vue2.name]?.startsWith(pair.vue2.version);
      const hasVue3Dep = allDeps[pair.vue3.name];

      if (hasVue2Dep && hasVue3Dep) {
        result.hasConflicts = true;
        result.conflicts.push({
          packageName: `${pair.vue2.name} / ${pair.vue3.name}`,
          versions: [
            allDeps[pair.vue2.name] || "unknown",
            allDeps[pair.vue3.name] || "unknown",
          ],
          conflictType: "incompatible-versions",
          severity: "error",
          message: `${pair.reason}. Both ${pair.vue2.name} and ${pair.vue3.name} are present.`,
        });
      }
    }

    // Check for multiple versions of the same package (if package-lock.json exists)
    if (await fileExists(packageLockPath)) {
      try {
        const lockContent = await fs.readFile(packageLockPath, "utf-8");
        const lockJson = JSON.parse(lockContent);

        // Check for duplicate package versions in lock file
        const packageVersions = new Map<string, Set<string>>();

        function checkDependencies(deps: any) {
          if (!deps) return;
          for (const [name, version] of Object.entries(deps)) {
            if (typeof version === "string") {
              if (!packageVersions.has(name)) {
                packageVersions.set(name, new Set());
              }
              packageVersions.get(name)!.add(version);
            }
          }
        }

        if (lockJson.dependencies) {
          checkDependencies(lockJson.dependencies);
        }
        if (lockJson.packages) {
          for (const [pkgPath, pkg] of Object.entries(lockJson.packages)) {
            const pkgData = pkg as any;
            if (pkgData.version) {
              const pkgName = pkgPath === "" ? lockJson.name : pkgPath.split("/").pop() || "";
              if (!packageVersions.has(pkgName)) {
                packageVersions.set(pkgName, new Set());
              }
              packageVersions.get(pkgName)!.add(pkgData.version);
            }
          }
        }

        // Report conflicts
        for (const [pkgName, versions] of packageVersions.entries()) {
          if (versions.size > 1) {
            // Check if this is a critical package (webpack, vue-loader, etc.)
            const criticalPackages = ["webpack", "vue-loader", "vue", "vue-router"];
            const isCritical = criticalPackages.some((cp) =>
              pkgName.toLowerCase().includes(cp.toLowerCase()),
            );

            if (isCritical) {
              result.hasConflicts = true;
              result.conflicts.push({
                packageName: pkgName,
                versions: Array.from(versions),
                conflictType: "multiple-versions",
                severity: "error",
                message: `Multiple versions of ${pkgName} detected: ${Array.from(versions).join(", ")}. This can cause runtime errors.`,
              });
            } else {
              result.warnings.push(
                `Multiple versions of ${pkgName} detected: ${Array.from(versions).join(", ")}`,
              );
            }
          }
        }
      } catch (error) {
        result.warnings.push(
          `Could not parse package-lock.json: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // Check for webpack version conflicts specifically
    const webpackVersions = new Set<string>();
    if (allDeps.webpack) {
      webpackVersions.add(allDeps.webpack);
    }
    if (allDeps["@vue/cli-service"]) {
      // Vue CLI 4 uses webpack 4, Vue CLI 5 uses webpack 5
      const cliVersion = allDeps["@vue/cli-service"];
      if (cliVersion.startsWith("^4")) {
        webpackVersions.add("^4");
      } else if (cliVersion.startsWith("^5")) {
        webpackVersions.add("^5");
      }
    }

    if (webpackVersions.size > 1) {
      result.hasConflicts = true;
      result.conflicts.push({
        packageName: "webpack",
        versions: Array.from(webpackVersions),
        conflictType: "incompatible-versions",
        severity: "error",
        message: "Multiple webpack versions detected. Vue CLI 4 requires webpack 4, Vue CLI 5 requires webpack 5.",
      });
    }

    // Generate recommendations
    if (result.hasConflicts) {
      result.recommendations.push(
        "Run 'npm install' after migration to resolve dependency conflicts",
      );
      result.recommendations.push(
        "Consider removing node_modules and package-lock.json before migration for a clean install",
      );
    }

    return result;
  } catch (error) {
    result.warnings.push(
      `Error checking dependencies: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return result;
  }
}

/**
 * Clean up dependencies before migration
 */
export async function cleanupDependencies(
  projectPath: string,
  dryRun: boolean = false,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    cleaned: false,
    removedFiles: [],
    warnings: [],
  };

  const nodeModulesPath = path.join(projectPath, "node_modules");
  const packageLockPath = path.join(projectPath, "package-lock.json");
  const yarnLockPath = path.join(projectPath, "yarn.lock");
  const pnpmLockPath = path.join(projectPath, "pnpm-lock.yaml");

  try {
    // Check for conflicts first
    const conflicts = await checkDependencyConflicts(projectPath);

    if (conflicts.hasConflicts) {
      result.warnings.push(
        "Dependency conflicts detected. Cleaning up dependencies...",
      );

      if (!dryRun) {
        // Remove node_modules
        if (await fileExists(nodeModulesPath)) {
          await fs.rm(nodeModulesPath, { recursive: true, force: true });
          result.removedFiles.push("node_modules");
        }

        // Remove lock files
        const lockFiles = [
          { path: packageLockPath, name: "package-lock.json" },
          { path: yarnLockPath, name: "yarn.lock" },
          { path: pnpmLockPath, name: "pnpm-lock.yaml" },
        ];

        for (const lockFile of lockFiles) {
          if (await fileExists(lockFile.path)) {
            await fs.unlink(lockFile.path);
            result.removedFiles.push(lockFile.name);
          }
        }

        result.cleaned = true;
      } else {
        result.warnings.push(
          "[DRY RUN] Would remove: node_modules, package-lock.json, yarn.lock, pnpm-lock.yaml",
        );
      }
    }

    return result;
  } catch (error) {
    result.warnings.push(
      `Error cleaning dependencies: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return result;
  }
}

/**
 * Verify dependency consistency after migration
 */
export async function verifyDependencyConsistency(
  projectPath: string,
): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    hasConflicts: false,
    conflicts: [],
    warnings: [],
    recommendations: [],
  };

  const packageJsonPath = path.join(projectPath, "package.json");

  try {
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    // Check Vue version
    if (allDeps.vue) {
      if (allDeps.vue.startsWith("^2.")) {
        result.warnings.push(
          "Vue version is still 2.x. Migration may not have completed successfully.",
        );
      } else if (allDeps.vue.startsWith("^3.")) {
        // Check for Vue 2 specific dependencies that should be removed
        if (allDeps["vue-template-compiler"]) {
          result.hasConflicts = true;
          result.conflicts.push({
            packageName: "vue-template-compiler",
            versions: [allDeps["vue-template-compiler"]],
            conflictType: "incompatible-versions",
            severity: "error",
            message: "vue-template-compiler is Vue 2 only and should be removed. Use @vue/compiler-sfc instead.",
          });
        }

        // Check for vue-loader compatibility
        if (allDeps["vue-loader"]) {
          const loaderVersion = allDeps["vue-loader"];
          if (loaderVersion.startsWith("^15") || loaderVersion.startsWith("15")) {
            result.hasConflicts = true;
            result.conflicts.push({
              packageName: "vue-loader",
              versions: [loaderVersion],
              conflictType: "incompatible-versions",
              severity: "error",
              message: "vue-loader 15 is for Vue 2. Should be upgraded to vue-loader 17 for Vue 3.",
            });
          }
        }

        // Check for Vuex (should be replaced by Pinia)
        if (allDeps.vuex && !allDeps.pinia) {
          result.warnings.push(
            "Vuex is still present. Consider migrating to Pinia for Vue 3.",
          );
        }
      }
    }

    // Check for @vue/compiler-sfc if vue-loader 17 is present
    if (allDeps["vue-loader"]?.startsWith("^17") && !allDeps["@vue/compiler-sfc"]) {
      result.hasConflicts = true;
      result.conflicts.push({
        packageName: "@vue/compiler-sfc",
        versions: [],
        conflictType: "missing-peer",
        severity: "error",
        message: "vue-loader 17 requires @vue/compiler-sfc but it's not installed.",
      });
    }

    // Generate recommendations
    if (result.hasConflicts) {
      result.recommendations.push("Run 'npm install' to install missing dependencies");
      result.recommendations.push(
        "Remove incompatible Vue 2 dependencies manually if needed",
      );
    }

    return result;
  } catch (error) {
    result.warnings.push(
      `Error verifying dependencies: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return result;
  }
}

/**
 * Install dependencies after migration
 */
export async function installDependencies(
  projectPath: string,
  packageManager: "npm" | "yarn" | "pnpm" = "npm",
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const command =
      packageManager === "yarn"
        ? "yarn install"
        : packageManager === "pnpm"
          ? "pnpm install"
          : "npm install";

    const { stdout, stderr } = await execAsync(command, {
      cwd: projectPath,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    return {
      success: true,
      output: stdout,
      error: stderr || undefined,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Helper function to check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
