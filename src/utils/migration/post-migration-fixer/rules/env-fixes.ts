/**
 * Rules for process.env / browser compatibility (process is not defined in Vite client bundle)
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";

/** Server-only file patterns - do not replace process in these */
const SERVER_ONLY_PATTERNS = [
  /entry-server/i,
  /create-api-server/i,
  /server\.(js|ts)$/,
  /\.server\.(js|ts)$/,
];

function isServerOnlyFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SERVER_ONLY_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Fix: process.env in client-side code → import.meta.env (Vite).
 * process is not defined in browser; Vite uses import.meta.env.
 * Generic: applies to util, api, components - skips server-only files.
 */
export const processEnvToImportMetaRule: FixRule = {
  id: "process-env-to-import-meta",
  description: "Replace process.env with import.meta.env for Vite client bundle",
  priority: 88,
  shouldApply: (filePath, content) => {
    if (isServerOnlyFile(filePath)) return false;
    if (!content.includes("process.env")) return false;
    return /\.(vue|js|ts)$/i.test(filePath);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    if (isServerOnlyFile(filePath)) return result;
    let fixed = content;

    // process.env.NODE_ENV === 'production' → import.meta.env.PROD
    fixed = fixed.replace(
      /process\.env\.NODE_ENV\s*===\s*['"]production['"]/g,
      "import.meta.env.PROD"
    );
    // process.env.NODE_ENV !== 'production' → import.meta.env.DEV
    fixed = fixed.replace(
      /process\.env\.NODE_ENV\s*!==\s*['"]production['"]/g,
      "import.meta.env.DEV"
    );
    // process.env.NODE_ENV === 'development' → import.meta.env.DEV
    fixed = fixed.replace(
      /process\.env\.NODE_ENV\s*===\s*['"]development['"]/g,
      "import.meta.env.DEV"
    );

    // process.env.VUE_ENV === 'server' → import.meta.env.SSR
    fixed = fixed.replace(
      /process\.env\.VUE_ENV\s*===\s*['"]server['"]/g,
      "import.meta.env.SSR"
    );
    fixed = fixed.replace(
      /process\.env\.VUE_ENV\s*!==\s*['"]server['"]/g,
      "!import.meta.env.SSR"
    );

    // process.env.DEBUG_API → import.meta.env.VITE_DEBUG_API
    fixed = fixed.replace(/process\.env\.DEBUG_API/g, "import.meta.env.VITE_DEBUG_API");

    // process.env.BASE_URL → import.meta.env.BASE_URL (Vite provides this)
    fixed = fixed.replace(/process\.env\.BASE_URL/g, "import.meta.env.BASE_URL");

    // Generic: remaining process.env.VAR_NAME → import.meta.env.VITE_VAR_NAME
    fixed = fixed.replace(
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
      "import.meta.env.VITE_$1"
    );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced process.env with import.meta.env for Vite");
    }
    return result;
  },
};
