/**
 * Add inject() in components that use global composable data (from app.provide)
 * when they don't already get it from useX() or inject('key')
 */

import * as fs from "fs";
import * as path from "path";
import type { FixRule, FixContext, FixRuleResult } from "../../types";

interface ProvideInfo {
  provideKey: string;
  composableName: string;
  returnKeys: string[];
}

/**
 * Parse main.js/main.ts for app.provide('key', useXxx()) and build provide -> returnKeys map
 */
function getProvidesFromMain(
  projectRoot: string,
  mixinMap: Map<string, { composableName: string; returnKeys: string[]; composablePath?: string }>
): ProvideInfo[] {
  const mainPaths = [
    path.join(projectRoot, "src", "main.js"),
    path.join(projectRoot, "src", "main.ts"),
    path.join(projectRoot, "main.js"),
    path.join(projectRoot, "main.ts"),
  ];
  let mainContent = "";
  for (const p of mainPaths) {
    try {
      mainContent = fs.readFileSync(p, "utf-8");
      break;
    } catch {
      continue;
    }
  }
  if (!mainContent) return [];

  const provides: ProvideInfo[] = [];
  // app.provide('user', useUser()) or app.provide("user", useUser())
  const providePattern = /app\.provide\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\(\s*\)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = providePattern.exec(mainContent)) !== null) {
    const provideKey = m[1];
    const composableName = m[2];
    const returnKeys = findReturnKeysForComposable(composableName, mixinMap);
    provides.push({ provideKey, composableName, returnKeys });
  }
  return provides;
}

function findReturnKeysForComposable(
  composableName: string,
  mixinMap: Map<string, { composableName: string; returnKeys: string[]; composablePath?: string }>
): string[] {
  for (const info of mixinMap.values()) {
    if (info.composableName === composableName) return info.returnKeys;
  }
  return [];
}

/**
 * Check if name is used in template or script (excluding comments and strings)
 */
function isKeyUsedInContent(key: string, templateContent: string, scriptContent: string): boolean {
  const regex = new RegExp(`\\b${key}\\b`);
  if (templateContent && regex.test(templateContent)) return true;
  if (scriptContent && regex.test(scriptContent)) return true;
  return false;
}

/**
 * Check if component already has inject(provideKey) or composableName()
 */
function alreadyHasAccess(scriptContent: string, provideKey: string, composableName: string): boolean {
  if (new RegExp(`inject\\s*\\(\\s*['"]${provideKey}['"]\\s*\\)`).test(scriptContent)) return true;
  if (new RegExp(`${composableName}\\s*\\(\\s*\\)`).test(scriptContent)) return true;
  return false;
}

export const injectGlobalComposableRule: FixRule = {
  id: "inject-global-composable",
  description: "Add inject() in components that use global composable data from app.provide",
  priority: 58,
  dependencies: ["mixins-to-composables", "vue2-global-api"],

  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script setup") &&
      (content.includes("<template>") || content.includes("<template "))
    );
  },

  apply: async (filePath, content, context: FixContext): Promise<FixRuleResult> => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const { projectRoot, mixinComposablesMap } = context;
    if (!projectRoot || !mixinComposablesMap || mixinComposablesMap.size === 0) return result;

    const provides = getProvidesFromMain(projectRoot, mixinComposablesMap);
    if (provides.length === 0) return result;

    const scriptMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!scriptMatch) return result;

    const scriptContent = scriptMatch[1];
    const templateContent = templateMatch?.[1] ?? "";

    const injectsToAdd: Array<{ provideKey: string; composableName: string; keysUsed: string[] }> = [];

    for (const { provideKey, composableName, returnKeys } of provides) {
      if (returnKeys.length === 0) continue;
      if (alreadyHasAccess(scriptContent, provideKey, composableName)) continue;

      const keysUsed = returnKeys.filter((key) =>
        isKeyUsedInContent(key, templateContent, scriptContent)
      );
      if (keysUsed.length > 0) {
        injectsToAdd.push({ provideKey, composableName, keysUsed });
      }
    }

    if (injectsToAdd.length === 0) return result;

    const injectStatements = injectsToAdd
      .map(
        ({ provideKey, keysUsed }) =>
          `const { ${keysUsed.join(", ")} } = inject("${provideKey}");`
      )
      .join("\n");

    const vueImportMatch = scriptContent.match(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"]/);
    const hasVueImport = !!vueImportMatch;
    const hasInjectImport = hasVueImport && /inject/.test(vueImportMatch![1]);

    let modifiedScript = scriptContent;

    // Add inject to vue import if needed
    if (hasVueImport && !hasInjectImport) {
      const newVueImport = vueImportMatch![0].replace(
        /\{([^}]+)\}/,
        (_, names) => `{ ${names.trim()}, inject }`
      );
      modifiedScript = modifiedScript.replace(vueImportMatch![0], newVueImport);
    } else if (!hasVueImport) {
      modifiedScript = 'import { inject } from "vue";\n' + modifiedScript;
    }

    // Insert inject statements after first import block
    const importBlockMatch = modifiedScript.match(/^[\s\n]*(?:import[\s\S]*?;[\s\n]*)+/);
    const insertOffset = importBlockMatch ? importBlockMatch[0].length : 0;
    const injectBlock = injectStatements + "\n\n";
    modifiedScript =
      modifiedScript.slice(0, insertOffset) + injectBlock + modifiedScript.slice(insertOffset);

    const newScriptBlock = scriptMatch[0].replace(scriptMatch[1], modifiedScript);
    result.content = content.replace(scriptMatch[0], newScriptBlock);
    result.fixed = true;
    result.fixes.push(
      `Added inject() for global composable: ${injectsToAdd.map((i) => i.provideKey).join(", ")}`
    );

    return result;
  },
};
