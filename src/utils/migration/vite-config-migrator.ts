import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";

export interface ViteConfigMigrationResult {
  modified: boolean;
  created: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Migrates vue.config.js to vite.config.js/ts for Vue 3
 * Vue 3 projects should use Vite instead of Vue CLI (webpack)
 */
export async function migrateToViteConfig(
  projectPath: string,
  dryRun: boolean = false,
  enableTypeScript: boolean = false
): Promise<ViteConfigMigrationResult> {
  const result: ViteConfigMigrationResult = {
    modified: false,
    created: false,
    changes: [],
    warnings: [],
  };

  const vueConfigPath = path.join(projectPath, "vue.config.js");
  const viteConfigPath = path.join(
    projectPath,
    enableTypeScript ? "vite.config.ts" : "vite.config.js"
  );
  
  // Remove empty or duplicate vite.config files to avoid conflicts
  // Vite can be confused if both vite.config.js and vite.config.ts exist
  if (enableTypeScript) {
    const viteConfigJsPath = path.join(projectPath, "vite.config.js");
    if (fsSync.existsSync(viteConfigJsPath)) {
      try {
        const jsContent = await fs.readFile(viteConfigJsPath, "utf-8");
        // Remove if empty or doesn't have proper config
        if (jsContent.trim().length === 0 || !jsContent.includes("defineConfig")) {
          await fs.unlink(viteConfigJsPath);
          result.changes.push("Removed empty/duplicate vite.config.js (using vite.config.ts)");
        }
      } catch {
        // Ignore errors
      }
    }
  } else {
    // If not TypeScript, remove vite.config.ts if it exists
    const viteConfigTsPath = path.join(projectPath, "vite.config.ts");
    if (fsSync.existsSync(viteConfigTsPath)) {
      try {
        const tsContent = await fs.readFile(viteConfigTsPath, "utf-8");
        // Remove if empty or doesn't have proper config
        if (tsContent.trim().length === 0 || !tsContent.includes("defineConfig")) {
          await fs.unlink(viteConfigTsPath);
          result.changes.push("Removed empty/duplicate vite.config.ts (using vite.config.js)");
        }
      } catch {
        // Ignore errors
      }
    }
  }

  // Check if vite.config already exists and has content
  const viteConfigExists = fsSync.existsSync(viteConfigPath);
  let shouldCreateViteConfig = true;
  if (viteConfigExists) {
    try {
      const existingContent = await fs.readFile(viteConfigPath, "utf-8");
      // If it's not empty and has actual config, don't overwrite
      if (existingContent.trim().length > 0 && 
          (existingContent.includes("defineConfig") || existingContent.includes("export default"))) {
        shouldCreateViteConfig = false;
        result.warnings.push("vite.config already exists with configuration, skipping config creation");
      }
      // If it's empty or just whitespace, we'll overwrite it
    } catch {
      // File exists but can't read it, skip config creation
      shouldCreateViteConfig = false;
    }
  }

  // Read vue.config.js to extract configuration
  let vueConfigContent = "";
  let hasVueConfig = false;
  try {
    vueConfigContent = await fs.readFile(vueConfigPath, "utf-8");
    hasVueConfig = true;
  } catch {
    // vue.config.js doesn't exist, that's fine - we'll create a default Vite config
  }

  // Extract configuration from vue.config.js
  const extractedConfig = extractVueConfigSettings(vueConfigContent);

  // Generate Vite configuration
  const viteConfig = generateViteConfig(extractedConfig, enableTypeScript);

  if (!dryRun) {
    // Write vite.config.js/ts if it doesn't exist or is empty
    if (shouldCreateViteConfig) {
      await fs.writeFile(viteConfigPath, viteConfig, "utf-8");
      result.created = true;
      result.changes.push(
        `Created ${enableTypeScript ? "vite.config.ts" : "vite.config.js"} for Vue 3`
      );
    }

    // Always update package.json to use Vite scripts instead of vue-cli-service
    try {
      const packageJsonPath = path.join(projectPath, "package.json");
      const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageJsonContent);
      
      let packageModified = false;
      
      // Update scripts
      if (packageJson.scripts) {
        if (packageJson.scripts.serve && packageJson.scripts.serve.includes("vue-cli-service")) {
          packageJson.scripts.dev = "vite";
          packageJson.scripts.serve = "vite"; // Keep serve for compatibility
          packageModified = true;
        }
        if (packageJson.scripts.build && packageJson.scripts.build.includes("vue-cli-service")) {
          packageJson.scripts.build = "vite build";
          packageModified = true;
        }
        if (!packageJson.scripts.preview) {
          packageJson.scripts.preview = "vite preview";
          packageModified = true;
        }
      } else {
        packageJson.scripts = {
          dev: "vite",
          serve: "vite",
          build: "vite build",
          preview: "vite preview",
        };
        packageModified = true;
      }
      
      // Add Vite dependencies if not present
      if (!packageJson.devDependencies) {
        packageJson.devDependencies = {};
      }
      
      if (!packageJson.devDependencies.vite) {
        packageJson.devDependencies.vite = "^5.0.0";
        packageModified = true;
      }
      if (!packageJson.devDependencies["@vitejs/plugin-vue"]) {
        packageJson.devDependencies["@vitejs/plugin-vue"] = "^5.0.0";
        packageModified = true;
      }
      
      if (packageModified) {
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf-8");
        result.changes.push("Updated package.json scripts and dependencies for Vite");
        result.warnings.push(
          "Updated package.json: replaced vue-cli-service with Vite. Run 'npm install' to install Vite dependencies."
        );
      }
    } catch (error) {
      result.warnings.push(
        `Could not update package.json: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Clean up Vue CLI / Webpack config files (Vite doesn't use them)
    // 1. Remove vue.config.js (Vite doesn't use it)
    if (hasVueConfig) {
      try {
        const backupPath = vueConfigPath + ".backup";
        // Only backup if backup doesn't exist
        if (!fsSync.existsSync(backupPath)) {
          await fs.copyFile(vueConfigPath, backupPath);
        }
        // Remove vue.config.js (Vite doesn't use it)
        await fs.unlink(vueConfigPath);
        result.changes.push("Removed vue.config.js (Vite doesn't use it, backup created)");
        result.warnings.push(
          "vue.config.js has been removed. Vite uses vite.config.js/ts instead. Backup saved as vue.config.js.backup"
        );
      } catch (error) {
        result.warnings.push(
          `Could not remove vue.config.js: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 2. Remove webpack.config.js (Vite doesn't use it)
    const webpackConfigPath = path.join(projectPath, "webpack.config.js");
    if (fsSync.existsSync(webpackConfigPath)) {
      try {
        const webpackBackupPath = webpackConfigPath + ".backup";
        // Backup before removing
        if (!fsSync.existsSync(webpackBackupPath)) {
          await fs.copyFile(webpackConfigPath, webpackBackupPath);
        }
        await fs.unlink(webpackConfigPath);
        result.changes.push("Removed webpack.config.js (Vite doesn't use it, backup created)");
        result.warnings.push(
          "webpack.config.js has been removed. Vite uses vite.config.js/ts instead. Backup saved as webpack.config.js.backup"
        );
      } catch (error) {
        result.warnings.push(
          `Could not remove webpack.config.js: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 3. Migrate index.html from public/ to root (Vite convention)
    const publicIndexHtmlPath = path.join(projectPath, "public", "index.html");
    const rootIndexHtmlPath = path.join(projectPath, "index.html");

    if (fsSync.existsSync(publicIndexHtmlPath)) {
      try {
        let indexHtmlContent = await fs.readFile(publicIndexHtmlPath, "utf-8");
        
        // Ensure the script tag references the entry point
        if (!indexHtmlContent.includes('<script') || !indexHtmlContent.includes('src=')) {
          // Find the closing </body> tag and add script before it
          if (indexHtmlContent.includes('</body>')) {
            indexHtmlContent = indexHtmlContent.replace(
              '</body>',
              '  <script type="module" src="/src/main.ts"></script>\n</body>'
            );
          } else {
            // No </body> tag, add script at the end
            indexHtmlContent += '\n  <script type="module" src="/src/main.ts"></script>\n';
          }
        } else {
          // Script exists but might need to be updated to use /src/main.ts
          indexHtmlContent = indexHtmlContent.replace(
            /<script[^>]*src=["'][^"']*main\.(js|ts)["'][^>]*>/i,
            '<script type="module" src="/src/main.ts">'
          );
        }
        
        // Write to root (overwrite if exists)
        await fs.writeFile(rootIndexHtmlPath, indexHtmlContent, "utf-8");
        result.changes.push("Migrated index.html from public/ to root (Vite convention)");
        
        // Remove public/index.html after migration
        await fs.unlink(publicIndexHtmlPath);
        result.changes.push("Removed public/index.html (Vite uses root index.html)");
      } catch (error) {
        result.warnings.push(
          `Could not migrate index.html: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (fsSync.existsSync(rootIndexHtmlPath)) {
      // Root index.html exists, ensure it has the script tag
      try {
        let indexHtmlContent = await fs.readFile(rootIndexHtmlPath, "utf-8");
        if (!indexHtmlContent.includes('<script') || !indexHtmlContent.includes('src=')) {
          if (indexHtmlContent.includes('</body>')) {
            indexHtmlContent = indexHtmlContent.replace(
              '</body>',
              '  <script type="module" src="/src/main.ts"></script>\n</body>'
            );
            await fs.writeFile(rootIndexHtmlPath, indexHtmlContent, "utf-8");
            result.changes.push("Added script tag to root index.html");
          }
        }
      } catch {
        // Ignore errors when updating existing index.html
      }
    }
  } else {
    result.changes.push(
      `Would create ${enableTypeScript ? "vite.config.ts" : "vite.config.js"} for Vue 3`
    );
    result.changes.push("Would update package.json scripts to use Vite");
    result.changes.push("Would remove vue.config.js and webpack.config.js");
    result.changes.push("Would migrate index.html from public/ to root");
  }

  result.modified = true;
  return result;
}

interface ExtractedConfig {
  alias: Record<string, string>;
  publicPath: string;
  outputDir: string;
  devServer: {
    port?: number;
    host?: string;
    proxy?: Record<string, any>;
  };
  chainWebpack: boolean;
  configureWebpack: boolean;
}

/**
 * Extracts configuration from vue.config.js
 */
function extractVueConfigSettings(vueConfigContent: string): ExtractedConfig {
  const config: ExtractedConfig = {
    alias: {},
    publicPath: "/",
    outputDir: "dist",
    devServer: {},
    chainWebpack: false,
    configureWebpack: false,
  };

  if (!vueConfigContent) {
    return config;
  }

  // Extract alias from configureWebpack.resolve.alias or chainWebpack
  const aliasMatch = vueConfigContent.match(
    /alias:\s*\{([^}]+)\}/s
  );
  if (aliasMatch) {
    const aliasContent = aliasMatch[1];
    // Extract '@': path.resolve(__dirname, 'src')
    const atAliasMatch = aliasContent.match(
      /['"]@['"]\s*:\s*path\.resolve\(__dirname,\s*['"]([^'"]+)['"]\)/
    );
    if (atAliasMatch) {
      config.alias["@"] = atAliasMatch[1];
    }
  }

  // Extract publicPath
  const publicPathMatch = vueConfigContent.match(
    /publicPath:\s*['"]([^'"]+)['"]/
  );
  if (publicPathMatch) {
    config.publicPath = publicPathMatch[1];
  }

  // Extract outputDir
  const outputDirMatch = vueConfigContent.match(
    /outputDir:\s*['"]([^'"]+)['"]/
  );
  if (outputDirMatch) {
    config.outputDir = outputDirMatch[1];
  }

  // Extract devServer port
  const portMatch = vueConfigContent.match(/port:\s*(\d+)/);
  if (portMatch) {
    config.devServer.port = parseInt(portMatch[1], 10);
  }

  // Extract devServer host
  const hostMatch = vueConfigContent.match(/host:\s*['"]([^'"]+)['"]/);
  if (hostMatch) {
    config.devServer.host = hostMatch[1];
  }

  // Check for proxy configuration
  if (vueConfigContent.includes("proxy:")) {
    config.devServer.proxy = {}; // We'll keep the proxy config in comments
  }

  // Check if chainWebpack or configureWebpack are used
  config.chainWebpack = vueConfigContent.includes("chainWebpack");
  config.configureWebpack = vueConfigContent.includes("configureWebpack");

  return config;
}

/**
 * Generates Vite configuration from extracted Vue config
 */
function generateViteConfig(
  config: ExtractedConfig,
  enableTypeScript: boolean
): string {
  const isTS = enableTypeScript;
  const importStatement = isTS
    ? `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\nimport path from 'path';`
    : `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\nimport path from 'path';`;

  // Build alias object
  const aliasEntries: string[] = [];
  if (config.alias["@"]) {
    const aliasPath = config.alias["@"];
    aliasEntries.push(`      '@': path.resolve(__dirname, '${aliasPath}')`);
  } else {
    // Default alias
    aliasEntries.push(`      '@': path.resolve(__dirname, 'src')`);
  }

  const aliasObject =
    aliasEntries.length > 0
      ? `resolve: {\n    alias: {\n${aliasEntries.join(",\n")}\n    }\n  },`
      : "";

  // Build server config
  const serverConfig: string[] = [];
  if (config.devServer.port) {
    serverConfig.push(`    port: ${config.devServer.port}`);
  }
  if (config.devServer.host) {
    serverConfig.push(`    host: '${config.devServer.host}'`);
  }
  if (config.devServer.proxy) {
    serverConfig.push(`    // Proxy configuration from vue.config.js - configure manually if needed`);
    serverConfig.push(`    // proxy: { ... }`);
  }

  const serverObject =
    serverConfig.length > 0 ? `server: {\n${serverConfig.join(",\n")}\n  },` : "";

  // Build build config
  const buildConfig: string[] = [];
  if (config.outputDir !== "dist") {
    buildConfig.push(`    outDir: '${config.outputDir}'`);
  }
  if (config.publicPath !== "/") {
    buildConfig.push(`    // base: '${config.publicPath}' // Set base if needed`);
  }

  const buildObject =
    buildConfig.length > 0 ? `build: {\n${buildConfig.join(",\n")}\n  },` : "";

  // Generate the config
  const viteConfig = `${importStatement}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
${aliasObject ? `  ${aliasObject}\n` : ""}${serverObject ? `  ${serverObject}\n` : ""}${buildObject ? `  ${buildObject}\n` : ""}});
`;

  return viteConfig;
}
