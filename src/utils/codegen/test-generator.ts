/**
 * Generate Vitest tests for migrated Vue components
 */

import * as path from "path";
import * as fs from "fs/promises";
import { parseVueFile, isVueFile } from "./vue-parser";

export interface TestGenerationOptions {
  framework?: "vitest" | "jest";
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
    options: TestGenerationOptions = {},
  ): Promise<GeneratedTest> {
    const {
      framework = "vitest",
      testDir = "__tests__",
      componentName = this.extractComponentName(componentPath, componentCode),
    } = options;

    const isVue = isVueFile(componentCode);
    const vueParts = isVue ? parseVueFile(componentCode) : null;

    // Extract component information
    const scriptContent = vueParts?.script?.content || componentCode;
    const templateContent = vueParts?.template?.content || componentCode;
    const props = this.extractProps(scriptContent);
    const emits = this.extractEmits(scriptContent);
    const hasCompositionAPI = this.hasCompositionAPI(scriptContent);
    const hasScriptSetup = vueParts?.script?.setup === true;
    const usesPinia =
      this.usesPinia(scriptContent) || this.usesPinia(componentCode);
    const usesRouter = this.usesRouter(scriptContent, templateContent);

    // Determine test file path
    const dir = path.dirname(componentPath);
    const testFilePath = path.join(dir, testDir, `${componentName}.test.ts`);

    // Relative path from test file to component (tests are in __tests__ subdir)
    const relativePath =
      path
        .relative(path.dirname(testFilePath), path.dirname(componentPath))
        .replace(/\\/g, "/") || ".";
    const componentImportPath =
      relativePath === "."
        ? `./${path.basename(componentPath)}`
        : `${relativePath}/${path.basename(componentPath)}`;

    // Generate test content
    const testContent = this.generateTestContent({
      componentPath,
      componentName,
      componentImportPath,
      props,
      emits,
      hasCompositionAPI,
      hasScriptSetup,
      usesPinia,
      usesRouter,
      framework,
    });

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
    componentImportPath?: string;
    props: string[];
    emits: string[];
    hasCompositionAPI: boolean;
    hasScriptSetup: boolean;
    usesPinia: boolean;
    usesRouter: boolean;
    framework: string;
  }): string {
    const { componentName, props, emits, usesPinia, usesRouter } = options;
    const componentImportPath =
      options.componentImportPath ??
      `./${path.basename(options.componentPath)}`;

    // Build imports
    const importLines: string[] = [
      "import { mount } from '@vue/test-utils';",
      "import { describe, it, expect } from 'vitest';",
    ];
    if (usesPinia) {
      importLines.push("import { createPinia } from 'pinia';");
    }
    if (usesRouter) {
      importLines.push(
        "import { createRouter, createMemoryHistory } from 'vue-router';",
      );
    }
    const imports = importLines.join("\n");

    // Build mount options string (props + global.plugins for Pinia/Router)
    const buildMountOpts = (includeProps: boolean): string => {
      const parts: string[] = [];
      if (includeProps && props.length > 0) {
        parts.push(
          `props: {\n${props.map((p) => `        ${p}: ${this.getPropDefaultValue(p)},`).join("\n")}\n      }`,
        );
      }
      const plugins: string[] = [];
      if (usesPinia) plugins.push("createPinia()");
      if (usesRouter) plugins.push("router");
      if (plugins.length > 0) {
        parts.push(`global: { plugins: [${plugins.join(", ")}] }`);
      }
      if (parts.length === 0) return "";
      return `{\n      ${parts.join(",\n      ")}\n    }`;
    };

    const defaultMountOpts = buildMountOpts(true);
    const mountCall = defaultMountOpts
      ? `mount(${componentName}, ${defaultMountOpts})`
      : `mount(${componentName})`;

    // Setup blocks for router (Pinia is passed via global.plugins in mount)
    const setupBlocks: string[] = [];
    if (usesRouter) {
      setupBlocks.push(`  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div/>' } }],
  });

`);
    }

    const testCases: string[] = [
      `  it("renders correctly", async () => {`,
      `    const wrapper = ${mountCall};`,
      ...(usesRouter ? ["    await router.isReady();"] : []),
      "    expect(wrapper.exists()).toBe(true);",
      "  });",
    ];

    if (props.length > 0) {
      testCases.push("");
      testCases.push(
        usesRouter
          ? '  it("accepts props correctly", async () => {'
          : '  it("accepts props correctly", () => {',
      );
      testCases.push(`    const wrapper = ${mountCall};`);
      if (usesRouter) {
        testCases.push("    await router.isReady();");
      }
      testCases.push("    expect(wrapper.exists()).toBe(true);");
      testCases.push("  });");
    }

    if (emits.length > 0) {
      testCases.push("");
      emits.forEach((emit) => {
        testCases.push(`  it(\`emits ${emit} when triggered\`, async () => {`);
        testCases.push(`    const wrapper = ${mountCall};`);
        testCases.push(
          `    const target = wrapper.find('button').exists() ? wrapper.find('button') : wrapper;`,
        );
        testCases.push(`    await target.trigger('click');`);
        testCases.push(`    expect(wrapper.emitted('${emit}')).toBeTruthy();`);
        testCases.push("  });");
      });
    }

    return `${imports}
import ${componentName} from '${componentImportPath}';

describe('${componentName}', () => {
${setupBlocks.join("")}${testCases.join("\n")}
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
      .join("");

    // Try to extract from code (export default)
    const exportMatch = code.match(
      /export\s+default\s+{\s*name:\s*['"]([^'"]+)['"]/,
    );
    if (exportMatch) {
      return exportMatch[1];
    }

    return pascalCase || "Component";
  }

  /**
   * Extract props from component code
   */
  private extractProps(code: string): string[] {
    const props: string[] = [];

    // Extract from defineProps<{...}> (TypeScript)
    const definePropsTsMatch = code.match(/defineProps<\{([^}]+)\}>/);
    if (definePropsTsMatch) {
      const propsContent = definePropsTsMatch[1];
      const propMatches = propsContent.match(/(\w+)(\??):/g);
      if (propMatches) {
        props.push(...propMatches.map((m) => m.replace(/[?:]/g, "").trim()));
      }
    }

    // Extract from defineProps({ propName: {...}, ... }) (runtime)
    // Match: propName: { or propName: String|Number| etc. (exclude type, required, default, validator)
    const definePropsStart = code.indexOf("defineProps");
    if (definePropsStart >= 0) {
      const afterDefineProps = code.slice(definePropsStart);
      const propKeyMatches = afterDefineProps.matchAll(
        /(\w+)\s*:\s*(?:\{\s*(?:type\s*:|required|default|validator)|String|Number|Boolean|Object|Array|Function|\[)/g,
      );
      for (const m of propKeyMatches) {
        const propName = m[1];
        if (
          propName &&
          !["type", "required", "default", "validator"].includes(propName)
        ) {
          props.push(propName);
        }
      }
    }

    // Extract from props option (Options API)
    const propsOptionMatch = code.match(/props:\s*\{([^}]+)\}/);
    if (propsOptionMatch) {
      const propsContent = propsOptionMatch[1];
      const propMatches = propsContent.match(/(\w+):/g);
      if (propMatches) {
        props.push(...propMatches.map((m) => m.replace(":", "").trim()));
      }
    }

    return [...new Set(props)]; // Remove duplicates
  }

  /**
   * Extract emits from component code
   */
  private extractEmits(code: string): string[] {
    const emits: string[] = [];

    // Extract from defineEmits<{...}> (TypeScript)
    const defineEmitsTsMatch = code.match(/defineEmits<\{([^}]+)\}>/);
    if (defineEmitsTsMatch) {
      const emitsContent = defineEmitsTsMatch[1];
      const emitMatches = emitsContent.match(/(\w+)(\??):/g);
      if (emitMatches) {
        emits.push(...emitMatches.map((m) => m.replace(/[?:]/g, "").trim()));
      }
    }

    // Extract from defineEmits(["event1", "event2"]) (runtime)
    const defineEmitsArrayMatch = code.match(/defineEmits\s*\(\s*\[([^\]]*)\]/);
    if (defineEmitsArrayMatch) {
      const emitsContent = defineEmitsArrayMatch[1];
      const emitMatches = emitsContent.match(/['"]([^'"]+)['"]/g);
      if (emitMatches) {
        emits.push(...emitMatches.map((m) => m.replace(/['"]/g, "")));
      }
    }

    // Extract from emits option (Options API)
    const emitsOptionMatch = code.match(/emits:\s*\[([^\]]+)\]/);
    if (emitsOptionMatch) {
      const emitsContent = emitsOptionMatch[1];
      const emitMatches = emitsContent.match(/['"]([^'"]+)['"]/g);
      if (emitMatches) {
        emits.push(...emitMatches.map((m) => m.replace(/['"]/g, "")));
      }
    }

    return [...new Set(emits)]; // Remove duplicates
  }

  /**
   * Infer default test value for a prop based on its name
   */
  private getPropDefaultValue(propName: string): string {
    const lower = propName.toLowerCase();
    if (
      ["user", "item", "data", "model", "record"].some((k) => lower.includes(k))
    ) {
      return `{ name: "Test", email: "test@test.com", role: "user" }`;
    }
    if (
      ["label", "title", "text", "name", "message", "placeholder"].some((k) =>
        lower.includes(k),
      )
    ) {
      return '"Test"';
    }
    if (["variant", "type", "theme"].some((k) => lower.includes(k))) {
      return '"primary"';
    }
    if (["tooltip", "hint", "description"].some((k) => lower.includes(k))) {
      return '""';
    }
    if (["count", "id", "index", "page"].some((k) => lower.includes(k))) {
      return "0";
    }
    if (
      ["isLoading", "disabled", "visible", "active"].some((k) =>
        lower.includes(k),
      )
    ) {
      return "false";
    }
    if (["items", "list", "options"].some((k) => lower.includes(k))) {
      return "[]";
    }
    return "undefined";
  }

  /**
   * Check if component uses Composition API
   */
  private hasCompositionAPI(code: string): boolean {
    return (
      code.includes("setup(") ||
      code.includes("ref(") ||
      code.includes("reactive(") ||
      code.includes("computed(") ||
      code.includes("watch(") ||
      code.includes("onMounted(") ||
      code.includes("onUnmounted(")
    );
  }

  /**
   * Check if component uses Pinia stores
   */
  private usesPinia(scriptContent: string): boolean {
    return (
      /use\w*Store\s*\(/.test(scriptContent) ||
      scriptContent.includes("defineStore") ||
      scriptContent.includes("getActivePinia") ||
      /from\s+['"].*\/store\//.test(scriptContent) ||
      /from\s+['"]@\/store/.test(scriptContent)
    );
  }

  /**
   * Check if component uses Vue Router
   */
  private usesRouter(scriptContent: string, templateContent: string): boolean {
    const inTemplate =
      /<router-link|<router-view/.test(templateContent) ||
      templateContent.includes("router-link") ||
      templateContent.includes("router-view");
    const inScript =
      scriptContent.includes("useRoute") || scriptContent.includes("useRouter");
    return inTemplate || inScript;
  }

  /**
   * Write test file to disk
   */
  async writeTest(test: GeneratedTest): Promise<void> {
    const dir = path.dirname(test.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(test.filePath, test.content, "utf-8");
  }
}
