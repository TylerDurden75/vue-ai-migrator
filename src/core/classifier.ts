/**
 * Classification system for migration complexity
 * 🟢 Simple → Automatic codemod
 * 🟡 Medium → Codemod + validation
 * 🔴 Complex → AI-assisted migration
 */

import * as jscodeshift from 'jscodeshift';
import { parseVueFile, isVueFile } from '../utils/codegen';

export type ComplexityLevel = 'simple' | 'medium' | 'complex';

export interface ClassificationResult {
  level: ComplexityLevel;
  confidence: number; // 0-1
  reasons: string[];
  estimatedTime?: string; // e.g., "5min", "30min"
  requiresAI: boolean;
  autoMigratable: boolean;
}

export interface ClassificationOptions {
  useAIForAnalysis?: boolean;
  aiService?: {
    analyzeComplexity: (code: string) => Promise<{
      complexity: 'low' | 'medium' | 'high' | ComplexityLevel;
      recommendations: string[];
    }>;
  };
}

/**
 * Classifies migration complexity based on AST analysis
 */
export class MigrationClassifier {
  private jscodeshift = jscodeshift.withParser('tsx');

  /**
   * Classify a file's migration complexity
   */
  async classify(
    _filePath: string,
    source: string,
    options: ClassificationOptions = {}
  ): Promise<ClassificationResult> {
    const reasons: string[] = [];
    let complexityScore = 0; // 0 = simple, 1 = medium, 2 = complex

    // Check if it's a Vue file
    const isVue = isVueFile(source);
    const vueParts = isVue ? parseVueFile(source) : null;

    // Analyze script section
    if (vueParts?.script) {
      const scriptAnalysis = this.analyzeScript(vueParts.script.content);
      complexityScore += scriptAnalysis.score;
      reasons.push(...scriptAnalysis.reasons);
    } else if (!isVue) {
      // Analyze JS/TS file
      const scriptAnalysis = this.analyzeScript(source);
      complexityScore += scriptAnalysis.score;
      reasons.push(...scriptAnalysis.reasons);
    }

    // Analyze template section
    if (vueParts?.template) {
      const templateAnalysis = this.analyzeTemplate(vueParts.template.content);
      complexityScore += templateAnalysis.score;
      reasons.push(...templateAnalysis.reasons);
    }

    // Use AI for final analysis if available and code is potentially complex
    if (options.useAIForAnalysis && options.aiService && complexityScore >= 1) {
      try {
        const aiAnalysis = await options.aiService.analyzeComplexity(source);
        // Map 'high' or 'complex' to complex level
        const complexity = aiAnalysis.complexity;
        if (complexity === 'high' || complexity === 'complex') {
          complexityScore = 2;
          reasons.push('AI detected high complexity');
          reasons.push(...aiAnalysis.recommendations);
        }
      } catch (error) {
        // Fallback to AST-based classification
        reasons.push('AI analysis unavailable, using AST-based classification');
      }
    }

    // Determine final level
    let level: ComplexityLevel;
    if (complexityScore === 0) {
      level = 'simple';
    } else if (complexityScore === 1) {
      level = 'medium';
    } else {
      level = 'complex';
    }

    // Calculate confidence based on number of indicators
    const confidence = Math.min(0.95, 0.5 + reasons.length * 0.1);

    // Estimate time
    const estimatedTime = this.estimateTime(level, reasons.length);

    return {
      level,
      confidence,
      reasons,
      estimatedTime,
      requiresAI: level === 'complex',
      autoMigratable: level === 'simple' || level === 'medium',
    };
  }

  /**
   * Analyze script section complexity
   */
  private analyzeScript(code: string): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    try {
      const root = this.jscodeshift(code);
      const program = root.find(jscodeshift.Program).paths()[0]?.node;

      if (!program) {
        return { score: 0, reasons: [] };
      }

      // Check for complex patterns
      const checks = [
        {
          name: 'Mixins usage',
          check: () => this.hasMixins(root),
          weight: 1,
        },
        {
          name: 'Vuex store usage',
          check: () => this.hasVuex(root),
          weight: 1,
        },
        {
          name: 'Complex computed properties',
          check: () => this.hasComplexComputed(root),
          weight: 0.5,
        },
        {
          name: 'Multiple lifecycle hooks',
          check: () => this.hasMultipleLifecycleHooks(root),
          weight: 0.5,
        },
        {
          name: 'Custom directives',
          check: () => this.hasCustomDirectives(root),
          weight: 1,
        },
        {
          name: 'Provide/Inject',
          check: () => this.hasProvideInject(root),
          weight: 0.5,
        },
        {
          name: 'Event API ($on, $off)',
          check: () => this.hasEventAPI(root),
          weight: 1,
        },
        {
          name: 'Global Vue API',
          check: () => this.hasGlobalVueAPI(root),
          weight: 0.5,
        },
        {
          name: 'Filters usage',
          check: () => this.hasFilters(root),
          weight: 0.5,
        },
        {
          name: 'Complex watchers',
          check: () => this.hasComplexWatchers(root),
          weight: 0.5,
        },
      ];

      for (const check of checks) {
        if (check.check()) {
          score += check.weight;
          reasons.push(check.name);
        }
      }

      // Multiple complex patterns = complex migration
      if (score >= 2) {
        score = 2;
      } else if (score >= 1) {
        score = 1;
      }
    } catch (error) {
      // If parsing fails, assume medium complexity
      score = 1;
      reasons.push('Parse error - manual review recommended');
    }

    return { score, reasons };
  }

  /**
   * Analyze template section complexity
   */
  private analyzeTemplate(template: string): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Check for complex template patterns
    if (template.includes('slot-scope')) {
      score += 0.5;
      reasons.push('Scoped slots');
    }

    if (template.includes('|')) {
      score += 0.5;
      reasons.push('Filters in template');
    }

    if (template.includes('$listeners')) {
      score += 0.5;
      reasons.push('$listeners usage');
    }

    if (template.includes('functional')) {
      score += 0.5;
      reasons.push('Functional components');
    }

    if (template.includes('v-model') && template.split('v-model').length > 2) {
      score += 0.5;
      reasons.push('Multiple v-model bindings');
    }

    return { score, reasons };
  }

  // AST analysis helpers
  private hasMixins(root: jscodeshift.Collection<any>): boolean {
    return (
      root.find(jscodeshift.Property, { key: { name: 'mixins' } }).size() > 0 ||
      root.find(jscodeshift.CallExpression, { callee: { property: { name: 'mixin' } } }).size() > 0
    );
  }

  private hasVuex(root: jscodeshift.Collection<any>): boolean {
    return (
      root.find(jscodeshift.MemberExpression, { object: { name: '$store' } }).size() > 0 ||
      root.find(jscodeshift.CallExpression, { callee: { name: 'mapState' } }).size() > 0 ||
      root.find(jscodeshift.CallExpression, { callee: { name: 'mapGetters' } }).size() > 0 ||
      root.find(jscodeshift.CallExpression, { callee: { name: 'mapActions' } }).size() > 0 ||
      root.find(jscodeshift.CallExpression, { callee: { name: 'mapMutations' } }).size() > 0
    );
  }

  private hasComplexComputed(root: jscodeshift.Collection<any>): boolean {
    const computed = root.find(jscodeshift.Property, { key: { name: 'computed' } });
    if (computed.size() === 0) return false;

    // Check if computed properties have complex logic
    const computedProps = computed.find(jscodeshift.ObjectProperty);
    return computedProps.size() > 5; // More than 5 computed properties
  }

  private hasMultipleLifecycleHooks(root: jscodeshift.Collection<any>): boolean {
    const lifecycleHooks = [
      'beforeCreate',
      'created',
      'beforeMount',
      'mounted',
      'beforeUpdate',
      'updated',
      'beforeDestroy',
      'destroyed',
    ];

    let count = 0;
    for (const hook of lifecycleHooks) {
      if (root.find(jscodeshift.Property, { key: { name: hook } }).size() > 0) {
        count++;
      }
    }

    return count > 4; // More than 4 lifecycle hooks
  }

  private hasCustomDirectives(root: jscodeshift.Collection<any>): boolean {
    return (
      root.find(jscodeshift.Property, { key: { name: 'directives' } }).size() > 0 ||
      root
        .find(jscodeshift.CallExpression, { callee: { property: { name: 'directive' } } })
        .size() > 0
    );
  }

  private hasProvideInject(root: jscodeshift.Collection<any>): boolean {
    return (
      root.find(jscodeshift.Property, { key: { name: 'provide' } }).size() > 0 ||
      root.find(jscodeshift.Property, { key: { name: 'inject' } }).size() > 0
    );
  }

  private hasEventAPI(root: jscodeshift.Collection<any>): boolean {
    return (
      root.find(jscodeshift.MemberExpression, { property: { name: '$on' } }).size() > 0 ||
      root.find(jscodeshift.MemberExpression, { property: { name: '$off' } }).size() > 0 ||
      root.find(jscodeshift.MemberExpression, { property: { name: '$once' } }).size() > 0
    );
  }

  private hasGlobalVueAPI(root: jscodeshift.Collection<any>): boolean {
    return (
      root.find(jscodeshift.CallExpression, { callee: { object: { name: 'Vue' } } }).size() > 0 ||
      root.find(jscodeshift.MemberExpression, { object: { name: 'Vue' } }).size() > 0
    );
  }

  private hasFilters(root: jscodeshift.Collection<any>): boolean {
    return root.find(jscodeshift.Property, { key: { name: 'filters' } }).size() > 0;
  }

  private hasComplexWatchers(root: jscodeshift.Collection<any>): boolean {
    const watch = root.find(jscodeshift.Property, { key: { name: 'watch' } });
    if (watch.size() === 0) return false;

    const watchProps = watch.find(jscodeshift.ObjectProperty);
    return watchProps.size() > 5; // More than 5 watchers
  }

  /**
   * Estimate migration time based on complexity
   */
  private estimateTime(level: ComplexityLevel, indicatorCount: number): string {
    const baseTime: Record<ComplexityLevel, number> = {
      simple: 2, // minutes
      medium: 10,
      complex: 30,
    };

    const time = baseTime[level] + indicatorCount * 2;
    if (time < 60) {
      return `${time}min`;
    }
    return `${Math.ceil(time / 60)}h`;
  }
}
