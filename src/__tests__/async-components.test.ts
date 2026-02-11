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

  it('should transform object async component with component→loader', async () => {
    const code = `const AsyncComponent = () => ({
        component: import('./Component.vue')
      });`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toContain('loader:');
    expect(result.code).toContain("import('./Component.vue')");
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

  it('should transform async component with options (component→loader, error→errorComponent)', async () => {
    const code = `const AsyncModal = {
      component: () => import('./Modal.vue'),
      delay: 200,
      timeout: 3000,
      error: ErrorComponent,
      loading: LoadingComponent
    };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toContain('loader:');
    expect(result.code).toContain('errorComponent:');
    expect(result.code).toContain('loadingComponent:');
    expect(result.code).not.toContain('component:');
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

  it('should transform (resolve, reject) loader to new Promise (Vue 2 → 3)', async () => {
    const code = `const AsyncComp = (resolve, reject) => {
      import('./Heavy.vue').then(m => resolve(m.default)).catch(reject);
    };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toContain('new Promise');
    expect(result.code).toContain('(resolve, reject)');
    expect(result.code).not.toMatch(/const AsyncComp = \(resolve, reject\)/);
  });

  it('should transform component: (resolve, reject) in options object', async () => {
    const code = `const AsyncModal = {
      component: (resolve, reject) => {
        fetch('/api/modal').then(r => r.json()).then(c => resolve(c));
      },
      delay: 200
    };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['async-components'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('defineAsyncComponent');
    expect(result.code).toContain('loader:');
    expect(result.code).toContain('new Promise');
    expect(result.code).toContain('(resolve, reject)');
    expect(result.code).not.toContain('component:');
  });
});
