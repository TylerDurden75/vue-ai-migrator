import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";

export interface CreateApiMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Migrate create-api pattern (Webpack alias) to index.client.js / index.server.js
 * for Vite SSR compatibility
 */
export async function migrateCreateApi(
  projectPath: string,
  dryRun: boolean
): Promise<CreateApiMigrationResult> {
  const result: CreateApiMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const apiDir = path.join(projectPath, "src", "api");
  const indexPath = path.join(apiDir, "index.js");

  if (!fsSync.existsSync(indexPath)) return result;

  const content = await fs.readFile(indexPath, "utf-8");
  const hasCreateApi =
    content.includes("from 'create-api'") || content.includes('from "create-api"');
  if (!hasCreateApi) return result;

  const createApiClientPath = path.join(apiDir, "create-api-client.js");
  const createApiServerPath = path.join(apiDir, "create-api-server.js");
  if (!fsSync.existsSync(createApiClientPath) || !fsSync.existsSync(createApiServerPath)) {
    result.warnings.push(
      "create-api-client.js or create-api-server.js missing, skipping"
    );
    return result;
  }

  // Remove warmCache block for client version (api.onServer is always false on client)
  const warmCacheBlock =
    /\/\/ warm the front page cache[\s\S]*?if \(api\.onServer\)\s*\{[^}]*\}[^\n]*\n\nfunction warmCache\s*\([^)]*\)\s*\{[\s\S]*?setTimeout\(warmCache,[^)]+\)\s*\n\}\s*\n\n?/;
  const contentWithoutWarmCache = content.replace(warmCacheBlock, "");

  // Client content: import from create-api-client, no warmCache
  const clientContent = contentWithoutWarmCache
    .replace(
      /import\s*\{\s*createAPI\s*\}\s*from\s*['"]create-api['"]/,
      'import { createAPI } from "./create-api-client.js"'
    )
    .replace(
      /!!process\.env\.DEBUG_API/g,
      "!!import.meta.env.DEV && !!import.meta.env.VITE_DEBUG_API"
    )
    .replace(/process\.env\.DEBUG_API/g, "import.meta.env.VITE_DEBUG_API")
    .replace(
      /cache && cache\.has\(child\)/g,
      "cache && cache.has && cache.has(child)"
    );

  // Server content: import from create-api-server, keep warmCache
  const serverContent = content
    .replace(
      /import\s*\{\s*createAPI\s*\}\s*from\s*['"]create-api['"]/,
      'import { createAPI } from "./create-api-server.js"'
    )
    .replace(
      /!!process\.env\.DEBUG_API/g,
      "!!import.meta.env.DEV && !!import.meta.env.VITE_DEBUG_API"
    )
    .replace(/process\.env\.DEBUG_API/g, "import.meta.env.VITE_DEBUG_API")
    .replace(
      /cache && cache\.has\(child\)/g,
      "cache && cache.has && cache.has(child)"
    );

  // index.js: re-export client by default
  const indexContent = `// Re-export from client by default; Vite uses resolve.conditions for SSR
export * from "./index.client.js";
`;

  if (!dryRun) {
    await fs.writeFile(path.join(apiDir, "index.client.js"), clientContent, "utf-8");
    await fs.writeFile(path.join(apiDir, "index.server.js"), serverContent, "utf-8");
    await fs.writeFile(indexPath, indexContent, "utf-8");
    result.changes.push("Created index.client.js and index.server.js");
    result.changes.push("Updated api/index.js");
    result.modified = true;
  } else {
    result.changes.push("Would create index.client.js and index.server.js");
    result.changes.push("Would update api/index.js");
  }

  return result;
}

/**
 * Add SSR alias for index.client.js -> index.server.js in vite.config
 */
export async function addCreateApiViteAlias(
  projectPath: string,
  dryRun: boolean
): Promise<boolean> {
  const vitePaths = [
    path.join(projectPath, "vite.config.js"),
    path.join(projectPath, "vite.config.ts"),
  ];

  for (const vitePath of vitePaths) {
    if (!fsSync.existsSync(vitePath)) continue;

    let content = await fs.readFile(vitePath, "utf-8");
    if (content.includes("index.client.js")) return false;

    const resolveAliasBlock = `resolve: {
      alias: {
        "./index.client.js": "./index.server.js",
      },
    }`;

    if (content.includes("ssr: {")) {
      content = content.replace(
        /(ssr:\s*\{\s*\n\s*(?:noExternal|external):\s*\[[^\]]+\])\s*,?\s*\n(\s*)\}/,
        `$1,\n$2${resolveAliasBlock},\n$2}`
      );
    } else {
      content = content.replace(
        /(build:\s*\{[^}]*\},?)/s,
        `$1
  ssr: {
    external: ["firebase"],
    ${resolveAliasBlock},
  },`
      );
    }

    if (!dryRun) {
      await fs.writeFile(vitePath, content, "utf-8");
    }
    return true;
  }
  return false;
}
