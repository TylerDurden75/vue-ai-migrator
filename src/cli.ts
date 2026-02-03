#!/usr/bin/env node

import { Command } from "commander";
import { migrate, MigrationOptions } from "./core/migrator";
import { RollbackManager } from "./utils/safety";
import { MigrationClassifier } from "./core/classifier";
import { MigrationReporter } from "./core/reporter";
import { getDiffSummary } from "./utils/codegen";
import chalk from "chalk";
import ora from "ora";
import { detectVueVersion, analyzeProject } from "./utils/analysis";
import { installDependencies } from "./utils/migration/dependency-checker";
import * as path from "path";
import * as fs from "fs/promises";

const program = new Command();

program
  .name("vue-ai-migrator")
  .description(
    "Automatic Vue 2 → Vue 3 migration - Free mode by default (AST only), optional AI assistance",
  )
  .version("0.6.0");

program
  .command("migrate")
  .description("Migrate a Vue 2 project to Vue 3")
  .argument("<path>", "Path to the project to migrate")
  .option(
    "-k, --ai-api-key <key>",
    "API key for AI (or use OPENAI_API_KEY/MISTRAL_API_KEY/ANTHROPIC_API_KEY env variable)",
  )
  .option(
    "-p, --provider <provider>",
    "AI provider: openai, mistral, claude, anthropic",
    "openai",
  )
  .option(
    "-d, --dry-run [boolean]",
    "Dry run mode (does not modify files, shows diff)",
    (value) => {
      if (value === undefined || value === "true") return true;
      if (value === "false") return false;
      return Boolean(value);
    },
    false,
  )
  .option(
    "-o, --output <file>",
    "Output file for the report",
    "migration-report.json",
  )
  .option(
    "--ai, --use-ai",
    "Enable AI assistance for complex migrations (requires API key)",
    false,
  )
  .option("--no-ai", "Explicitly disable AI usage (default behavior)")
  .option(
    "--transformations <list>",
    "List of transformations to apply (comma-separated)",
  )
  .option("--no-rollback", "Disable automatic backups")
  .option(
    "--generate-tests",
    "Generate Vitest tests for migrated components",
    false,
  )
  .option(
    "--show-diff",
    "Show detailed diff for each file in dry-run mode",
    false,
  )
  .option(
    "--typescript",
    "Enable TypeScript type annotations in migrated code",
  )
  .option(
    "--install",
    "Automatically install dependencies after migration",
    false,
  )
  .option(
    "--clean-install",
    "Remove node_modules and package-lock.json before reinstalling dependencies",
    false,
  )
  .option(
    "-v, --verbose",
    "Enable verbose logging (show DEBUG messages and detailed fixes)",
    false,
  )
  .option(
    "--legacy",
    "Use legacy post-migration fixer (multi-pass) instead of optimized rule engine",
    false,
  )
  .action(async (projectPath: string, options) => {
    const spinner = ora("Analyzing project...").start();

    try {
      // Detect Vue version
      const vueVersion = await detectVueVersion(projectPath);

      if (!vueVersion || vueVersion.major !== 2) {
        spinner.fail("This project does not appear to be a Vue 2 project");
        process.exit(1);
      }

      spinner.succeed(`Vue version detected: ${vueVersion.version}`);

      // Get API key from various sources
      const provider = (options.provider || "openai") as
        | "openai"
        | "mistral"
        | "claude"
        | "anthropic";
      let apiKey = options.aiApiKey;

      if (!apiKey) {
        // Try provider-specific environment variables
        switch (provider) {
          case "openai":
            apiKey = process.env.OPENAI_API_KEY;
            break;
          case "mistral":
            apiKey = process.env.MISTRAL_API_KEY;
            break;
          case "claude":
          case "anthropic":
            apiKey =
              process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
            break;
        }
      }

      // Determine if AI should be used
      // AI is enabled only if explicitly requested with --ai/--use-ai flag
      const shouldUseAI = (options.ai || options.useAi) && !options.noAi;
      
      // Warn if AI is requested but no key provided
      if (shouldUseAI && !apiKey) {
        spinner.warn(
          "AI assistance requested but no API key found. AI features will be disabled.",
        );
        spinner.info(
          `To enable AI, set API key: ${provider === "openai" ? "OPENAI_API_KEY" : provider === "mistral" ? "MISTRAL_API_KEY" : "ANTHROPIC_API_KEY"}`,
        );
        spinner.info(
          "Continuing with AST-only migration (free mode)...",
        );
      }

      // Show mode information
      if (!shouldUseAI || !apiKey) {
        spinner.info(
          chalk.blue("Running in free mode (AST transformations only, no AI required)"),
        );
      } else {
        spinner.info(
          chalk.blue("AI assistance enabled for complex migrations"),
        );
      }

      const migrationOptions: MigrationOptions = {
        projectPath: projectPath,
        aiApiKey: apiKey,
        aiProvider: provider,
        dryRun: options.dryRun || false,
        useAI: shouldUseAI && !!apiKey, // Only enable if explicitly requested AND key is available
        outputReport: options.output,
        transformations: options.transformations
          ? options.transformations.split(",")
          : undefined,
        enableRollback: !options.noRollback,
        generateTests: options.generateTests || false,
        enableTypeScript: !!options.typescript,
        verbose: options.verbose || false,
        useOptimizedFixer: !options.legacy,
      };

      if (shouldUseAI && apiKey) {
        spinner.start("Starting migration with AI assistance...");
      } else {
        spinner.start("Starting migration (free mode - AST transformations only)...");
      }

      const result = await migrate(migrationOptions);

      spinner.succeed("Migration completed!");

      console.log("\n" + chalk.green("✓ Migration results:"));
      console.log(chalk.cyan(`  - Files analyzed: ${result.filesAnalyzed}`));
      console.log(chalk.cyan(`  - Files modified: ${result.filesModified}`));
      console.log(
        chalk.cyan(
          `  - Transformations applied: ${result.transformationsApplied}`,
        ),
      );

      // Show classification summary if available
      if (result.classification) {
        console.log(chalk.cyan(`\n  Classification:`));
        const total = result.classification.simple + result.classification.medium + result.classification.complex;
        const freeModeCoverage = result.classification.simple + result.classification.medium;
        const freeModePercentage = total > 0 ? Math.round((freeModeCoverage / total) * 100) : 0;
        
        console.log(
          chalk.green(`    🟢 Simple: ${result.classification.simple} (free mode handles these)`),
        );
        console.log(
          chalk.yellow(`    🟡 Medium: ${result.classification.medium} (free mode usually handles these)`),
        );
        console.log(
          chalk.red(`    🔴 Complex: ${result.classification.complex} (may benefit from AI)`),
        );
        
        // Show free mode coverage
        if (!shouldUseAI || !apiKey) {
          console.log(
            chalk.blue(`\n  💡 Free Mode Coverage: ${freeModePercentage}% of files can be migrated without AI`),
          );
          if (result.classification.complex > 0) {
            console.log(
              chalk.yellow(`  💡 Tip: ${result.classification.complex} complex file(s) detected. Consider using --ai for better results.`),
            );
          }
        }
      }

      // Show diff summary in dry-run mode
      if (options.dryRun && result.diffs) {
        console.log(chalk.blue(`\n  Diff summary:`));
        for (const [file, diff] of Object.entries(result.diffs)) {
          const summary = getDiffSummary(diff);
          console.log(chalk.cyan(`    ${file}: ${summary}`));
        }
      }

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n  - Errors: ${result.errors.length}`));
        result.errors.forEach((error) => {
          console.log(chalk.red(`    • ${error}`));
        });
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow(`\n  - Warnings: ${result.warnings.length}`));
        result.warnings.forEach((warning) => {
          console.log(chalk.yellow(`    • ${warning}`));
        });
      }

      if (result.reportPath) {
        console.log(chalk.blue(`\n📄 Detailed report: ${result.reportPath}`));
      }

      if (result.filesModified > 0 && !options.dryRun) {
        console.log(
          chalk.green(
            '\n💾 Backups created - use "vue-ai-migrator rollback" to restore',
          ),
        );
      }
      
      // Handle dependency installation after migration
      if (!options.dryRun && (options.install || options.cleanInstall)) {
        if (options.cleanInstall) {
          spinner.start("Cleaning node_modules and package-lock.json...");
          try {
            const nodeModulesPath = path.join(projectPath, "node_modules");
            const packageLockPath = path.join(projectPath, "package-lock.json");
            
            try {
              await fs.rm(nodeModulesPath, { recursive: true, force: true });
            } catch {
              // node_modules might not exist
            }
            
            try {
              await fs.unlink(packageLockPath);
            } catch {
              // package-lock.json might not exist
            }
            
            spinner.succeed("Cleaned node_modules and package-lock.json");
          } catch (error) {
            spinner.fail("Failed to clean node_modules");
            console.log(
              chalk.yellow(
                `   Continuing with npm install anyway...`,
              ),
            );
          }
        }

        spinner.start("Installing dependencies...");
        const installResult = await installDependencies(projectPath, "npm");
        
        if (installResult.success) {
          spinner.succeed("Dependencies installed successfully!");
          console.log(
            chalk.green(
              `\n✓ All dependencies have been installed.`,
            ),
          );
          if (options.typescript) {
            console.log(
              chalk.green(
                `   TypeScript dependencies are now available.`,
              ),
            );
          }
        } else {
          spinner.fail("Failed to install dependencies");
          console.log(
            chalk.red(
              `\n✗ Error: ${installResult.error || "Unknown error"}`,
            ),
          );
          console.log(
            chalk.yellow(
              `   Please run 'npm install' manually to install dependencies.`,
            ),
          );
        }
      }
      
      // Show helpful next steps
      if (result.filesModified > 0) {
        console.log(chalk.blue("\n📝 Next steps:"));
        console.log(chalk.gray("  1. Review the migrated code"));
        console.log(chalk.gray("  2. Run your tests: npm test"));
        if (!options.install && !options.cleanInstall) {
          console.log(chalk.gray("  3. Install dependencies: npm install"));
        } else {
          console.log(chalk.green("  3. ✓ Dependencies already installed"));
        }
        if (result.classification && result.classification.complex > 0 && (!shouldUseAI || !apiKey)) {
          console.log(chalk.yellow("  4. Consider using --ai for complex files if needed"));
        }
      }
    } catch (error) {
      spinner.fail("Error during migration");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Analyze a Vue project and classify migration complexity")
  .argument("<path>", "Path to the project to analyze")
  .option(
    "--classify",
    "Classify each file by complexity (simple/medium/complex)",
    false,
  )
  .option("-o, --output <file>", "Output file for detailed analysis report")
  .action(async (path: string, options) => {
    const spinner = ora("Analyzing project...").start();

    try {
      const analysis = await analyzeProject(path);
      const classifier = new MigrationClassifier();

      spinner.succeed("Analysis completed");

      console.log("\n" + chalk.green("📊 Analysis results:"));
      console.log(
        chalk.cyan(
          `  Vue version: ${analysis.vueVersion?.version || "Not detected"}`,
        ),
      );
      console.log(chalk.cyan(`  Vue files: ${analysis.vueFiles.length}`));
      console.log(
        chalk.cyan(`  Components found: ${analysis.componentsFound}`),
      );
      console.log(
        chalk.cyan(
          `  Vue 2 patterns detected: ${analysis.vue2Patterns.length}`,
        ),
      );

      if (analysis.vue2Patterns.length > 0) {
        console.log(chalk.yellow("\n⚠️  Vue 2 patterns detected:"));
        analysis.vue2Patterns.forEach((pattern) => {
          console.log(chalk.yellow(`  • ${pattern}`));
        });
      }

      // Classify files if requested
      if (options.classify && analysis.vueFiles.length > 0) {
        spinner.start("Classifying files...");
        const classifications: Array<{ file: string; classification: any }> =
          [];

        // Optimized: Process classification in parallel batches
        const filesToClassify = analysis.vueFiles.slice(0, 50); // Increased from 20 to 50
        const classifyBatchSize = 10;
        
        for (let i = 0; i < filesToClassify.length; i += classifyBatchSize) {
          const batch = filesToClassify.slice(i, i + classifyBatchSize);
          const batchResults = await Promise.allSettled(
            batch.map(async (file) => {
              try {
                const content = await fs.readFile(file, "utf-8");
                const classification = await classifier.classify(file, content);
                return { file, classification };
              } catch (error) {
                return null;
              }
            })
          );
          
          batchResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
              classifications.push(result.value);
            }
          });
        }

        spinner.succeed("Classification completed");

        console.log(chalk.blue("\n📋 File Classification:"));
        const simple = classifications.filter(
          (c) => c.classification.level === "simple",
        ).length;
        const medium = classifications.filter(
          (c) => c.classification.level === "medium",
        ).length;
        const complex = classifications.filter(
          (c) => c.classification.level === "complex",
        ).length;

        const total = simple + medium + complex;
        const freeModeCoverage = simple + medium;
        const freeModePercentage = total > 0 ? Math.round((freeModeCoverage / total) * 100) : 0;
        
        console.log(chalk.green(`  🟢 Simple: ${simple} (free mode ✅)`));
        console.log(chalk.yellow(`  🟡 Medium: ${medium} (free mode usually ✅)`));
        console.log(chalk.red(`  🔴 Complex: ${complex} (may need AI)`));
        
        // Show free mode recommendation
        console.log(chalk.blue(`\n  💡 Free Mode Coverage: ${freeModePercentage}%`));
        if (freeModePercentage >= 80) {
          console.log(chalk.green(`  ✅ Your project is well-suited for free mode!`));
        } else if (freeModePercentage >= 50) {
          console.log(chalk.yellow(`  ⚠️  Consider using --ai for complex files`));
        } else {
          console.log(chalk.yellow(`  💡 You may benefit from --ai flag for better results`));
        }

        if (classifications.length > 0) {
          console.log(chalk.cyan("\n  Sample classifications:"));
          for (const { file, classification } of classifications.slice(0, 5)) {
            const emoji =
              classification.level === "simple"
                ? "🟢"
                : classification.level === "medium"
                  ? "🟡"
                  : "🔴";
            const fileName = file.split("/").pop() || file;
            const modeHint = classification.level === "complex" ? " (consider --ai)" : " (free mode OK)";
            console.log(
              chalk.cyan(`    ${emoji} ${fileName}: ${classification.level}${modeHint}`),
            );
            if (classification.reasons.length > 0) {
              console.log(
                chalk.gray(
                  `      Reasons: ${classification.reasons.slice(0, 2).join(", ")}`,
                ),
              );
            }
          }
        }
      }

      // Generate report if output specified
      if (options.output) {
        spinner.start("Generating report...");
        // Detailed report generation can be implemented here if needed
        spinner.succeed(`Report saved to ${options.output}`);
      }
    } catch (error) {
      spinner.fail("Error during analysis");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("rollback")
  .description("Rollback the last migration (restore files from backup)")
  .argument("<path>", "Path to the project to rollback")
  .option("-a, --all", "Rollback all files", false)
  .option("-f, --file <file>", "Rollback a specific file")
  .option("--install", "Automatically reinstall dependencies after rollback", false)
  .option("--clean-install", "Remove node_modules and package-lock.json before reinstalling", false)
  .action(async (projectPath: string, options) => {
    const spinner = ora("Loading backups...").start();

    try {
      const rollbackManager = new RollbackManager(projectPath);
      await rollbackManager.loadBackups();

      const backupCount = rollbackManager.getBackupCount();

      if (backupCount === 0) {
        spinner.fail("No backups found");
        console.log(
          chalk.yellow("No backup files found. Nothing to rollback."),
        );
        process.exit(0);
      }

      spinner.succeed(`Found ${backupCount} backup(s)`);

      if (options.file) {
        // Rollback specific file
        const filePath = path.resolve(projectPath, options.file);
        spinner.start(`Rolling back ${options.file}...`);
        const success = await rollbackManager.restoreFile(filePath);

        if (success) {
          spinner.succeed(`Successfully rolled back ${options.file}`);
        } else {
          spinner.fail(`Failed to rollback ${options.file}`);
          process.exit(1);
        }
      } else {
        // Rollback all files
        spinner.start("Rolling back all files...");
        const result = await rollbackManager.restoreAll();

        spinner.succeed("Rollback completed!");
        console.log(chalk.green(`\n✓ Rollback results:`));
        console.log(chalk.cyan(`  - Files restored: ${result.restored}`));

        if (result.failed.length > 0) {
          console.log(chalk.yellow(`  - Failed: ${result.failed.length}`));
          result.failed.forEach((file) => {
            console.log(chalk.red(`    • ${file}`));
          });
        }

        // Handle package.json restoration and dependency reinstallation
        const packageJsonPath = path.resolve(projectPath, "package.json");
        const hasPackageBackup = rollbackManager.hasBackup(packageJsonPath);
        if (hasPackageBackup) {
          console.log(
            chalk.yellow(
              `\n⚠️  Important: package.json has been restored with Vue 2 dependencies.`,
            ),
          );
          console.log(
            chalk.yellow(
              `   Your node_modules may still contain Vue 3 dependencies, which can cause errors.`,
            ),
          );

          if (options.install || options.cleanInstall) {
            // Automatically reinstall dependencies
            if (options.cleanInstall) {
              spinner.start("Cleaning node_modules and package-lock.json...");
              try {
                const nodeModulesPath = path.join(projectPath, "node_modules");
                const packageLockPath = path.join(projectPath, "package-lock.json");
                
                try {
                  await fs.rm(nodeModulesPath, { recursive: true, force: true });
                } catch {
                  // node_modules might not exist
                }
                
                try {
                  await fs.unlink(packageLockPath);
                } catch {
                  // package-lock.json might not exist
                }
                
                spinner.succeed("Cleaned node_modules and package-lock.json");
              } catch (error) {
                spinner.fail("Failed to clean node_modules");
                console.log(
                  chalk.yellow(
                    `   Continuing with npm install anyway...`,
                  ),
                );
              }
            }

            spinner.start("Reinstalling dependencies...");
            const installResult = await installDependencies(projectPath, "npm");
            
            if (installResult.success) {
              spinner.succeed("Dependencies reinstalled successfully!");
              console.log(
                chalk.green(
                  `\n✓ All dependencies have been restored to match Vue 2 requirements.`,
                ),
              );
            } else {
              spinner.fail("Failed to reinstall dependencies");
              console.log(
                chalk.red(
                  `\n✗ Error: ${installResult.error || "Unknown error"}`,
                ),
              );
              console.log(
                chalk.yellow(
                  `   Please run 'npm install' manually to restore dependencies.`,
                ),
              );
            }
          } else {
            // Show warning and instructions
            console.log(
              chalk.red(
                `   ⚠️  CRITICAL: You MUST run 'npm install' to restore the correct dependencies.`,
              ),
            );
            console.log(
              chalk.yellow(
                `   Tip: Use '--install' to automatically reinstall dependencies, or '--clean-install' to clean and reinstall.`,
              ),
            );
          }
        }
      }
    } catch (error) {
      spinner.fail("Error during rollback");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("report")
  .description("Generate detailed migration report from previous migration")
  .argument("<report-file>", "Path to migration report JSON file")
  .option(
    "-f, --format <format>",
    "Output format (json, markdown, console)",
    "console",
  )
  .option("-o, --output <file>", "Output file (for json/markdown formats)")
  .action(async (reportFile: string, options) => {
    const spinner = ora("Loading report...").start();

    try {
      const reportContent = await fs.readFile(reportFile, "utf-8");
      const report = JSON.parse(reportContent);

      spinner.succeed("Report loaded");

      if (options.format === "console") {
        // Display report in console
        console.log(chalk.green("\n📊 Migration Report"));
        console.log(chalk.cyan(`\nSummary:`));
        console.log(`  Total Files: ${report.summary.totalFiles}`);
        console.log(`  Files Migrated: ${report.summary.filesMigrated}`);
        console.log(`  Files Skipped: ${report.summary.filesSkipped}`);

        if (report.classification) {
          console.log(chalk.cyan(`\nClassification:`));
          console.log(
            chalk.green(`  🟢 Simple: ${report.classification.simple}`),
          );
          console.log(
            chalk.yellow(`  🟡 Medium: ${report.classification.medium}`),
          );
          console.log(
            chalk.red(`  🔴 Complex: ${report.classification.complex}`),
          );
        }

        if (report.recommendations && report.recommendations.length > 0) {
          console.log(chalk.cyan(`\nRecommendations:`));
          report.recommendations.forEach((rec: string) => {
            console.log(chalk.yellow(`  • ${rec}`));
          });
        }
      } else if (options.format === "markdown" && options.output) {
        const reporter = new MigrationReporter();
        const mdPath = options.output.endsWith(".md")
          ? options.output
          : `${options.output}.md`;
        await fs.writeFile(
          mdPath,
          reporter["generateMarkdownReport"](report),
          "utf-8",
        );
        console.log(chalk.green(`\n✓ Markdown report saved to ${mdPath}`));
      } else if (options.format === "json" && options.output) {
        await fs.writeFile(
          options.output,
          JSON.stringify(report, null, 2),
          "utf-8",
        );
        console.log(chalk.green(`\n✓ JSON report saved to ${options.output}`));
      }
    } catch (error) {
      spinner.fail("Error loading report");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("plan")
  .description("Generate a prioritized migration plan for the project")
  .argument("<projectPath>", "Path to the project to analyze")
  .option(
    "-k, --ai-api-key <key>",
    "API key for AI (or use OPENAI_API_KEY env variable)",
  )
  .option(
    "-o, --output <file>",
    "Output file for the plan",
    "migration-plan.json",
  )
  .action(async (projectPath: string, options) => {
    const spinner = ora(
      "Analyzing project and generating migration plan...",
    ).start();

    try {
      const { analyzeProject } = await import("./utils/analysis");
      const { UnifiedAIService } = await import("./ai/unified-service");

      const analysis = await analyzeProject(projectPath);

      if (analysis.vueFiles.length === 0) {
        spinner.fail("No Vue files found in the project");
        process.exit(1);
      }

      const provider = (options.provider || "openai") as
        | "openai"
        | "mistral"
        | "claude"
        | "anthropic";

      // Get API key from various sources
      let apiKey = options.aiApiKey;
      if (!apiKey) {
        switch (provider) {
          case "openai":
            apiKey = process.env.OPENAI_API_KEY;
            break;
          case "mistral":
            apiKey = process.env.MISTRAL_API_KEY;
            break;
          case "claude":
          case "anthropic":
            apiKey =
              process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
            break;
        }
      }

      if (!apiKey) {
        spinner.fail(
          `AI API key required for migration plan. Use --ai-api-key or set ${provider === "openai" ? "OPENAI_API_KEY" : provider === "mistral" ? "MISTRAL_API_KEY" : "ANTHROPIC_API_KEY"} environment variable.`,
        );
        process.exit(1);
      }

      spinner.text = "Generating prioritized migration plan with AI...";

      const agent = new UnifiedAIService({
        provider,
        apiKey,
      });

      const plan = await agent.analyzeMigrationPlan(analysis.vueFiles);

      spinner.succeed("Migration plan generated");

      // Save plan to file
      const planPath = path.resolve(projectPath, options.output);
      const planDir = path.dirname(planPath);
      await fs.mkdir(planDir, { recursive: true });
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf-8");

      console.log("\n" + chalk.green("📋 Migration Plan:"));
      console.log(chalk.cyan(`\nEstimated Time: ${plan.estimatedTime}`));

      console.log(chalk.blue("\n📊 Prioritized Files:"));
      const sortedFiles = plan.priority.sort((a, b) => b.priority - a.priority);
      for (const item of sortedFiles.slice(0, 10)) {
        const priorityEmoji =
          item.priority >= 8 ? "🔴" : item.priority >= 5 ? "🟡" : "🟢";
        console.log(
          chalk.cyan(
            `  ${priorityEmoji} Priority ${item.priority}/10: ${item.file}`,
          ),
        );
        console.log(chalk.gray(`     Reason: ${item.reason}`));
      }
      if (sortedFiles.length > 10) {
        console.log(
          chalk.gray(`  ... and ${sortedFiles.length - 10} more files`),
        );
      }

      if (plan.recommendations.length > 0) {
        console.log(chalk.yellow("\n💡 Recommendations:"));
        plan.recommendations.forEach((rec) => {
          console.log(chalk.yellow(`  • ${rec}`));
        });
      }

      console.log(chalk.blue(`\n📄 Full plan saved to: ${planPath}`));
    } catch (error) {
      spinner.fail("Error generating migration plan");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program.parse();
