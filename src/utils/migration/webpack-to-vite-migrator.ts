import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";

export interface WebpackToViteResult {
  modified: boolean;
  created: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Migrate Vue 2 SSR (Webpack) project to Vite SSR
 * Handles build/webpack.client.config.js, build/webpack.server.config.js
 */
export async function migrateWebpackToVite(
  projectPath: string,
  dryRun: boolean,
  enableTypeScript: boolean,
  rollbackManager?: any
): Promise<WebpackToViteResult> {
  const result: WebpackToViteResult = {
    modified: false,
    created: false,
    changes: [],
    warnings: [],
  };

  const viteConfigPath = path.join(
    projectPath,
    enableTypeScript ? "vite.config.ts" : "vite.config.js"
  );

  if (fsSync.existsSync(viteConfigPath)) {
    const content = await fs.readFile(viteConfigPath, "utf-8");
    if (
      content.trim().length > 0 &&
      (content.includes("defineConfig") || content.includes("export default"))
    ) {
      result.warnings.push("vite.config already exists, skipping");
      return result;
    }
  }

    // Extract info from webpack base config (alias, etc.)
  const buildDir = path.join(projectPath, "build");
  let hasStylus = false;
  let hasFirebase = false;

  if (fsSync.existsSync(buildDir)) {
    const basePath = path.join(buildDir, "webpack.base.config.js");
    if (fsSync.existsSync(basePath)) {
      const baseContent = await fs.readFile(basePath, "utf-8");
      if (baseContent.includes("stylus")) hasStylus = true;
    }
  }

  try {
    const pkgPath = path.join(projectPath, "package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    hasFirebase = !!deps.firebase;
  } catch {
    // ignore
  }

  const viteConfig = generateViteSSRConfig(enableTypeScript, hasStylus, hasFirebase);

  if (!dryRun) {
    if (rollbackManager) {
      await rollbackManager.backupFile(viteConfigPath);
    }
    await fs.writeFile(viteConfigPath, viteConfig, "utf-8");
    result.created = true;
    result.changes.push(
      `Created ${enableTypeScript ? "vite.config.ts" : "vite.config.js"} for Vue 3 SSR`
    );

    // Create index.html if missing
    const indexHtmlPath = path.join(projectPath, "index.html");
    const indexTemplatePath = path.join(
      projectPath,
      "src",
      "index.template.html"
    );

    if (!fsSync.existsSync(indexHtmlPath)) {
      let indexContent: string;
      if (fsSync.existsSync(indexTemplatePath)) {
        indexContent = await fs.readFile(indexTemplatePath, "utf-8");
        // Replace SSR placeholders if needed
        if (!indexContent.includes("<script")) {
          indexContent = indexContent.replace(
            "</body>",
            '  <script type="module" src="/src/entry-client.js"></script>\n</body>'
          );
        }
      } else {
        indexContent = getDefaultIndexHtml();
      }
      await fs.writeFile(indexHtmlPath, indexContent, "utf-8");
      result.changes.push("Created index.html at project root");
    }

    // Update package.json
    await updatePackageJsonForViteSSR(projectPath, result);
  } else {
    result.changes.push("Would create vite.config.js/ts for SSR");
    result.changes.push("Would create index.html");
    result.changes.push("Would update package.json scripts");
  }

  result.modified = true;
  return result;
}

function generateViteSSRConfig(
  enableTypeScript: boolean,
  hasStylus: boolean,
  hasFirebase: boolean
): string {
  const ssrBlock = hasFirebase
    ? `  ssr: {
    external: ["firebase"],
  },
`
    : "";
  let config = `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  build: {
    target: "esnext",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    conditions: ["import", "module", "browser", "default"],
  },
${ssrBlock}`;

  if (hasStylus) {
    config += `  css: {
    preprocessorOptions: {
      stylus: {},
    },
  },
`;
  }

  config += "});\n";
  return config;
}

function getDefaultIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>{{ title }}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="/favicon.ico">
  </head>
  <body>
    <div id="app"><!--ssr-outlet--></div>
    <script type="module" src="/src/entry-client.js"></script>
  </body>
</html>
`;
}

async function updatePackageJsonForViteSSR(
  projectPath: string,
  result: WebpackToViteResult
): Promise<void> {
  try {
    const pkgPath = path.join(projectPath, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);

    if (!pkg.scripts) pkg.scripts = {};

    const updates: Record<string, string> = {
      dev: "node server",
      build:
        "rimraf dist && npm run build:client && npm run build:server",
      "build:client": "vite build --outDir dist/client",
      "build:server":
        "vite build --outDir dist/server --ssr src/entry-server.js",
      start: "cross-env NODE_ENV=production node server",
      preview: "vite preview",
    };

    let modified = false;
    for (const [key, value] of Object.entries(updates)) {
      if (pkg.scripts[key] !== value) {
        pkg.scripts[key] = value;
        modified = true;
      }
    }

    // Vite dependencies
    if (!pkg.devDependencies) pkg.devDependencies = {};
    if (!pkg.devDependencies.vite) {
      pkg.devDependencies.vite = "^5.0.0";
      modified = true;
    }
    if (!pkg.devDependencies["@vitejs/plugin-vue"]) {
      pkg.devDependencies["@vitejs/plugin-vue"] = "^5.0.0";
      modified = true;
    }

    if (modified) {
      await fs.writeFile(
        pkgPath,
        JSON.stringify(pkg, null, 2) + "\n",
        "utf-8"
      );
      result.changes.push("Updated package.json for Vite SSR");
    }
  } catch (err) {
    result.warnings.push(
      `Package.json error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
