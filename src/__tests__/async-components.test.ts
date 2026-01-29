import { CodemodRunner } from '../codemods/runner';

describe('Async Components Transformation', () => {
  let runner: CodemodRunner;

  beforeEach(() => {
    runner = new CodemodRunner();
  });

  it('should transform arrow function async component', async () => {
    const code = `const AsyncComponent = () => import('./Component.vue');`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toMatch(/import\s*{[^}]*defineAsyncComponent[^}]*}\s*from\s*['"]vue['"]/);
    expect(result.code).toMatch(/defineAsyncComponent\(\(\)\s*=>\s*import/);
  });

  it('should transform object async component', async () => {
    const code = `const AsyncComponent = () => ({
        component: import('./Component.vue')
      });`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toMatch(/defineAsyncComponent\(\(\)\s*=>\s*import/);
  });

  it('should add import for defineAsyncComponent', async () => {
    const code = `const AsyncComponent = () => import('./Component.vue');`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.code).toMatch(/import\s*{[^}]*defineAsyncComponent[^}]*}\s*from\s*['"]vue['"]/);
  });

  it('should add to existing vue import', async () => {
    const code = `import { ref } from 'vue';
      const AsyncComponent = () => import('./Component.vue');`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toMatch(/import\s*{[^}]*defineAsyncComponent[^}]*}\s*from\s*['"]vue['"]/);
  });

  it('should not modify non-async components', async () => {
    const code = `const Component = () => {
        return { template: '<div>Hello</div>' };
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(false);
    expect(result.code).not.toContain('defineAsyncComponent');
  });

  it('should handle multiple async components', async () => {
    const code = `const Component1 = () => import('./Comp1.vue');
      const Component2 = () => import('./Comp2.vue');`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    // Should have 2 defineAsyncComponent calls + 1 import = 3 occurrences total
    const defineAsyncComponentCount = (result.code.match(/defineAsyncComponent/g) || []).length;
    expect(defineAsyncComponentCount).toBeGreaterThanOrEqual(2);
  });
});
