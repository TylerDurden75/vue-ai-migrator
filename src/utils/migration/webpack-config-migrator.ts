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
  enableTypeScript: boolean = false,
): Promise<WebpackConfigMigrationResult> {
  const result: WebpackConfigMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const vueConfigPath = path.join(projectPath, "vue.config.js");

  try {
    const content = await fs.readFile(vueConfigPath, "utf-8");
    let modifiedContent = content;

    // Ensure path module is imported if we're going to use path.resolve() for TypeScript
    // We'll check this again after TypeScript modifications, but do a preliminary check
    let hasPathImport = modifiedContent.includes("require('path')") || modifiedContent.includes('require("path")') || modifiedContent.includes('const path =') || modifiedContent.includes('var path =') || modifiedContent.includes('let path =') || modifiedContent.includes('import path from');

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

    // Update entry point from main.js to main.ts if TypeScript is enabled
    if (enableTypeScript) {
      const mainTsPath = path.join(projectPath, "src", "main.ts");
      
      try {
        // Check if main.ts exists (file was renamed)
        await fs.access(mainTsPath);
        
        // Check if entry point is already configured
        const hasEntryPoint = modifiedContent.includes('entry:') || modifiedContent.includes('pages:');
        
        if (!hasEntryPoint) {
          // Add entry point configuration to point to main.ts
          if (modifiedContent.includes('configureWebpack:')) {
            // Add entry to existing configureWebpack (before module: or after opening brace)
            if (modifiedContent.includes('configureWebpack: {')) {
              modifiedContent = modifiedContent.replace(
                /(configureWebpack:\s*\{)/,
                `$1\n    entry: './src/main.ts',`
              );
            }
          } else {
            // Add configureWebpack with entry point
            modifiedContent = modifiedContent.replace(
              /(module\.exports\s*=\s*\{)/,
              `$1\n  configureWebpack: {\n    entry: './src/main.ts',\n  },`
            );
          }
          result.modified = true;
          result.changes.push("Updated entry point from main.js to main.ts (TypeScript)");
        } else {
          // Update existing entry point if it references main.js
          modifiedContent = modifiedContent.replace(
            /entry:\s*['"]\.\/src\/main\.js['"]/g,
            "entry: './src/main.ts'"
          );
          modifiedContent = modifiedContent.replace(
            /entry:\s*['"]\.\/src\/main\.js['"]/g,
            `entry: './src/main.ts'`
          );
          if (modifiedContent !== content) {
            result.modified = true;
            result.changes.push("Updated entry point from main.js to main.ts (TypeScript)");
          }
        }
      } catch (error) {
        // main.ts doesn't exist yet, but we'll add entry point anyway if TypeScript is enabled
        // This handles the case where vue.config.js is migrated before main.js is renamed
        if (!modifiedContent.includes('entry:') && !modifiedContent.includes('pages:')) {
          if (modifiedContent.includes('configureWebpack:')) {
            modifiedContent = modifiedContent.replace(
              /(configureWebpack:\s*\{)/,
              `$1\n    entry: './src/main.ts',`
            );
          } else {
            modifiedContent = modifiedContent.replace(
              /(module\.exports\s*=\s*\{)/,
              `$1\n  configureWebpack: {\n    entry: './src/main.ts',\n  },`
            );
          }
          result.modified = true;
          result.changes.push("Added entry point for main.ts (TypeScript)");
        }
      }
      
      // Add TypeScript extension resolution in configureWebpack.resolve.extensions
      // Use simpler detection that works with multiline content
      const hasResolveInConfigureWebpack = /configureWebpack:\s*\{[\s\S]*?resolve:/.test(modifiedContent);
      const hasExtensionsInConfigureWebpack = /configureWebpack:\s*\{[\s\S]*?extensions:/.test(modifiedContent);
      
      if (!hasExtensionsInConfigureWebpack) {
        // Need to add extensions in configureWebpack
        if (hasResolveInConfigureWebpack) {
          // resolve exists, add extensions to it (find resolve: { and add extensions after opening brace)
          modifiedContent = modifiedContent.replace(
            /(configureWebpack:\s*\{[\s\S]*?resolve:\s*\{)/,
            `$1\n      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],`
          );
        } else {
          // resolve doesn't exist, add resolve with extensions
          // Try to add before module: or entry: or at the beginning
          if (modifiedContent.includes('configureWebpack: {')) {
            // Find the best place to insert (before module: or entry:)
            if (/configureWebpack:\s*\{[\s\S]*?module:/.test(modifiedContent)) {
              modifiedContent = modifiedContent.replace(
                /(configureWebpack:\s*\{[\s\S]*?)(module:)/,
                `$1resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      },\n      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],\n    },\n    $2`
              );
            } else if (/configureWebpack:\s*\{[\s\S]*?entry:/.test(modifiedContent)) {
              modifiedContent = modifiedContent.replace(
                /(configureWebpack:\s*\{[\s\S]*?)(entry:)/,
                `$1resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      },\n      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],\n    },\n    $2`
              );
            } else {
              // Add at the beginning of configureWebpack
              modifiedContent = modifiedContent.replace(
                /(configureWebpack:\s*\{)/,
                `$1\n    resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      },\n      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],\n    },`
              );
            }
          } else {
            // configureWebpack doesn't exist, add it
            modifiedContent = modifiedContent.replace(
              /(module\.exports\s*=\s*\{)/,
              `$1\n  configureWebpack: {\n    resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      },\n      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'],\n    },\n  },`
            );
          }
        }
        result.modified = true;
        result.changes.push("Added TypeScript extension resolution in configureWebpack (.ts, .tsx)");
      } else {
        // Extensions exist, check if .ts is included
        const extensionsMatch = modifiedContent.match(/configureWebpack:\s*\{[\s\S]*?extensions:\s*\[([^\]]+)\]/);
        if (extensionsMatch && !extensionsMatch[1].includes('.ts')) {
          // Update extensions to include .ts
          modifiedContent = modifiedContent.replace(
            /(configureWebpack:\s*\{[\s\S]*?extensions:\s*\[)([^\]]+)(\])/,
            (match, before, existing, after) => {
              const cleaned = existing.replace(/['"]/g, '').split(',').map((e: string) => e.trim()).filter(Boolean);
              const newExtensions = ['.ts', '.tsx', ...cleaned, '.vue', '.json'].filter((v, i, a) => a.indexOf(v) === i);
              return `${before}${newExtensions.map(e => `'${e}'`).join(', ')}${after}`;
            }
          );
          result.modified = true;
          result.changes.push("Updated extensions to include TypeScript (.ts, .tsx)");
        }
      }
      
      // Also add chainWebpack extension resolution and TypeScript loader
      if (modifiedContent.includes('chainWebpack:')) {
        // Check if extensions merge is already in chainWebpack (use simpler check)
        const hasExtensionsMergeInChainWebpack = modifiedContent.includes('config.resolve.extensions.merge');
        if (!hasExtensionsMergeInChainWebpack) {
          // Find the end of the chainWebpack block (before closing brace)
          // Use a more robust regex that handles nested braces
          const chainWebpackRegex = /(chainWebpack:\s*config\s*=>\s*\{)([\s\S]*?)(\n\s*\})/;
          const chainWebpackMatch = modifiedContent.match(chainWebpackRegex);
          if (chainWebpackMatch) {
            const chainWebpackContent = chainWebpackMatch[2];
            // Add extensions merge before the closing brace
            const newChainWebpackContent = chainWebpackContent + 
              `\n    config.resolve.extensions.merge(['.ts', '.tsx', '.js', '.jsx', '.vue', '.json']);`;
            modifiedContent = modifiedContent.replace(
              chainWebpackMatch[0],
              chainWebpackMatch[1] + newChainWebpackContent + chainWebpackMatch[3]
            );
          } else {
            // Fallback: add at the beginning
            modifiedContent = modifiedContent.replace(
              /(chainWebpack:\s*config\s*=>\s*\{)/,
              `$1\n    config.resolve.extensions.merge(['.ts', '.tsx', '.js', '.jsx', '.vue', '.json']);`
            );
          }
          result.modified = true;
          result.changes.push("Added chainWebpack TypeScript extension resolution");
        }
        
        // Add TypeScript loader configuration (vue-loader will automatically use it for <script lang="ts">)
        const hasTsRuleInChainWebpack = modifiedContent.includes(".rule('ts')") || modifiedContent.includes('.rule("ts")') || modifiedContent.includes('.rule(`ts`)');
        if (!hasTsRuleInChainWebpack) {
          // Find the end of the chainWebpack block (before closing brace)
          const chainWebpackRegex = /(chainWebpack:\s*config\s*=>\s*\{)([\s\S]*?)(\n\s*\})/;
          const chainWebpackMatch = modifiedContent.match(chainWebpackRegex);
          if (chainWebpackMatch) {
            const chainWebpackContent = chainWebpackMatch[2];
            // Add ts rule before the closing brace
            const tsRule = `\n    config.module\n      .rule('ts')\n      .test(/\\.ts$/)\n      .exclude\n        .add(/node_modules/)\n        .end()\n      .use('ts-loader')\n        .loader('ts-loader')\n        .options({\n          appendTsSuffixTo: [/\\.vue$/],\n          transpileOnly: true\n        })`;
            const newChainWebpackContent = chainWebpackContent + tsRule;
            modifiedContent = modifiedContent.replace(
              chainWebpackMatch[0],
              chainWebpackMatch[1] + newChainWebpackContent + chainWebpackMatch[3]
            );
          } else {
            // Fallback: add at the end
            modifiedContent = modifiedContent.replace(
              /(chainWebpack:\s*config\s*=>\s*\{[\s\S]*?)(\n\s*\})/,
              `$1    config.module\n      .rule('ts')\n      .test(/\\.ts$/)\n      .exclude\n        .add(/node_modules/)\n        .end()\n      .use('ts-loader')\n        .loader('ts-loader')\n        .options({\n          appendTsSuffixTo: [/\\.vue$/],\n          transpileOnly: true\n        })\n$2`
            );
          }
          result.modified = true;
          result.changes.push("Added TypeScript loader configuration in chainWebpack (ts-loader)");
        }
      } else {
        // Add chainWebpack with extension resolution and TypeScript loader
        modifiedContent = modifiedContent.replace(
          /(module\.exports\s*=\s*\{)/,
          `$1\n  chainWebpack: config => {\n    config.resolve.extensions.merge(['.ts', '.tsx', '.js', '.jsx', '.vue', '.json']);\n    config.module\n      .rule('ts')\n      .test(/\\.ts$/)\n      .exclude\n        .add(/node_modules/)\n        .end()\n      .use('ts-loader')\n        .loader('ts-loader')\n        .options({\n          appendTsSuffixTo: [/\\.vue$/],\n          transpileOnly: true\n        })\n  },`
        );
        result.modified = true;
        result.changes.push("Added chainWebpack with TypeScript extension resolution and loader");
      }
      
      // Also add ts-loader rule in configureWebpack.module.rules
      const hasTsLoaderInConfigureWebpack = /configureWebpack:\s*\{[\s\S]*?ts-loader/.test(modifiedContent);
      if (!hasTsLoaderInConfigureWebpack && modifiedContent.includes('configureWebpack:')) {
        if (/configureWebpack:\s*\{[\s\S]*?module:\s*\{[\s\S]*?rules:\s*\[/.test(modifiedContent)) {
          // Add ts-loader rule to existing rules array
          // Find the rules array and add ts-loader rule
          modifiedContent = modifiedContent.replace(
            /(configureWebpack:\s*\{[\s\S]*?module:\s*\{[\s\S]*?rules:\s*\[)/,
            `$1\n        {\n          test: /\\.ts$/,\n          exclude: /node_modules/,\n          use: {\n            loader: 'ts-loader',\n            options: {\n              appendTsSuffixTo: [/\\.vue$/],\n              transpileOnly: true\n            }\n          }\n        },`
          );
          result.modified = true;
          result.changes.push("Added ts-loader rule in configureWebpack.module.rules");
        } else {
          // Add module.rules with ts-loader
          // Find where to insert (before closing brace of configureWebpack)
          if (/configureWebpack:\s*\{[\s\S]*?resolve:/.test(modifiedContent)) {
            // Add after resolve (before closing brace)
            modifiedContent = modifiedContent.replace(
              /(configureWebpack:\s*\{[\s\S]*?resolve:[\s\S]*?\})/,
              `$1,\n    module: {\n      rules: [\n        {\n          test: /\\.ts$/,\n          exclude: /node_modules/,\n          use: {\n            loader: 'ts-loader',\n            options: {\n              appendTsSuffixTo: [/\\.vue$/],\n              transpileOnly: true\n            }\n          }\n        }\n      ]\n    }`
            );
          } else if (/configureWebpack:\s*\{[\s\S]*?entry:/.test(modifiedContent)) {
            // Add after entry
            modifiedContent = modifiedContent.replace(
              /(configureWebpack:\s*\{[\s\S]*?entry:[^,}]+)/,
              `$1,\n    module: {\n      rules: [\n        {\n          test: /\\.ts$/,\n          exclude: /node_modules/,\n          use: {\n            loader: 'ts-loader',\n            options: {\n              appendTsSuffixTo: [/\\.vue$/],\n              transpileOnly: true\n            }\n          }\n        }\n      ]\n    }`
            );
          } else {
            // Add at the beginning
            modifiedContent = modifiedContent.replace(
              /(configureWebpack:\s*\{)/,
              `$1\n    module: {\n      rules: [\n        {\n          test: /\\.ts$/,\n          exclude: /node_modules/,\n          use: {\n            loader: 'ts-loader',\n            options: {\n              appendTsSuffixTo: [/\\.vue$/],\n              transpileOnly: true\n            }\n          }\n        }\n      ]\n    },`
            );
          }
          result.modified = true;
          result.changes.push("Added module.rules with ts-loader in configureWebpack");
        }
      }
    }

    // After all TypeScript modifications, ensure path module is imported if path.resolve() is used
    // Check BOTH original content and modified content to catch all cases
    const usesPath = modifiedContent.includes('path.resolve') || modifiedContent.includes('path.join');
    hasPathImport = modifiedContent.includes("require('path')") || modifiedContent.includes('require("path")') || modifiedContent.includes('const path =') || modifiedContent.includes('var path =') || modifiedContent.includes('let path =') || modifiedContent.includes('import path from');
    
    if (usesPath && !hasPathImport) {
      // Add path import at the beginning of the file
      if (modifiedContent.trim().startsWith('module.exports') || modifiedContent.trim().startsWith('export default')) {
        modifiedContent = `const path = require('path')\n\n${modifiedContent}`;
      } else {
        // Try to add before module.exports or first require/import
        const firstLineMatch = modifiedContent.match(/^([^\n]+)/);
        if (firstLineMatch && (firstLineMatch[1].includes('require') || firstLineMatch[1].includes('import'))) {
          // Add before first line
          modifiedContent = `const path = require('path')\n${modifiedContent}`;
        } else {
          // Add at the very beginning
          modifiedContent = `const path = require('path')\n\n${modifiedContent}`;
        }
      }
      result.modified = true;
      result.changes.push("Added path module import for TypeScript alias configuration");
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
        const extensionsConfig = enableTypeScript 
          ? `    resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      },\n      extensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.json']\n    },`
          : `    resolve: {\n      alias: {\n        '@': path.resolve(__dirname, 'src')\n      }\n    },`;
        const defaultConfig = `const path = require('path')\n\nmodule.exports = {\n  configureWebpack: {\n${extensionsConfig}\n    module: {\n      rules: [\n        {\n          test: /\\.mjs$/,\n          include: /node_modules/,\n          type: 'javascript/auto'\n        }\n      ]\n    }\n  },\n  chainWebpack: config => {\n    config.module\n      .rule('mjs')\n      .test(/\\.mjs$/)\n      .include\n        .add(/node_modules/)\n        .end()\n      .type('javascript/auto')\n${enableTypeScript ? `    config.resolve.extensions.merge(['.ts', '.tsx', '.js', '.jsx', '.vue', '.json'])\n` : ''}  }\n}\n`;
        await fs.writeFile(vueConfigPath, defaultConfig, "utf-8");
        result.modified = true;
        result.changes.push(`Created vue.config.js with .mjs support${enableTypeScript ? ' and TypeScript extensions' : ''}`);
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
