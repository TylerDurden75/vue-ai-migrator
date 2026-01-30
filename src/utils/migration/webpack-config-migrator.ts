import * as fs from "fs/promises";
import * as path from "path";

export interface WebpackConfigMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Migrate vue.config.js for Vue 3 compatibility
 * - Add support for .mjs files (ESM modules from Vue Router 4)
 * - Update Vue CLI configuration
 */
export async function migrateVueConfig(
  projectPath: string,
  dryRun: boolean = false,
): Promise<WebpackConfigMigrationResult> {
  const result: WebpackConfigMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const vueConfigPath = path.join(projectPath, "vue.config.js");

  try {
    let content = await fs.readFile(vueConfigPath, "utf-8");
    let modifiedContent = content;

    // Check if .mjs support is already configured
    const hasMjsSupport = 
      content.includes('.mjs') || 
      content.includes('javascript/auto') ||
      content.includes('chainWebpack');

    if (!hasMjsSupport) {
      // Add support for .mjs files to handle Vue Router 4 ESM modules
      // This is needed for Vue CLI 4 which doesn't handle .mjs files by default
      
      // Check if configureWebpack exists
      if (content.includes('configureWebpack')) {
        // Add module rules to existing configureWebpack
        if (!content.includes('module:')) {
          // Find configureWebpack and add module configuration
          modifiedContent = modifiedContent.replace(
            /(configureWebpack:\s*\{)/,
            `$1\n    module: {\n      rules: [\n        {\n          test: /\\.mjs$/,\n          include: /node_modules/,\n          type: 'javascript/auto'\n        }\n      ]\n    },`
          );
        } else {
          // Add rule to existing module.rules
          modifiedContent = modifiedContent.replace(
            /(module:\s*\{[^}]*rules:\s*\[)/,
            `$1\n        {\n          test: /\\.mjs$/,\n          include: /node_modules/,\n          type: 'javascript/auto'\n        },`
          );
        }
      } else {
        // Add configureWebpack if it doesn't exist
        if (content.includes('module.exports')) {
          modifiedContent = modifiedContent.replace(
            /(module\.exports\s*=\s*\{)/,
            `$1\n  configureWebpack: {\n    module: {\n      rules: [\n        {\n          test: /\\.mjs$/,\n          include: /node_modules/,\n          type: 'javascript/auto'\n        }\n      ]\n    }\n  },`
          );
        } else {
          // Add entire configuration
          modifiedContent = `const path = require('path')\n\nmodule.exports = {\n  configureWebpack: {\n    module: {\n      rules: [\n        {\n          test: /\\.mjs$/,\n          include: /node_modules/,\n          type: 'javascript/auto'\n        }\n      ]\n    }\n  }\n}\n${modifiedContent}`;
        }
      }

      // Also add chainWebpack configuration as fallback
      if (!content.includes('chainWebpack')) {
        modifiedContent = modifiedContent.replace(
          /(module\.exports\s*=\s*\{)/,
          `$1\n  chainWebpack: config => {\n    config.module\n      .rule('mjs')\n      .test(/\\.mjs$/)\n      .include\n        .add(/node_modules/)\n        .end()\n      .type('javascript/auto')\n  },`
        );
      }

      result.modified = true;
      result.changes.push("Added .mjs file support for Vue Router 4 ESM modules");
    }

    // Update Vue CLI version recommendation if using Vue CLI 4
    if (content.includes('@vue/cli-service') && content.includes('^4.')) {
      result.warnings.push(
        "Consider upgrading to @vue/cli-service ^5.0.0 for better ESM support"
      );
    }

    if (modifiedContent !== content && !dryRun) {
      await fs.writeFile(vueConfigPath, modifiedContent, "utf-8");
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      // vue.config.js doesn't exist, create it
      if (!dryRun) {
        const defaultConfig = `const path = require('path')\n\nmodule.exports = {\n  configureWebpack: {\n    resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      }\n    },\n    module: {\n      rules: [\n        {\n          test: /\\.mjs$/,\n          include: /node_modules/,\n          type: 'javascript/auto'\n        }\n      ]\n    }\n  },\n  chainWebpack: config => {\n    config.module\n      .rule('mjs')\n      .test(/\\.mjs$/)\n      .include\n        .add(/node_modules/)\n        .end()\n      .type('javascript/auto')\n  }\n}\n`;
        await fs.writeFile(vueConfigPath, defaultConfig, "utf-8");
        result.modified = true;
        result.changes.push("Created vue.config.js with .mjs support");
      }
      return result;
    } else {
      result.warnings.push(
        `Error migrating vue.config.js: ${error instanceof Error ? error.message : String(error)}`,
      );
      return result;
    }
  }
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

    // Fix syntax errors: remove empty alias objects with trailing commas
    // Pattern: alias: { , } or alias: { }
    modifiedContent = modifiedContent.replace(/alias:\s*{\s*,\s*}/g, "");

    // Pattern: alias: { } with trailing comma
    modifiedContent = modifiedContent.replace(/alias:\s*{\s*}\s*,/g, "");

    // Pattern: alias: { } without trailing comma
    modifiedContent = modifiedContent.replace(/alias:\s*{\s*}/g, "");

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

    // Clean up double commas that might result from alias removal
    modifiedContent = modifiedContent.replace(/,(\s*,)+/g, ",");
    modifiedContent = modifiedContent.replace(/{\s*,/g, "{");
    modifiedContent = modifiedContent.replace(/,\s*}/g, "}");

    // Fix duplicate alias properties - keep only the first valid one
    const aliasMatches = modifiedContent.match(/alias:\s*{([^}]*)}/g);
    if (aliasMatches && aliasMatches.length > 1) {
      // Find the first alias with actual content
      let validAlias = "";
      for (const match of aliasMatches) {
        const aliasContent = match.match(/alias:\s*{([^}]*)}/)?.[1] || "";
        if (aliasContent.trim() && !aliasContent.match(/^[\s,]*$/)) {
          validAlias = match;
          break;
        }
      }

      // Remove all alias blocks
      modifiedContent = modifiedContent.replace(/alias:\s*{[^}]*},?\s*/g, "");

      // Add back the valid alias if we found one
      if (validAlias) {
        // Find resolve: { and add alias before extensions or closing brace
        modifiedContent = modifiedContent.replace(
          /(resolve:\s*{)/,
          `$1\n    ${validAlias.replace(/alias:\s*{/, "alias: {").replace(/\n/g, "\n    ")},\n`,
        );
        result.changes.push("Fixed duplicate alias properties");
        result.modified = true;
      }
    }

    // Fix syntax errors: remove alias blocks with only commas or invalid syntax
    modifiedContent = modifiedContent.replace(/alias:\s*{\s*,\s*},?\s*/g, "");

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
