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
