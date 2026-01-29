/**
 * Unified AI Service for migration
 * Combines the functionality of AIService and MigrationAgent
 * Provides a single, consistent interface for AI-powered migrations
 */

import OpenAI from 'openai';
import { validateApiKey } from '../utils/safety';
import type {
  IAIService,
  MigrationContext,
  AgentResponse,
  ComplexityAnalysis,
} from '../interfaces';

export type LLMProvider = 'openai' | 'mistral' | 'claude' | 'anthropic';

export interface UnifiedAIServiceConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Unified AI Service that combines simple and advanced AI capabilities
 * Implements IAIService interface for consistent usage
 */
export class UnifiedAIService implements IAIService {
  private client: OpenAI | null = null;
  private config: UnifiedAIServiceConfig;

  constructor(config: UnifiedAIServiceConfig) {
    this.config = {
      model: config.model || this.getDefaultModel(config.provider),
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 4000,
      ...config,
    };

    // Initialize provider-specific client
    if (config.provider === 'openai') {
      if (!validateApiKey(config.apiKey, 'openai')) {
        throw new Error(
          'Invalid OpenAI API key format. OpenAI keys should start with "sk-" and be at least 20 characters.'
        );
      }
      this.client = new OpenAI({ apiKey: config.apiKey });
    } else if (config.provider === 'mistral') {
      // TODO: Implement Mistral client when SDK is available
      throw new Error('Mistral provider is not yet implemented. Coming in v0.7.0');
    } else if (config.provider === 'claude' || config.provider === 'anthropic') {
      // TODO: Implement Anthropic/Claude client when SDK is available
      throw new Error('Anthropic/Claude provider is not yet implemented. Coming in v0.7.0');
    } else {
      throw new Error(
        `Unknown provider: ${config.provider}. Supported providers: openai, mistral, claude, anthropic`
      );
    }
  }

  /**
   * Migrate complex case with AI assistance
   */
  async migrate(context: MigrationContext): Promise<AgentResponse> {
    if (!this.client) {
      return {
        success: false,
        reason: `Provider ${this.config.provider} not yet implemented`,
      };
    }

    try {
      const prompt = this.buildMigrationPrompt(context);
      const systemPrompt = this.buildSystemPrompt();

      const completion = await this.client.chat.completions.create({
        model: this.config.model!,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        response_format: { type: 'json_object' },
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        return {
          success: false,
          reason: 'No response from AI',
        };
      }

      const parsed = JSON.parse(response);
      const migratedCode = this.extractCodeFromResponse(parsed.code || parsed.migratedCode || '');

      return {
        success: true,
        migratedCode,
        explanation: parsed.explanation,
        suggestions: parsed.suggestions || [],
        confidence: parsed.confidence || 0.8,
      };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate tests for migrated component
   */
  async generateTests(context: MigrationContext): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      const prompt = `Generate Vitest tests for this Vue 3 component:

\`\`\`vue
${context.code}
\`\`\`

Generate comprehensive tests covering:
- Component rendering
- Props handling
- Events emission
- Computed properties
- Lifecycle hooks

Return only the test code in a code block.`;

      const completion = await this.client.chat.completions.create({
        model: this.config.model!,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert in Vue 3 testing with Vitest. Generate comprehensive test suites.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const response = completion.choices[0]?.message?.content;
      return response ? this.extractCodeFromResponse(response) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Explain changes made during migration
   */
  async explainChanges(context: MigrationContext): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      const prompt = `Explain the migration changes for this Vue component:

Original code:
\`\`\`vue
${context.code}
\`\`\`

Issues detected:
${context.issues.map((i) => `- ${i}`).join('\n')}

Provide a clear explanation of what changed and why.`;

      const completion = await this.client.chat.completions.create({
        model: this.config.model!,
        messages: [
          {
            role: 'system',
            content: 'You are an expert in Vue 2 to Vue 3 migration. Explain changes clearly.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      return completion.choices[0]?.message?.content || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Analyze migration plan for a project
   */
  async analyzeMigrationPlan(filePaths: string[]): Promise<{
    estimatedTime: string;
    priority: Array<{ file: string; priority: number; reason: string }>;
    recommendations: string[];
  }> {
    if (!this.client) {
      throw new Error(`Provider ${this.config.provider} not yet implemented`);
    }

    try {
      const prompt = `Analyze these Vue 2 files and create a prioritized migration plan:
${filePaths.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Respond in JSON with:
- estimatedTime: string (e.g., "2-3 days")
- priority: array of {file: string, priority: number (1-10), reason: string}
- recommendations: array of strings`;

      const completion = await this.client.chat.completions.create({
        model: this.config.model!,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert in Vue migration planning. Create prioritized migration plans.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from AI');
      }

      return JSON.parse(response);
    } catch (error) {
      throw new Error(
        `Failed to generate migration plan: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Analyze code complexity
   */
  async analyzeComplexity(code: string): Promise<ComplexityAnalysis> {
    if (!this.client) {
      return {
        complexity: 'medium',
        recommendations: ['AI analysis unavailable'],
      };
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.config.model!,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert in Vue code analysis. Analyze migration complexity and provide recommendations.',
          },
          {
            role: 'user',
            content: `Analyze this Vue 2 code and evaluate the migration complexity to Vue 3:\n\n\`\`\`vue\n${code}\n\`\`\`\n\nRespond in JSON with fields: complexity (low/medium/high) and recommendations (array of strings).`,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

      return {
        complexity: result.complexity || 'medium',
        recommendations: result.recommendations || [],
      };
    } catch (error) {
      return {
        complexity: 'medium',
        recommendations: ['Error during AI analysis'],
      };
    }
  }

  // Private helper methods

  private getDefaultModel(provider: LLMProvider): string {
    const defaults: Record<LLMProvider, string> = {
      openai: 'gpt-4-turbo-preview',
      mistral: 'mistral-large',
      claude: 'claude-3-opus-20240229',
      anthropic: 'claude-3-opus-20240229',
    };
    return defaults[provider] || 'gpt-4-turbo-preview';
  }

  private buildSystemPrompt(): string {
    return `You are an expert in Vue 2 to Vue 3 migration. Your role is to help migrate Vue 2 code to Vue 3 following best practices.

Rules:
1. Always use Composition API with <script setup lang="ts"> when possible
2. Replace filters with computed properties or methods
3. Transform v-model to use modelValue and update:modelValue
4. Replace global Vue API with createApp
5. Adapt lifecycle hooks (beforeDestroy → beforeUnmount, destroyed → unmounted)
6. Replace Vuex with Pinia if necessary
7. Adapt Vue Router to version 4
8. Always return valid Vue 3 code
9. Preserve component functionality
10. Add proper TypeScript types when using lang="ts"`;
  }

  private buildMigrationPrompt(context: MigrationContext): string {
    return `Migrate this Vue 2 code to Vue 3.

File: ${context.filePath}
Classification: ${context.classification}

Vue 2 Code:
\`\`\`vue
${context.code}
\`\`\`

Detected issues:
${context.issues.map((issue) => `- ${issue}`).join('\n')}

${context.relatedFiles ? `Related files: ${context.relatedFiles.join(', ')}` : ''}

Return JSON with:
- code: The migrated Vue 3 code
- explanation: Brief explanation of changes
- suggestions: Array of improvement suggestions
- confidence: Number between 0 and 1`;
  }

  private extractCodeFromResponse(response: string): string {
    // Extract code from markdown code blocks if present
    const codeBlockRegex = /```(?:vue|typescript|javascript|ts|js)?\n([\s\S]*?)```/;
    const match = response.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    return response.trim();
  }
}

/**
 * Factory function to create AI service from simple config
 * Maintains backward compatibility with AIService
 */
export function createAIService(
  apiKey: string,
  provider: LLMProvider = 'openai'
): UnifiedAIService {
  return new UnifiedAIService({
    provider,
    apiKey,
  });
}
