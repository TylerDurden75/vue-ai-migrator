import { CodemodRunner } from '../codemods/runner';

describe('Render Functions Transformation', () => {
  let runner: CodemodRunner;

  beforeEach(() => {
    runner = new CodemodRunner();
  });

  it('should remove h parameter from render function', async () => {
    const code = `export default {
        render(h) {
          return h('div', 'Hello');
        }
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('render()');
    expect(result.code).not.toContain('render(h)');
    // Check for h import (might be in same import statement)
    expect(result.code).toMatch(/import\s*{[^}]*h[^}]*}\s*from\s*['"]vue['"]/);
  });

  it('should add h import when removing h parameter', async () => {
    const code = `export default {
        render(h) {
          return h('div');
        }
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.code).toMatch(/import\s*{[^}]*h[^}]*}\s*from\s*['"]vue['"]/);
  });

  it('should transform component references to use resolveComponent', async () => {
    const code = `export default {
        render() {
          return h('MyComponent');
        }
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('resolveComponent');
    expect(result.code).toMatch(/h\(resolveComponent\(['"]MyComponent['"]\)\)/);
    // Check for imports (might be in same or separate import statements)
    expect(result.code).toMatch(/import\s*{[^}]*h[^}]*}\s*from\s*['"]vue['"]/);
    expect(result.code).toMatch(/import\s*{[^}]*resolveComponent[^}]*}\s*from\s*['"]vue['"]/);
  });

  it('should not transform built-in components', async () => {
    const code = `
      export default {
        render() {
          return h('Transition');
        }
      };
    `;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.code).not.toContain('resolveComponent');
    expect(result.code).toContain("h('Transition')");
  });

  it('should handle render as object property', async () => {
    const code = `export default {
        render: function(h) {
          return h('div');
        }
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('render: function()');
    expect(result.code).not.toContain('render: function(h)');
  });

  it('should handle arrow function render', async () => {
    const code = `export default {
        render: (h) => h('div')
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('render: () =>');
    expect(result.code).not.toContain('render: (h) =>');
  });

  it('should add to existing vue import', async () => {
    const code = `import { ref } from 'vue';
      export default {
        render(h) {
          return h('MyComponent');
        }
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    // Should have h and resolveComponent in imports
    expect(result.code).toMatch(/import\s*{[^}]*h[^}]*}\s*from\s*['"]vue['"]/);
    expect(result.code).toMatch(/import\s*{[^}]*resolveComponent[^}]*}\s*from\s*['"]vue['"]/);
  });

  it('should handle lowercase component names (not components)', async () => {
    const code = `export default {
        render() {
          return h('div');
        }
      };`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    // Lowercase 'div' should not be transformed
    expect(result.code).toContain("h('div')");
    expect(result.code).not.toContain('resolveComponent');
  });
});
