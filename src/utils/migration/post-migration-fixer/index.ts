/**
 * Main entry point for post-migration fixer
 * Uses optimized rule engine for single-pass execution
 */

import { createRequire } from "module";
import * as path from "path";
import { RuleEngine } from "./rule-engine";
import type { FixRule, FixResult, FixContext } from "./types";
import { allRules } from "./rule-groups";
import { scriptStyleInsideTemplateRule } from "./rules/vue-script/vue-structure-fixes";
import { formatWithPrettier } from "../prettier-formatter";
import { astCache } from "./utils/ast-cache";
import { loadConfig } from "../../config";
import { getMainStoreInfo } from "./utils/store-analysis-cache";
import { getEventBusClassification } from "../event-bus-composable";
import {
  getMixinComposablesMap,
  buildMixinComposablesMapFromProject,
} from "../mixins-to-composables";

const _req = createRequire(require.resolve("./rule-engine"));

const ruleEngine = new RuleEngine();
ruleEngine.registerRules(allRules);

/** Load custom rules from config.fixerRulesAdd paths (relative to projectRoot) */
function loadCustomRules(projectRoot: string, rulePaths: string[]): FixRule[] {
  const rules: FixRule[] = [];
  for (const rulePath of rulePaths) {
    try {
      const resolved = path.resolve(projectRoot, rulePath);
      const mod = _req(resolved);
      const ruleOrRules = mod?.default ?? mod;
      if (Array.isArray(ruleOrRules)) {
        rules.push(...ruleOrRules.filter((r): r is FixRule => r && typeof r?.apply === "function"));
      } else if (ruleOrRules && typeof ruleOrRules?.apply === "function") {
        rules.push(ruleOrRules);
      }
    } catch (err) {
      // Log but don't fail - custom rule may be optional
      console.warn(`[vue-ai-migrator] Could not load custom rule from ${rulePath}:`, err);
    }
  }
  return rules;
}

/** Build engine for a run: allRules + optional custom rules from config */
function getEngineForRun(projectRoot: string | undefined, fixerRulesAdd?: string[]) {
  if (!projectRoot || !fixerRulesAdd?.length) {
    return ruleEngine;
  }
  const customRules = loadCustomRules(projectRoot, fixerRulesAdd);
  if (customRules.length === 0) return ruleEngine;
  const engine = new RuleEngine();
  engine.registerRules([...allRules, ...customRules]);
  return engine;
}

/**
 * Main function: Fix post-migration issues using optimized rule engine
 * This replaces the old fixPostMigrationIssues function
 */
export async function fixPostMigrationIssues(
  filePath: string,
  content: string,
  enableTypeScript: boolean = false,
  projectRoot?: string
): Promise<FixResult> {
  const isVueFile = filePath.endsWith(".vue");
  
  // Use AST cache for performance (parse once, reuse for all rules)
  const cachedAST = astCache.get(filePath, content);
  
  let fixerRulesDisable: string[] | undefined;
  let fixerRulesEnable: string[] | undefined;
  let fixerRulesAdd: string[] | undefined;
  if (projectRoot) {
    try {
      const config = await loadConfig(projectRoot);
      fixerRulesDisable = config.fixerRulesDisable;
      fixerRulesEnable = config.fixerRulesEnable;
      fixerRulesAdd = config.fixerRulesAdd;
    } catch {
      // Config not found or invalid, use defaults
    }
  }

  let mainStoreInfo;
  if (projectRoot) {
    try {
      mainStoreInfo = await getMainStoreInfo(projectRoot);
    } catch {
      // Use default if detection fails
    }
  }

  const eventBusClassification = projectRoot
    ? getEventBusClassification(projectRoot) ?? undefined
    : undefined;

  let mixinComposablesMap: Map<string, { composableName: string; returnKeys: string[]; composablePath: string }> | undefined;
  if (projectRoot) {
    mixinComposablesMap = getMixinComposablesMap(projectRoot) ?? undefined;
    if (!mixinComposablesMap) {
      const built = buildMixinComposablesMapFromProject(projectRoot);
      if (built.size > 0) mixinComposablesMap = built;
    }
  }

  const context: FixContext = {
    enableTypeScript,
    projectRoot,
    isVueFile,
    scriptContent: cachedAST.scriptContent,
    templateContent: cachedAST.templateContent,
    astCache: cachedAST,
    mainStoreInfo,
    fixerRulesDisable,
    fixerRulesEnable,
    eventBusClassification,
    mixinComposablesMap,
  };

  // Execute all rules in a single optimized pass (use custom engine if fixerRulesAdd)
  const engine = getEngineForRun(projectRoot, fixerRulesAdd);
  const result = await engine.execute(filePath, content, context);

  // Update AST cache if content changed
  if (result.fixed) {
    astCache.update(filePath, result.content);
  }

  // Final formatting with Prettier
  if (result.fixed) {
    try {
      const prettierFormatted = await formatWithPrettier(filePath, result.content, projectRoot);
      if (prettierFormatted !== result.content) {
        result.content = prettierFormatted;
        if (!result.fixes.some(f => f.includes("Prettier"))) {
          result.fixes.push("Formatted code with Prettier");
        }
      }
    } catch {
      // Prettier not available, continue
    }
  }

  return result;
}

/**
 * Export rule engine for testing and advanced usage
 */
export { ruleEngine };

/**
 * Export parallel processor utilities
 */
export { processFilesInParallel, getOptimalConcurrency } from "./utils/parallel-processor";

/**
 * Clear store analysis cache (for compatibility)
 */
export { clearStoreAnalysisCache } from "./utils/store-analysis-cache";

/**
 * Re-export fixImportPaths for migration pipeline compatibility
 */
export { fixImportPaths } from "../import-paths";

/**
 * Event bus detection (for migrator: create event-bus.js when needed)
 */
export { hasEventBusUsage } from "./rules/event-bus/event-bus-fixes";

/**
 * Pre-migration SFC structure fix: move script/style from inside template to correct position.
 * Call this BEFORE codemods so the parser can correctly parse the file.
 */
export async function fixSFCStructureBeforeMigration(
  filePath: string,
  content: string
): Promise<{ content: string; fixed: boolean }> {
  if (!filePath.endsWith(".vue")) return { content, fixed: false };
  if (!scriptStyleInsideTemplateRule.shouldApply(filePath, content)) {
    return { content, fixed: false };
  }
  const result = await scriptStyleInsideTemplateRule.apply(filePath, content, {
    enableTypeScript: false,
    projectRoot: undefined,
    isVueFile: true,
    scriptContent: "",
    templateContent: "",
    astCache: { get: () => ({}), update: () => {} } as any,
    fixerRulesDisable: undefined,
    fixerRulesEnable: undefined,
  });
  return { content: result.content, fixed: result.fixed };
}
