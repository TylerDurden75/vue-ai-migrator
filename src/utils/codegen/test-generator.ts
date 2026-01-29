/**
 * Generate Vitest tests for migrated Vue components
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { parseVueFile, isVueFile } from './vue-parser';

export interface TestGenerationOptions {
  framework?: 'vitest' | 'jest';
  testDir?: string;
  coverage?: boolean;
  componentName?: string;
}

export interface GeneratedTest {
  filePath: string;
  content: string;
  framework: string;
}

/**
 * Generate Vitest test file for a migrated Vue component
 */
export class TestGenerator {
  /**
   * Generate test file for a Vue component
   */
  async generateTest(
    componentPath: string,
    componentCode: string,
    options: TestGenerationOptions = {}
  ): Promise<GeneratedTest> {
    const {
      framework = 'vitest',
      testDir = '__tests__',
      componentName = this.extractComponentName(componentPath, componentCode),
    } = options;

    const isVue = isVueFile(componentCode);
    const vueParts = isVue ? parseVueFile(componentCode) : null;

    // Extract component information
    const props = this.extractProps(vueParts?.script?.content || componentCode);
    const emits = this.extractEmits(vueParts?.script?.content || componentCode);
    const hasCompositionAPI = this.hasCompositionAPI(vueParts?.script?.content || componentCode);
    const hasScriptSetup = vueParts?.script?.setup === true;

    // Generate test content
    const testContent = this.generateTestContent({
      componentPath,
      componentName,
      props,
      emits,
      hasCompositionAPI,
      hasScriptSetup,
      framework,
    });

    // Determine test file path
    const dir = path.dirname(componentPath);
    const testFilePath = path.join(dir, testDir, `${componentName}.test.ts`);

    return {
      filePath: testFilePath,
      content: testContent,
      framework,
    };
  }

  /**
   * Generate test content
   */
  private generateTestContent(options: {
    componentPath: string;
    componentName: string;
    props: string[];
    emits: string[];
    hasCompositionAPI: boolean;
    hasScriptSetup: boolean;
    framework: string;
  }): string {
    const { componentPath, componentName, props, emits, hasCompositionAPI, hasScriptSetup } =
      options;

    const relativePath = `./${path.basename(componentPath)}`;
    const imports =
      hasCompositionAPI || hasScriptSetup
        ? `import { mount } from '@vue/test-utils';\nimport { describe, it, expect } from 'vitest';`
        : `import { mount } from '@vue/test-utils';\nimport { describe, it, expect } from 'vitest';`;

    const propsSetup =
      props.length > 0
        ? `    const props = {\n${props.map((p) => `      ${p}: undefined, // TODO: Set default value`).join('\n')}\n    };`
        : '';

    const testCases = [
      'it("renders correctly", () => {',
      `    const wrapper = mount(${componentName}${props.length > 0 ? ', { props }' : ''});`,
      '    expect(wrapper.exists()).toBe(true);',
      '  });',
    ];

    if (props.length > 0) {
      testCases.push('');
      testCases.push('  it("accepts props correctly", () => {');
      testCases.push(`    const wrapper = mount(${componentName}, {`);
      testCases.push('      props: {');
      props.forEach((prop) => {
        testCases.push(`        ${prop}: "test-value",`);
      });
      testCases.push('      },');
      testCases.push('    });');
      testCases.push('    // TODO: Add assertions for props');
      testCases.push('  });');
    }

    if (emits.length > 0) {
      testCases.push('');
      testCases.push('  it("emits events correctly", async () => {');
      testCases.push(`    const wrapper = mount(${componentName});`);
      emits.forEach((emit) => {
        testCases.push(`    // TODO: Trigger ${emit} event and assert`);
      });
      testCases.push('  });');
    }

    return `${imports}
import ${componentName} from '${relativePath}';

describe('${componentName}', () => {
${propsSetup ? propsSetup + '\n' : ''}${testCases.join('\n')}
});
`;
  }

  /**
   * Extract component name from path or code
   */
  private extractComponentName(filePath: string, code: string): string {
    // Try to extract from file path
    const fileName = path.basename(filePath, path.extname(filePath));
    const pascalCase = fileName
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    // Try to extract from code (export default)
    const exportMatch = code.match(/export\s+default\s+{\s*name:\s*['"]([^'"]+)['"]/);
    if (exportMatch) {
      return exportMatch[1];
    }

    return pascalCase || 'Component';
  }

  /**
   * Extract props from component code
   */
  private extractProps(code: string): string[] {
    const props: string[] = [];

    // Extract from defineProps or props option
    const definePropsMatch = code.match(/defineProps<\{([^}]+)\}>/);
    if (definePropsMatch) {
      const propsContent = definePropsMatch[1];
      const propMatches = propsContent.match(/(\w+)(\??):/g);
      if (propMatches) {
        props.push(...propMatches.map((m) => m.replace(/[?:]/g, '').trim()));
      }
    }

    // Extract from props option
    const propsOptionMatch = code.match(/props:\s*\{([^}]+)\}/);
    if (propsOptionMatch) {
      const propsContent = propsOptionMatch[1];
      const propMatches = propsContent.match(/(\w+):/g);
      if (propMatches) {
        props.push(...propMatches.map((m) => m.replace(':', '').trim()));
      }
    }

    return [...new Set(props)]; // Remove duplicates
  }

  /**
   * Extract emits from component code
   */
  private extractEmits(code: string): string[] {
    const emits: string[] = [];

    // Extract from defineEmits
    const defineEmitsMatch = code.match(/defineEmits<\{([^}]+)\}>/);
    if (defineEmitsMatch) {
      const emitsContent = defineEmitsMatch[1];
      const emitMatches = emitsContent.match(/(\w+)(\??):/g);
      if (emitMatches) {
        emits.push(...emitMatches.map((m) => m.replace(/[?:]/g, '').trim()));
      }
    }

    // Extract from emits option
    const emitsOptionMatch = code.match(/emits:\s*\[([^\]]+)\]/);
    if (emitsOptionMatch) {
      const emitsContent = emitsOptionMatch[1];
      const emitMatches = emitsContent.match(/['"]([^'"]+)['"]/g);
      if (emitMatches) {
        emits.push(...emitMatches.map((m) => m.replace(/['"]/g, '')));
      }
    }

    return [...new Set(emits)]; // Remove duplicates
  }

  /**
   * Check if component uses Composition API
   */
  private hasCompositionAPI(code: string): boolean {
    return (
      code.includes('setup(') ||
      code.includes('ref(') ||
      code.includes('reactive(') ||
      code.includes('computed(') ||
      code.includes('watch(') ||
      code.includes('onMounted(') ||
      code.includes('onUnmounted(')
    );
  }

  /**
   * Write test file to disk
   */
  async writeTest(test: GeneratedTest): Promise<void> {
    const dir = path.dirname(test.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(test.filePath, test.content, 'utf-8');
  }
}
