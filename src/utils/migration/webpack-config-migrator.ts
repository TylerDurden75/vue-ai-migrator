import * as fs from "fs/promises";
import * as path from "path";

export interface WebpackConfigMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Migrate webpack.config.js for Vue 3 compatibility
 * - Remove Vue 2 specific alias (vue$: "vue/dist/vue.esm.js")
 * - Update vue-loader configuration if needed
 */
export async function migrateWebpackConfig(
  projectPath: string,
  dryRun: boolean = false,
): Promise<WebpackConfigMigrationResult> {
  const result: WebpackConfigMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const webpackConfigPath = path.join(projectPath, "webpack.config.js");

  try {
    const content = await fs.readFile(webpackConfigPath, "utf-8");

    // Check if this is a Vue 2 webpack config
    const hasVue2Alias =
      content.includes('vue$: "vue/dist/vue.esm.js"') ||
      content.includes("vue$: 'vue/dist/vue.esm.js'") ||
      content.includes("vue$: `vue/dist/vue.esm.js`");

    if (!hasVue2Alias) {
      // Not a Vue 2 config or already migrated
      return result;
    }

    let modifiedContent = content;

    // Remove Vue 2 alias
    modifiedContent = modifiedContent.replace(
      /vue\$:\s*["'`]vue\/dist\/vue\.esm\.js["'`]/g,
      "",
    );

    // Clean up empty alias object if it becomes empty
    modifiedContent = modifiedContent.replace(
      /resolve:\s*{\s*alias:\s*{\s*},\s*extensions:/g,
      "resolve: {\n    extensions:",
    );

    // Clean up empty alias property
    modifiedContent = modifiedContent.replace(
      /resolve:\s*{\s*alias:\s*{\s*},\s*}/g,
      "resolve: {}",
    );

    // Add @ alias for src directory if not present (common Vue 3 pattern)
    if (
      !modifiedContent.includes('"@":') &&
      !modifiedContent.includes("'@':")
    ) {
      // Find resolve section and add alias
      if (modifiedContent.includes("resolve:")) {
        modifiedContent = modifiedContent.replace(
          /(resolve:\s*{)/,
          `$1\n    alias: {\n      "@": path.resolve(__dirname, "src"),\n    },`,
        );
        result.changes.push("Added @ alias for src directory");
        result.modified = true;
      }
    }

    // Remove Vue 2 specific extensions pattern
    modifiedContent = modifiedContent.replace(
      /extensions:\s*\[["'`]\*["'`]/g,
      'extensions: [".js"',
    );

    if (modifiedContent !== content) {
      result.modified = true;
      result.changes.push(
        "Removed Vue 2 specific alias (vue$: vue/dist/vue.esm.js)",
      );
      result.changes.push("Updated resolve.extensions for Vue 3");

      if (!dryRun) {
        await fs.writeFile(webpackConfigPath, modifiedContent, "utf-8");
      }
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      // webpack.config.js doesn't exist, that's fine
      return result;
    } else {
      result.warnings.push(
        `Error migrating webpack.config.js: ${error instanceof Error ? error.message : String(error)}`,
      );
      return result;
    }
  }
}
