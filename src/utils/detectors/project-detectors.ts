import * as fs from "fs/promises";
import * as path from "path";
import * as fsSync from "fs";

export interface ProjectDetectionResult {
  /** Project with build/webpack.*.config.js (Webpack SSR) */
  hasWebpackSSR: boolean;
  /** Project with entry-client.js and entry-server.js */
  hasSSREntries: boolean;
  /** Components with asyncData */
  hasAsyncData: boolean;
  /** API utilisant l'alias create-api (client/server) */
  hasCreateApiPattern: boolean;
  /** Project with vue.config.js (Vue CLI) */
  hasVueConfig: boolean;
  /** Project with index.template.html (Vue 2 SSR) */
  hasIndexTemplate: boolean;
  /** Detected webpack config file paths */
  webpackConfigPaths: string[];
}

/**
 * Detect project patterns to adapt migration
 */
export async function detectProjectPatterns(
  projectPath: string
): Promise<ProjectDetectionResult> {
  const result: ProjectDetectionResult = {
    hasWebpackSSR: false,
    hasSSREntries: false,
    hasAsyncData: false,
    hasCreateApiPattern: false,
    hasVueConfig: false,
    hasIndexTemplate: false,
    webpackConfigPaths: [],
  };

  // Detect vue.config.js
  const vueConfigPath = path.join(projectPath, "vue.config.js");
  result.hasVueConfig = fsSync.existsSync(vueConfigPath);

  // Detect build/webpack.*.config.js
  const buildDir = path.join(projectPath, "build");
  if (fsSync.existsSync(buildDir)) {
    const webpackClient = path.join(buildDir, "webpack.client.config.js");
    const webpackServer = path.join(buildDir, "webpack.server.config.js");
    const webpackBase = path.join(buildDir, "webpack.base.config.js");
    if (fsSync.existsSync(webpackClient) || fsSync.existsSync(webpackServer)) {
      result.hasWebpackSSR = true;
      [webpackClient, webpackServer, webpackBase].forEach((p) => {
        if (fsSync.existsSync(p)) result.webpackConfigPaths.push(p);
      });
    }
  }

  // Detect webpack.config.js at project root
  const webpackRoot = path.join(projectPath, "webpack.config.js");
  if (fsSync.existsSync(webpackRoot)) {
    result.webpackConfigPaths.push(webpackRoot);
  }

  // Detect entry-client.js and entry-server.js
  const srcDir = path.join(projectPath, "src");
  if (fsSync.existsSync(srcDir)) {
    const entryClient = path.join(srcDir, "entry-client.js");
    const entryServer = path.join(srcDir, "entry-server.js");
    result.hasSSREntries =
      fsSync.existsSync(entryClient) && fsSync.existsSync(entryServer);
  }

  // Detect index.template.html
  const indexTemplate = path.join(projectPath, "src", "index.template.html");
  result.hasIndexTemplate = fsSync.existsSync(indexTemplate);

  // Detect create-api (import from 'create-api')
  const apiIndexPath = path.join(projectPath, "src", "api", "index.js");
  if (fsSync.existsSync(apiIndexPath)) {
    try {
      const content = await fs.readFile(apiIndexPath, "utf-8");
      result.hasCreateApiPattern =
        content.includes("from 'create-api'") ||
        content.includes('from "create-api"');
    } catch {
      // Ignore
    }
  }

  // Detect asyncData in .vue and .js files
  const srcFiles = await globVueAndJs(projectPath);
  for (const file of srcFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      if (/\basyncData\s*[:(]/.test(content)) {
        result.hasAsyncData = true;
        break;
      }
    } catch {
      // Ignore
    }
  }

  return result;
}

async function globVueAndJs(projectPath: string): Promise<string[]> {
  const { glob } = await import("glob");
  const vueFiles = await glob("**/*.vue", {
    cwd: projectPath,
    ignore: ["node_modules/**", "dist/**"],
    absolute: true,
  });
  const srcDir = path.join(projectPath, "src");
  let jsFiles: string[] = [];
  if (fsSync.existsSync(srcDir)) {
    jsFiles = await glob("**/*.js", {
      cwd: srcDir,
      ignore: ["node_modules/**"],
      absolute: true,
    });
  }
  return [...vueFiles, ...jsFiles];
}
