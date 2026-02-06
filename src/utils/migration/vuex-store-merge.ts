import * as fs from "fs/promises";
import * as path from "path";

export interface VuexStoreMergeResult {
  success: boolean;
  merged: boolean;
  storePath: string;
  mergedFiles: string[];
  removedFiles: string[];
  changes: string[];
  warnings: string[];
  errors: string[];
}

const STORE_PATHS = ["src/store", "store", "src/stores", "stores"];

/**
 * Extract the default export object content from a JS file.
 * Handles: export default { ... } or export default { ... };
 */
function extractDefaultExportObject(content: string): { content: string; imports: string } | null {
  // Extract top-level imports (before export default) - handle multiline
  const importRegex = /import\s+(?:[\w{}\s,*\n]+?)\s+from\s+['"][^'"]+['"];?\s*/g;
  const imports: string[] = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const line = match[0].trim();
    // Skip Vue import if we're merging - the main store will have it
    if (!line.includes("from 'vue'") && !line.includes('from "vue"')) {
      imports.push(line);
    }
  }

  // Find export default and extract object with proper brace matching
  const exportIdx = content.indexOf("export default");
  if (exportIdx === -1) return null;

  const afterExport = content.slice(exportIdx + "export default".length);
  const braceStart = afterExport.indexOf("{");
  if (braceStart === -1) return null;

  let depth = 1;
  let i = braceStart + 1;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  while (i < afterExport.length && depth > 0) {
    const char = afterExport[i];
    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      i++;
      continue;
    }
    if (!inString) {
      if (char === '"' || char === "'" || char === "`") {
        inString = true;
        stringChar = char;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      }
    } else if (char === stringChar) {
      inString = false;
    }
    i++;
  }

  if (depth !== 0) return null;

  const objectStr = afterExport.slice(braceStart, i);
  const objectContent = objectStr.slice(1, -1).trim();

  return {
    content: objectContent,
    imports: imports.join("\n"),
  };
}

/**
 * Check if store/index.js imports from ./actions, ./mutations, ./getters
 */
function detectSplitStore(content: string): {
  hasActions: boolean;
  hasMutations: boolean;
  hasGetters: boolean;
} {
  const hasActions =
    /import\s+\w+\s+from\s+['"]\.\/actions['"]/m.test(content) ||
    /import\s+\w+\s+from\s+['"]\.\.?\/actions['"]/m.test(content);
  const hasMutations =
    /import\s+\w+\s+from\s+['"]\.\/mutations['"]/m.test(content) ||
    /import\s+\w+\s+from\s+['"]\.\.?\/mutations['"]/m.test(content);
  const hasGetters =
    /import\s+\w+\s+from\s+['"]\.\/getters['"]/m.test(content) ||
    /import\s+\w+\s+from\s+['"]\.\.?\/getters['"]/m.test(content);

  return { hasActions, hasMutations, hasGetters };
}

/**
 * Merge Vuex store split across actions.js, mutations.js, getters.js into a single index.js
 */
export async function mergeVuexStore(
  projectPath: string,
  dryRun: boolean = false,
): Promise<VuexStoreMergeResult> {
  const result: VuexStoreMergeResult = {
    success: false,
    merged: false,
    storePath: "",
    mergedFiles: [],
    removedFiles: [],
    changes: [],
    warnings: [],
    errors: [],
  };

  let storeIndexPath: string | null = null;

  for (const storePath of STORE_PATHS) {
    const fullPath = path.join(projectPath, storePath);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const indexJs = path.join(fullPath, "index.js");
        const indexTs = path.join(fullPath, "index.ts");
        if (await fileExists(indexJs)) {
          storeIndexPath = indexJs;
          break;
        }
        if (await fileExists(indexTs)) {
          storeIndexPath = indexTs;
          break;
        }
      }
    } catch {
      continue;
    }
  }

  if (!storeIndexPath) {
    result.errors.push("No store/index.js or store/index.ts found in project");
    return result;
  }

  result.storePath = path.relative(projectPath, storeIndexPath);
  const storeDir = path.dirname(storeIndexPath);

  let indexContent: string;
  try {
    indexContent = await fs.readFile(storeIndexPath, "utf-8");
  } catch (err) {
    result.errors.push(`Failed to read ${result.storePath}: ${err}`);
    return result;
  }

  const { hasActions, hasMutations, hasGetters } = detectSplitStore(indexContent);

  if (!hasActions && !hasMutations && !hasGetters) {
    result.warnings.push("Store does not use split structure (actions/mutations/getters) - nothing to merge");
    result.success = true;
    return result;
  }

  const actionsPath = path.join(storeDir, "actions.js");
  const mutationsPath = path.join(storeDir, "mutations.js");
  const gettersPath = path.join(storeDir, "getters.js");

  const actionsContent = hasActions && (await fileExists(actionsPath))
    ? await fs.readFile(actionsPath, "utf-8")
    : null;
  const mutationsContent = hasMutations && (await fileExists(mutationsPath))
    ? await fs.readFile(mutationsPath, "utf-8")
    : null;
  const gettersContent = hasGetters && (await fileExists(gettersPath))
    ? await fs.readFile(gettersPath, "utf-8")
    : null;

  if (hasActions && !actionsContent) {
    result.errors.push("actions.js referenced but not found");
    return result;
  }
  if (hasMutations && !mutationsContent) {
    result.errors.push("mutations.js referenced but not found");
    return result;
  }
  if (hasGetters && !gettersContent) {
    result.errors.push("getters.js referenced but not found");
    return result;
  }

  // Extract content from each file
  let actionsInlines = "";
  let actionsImports = "";
  if (actionsContent) {
    const extracted = extractDefaultExportObject(actionsContent);
    if (extracted) {
      actionsInlines = extracted.content;
      actionsImports = extracted.imports;
    } else {
      result.errors.push("Could not parse actions.js default export");
      return result;
    }
  }

  let mutationsInlines = "";
  if (mutationsContent) {
    const extracted = extractDefaultExportObject(mutationsContent);
    if (extracted) {
      mutationsInlines = extracted.content;
    } else {
      result.errors.push("Could not parse mutations.js default export");
      return result;
    }
  }

  let gettersInlines = "";
  if (gettersContent) {
    const extracted = extractDefaultExportObject(gettersContent);
    if (extracted) {
      gettersInlines = extracted.content;
    } else {
      result.errors.push("Could not parse getters.js default export");
      return result;
    }
  }

  // Build merged index.js
  // 1. Remove imports of actions, mutations, getters
  // 2. Add actionsImports after existing imports (if any from actions)
  // 3. Replace actions, mutations, getters in Vuex.Store config with inline objects

  let newIndexContent = indexContent;

  // Remove the import lines for actions, mutations, getters
  newIndexContent = newIndexContent.replace(
    /import\s+\w+\s+from\s+['"]\.\/actions['"];?\s*\n?/g,
    "",
  );
  newIndexContent = newIndexContent.replace(
    /import\s+\w+\s+from\s+['"]\.\/mutations['"];?\s*\n?/g,
    "",
  );
  newIndexContent = newIndexContent.replace(
    /import\s+\w+\s+from\s+['"]\.\/getters['"];?\s*\n?/g,
    "",
  );

  // Add actions imports after the last import (before Vue.use)
  if (actionsImports.trim()) {
    const importMatches = [...newIndexContent.matchAll(/import\s+.*?from\s+['"].*?['"];?\s*/g)];
    const lastImport = importMatches[importMatches.length - 1];
    const insertAfter = lastImport
      ? lastImport.index! + lastImport[0].length
      : -1;
    if (insertAfter >= 0) {
      const before = newIndexContent.slice(0, insertAfter);
      const after = newIndexContent.slice(insertAfter);
      newIndexContent = before + "\n\n" + actionsImports.trim() + "\n" + after;
    }
  }

  // Replace actions, mutations, getters in the store config with inline content
  // Handles: actions, or actions: actions, (ES6 shorthand)
  const storeConfigMatch = newIndexContent.match(
    /new\s+Vuex\.Store\s*\(\s*\{([\s\S]*?)\}\s*\)/,
  );
  if (!storeConfigMatch) {
    result.errors.push("Could not find Vuex.Store config in index");
    return result;
  }

  let configContent = storeConfigMatch[1];

  const indent = (str: string, spaces: number) =>
    str
      .split("\n")
      .map((line) => " ".repeat(spaces) + line)
      .join("\n");

  const configIndent = 4;
  if (hasActions && actionsInlines) {
    const inlineActions = `actions: {\n${indent(actionsInlines, configIndent + 2)}\n  }`;
    configContent = configContent.replace(
      /^\s*actions\s*,?\s*$/m,
      "  " + inlineActions + ",",
    );
    configContent = configContent.replace(
      /actions\s*:\s*\w+\s*,?/,
      "  " + inlineActions + ",",
    );
  }

  if (hasMutations && mutationsInlines) {
    const inlineMutations = `mutations: {\n${indent(mutationsInlines, configIndent + 2)}\n  }`;
    configContent = configContent.replace(
      /^\s*mutations\s*,?\s*$/m,
      "  " + inlineMutations + ",",
    );
    configContent = configContent.replace(
      /mutations\s*:\s*\w+\s*,?/,
      "  " + inlineMutations + ",",
    );
  }

  if (hasGetters && gettersInlines) {
    const inlineGetters = `getters: {\n${indent(gettersInlines, configIndent + 2)}\n  }`;
    configContent = configContent.replace(
      /^\s*getters\s*,?\s*$/m,
      "  " + inlineGetters,
    );
    configContent = configContent.replace(
      /getters\s*:\s*\w+\s*,?/,
      "  " + inlineGetters,
    );
  }

  newIndexContent = newIndexContent.replace(
    /new\s+Vuex\.Store\s*\(\s*\{[\s\S]*?\}\s*\)/,
    `new Vuex.Store({\n${configContent}\n})`,
  );

  result.changes.push(`Merged actions, mutations, getters into ${result.storePath}`);
  if (hasActions) result.mergedFiles.push("actions.js");
  if (hasMutations) result.mergedFiles.push("mutations.js");
  if (hasGetters) result.mergedFiles.push("getters.js");

  if (!dryRun) {
    try {
      await fs.writeFile(storeIndexPath, newIndexContent, "utf-8");
      result.merged = true;
      result.success = true;

      // Remove merged files
      if (hasActions && (await fileExists(actionsPath))) {
        await fs.unlink(actionsPath);
        result.removedFiles.push(path.relative(projectPath, actionsPath));
      }
      if (hasMutations && (await fileExists(mutationsPath))) {
        await fs.unlink(mutationsPath);
        result.removedFiles.push(path.relative(projectPath, mutationsPath));
      }
      if (hasGetters && (await fileExists(gettersPath))) {
        await fs.unlink(gettersPath);
        result.removedFiles.push(path.relative(projectPath, gettersPath));
      }
    } catch (err) {
      result.errors.push(`Failed to write merged store: ${err}`);
      return result;
    }
  } else {
    result.success = true;
    result.changes.push("(dry run - no files modified)");
  }

  return result;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
