/**
 * AI Agent for complex migration cases
 * Supports multiple LLM providers (OpenAI, Mistral, Claude)
 * Can be extended with LangChain or Vercel AI SDK
 */

import OpenAI from 'openai';
import { validateApiKey } from '../utils/safety';

export type LLMProvider = 'openai' | 'mistral' | 'claude' | 'anthropic';

export interface AgentConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface MigrationContext {
  code: string;
  filePath: string;
  issues: string[];
  classification: 'simple' | 'medium' | 'complex';
  relatedFiles?: string[];
  vueVersion?: string;
}

export interface AgentResponse {
  success: boolean;
  migratedCode?: string;
  explanation?: string;
  suggestions?: string[];
  tests?: string;
  confidence?: number;
  reason?: string;
}

/**
 * AI Agent for intelligent migration assistance
 */
export class MigrationAgent {
  private client: OpenAI | null = null;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = {
      model: config.model || this.getDefaultModel(config.provider),
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 4000,
      ...config,
    };

    // Initialize provider-specific client
    if (config.provider === 'openai') {
      if (!validateApiKey(config.apiKey, config.provider)) {
        throw new Error(`Invalid ${config.provider} API key format`);
      }
      this.client = new OpenAI({ apiKey: config.apiKey });
    }
    // TODO: Add support for Mistral and Claude
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

      const parsed = this.parseAgentResponse(response);
      return parsed;
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate tests for migrated code
   */
  async generateTests(code: string, componentName: string): Promise<string> {
    if (!this.client) {
      throw new Error('AI client not initialized');
    }

    const prompt = `Generate Vitest tests for this Vue 3 component:

\`\`\`vue
${code}
\`\`\`

Component name: ${componentName}

Requirements:
1. Use @vue/test-utils for mounting
2. Test props, emits, and basic rendering
3. Use describe/it/expect from Vitest
4. Include TODO comments for complex test cases
5. Return only the test code, no explanations

Return the test code in a JSON object with field "testCode".`;

    const completion = await this.client.chat.completions.create({
      model: this.config.model!,
      messages: [
        {
          role: 'system',
          content: 'You are an expert in Vue testing. Generate comprehensive test suites.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(response);
    return parsed.testCode || '';
  }

  /**
   * Explain migration changes
   */
  async explainChanges(oldCode: string, newCode: string): Promise<string> {
    if (!this.client) {
      throw new Error('AI client not initialized');
    }

    const prompt = `Explain the migration changes from Vue 2 to Vue 3:

Vue 2 Code:
\`\`\`vue
${oldCode}
\`\`\`

Vue 3 Code:
\`\`\`vue
${newCode}
\`\`\`

Provide a clear explanation of what changed and why.`;

    const completion = await this.client.chat.completions.create({
      model: this.config.model!,
      messages: [
        {
          role: 'system',
          content: 'You are an expert in Vue migration. Explain changes clearly and concisely.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    });

    return completion.choices[0]?.message?.content || 'No explanation available';
  }

  /**
   * Analyze migration plan for a repository
   */
  async analyzeMigrationPlan(filePaths: string[]): Promise<{
    priority: Array<{ file: string; priority: number; reason: string }>;
    estimatedTime: string;
    recommendations: string[];
  }> {
    if (!this.client) {
      throw new Error('AI client not initialized');
    }

    const prompt = `Analyze this Vue 2 project and create a prioritized migration plan:

Files to migrate:
${filePaths.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Provide a JSON response with:
- priority: array of {file, priority (1-10), reason}
- estimatedTime: string estimate
- recommendations: array of strings`;

    const completion = await this.client.chat.completions.create({
      model: this.config.model!,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert in Vue migration planning. Create efficient migration strategies.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI');
    }

    return JSON.parse(response);
  }

  /**
   * Build system prompt for migration
   */
  private buildSystemPrompt(): string {
    return `You are an expert Vue 2 → Vue 3 migration assistant.

Your role:
1. Migrate Vue 2 code to Vue 3 following official migration guide
2. Use Composition API with <script setup lang="ts"> when possible
3. Follow Vue 3 best practices
4. Explain changes clearly
5. Generate tests for migrated code

Rules:
- Always validate syntax before returning code
- Preserve component functionality
- Use TypeScript when possible
- Follow Vue 3 Composition API patterns
- Replace Vue 2 specific APIs (filters, $listeners, etc.)
- Transform Vuex to Pinia when needed
- Update Vue Router to v4

Return responses in JSON format with fields:
- migratedCode: string (the migrated code)
- explanation: string (what changed and why)
- suggestions: string[] (additional recommendations)
- tests: string (optional test code)
- confidence: number (0-1)`;
  }

  /**
   * Build migration prompt
   */
  private buildMigrationPrompt(context: MigrationContext): string {
    return `Migrate this Vue 2 code to Vue 3:

File: ${context.filePath}
Classification: ${context.classification}
Vue Version: ${context.vueVersion || '2.x'}

Vue 2 Code:
\`\`\`vue
${context.code}
\`\`\`

Detected Issues:
${context.issues.map((i) => `- ${i}`).join('\n')}

${context.relatedFiles ? `Related Files:\n${context.relatedFiles.join('\n')}\n` : ''}

Instructions:
1. Use Composition API with <script setup lang="ts"> if possible
2. Replace filters with computed properties or methods
3. Transform v-model to use modelValue and update:modelValue
4. Replace global Vue API with createApp
5. Adapt lifecycle hooks (beforeDestroy → beforeUnmount, destroyed → unmounted)
6. Replace Vuex with Pinia if necessary
7. Adapt Vue Router to version 4
8. Ensure TypeScript types are correct

Return JSON with migratedCode, explanation, suggestions, and optional tests.`;
  }

  /**
   * Parse agent response
   */
  private parseAgentResponse(response: string): AgentResponse {
    try {
      const parsed = JSON.parse(response);
      return {
        success: true,
        migratedCode: parsed.migratedCode || parsed.code,
        explanation: parsed.explanation,
        suggestions: parsed.suggestions || [],
        tests: parsed.tests,
        confidence: parsed.confidence ?? 0.8,
      };
    } catch (error) {
      // Fallback: try to extract code from markdown
      const codeMatch = response.match(/```(?:vue|typescript|javascript|ts|js)?\n([\s\S]*?)```/);
      return {
        success: codeMatch !== null,
        migratedCode: codeMatch ? codeMatch[1].trim() : undefined,
        explanation: codeMatch ? 'Code extracted from response' : undefined,
        confidence: codeMatch ? 0.6 : 0,
        reason: codeMatch ? undefined : 'Could not parse response',
      };
    }
  }

  /**
   * Get default model for provider
   */
  private getDefaultModel(provider: LLMProvider): string {
    const models: Record<LLMProvider, string> = {
      openai: 'gpt-4-turbo-preview',
      mistral: 'mistral-large-latest',
      claude: 'claude-3-opus-20240229',
      anthropic: 'claude-3-opus-20240229',
    };
    return models[provider];
  }
}
