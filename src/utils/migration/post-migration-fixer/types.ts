/**
 * Types and interfaces for post-migration fixer
 */

export interface FixResult {
  fixed: boolean;
  issues: string[];
  fixes: string[];
  content: string;
  warnings?: string[]; // Optional warnings array for compatibility
}

export interface FixRule {
  /** Unique identifier for the rule */
  id: string;
  
  /** Human-readable description */
  description: string;
  
  /** Priority: higher = runs first */
  priority: number;
  
  /** Dependencies: rule IDs that must run before this one */
  dependencies?: string[];
  
  /** Check if this rule should be applied to the file */
  shouldApply: (filePath: string, content: string) => boolean;
  
  /** Apply the fix and return modified content */
  apply: (
    filePath: string,
    content: string,
    context: FixContext
  ) => Promise<FixRuleResult>;
}

export interface MainStoreInfo {
  storeName: string;
  storeVar: string;
  importPath: string;
  storeId: string;
}

export interface FixContext {
  enableTypeScript: boolean;
  projectRoot?: string;
  isVueFile: boolean;
  scriptContent?: string;
  templateContent?: string;
  astCache?: {
    scriptContent?: string;
    templateContent?: string;
  };
  /** Main store from project (useXStore, xStore, @/store/index) - detected dynamically */
  mainStoreInfo?: MainStoreInfo;
  /** Rule IDs to disable (from vue-migrator.config.js fixerRulesDisable) */
  fixerRulesDisable?: string[];
  /** If set, only run these rule IDs (from vue-migrator.config.js fixerRulesEnable) */
  fixerRulesEnable?: string[];
  /** Event bus classification: composable vs mitt per event name (set during migration) */
  eventBusClassification?: {
    composable: Set<string>;
    mitt: Set<string>;
  };
  /** Mixin → composable map (mixin file absolute path -> { composableName, returnKeys, composablePath }) */
  mixinComposablesMap?: Map<
    string,
    { composableName: string; returnKeys: string[]; composablePath: string }
  >;
}

export interface FixRuleResult {
  content: string;
  fixed: boolean;
  fixes: string[];
  issues: string[];
}

export interface RuleExecutionPlan {
  rules: FixRule[];
  executionOrder: string[];
}
