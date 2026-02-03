import { CodemodRunner } from "../codemods/runner";
import { UnifiedAIService } from "../ai/unified-service";
import { MigrationClassifier, ClassificationResult } from "./classifier";
import type { IAIService, AgentResponse } from "../interfaces";
import { analyzeProject } from "../utils/analysis";
import { TestGenerator } from "../utils/codegen";
import { generateDiff, DiffResult } from "../utils/codegen";
import {
  validateProjectPath,
  safeReadFile,
  safeWriteFile,
  retry,
  MigrationError,
} from "../utils/safety";
import { RollbackManager } from "../utils/safety";
import { migratePackageJson } from "../utils/migration";
import {
  migrateWebpackConfig,
  migrateVueConfig,
} from "../utils/migration/webpack-config-migrator";
import { migrateToViteConfig } from "../utils/migration/vite-config-migrator";
import { validateMigration } from "../utils/migration";
import {
  fixPostMigrationIssues,
  fixImportPaths,
} from "../utils/migration/post-migration-fixer";
import {
  checkDependencyConflicts,
  cleanupDependencies,
  verifyDependencyConsistency,
} from "../utils/migration/dependency-checker";
import { createOrUpdateTsConfig } from "../utils/migration/typescript-config";
import { createVue3ConfigFiles } from "../utils/migration/prettier-formatter";
import { CacheManager } from "../utils/cache";
import { MigrationReporter, FileReport } from "./reporter";
import * as path from "path";
import * as fs from "fs/promises";
import { glob } from "glob";

export interface MigrationOptions {
  projectPath: string;
  aiApiKey?: string;
  aiProvider?: "openai" | "mistral" | "claude" | "anthropic";
  dryRun?: boolean;
  useAI?: boolean;
  outputReport?: string;
  transformations?: string[];
  enableRollback?: boolean;
  migratePackageJson?: boolean;
  validateAfterMigration?: boolean;
  useCache?: boolean;
  incremental?: boolean;
  generateTests?: boolean;
  showDiff?: boolean;
  classifyFiles?: boolean;
  enableTypeScript?: boolean;
  verbose?: boolean; // Enable verbose logging (DEBUG messages, detailed fixes)
}

export interface MigrationResult {
  filesAnalyzed: number;
  filesModified: number;
  transformationsApplied: number;
  errors: string[];
  warnings: string[];
  reportPath?: string;
  classification?: {
    simple: number;
    medium: number;
    complex: number;
  };
  diffs?: Record<string, DiffResult>;
  explanations?: Record<string, string>;
  testFilesGenerated?: number;
}

export async function migrate(
  options: MigrationOptions
): Promise<MigrationResult> {
  const {
    projectPath,
    aiApiKey,
    aiProvider = "openai",
    dryRun = false,
    useAI = false, // AI is now opt-in by default (free mode)
    outputReport = "migration-report.json",
    enableRollback = true,
    migratePackageJson: shouldMigratePackage = true,
    validateAfterMigration: shouldValidate = true,
    useCache = true,
    incremental = false,
  } = options;

  const result: MigrationResult = {
    filesAnalyzed: 0,
    filesModified: 0,
    transformationsApplied: 0,
    errors: [],
    warnings: [],
  };

  try {
    // Validate project path
    validateProjectPath(projectPath);

    // Check for dependency conflicts BEFORE migration
    console.log("Checking for dependency conflicts...");
    const preMigrationConflicts = await checkDependencyConflicts(projectPath);

    if (preMigrationConflicts.hasConflicts) {
      const errorConflicts = preMigrationConflicts.conflicts.filter(
        (c) => c.severity === "error"
      );
      if (errorConflicts.length > 0) {
        console.warn("⚠️  Dependency conflicts detected before migration:");
        errorConflicts.forEach((conflict) => {
          console.warn(`  - ${conflict.packageName}: ${conflict.message}`);
        });

        // Auto-cleanup if conflicts are detected
        if (options.verbose) {
          console.log("Cleaning up dependencies to resolve conflicts...");
        }
        const cleanupResult = await cleanupDependencies(projectPath, dryRun);

        if (cleanupResult.cleaned && !dryRun) {
          console.log(`✓ Cleaned up: ${cleanupResult.removedFiles.join(", ")}`);
          result.warnings.push(
            `Cleaned up dependencies before migration: ${cleanupResult.removedFiles.join(", ")}`
          );
        } else if (dryRun) {
          result.warnings.push(
            `[DRY RUN] Would clean up: ${cleanupResult.removedFiles.join(", ")}`
          );
        }

        // Show recommendations
        if (preMigrationConflicts.recommendations.length > 0) {
          if (options.verbose) {
            console.log("Recommendations:");
            preMigrationConflicts.recommendations.forEach((rec) => {
              console.log(`  - ${rec}`);
            });
          }
        }
      }

      // Add warnings for non-critical conflicts
      preMigrationConflicts.conflicts
        .filter((c) => c.severity === "warning")
        .forEach((conflict) => {
          result.warnings.push(`${conflict.packageName}: ${conflict.message}`);
        });
    } else {
      console.log("✓ No critical dependency conflicts detected");
    }

    // Analyze the project
    const analysis = await analyzeProject(projectPath);

    // Find all Vue files
    const vueFiles = await glob("**/*.{vue,js,ts}", {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", "build/**"],
      absolute: true,
    });

    result.filesAnalyzed = vueFiles.length;

    if (vueFiles.length === 0) {
      result.warnings.push("No Vue files found in the project");
      return result;
    }

    // Initialize services
    const codemodRunner = new CodemodRunner();
    const migrationAgent: IAIService | null =
      useAI && aiApiKey
        ? new UnifiedAIService({
            provider: aiProvider,
            apiKey: aiApiKey,
          })
        : null;
    const classifier = new MigrationClassifier();
    const testGenerator = options.generateTests ? new TestGenerator() : null;
    const reporter = new MigrationReporter();
    const rollbackManager = enableRollback
      ? new RollbackManager(projectPath)
      : null;
    const cacheManager = useCache ? new CacheManager(projectPath) : null;

    // Load cache early for better performance
    if (cacheManager) {
      await cacheManager.loadCache();
    }

    // Track classification and diffs
    const fileReports: FileReport[] = [];
    const diffs: Record<string, DiffResult> = {};
    const classificationCounts = { simple: 0, medium: 0, complex: 0 };
    const explanations: Record<string, string> = {};

    // Load existing backups if rollback is enabled
    if (rollbackManager && !dryRun) {
      await rollbackManager.loadBackups();

      // Backup important configuration files before migration
      const configFiles = [
        path.join(projectPath, "package.json"),
        path.join(projectPath, "webpack.config.js"),
        path.join(projectPath, "vite.config.js"),
        path.join(projectPath, "vue.config.js"),
      ];

      // Only backup tsconfig.json if TypeScript is enabled (it will be created/modified)
      if (options.enableTypeScript) {
        configFiles.push(path.join(projectPath, "tsconfig.json"));
      }

      for (const configFile of configFiles) {
        try {
          await rollbackManager.backupFile(configFile);
        } catch {
          // File doesn't exist, skip silently
        }
      }
    }

    // Load cache if enabled
    if (cacheManager) {
      await cacheManager.loadCache();
    }

    // Cache for file content hashes to avoid reprocessing unchanged files (fallback)
    const fileCache = new Map<string, string>();

    // Determine transformations to apply
    let transformationsToApply =
      options.transformations ||
      Object.keys(CodemodRunner.AVAILABLE_TRANSFORMS);

    // If vuex-pinia is used, automatically add vuex-pinia-components
    if (
      transformationsToApply.includes("vuex-pinia") &&
      !transformationsToApply.includes("vuex-pinia-components")
    ) {
      transformationsToApply = [
        ...transformationsToApply,
        "vuex-pinia-components",
      ];
    }

    // Ensure vuex-pinia-components runs after vuex-pinia
    if (
      transformationsToApply.includes("vuex-pinia") &&
      transformationsToApply.includes("vuex-pinia-components")
    ) {
      const vuexIndex = transformationsToApply.indexOf("vuex-pinia");
      const componentsIndex = transformationsToApply.indexOf(
        "vuex-pinia-components"
      );
      if (componentsIndex < vuexIndex) {
        // Move vuex-pinia-components after vuex-pinia
        transformationsToApply.splice(componentsIndex, 1);
        transformationsToApply.splice(
          vuexIndex + 1,
          0,
          "vuex-pinia-components"
        );
      }
    }

    // Process files in parallel batches for better performance
    // Optimized batch size based on project size and available resources
    // Smaller batches for large projects to avoid memory issues
    const getOptimalBatchSize = (fileCount: number): number => {
      if (fileCount < 50) return 20; // Small projects: larger batches
      if (fileCount < 200) return 15; // Medium projects: medium batches
      if (fileCount < 500) return 10; // Large projects: smaller batches
      return 8; // Very large projects: small batches to avoid memory pressure
    };

    const BATCH_SIZE = getOptimalBatchSize(vueFiles.length);
    const batches: string[][] = [];
    for (let i = 0; i < vueFiles.length; i += BATCH_SIZE) {
      batches.push(vueFiles.slice(i, i + BATCH_SIZE));
    }

    // Process batches sequentially, files within batch in parallel
    // Use Promise.allSettled for better error handling and to continue on errors
    for (const batch of batches) {
      await Promise.allSettled(
        batch.map(async (filePath) => {
          try {
            const content = await safeReadFile(filePath);

            // Check cache if enabled and incremental mode
            if (cacheManager && incremental) {
              if (
                !cacheManager.needsProcessing(
                  filePath,
                  content,
                  transformationsToApply
                )
              ) {
                return; // Skip if already processed with same transformations
              }
            }

            // Create backup before modification if rollback is enabled
            if (rollbackManager && !dryRun) {
              await rollbackManager.backupFile(filePath);
            }

            // Simple hash-based cache check (fallback if cache manager not used)
            if (!cacheManager) {
              const contentHash = `${content.length}-${content.slice(0, 50)}-${content.slice(-50)}`;
              const cachedHash = fileCache.get(filePath);

              // Skip if file hasn't changed (simple optimization)
              if (cachedHash === contentHash && !dryRun) {
                return;
              }
            }

            // Classify file complexity
            let classification: ClassificationResult | undefined;
            if (options.classifyFiles !== false) {
              classification = await classifier.classify(filePath, content, {
                useAIForAnalysis: !!migrationAgent,
                aiService: migrationAgent
                  ? {
                      analyzeComplexity: async (code: string) => {
                        try {
                          const agentResult: AgentResponse =
                            await migrationAgent.migrate({
                              code,
                              filePath,
                              issues: [],
                              classification: "medium",
                            });
                          return {
                            complexity:
                              agentResult.confidence &&
                              agentResult.confidence > 0.8
                                ? "high"
                                : ("medium" as const),
                            recommendations: agentResult.suggestions || [],
                          };
                        } catch {
                          return {
                            complexity: "medium" as const,
                            recommendations: [],
                          };
                        }
                      },
                    }
                  : undefined,
              });
              const level = classification.level;
              if (
                level === "simple" ||
                level === "medium" ||
                level === "complex"
              ) {
                classificationCounts[level]++;
              }
            }

            // Apply codemod transformations
            const codemodResult = await codemodRunner.transform(
              filePath,
              content,
              {
                transformations: transformationsToApply,
                enableTypeScript: options.enableTypeScript || false,
              }
            );

            let finalCode = codemodResult.code;
            let migrated = codemodResult.modified;
            let explanation: string | undefined;

            // Debug: Log migration status
            if (migrated) {
              const codeChanged = finalCode !== content;
              if (!codeChanged) {
                result.warnings.push(
                  options.verbose === true ? `DEBUG: ${path.relative(projectPath, filePath)} marked as migrated but codemod code === original content` : `File ${path.relative(projectPath, filePath)} marked as migrated but no changes detected`
                );
              }
            }

            // For complex cases, use MigrationAgent with retry logic
            if (
              migrationAgent &&
              (codemodResult.needsAI || classification?.level === "complex")
            ) {
              try {
                const agentResult: AgentResponse = await retry(
                  async () =>
                    migrationAgent!.migrate({
                      code: codemodResult.code,
                      filePath,
                      issues: codemodResult.issues,
                      classification: classification?.level || "medium",
                    }),
                  {
                    maxRetries: 2,
                    retryDelay: 1000,
                    onRetry: (attempt: number, error: Error) => {
                      result.warnings.push(
                        `AI retry attempt ${attempt} for ${filePath}: ${error.message}`
                      );
                    },
                  }
                );

                if (agentResult.success && agentResult.migratedCode) {
                  finalCode = agentResult.migratedCode;
                  migrated = true;
                  explanation = agentResult.explanation;
                  result.transformationsApplied++;

                  // Generate tests if requested and migration successful
                  if (testGenerator && agentResult.migratedCode) {
                    try {
                      const componentName =
                        filePath.split("/").pop()?.replace(".vue", "") ||
                        "Component";
                      const testResult = await testGenerator.generateTest(
                        filePath,
                        agentResult.migratedCode,
                        {
                          componentName,
                        }
                      );
                      await testGenerator.writeTest(testResult);
                      result.testFilesGenerated =
                        (result.testFilesGenerated || 0) + 1;
                    } catch (error) {
                      result.warnings.push(
                        `Could not generate test for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
                      );
                    }
                  }
                } else {
                  result.warnings.push(
                    `AI could not migrate ${filePath}: ${agentResult.reason || "Unknown reason"}`
                  );
                }
              } catch (error) {
                result.errors.push(
                  `AI error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }

            // Generate diff if dry-run mode
            if (dryRun && migrated && content !== finalCode) {
              diffs[filePath] = generateDiff(content, finalCode);
              if (explanation) {
                explanations[filePath] = explanation;
              }
            }

            // Update cache
            if (cacheManager) {
              if (migrated) {
                cacheManager.markProcessed(
                  filePath,
                  finalCode,
                  transformationsToApply
                );
              } else {
                cacheManager.markProcessed(
                  filePath,
                  content,
                  transformationsToApply
                );
              }
            } else {
              // Fallback cache
              if (migrated) {
                fileCache.set(
                  filePath,
                  `${finalCode.length}-${finalCode.slice(0, 50)}-${finalCode.slice(-50)}`
                );
              } else {
                const contentHash = `${content.length}-${content.slice(0, 50)}-${content.slice(-50)}`;
                fileCache.set(filePath, contentHash);
              }
            }

            // Check if this is a mixin file that needs processing
            const isMixinFile =
              filePath.includes("/mixins/") ||
              filePath.includes("mixin.ts") ||
              filePath.includes("mixin.js");
            
            // Process mixin files even if not modified by codemods
            if (migrated || isMixinFile) {
              // Debug logging (only if verbose mode)
              if (options.verbose === true) {
                const relativePath = path.relative(projectPath, filePath);
                result.warnings.push(
                  `DEBUG: Processing ${relativePath} - migrated=${migrated}, codeChanged=${finalCode !== content}, dryRun=${dryRun}, isMixinFile=${isMixinFile}`
                );
              }

              // Only save if code actually changed or if it's a mixin file
              const shouldProcess = finalCode !== content || isMixinFile;

              // Debug: log mixin file processing (only if verbose mode)
              if (isMixinFile && options.verbose === true) {
                result.warnings.push(
                  `DEBUG: Processing mixin file ${path.relative(projectPath, filePath)} - shouldProcess=${shouldProcess}, codeChanged=${finalCode !== content}`
                );
              }
              let fixResult: {
                fixed: boolean;
                content: string;
                fixes: string[];
                issues: string[];
              } | null = null;

              if (shouldProcess) {
                if (!dryRun) {
                  // Apply post-migration fixes
                  try {
                    fixResult = await fixPostMigrationIssues(
                      filePath,
                      finalCode,
                      options.enableTypeScript || false,
                      projectPath // Pass projectRoot for dynamic store analysis
                    );
                    if (fixResult.fixed) {
                      finalCode = fixResult.content;
                      // Only log post-migration fixes if verbose mode is enabled
                      if (options.verbose === true && fixResult.fixes.length > 0) {
                        result.warnings.push(
                          `Post-migration fixes for ${path.relative(projectPath, filePath)}: ${fixResult.fixes.join(", ")}`
                        );
                      }
                    }

                    // Fix import paths to use @ alias
                    finalCode = fixImportPaths(
                      finalCode,
                      projectPath,
                      filePath
                    );

                    // Report issues found but not fixed
                    if (fixResult.issues.length > 0) {
                      result.warnings.push(
                        `Issues detected in ${path.relative(projectPath, filePath)}: ${fixResult.issues.join(", ")}`
                      );
                    }
                  } catch (error) {
                    // If fixing fails, still write the file but warn
                    result.warnings.push(
                      `Post-migration fixer failed for ${path.relative(projectPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`
                    );
                  }

                  // Double-check that code is still different after fixes
                  // For mixin files, always save if fixes were applied
                  if (
                    finalCode !== content ||
                    (isMixinFile && fixResult && fixResult.fixed)
                  ) {
                    try {
                      // Rename .js to .ts if TypeScript is enabled and file is a .js file
                      let targetFilePath = filePath;
                      if (
                        options.enableTypeScript &&
                        filePath.endsWith(".js") &&
                        !filePath.endsWith(".vue")
                      ) {
                        const newFilePath = filePath.replace(/\.js$/, ".ts");
                        // Backup old file if it exists and we're renaming
                        if (rollbackManager && !dryRun) {
                          await rollbackManager.backupFile(filePath);
                        }
                        // Delete old .js file if it exists
                        try {
                          await fs.unlink(filePath);
                        } catch (unlinkError) {
                          // File might not exist, that's okay
                        }
                        targetFilePath = newFilePath;
                        result.warnings.push(
                          `Renamed ${path.relative(projectPath, filePath)} → ${path.relative(projectPath, newFilePath)} (TypeScript)`
                        );
                      }

                      await safeWriteFile(targetFilePath, finalCode);
                      // Verify file was written correctly
                      const writtenContent = await safeReadFile(targetFilePath);
                      if (writtenContent !== finalCode) {
                        result.warnings.push(
                          `File ${path.relative(projectPath, targetFilePath)} was written but content doesn't match expected result`
                        );
                      } else {
                        // Successfully written
                        result.warnings.push(
                          `✓ Successfully migrated ${path.relative(projectPath, targetFilePath)}`
                        );
                      }
                    } catch (error) {
                      result.errors.push(
                        `Failed to write ${path.relative(projectPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`
                      );
                    }
                  } else {
                    result.warnings.push(
                      `File ${path.relative(projectPath, filePath)} was transformed but post-fixes restored original content`
                    );
                  }
                }
                result.filesModified++;
              } else {
                // Code marked as migrated but didn't actually change
                result.warnings.push(
                  `File ${path.relative(projectPath, filePath)} marked as migrated but content unchanged (codemod returned same code)`
                );
              }
              result.transformationsApplied +=
                codemodResult.transformationsApplied;
            }

            // Create file report
            const fileReport: FileReport = {
              filePath,
              classification: classification || {
                level: "medium",
                confidence: 0.5,
                reasons: [],
                requiresAI: false,
                autoMigratable: true,
              },
              migrated,
              transformationsApplied: migrated ? transformationsToApply : [],
              timeTaken: 0, // Time tracking can be added in future versions
            };

            if (dryRun && diffs[filePath]) {
              fileReport.diff = diffs[filePath];
            }

            if (explanation) {
              fileReport.explanation = explanation;
            }

            fileReports.push(fileReport);
          } catch (error) {
            if (error instanceof MigrationError) {
              result.errors.push(
                `[${error.code}] ${error.message}${error.filePath ? ` (${error.filePath})` : ""}`
              );
            } else {
              result.errors.push(
                `Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        })
      );
    }

    // Add classification, diffs, and explanations to result
    result.classification = classificationCounts;
    if (dryRun && Object.keys(diffs).length > 0) {
      result.diffs = diffs;
    }
    if (Object.keys(explanations).length > 0) {
      result.explanations = explanations;
    }

    // Generate report
    if (outputReport) {
      const reportPath = await reporter.generateReport(
        result,
        fileReports,
        outputReport
      );
      result.reportPath = reportPath;
    }

    // Migrate package.json if requested
    if (shouldMigratePackage) {
      try {
        // Backup package.json before migration (ensure it's backed up before modification)
        const packageJsonPath = path.join(projectPath, "package.json");
        if (rollbackManager && !dryRun) {
          try {
            // Always backup package.json before modifying it
            // backupFile will read the current content, so this must be called BEFORE migratePackageJson
            await rollbackManager.backupFile(packageJsonPath);
          } catch {
            // File doesn't exist or can't be read, skip silently
          }
        }

        const packageResult = await migratePackageJson(
          projectPath,
          dryRun,
          options.enableTypeScript || false
        );
        if (packageResult.modified) {
          result.warnings.push(
            ...packageResult.changes.map((c) => `Package: ${c}`)
          );
          result.warnings.push(...packageResult.warnings);
        }

        // Create or update tsconfig.json if TypeScript is enabled (ALWAYS, regardless of package.json modification)
        if (options.enableTypeScript) {
          try {
            const tsconfigPath = path.join(projectPath, "tsconfig.json");

            // Check if tsconfig.json exists BEFORE creating it (for rollback tracking)
            let tsconfigExistedBefore = false;
            try {
              await fs.access(tsconfigPath);
              tsconfigExistedBefore = true;
            } catch {
              tsconfigExistedBefore = false;
            }

            // Create backup BEFORE creating/updating the file
            if (rollbackManager && !dryRun && !tsconfigExistedBefore) {
              // File doesn't exist, create empty backup to mark it as "created during migration"
              (rollbackManager as any).backups.set(tsconfigPath, {
                filePath: tsconfigPath,
                originalContent: "", // Empty = file was created
                timestamp: new Date(),
              });
            } else if (rollbackManager && !dryRun && tsconfigExistedBefore) {
              // File exists, backup its current content
              await rollbackManager.backupFile(tsconfigPath);
            }

            // Now create or update tsconfig.json
            const tsConfigResult = await createOrUpdateTsConfig(
              projectPath,
              dryRun
            );
            if (tsConfigResult.created || tsConfigResult.modified) {
              result.warnings.push(
                ...tsConfigResult.changes.map((c) => `TypeScript Config: ${c}`)
              );
              result.warnings.push(...tsConfigResult.warnings);
            }
            
            // Create Prettier and ESLint config files for Vue 3
            if (!dryRun) {
              try {
                await createVue3ConfigFiles(projectPath);
                result.warnings.push("Created Prettier and ESLint config files for Vue 3");
              } catch (error) {
                // Config file creation failed, that's fine
              }
            }
          } catch (error) {
            result.warnings.push(
              `TypeScript config error: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        // After package.json migration, verify dependency consistency
        if (!dryRun && packageResult.modified) {
          if (options.verbose) {
            console.log("Verifying dependency consistency after migration...");
          }
          const postMigrationCheck =
            await verifyDependencyConsistency(projectPath);

          if (postMigrationCheck.hasConflicts) {
            const errorConflicts = postMigrationCheck.conflicts.filter(
              (c) => c.severity === "error"
            );
            errorConflicts.forEach((conflict) => {
              result.errors.push(
                `Dependency conflict: ${conflict.packageName} - ${conflict.message}`
              );
            });

            // Show recommendations
            if (postMigrationCheck.recommendations.length > 0) {
              console.log("Recommendations to fix dependency issues:");
              postMigrationCheck.recommendations.forEach((rec) => {
                console.log(`  - ${rec}`);
                result.warnings.push(`Recommendation: ${rec}`);
              });
            }
          } else {
            if (options.verbose) {
              console.log("✓ Dependency consistency verified");
            }
          }

          // Add warnings
          postMigrationCheck.warnings.forEach((warning) => {
            result.warnings.push(warning);
          });
        }
      } catch (error) {
        result.warnings.push(
          `Package migration error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Migrate vue.config.js to vite.config.js/ts (Vue 3 uses Vite, not Vue CLI)
    let viteConfigResult: any = null;
    try {
      const vueConfigPath = path.join(projectPath, "vue.config.js");
      // Backup vue.config.js before migration if not already backed up
      if (rollbackManager && !dryRun) {
        try {
          await rollbackManager.backupFile(vueConfigPath);
        } catch {
          // Already backed up or doesn't exist
        }
      }

      // Migrate to Vite (recommended for Vue 3)
      // This will create vite.config.ts/js, update package.json, and clean up legacy files
      try {
        viteConfigResult = await migrateToViteConfig(
          projectPath,
          dryRun,
          options.enableTypeScript || false,
          rollbackManager
        );
        if (viteConfigResult.modified || viteConfigResult.created) {
          result.warnings.push(
            ...viteConfigResult.changes.map((c: string) => `Vite Config: ${c}`)
          );
          result.warnings.push(...viteConfigResult.warnings);
        }
      } catch (error) {
        // Vite migration failed, continue with legacy migration
        viteConfigResult = null;
      }

      // Skip legacy vue.config.js migration if Vite migration was successful
      // Vite is the recommended approach for Vue 3, and we've already cleaned up vue.config.js
      if (!viteConfigResult || (!viteConfigResult.modified && !viteConfigResult.created)) {
        // Only migrate vue.config.js for Vue CLI compatibility if Vite migration didn't happen
        // This is for edge cases where Vite migration was skipped
        const vueConfigResult = await migrateVueConfig(
          projectPath,
          dryRun,
          options.enableTypeScript || false
        );
        if (vueConfigResult.modified) {
          result.warnings.push(
            ...vueConfigResult.changes.map((c) => `Vue Config (legacy): ${c}`)
          );
          result.warnings.push(...vueConfigResult.warnings);
          result.warnings.push(
            "Note: Vue 3 projects should use Vite (vite.config.js/ts) instead of Vue CLI (vue.config.js)"
          );
        }
      }
    } catch (error) {
      // vue.config.js doesn't exist or error, that's fine
    }

    // Skip webpack.config.js migration if Vite migration was successful
    // Vite replaces webpack, so we don't need to migrate webpack.config.js
    // The vite migration already handles cleanup of webpack.config.js
    if (!viteConfigResult || (!viteConfigResult.modified && !viteConfigResult.created)) {
      // Only migrate webpack.config.js if Vite migration didn't happen
      try {
        const webpackConfigPath = path.join(projectPath, "webpack.config.js");
        // Backup webpack.config.js before migration if not already backed up
        if (rollbackManager && !dryRun) {
          try {
            await rollbackManager.backupFile(webpackConfigPath);
          } catch {
            // Already backed up or doesn't exist
          }
        }

        const webpackResult = await migrateWebpackConfig(projectPath, dryRun);
        if (webpackResult.modified) {
          result.warnings.push(
            ...webpackResult.changes.map((c) => `Webpack: ${c}`)
          );
          result.warnings.push(...webpackResult.warnings);
        }
      } catch (error) {
        // webpack.config.js doesn't exist or error, that's fine
      }
    }

    // Validate migration if requested
    let validationResult = null;
    if (shouldValidate && !dryRun) {
      try {
        validationResult = await validateMigration(projectPath);
        if (!validationResult.valid) {
          result.errors.push(...validationResult.errors);
        }
        result.warnings.push(...validationResult.warnings);
      } catch (error) {
        result.warnings.push(
          `Validation error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Second pass: Fix remaining issues after all stores are migrated
    // GENERIC: This ensures store analysis works correctly after all stores are migrated
    if (!dryRun && result.filesModified > 0) {
      try {
        // Clear the store analysis cache to force re-analysis with migrated stores
        const { clearStoreAnalysisCache } =
          await import("../utils/migration/post-migration-fixer");
        if (clearStoreAnalysisCache) {
          clearStoreAnalysisCache();
        }

        // Re-process Vue files to fix remaining issues (missing store imports, etc.)
        const vueFilesToFix = vueFiles.filter(
          (file) =>
            file.endsWith(".vue") &&
            !file.includes("node_modules") &&
            !file.includes("dist")
        );

        for (const filePath of vueFilesToFix) {
          try {
            const content = await safeReadFile(filePath);
            if (content) {
              const fixResult = await fixPostMigrationIssues(
                filePath,
                content,
                options.enableTypeScript || false,
                projectPath
              );
              if (fixResult.fixed && fixResult.fixes.length > 0) {
                await safeWriteFile(filePath, fixResult.content);
                // Only log second pass fixes if verbose mode is enabled
                if (options.verbose === true) {
                  result.warnings.push(
                    `Second pass fixes for ${path.relative(projectPath, filePath)}: ${fixResult.fixes.join(", ")}`
                  );
                }
                // Otherwise, silently apply fixes
              }
            }
          } catch (error) {
            // Skip files that can't be read or fixed
          }
        }

        // Third pass: Clean up duplicates and final fixes
        // GENERIC: Final cleanup pass to remove any remaining duplicates or issues
        for (const filePath of vueFilesToFix) {
          try {
            const content = await safeReadFile(filePath);
            if (content) {
              const fixResult = await fixPostMigrationIssues(
                filePath,
                content,
                options.enableTypeScript || false,
                projectPath
              );
              if (fixResult.fixed && fixResult.fixes.length > 0) {
                await safeWriteFile(filePath, fixResult.content);
                // Only log third pass fixes if verbose mode is enabled
                if (options.verbose === true) {
                  result.warnings.push(
                    `Third pass fixes for ${path.relative(projectPath, filePath)}: ${fixResult.fixes.join(", ")}`
                  );
                }
                // Otherwise, silently apply fixes
              }
            }
          } catch (error) {
            // Skip files that can't be read or fixed
          }
        }
      } catch (error) {
        // Pass failed, but don't fail the entire migration
        result.warnings.push(
          `Post-migration pass error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Save cache if enabled
    if (cacheManager && !dryRun) {
      await cacheManager.saveCache();
    }

    // Save backups if rollback is enabled
    if (rollbackManager && !dryRun && result.filesModified > 0) {
      await rollbackManager.saveBackups();
    }

    // Final dependency consistency check and installation recommendation
    if (!dryRun && shouldMigratePackage) {
      if (options.verbose) {
        console.log("Performing final dependency consistency check...");
      }
      const finalCheck = await verifyDependencyConsistency(projectPath);

      if (finalCheck.hasConflicts) {
        const errorConflicts = finalCheck.conflicts.filter(
          (c) => c.severity === "error"
        );
        if (errorConflicts.length > 0) {
          console.warn("⚠️  Dependency conflicts detected after migration:");
          errorConflicts.forEach((conflict) => {
            console.warn(`  - ${conflict.packageName}: ${conflict.message}`);
            result.errors.push(
              `Dependency conflict: ${conflict.packageName} - ${conflict.message}`
            );
          });
        }

        // Show recommendations
        if (finalCheck.recommendations.length > 0) {
          console.log("\n📋 Recommendations:");
          finalCheck.recommendations.forEach((rec) => {
            console.log(`  - ${rec}`);
            result.warnings.push(`Recommendation: ${rec}`);
          });
        }

        // Suggest automatic installation
        console.log(
          "\n💡 Tip: Run 'npm install' to resolve dependency conflicts automatically."
        );
        result.warnings.push(
          "Run 'npm install' to install updated dependencies and resolve conflicts"
        );
      } else {
        if (options.verbose) {
          console.log("✓ All dependencies are consistent");
        }

        // Check if node_modules exists, if not suggest installation
        const nodeModulesPath = path.join(projectPath, "node_modules");
        try {
          await fs.access(nodeModulesPath);
        } catch {
          // node_modules doesn't exist, suggest installation
          if (options.verbose) {
            console.log("💡 Tip: Run 'npm install' to install dependencies.");
          }
          result.warnings.push("Run 'npm install' to install dependencies");
        }
      }

      // Add warnings
      finalCheck.warnings.forEach((warning) => {
        result.warnings.push(warning);
      });
    }

    // Generate report
    if (outputReport) {
      try {
        const reportPath = path.resolve(projectPath, outputReport);
        const report = {
          timestamp: new Date().toISOString(),
          projectPath,
          analysis,
          result,
          dryRun,
          rollbackAvailable: rollbackManager
            ? rollbackManager.getBackupCount() > 0
            : false,
          validation: validationResult,
          suggestions: validationResult?.suggestions || [],
        };

        if (!dryRun) {
          await safeWriteFile(reportPath, JSON.stringify(report, null, 2));
          result.reportPath = reportPath;
        }
      } catch (error) {
        result.warnings.push(
          `Failed to generate report: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return result;
  } catch (error) {
    if (error instanceof MigrationError) {
      result.errors.push(
        `[${error.code}] ${error.message}${error.filePath ? ` (${error.filePath})` : ""}`
      );
    } else {
      result.errors.push(
        `General error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    // Don't throw, return result with errors instead
    return result;
  }
}
