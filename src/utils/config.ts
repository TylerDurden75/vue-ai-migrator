/**
 * Load and merge vue-migrator.config.js from project root
 */

import { createRequire } from "module";
import * as path from "path";
import * as fs from "fs/promises";

const dynamicRequire = createRequire(__filename);

export interface VueMigratorConfig {
  /** Paths to ignore during migration (glob patterns) */
  ignore?: string[];
  /** Custom store paths (e.g. ["src/stores", "src/store"]) - used by store analyzer */
  storePaths?: string[];
  /** Fixer rules to enable (by rule id) - only these run if specified */
  fixerRulesEnable?: string[];
  /** Fixer rules to disable (by rule id) */
  fixerRulesDisable?: string[];
  /** Transformations to apply */
  transformations?: string[];
  /** Use AI for complex cases */
  useAI?: boolean;
  /** AI configuration */
  ai?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
  };
}

const DEFAULT_CONFIG: VueMigratorConfig = {
  ignore: ["node_modules/**", "dist/**", "build/**"],
  storePaths: ["src/store", "store"],
};

/**
 * Load vue-migrator.config.js from project root
 */
export async function loadConfig(
  projectPath: string,
): Promise<VueMigratorConfig> {
  const configPaths = [
    path.join(projectPath, "vue-migrator.config.js"),
    path.join(projectPath, "vue-migrator.config.cjs"),
  ];

  for (const configPath of configPaths) {
    try {
      await fs.access(configPath);
      const mod = dynamicRequire(configPath);
      const userConfig = (mod.default ?? mod) as VueMigratorConfig;
      return mergeConfig(DEFAULT_CONFIG, userConfig);
    } catch {
      continue;
    }
  }

  return { ...DEFAULT_CONFIG };
}

function mergeConfig(
  defaults: VueMigratorConfig,
  user: VueMigratorConfig,
): VueMigratorConfig {
  return {
    ignore: user.ignore ?? defaults.ignore,
    storePaths: user.storePaths ?? defaults.storePaths,
    fixerRulesEnable: user.fixerRulesEnable,
    fixerRulesDisable: user.fixerRulesDisable,
    transformations: user.transformations ?? defaults.transformations,
    useAI: user.useAI ?? defaults.useAI,
    ai: user.ai ? { ...defaults.ai, ...user.ai } : defaults.ai,
  };
}
