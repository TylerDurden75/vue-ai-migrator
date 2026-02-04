/**
 * Optimized rule engine for post-migration fixes
 * Executes rules in a single pass with dependency resolution
 */

import type { FixRule, FixContext, RuleExecutionPlan, FixResult } from "./types";

export class RuleEngine {
  private rules: Map<string, FixRule> = new Map();
  private executionPlan: RuleExecutionPlan | null = null;

  /**
   * Register a fix rule
   */
  registerRule(rule: FixRule): void {
    this.rules.set(rule.id, rule);
    this.executionPlan = null; // Invalidate cache
  }

  /**
   * Register multiple rules
   */
  registerRules(rules: FixRule[]): void {
    rules.forEach(rule => this.registerRule(rule));
    this.executionPlan = null;
  }

  /**
   * Build execution plan with topological sort for dependencies
   */
  private buildExecutionPlan(): RuleExecutionPlan {
    if (this.executionPlan) {
      return this.executionPlan;
    }

    const rules = Array.from(this.rules.values());
    
    // Sort by priority (higher first)
    rules.sort((a, b) => b.priority - a.priority);

    // Topological sort for dependencies
    const executionOrder: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (ruleId: string) => {
      if (visiting.has(ruleId)) {
        // Circular dependency detected - skip
        return;
      }
      if (visited.has(ruleId)) {
        return;
      }

      visiting.add(ruleId);
      const rule = this.rules.get(ruleId);
      if (rule?.dependencies) {
        rule.dependencies.forEach(depId => {
          if (this.rules.has(depId)) {
            visit(depId);
          }
        });
      }
      visiting.delete(ruleId);
      visited.add(ruleId);
      executionOrder.push(ruleId);
    };

    rules.forEach(rule => {
      if (!visited.has(rule.id)) {
        visit(rule.id);
      }
    });

    this.executionPlan = {
      rules,
      executionOrder
    };

    return this.executionPlan;
  }

  /**
   * Execute all applicable rules in a single optimized pass
   */
  async execute(
    filePath: string,
    content: string,
    context: FixContext
  ): Promise<FixResult> {
    const plan = this.buildExecutionPlan();
    const result: FixResult = {
      fixed: false,
      issues: [],
      fixes: [],
      content
    };

    let currentContent = content;
    let hasChanges = false;

    // Update context with current content (for rules that need it)
    if (context.isVueFile) {
      const scriptMatch = currentContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      context.scriptContent = scriptMatch ? scriptMatch[1] : undefined;
      
      const templateMatch = currentContent.match(/<template[^>]*>([\s\S]*?)<\/template>/);
      context.templateContent = templateMatch ? templateMatch[1] : undefined;
      
      // Update AST cache
      if (context.astCache) {
        context.astCache.scriptContent = context.scriptContent;
        context.astCache.templateContent = context.templateContent;
      }
    }

    // Execute rules in order
    for (const ruleId of plan.executionOrder) {
      const rule = this.rules.get(ruleId);
      if (!rule) continue;

      // Check if rule should apply
      if (!rule.shouldApply(filePath, currentContent)) {
        continue;
      }

      try {
        // Update context with latest content before applying rule
        if (context.isVueFile && currentContent !== content) {
          const scriptMatch = currentContent.match(/<script[^>]*>([\s\S]*?)<\/script>/);
          context.scriptContent = scriptMatch ? scriptMatch[1] : undefined;
          
          if (context.astCache) {
            context.astCache.scriptContent = context.scriptContent;
          }
        }

        // Apply rule
        const ruleResult = await rule.apply(filePath, currentContent, context);
        
        if (ruleResult.fixed) {
          currentContent = ruleResult.content;
          hasChanges = true;
          result.fixes.push(...ruleResult.fixes);
          result.issues.push(...ruleResult.issues);
        }
      } catch (error) {
        result.issues.push(
          `Error in rule ${rule.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    result.fixed = hasChanges;
    result.content = currentContent;

    return result;
  }

  /**
   * Get all registered rules
   */
  getRules(): FixRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Clear all rules
   */
  clear(): void {
    this.rules.clear();
    this.executionPlan = null;
  }
}
