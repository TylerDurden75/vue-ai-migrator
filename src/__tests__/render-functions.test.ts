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

  it('should flatten Vue 2 VNode props to Vue 3 format', async () => {
    const code = `import { h } from 'vue';
export default {
  render() {
    return h('button', {
      staticClass: 'button',
      class: { 'is-outlined': isOutlined },
      attrs: { id: 'submit' },
      domProps: { innerHTML: '' },
      on: { click: submitForm },
      key: 'submit-button'
    });
  }
};`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain("class:");
    expect(result.code).not.toContain("staticClass:");
    expect(result.code).not.toContain("attrs:");
    expect(result.code).not.toContain("domProps:");
    expect(result.code).not.toContain("on:");
    expect(result.code).toContain("onClick:");
    expect(result.code).toContain("id:");
  });

  it('should merge staticClass and class into class array', async () => {
    const code = `export default {
  render(h) {
    return h('div', { staticClass: 'foo', class: { bar: true } });
  }
};`;

    const result = await runner.transform('test.js', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toMatch(/class:\s*\[/);
    expect(result.code).not.toContain("staticClass");
  });

  it('should convert render-only .vue to script setup + template', async () => {
    const code = `<script>
export default {
  props: ['text'],
  render(h) {
    return h('button', {
      class: 'button',
      attrs: { id: 'submit' },
      on: { click: () => this.$emit('submit') }
    }, this.text);
  }
}
</script>`;

    const result = await runner.transform('Button.vue', code, {
      transformations: ['render-functions'],
    });

    expect(result.modified).toBe(true);
    expect(result.code).toContain('<script setup>');
    expect(result.code).toContain('defineProps');
    expect(result.code).toContain("defineEmits(['submit'])");
    expect(result.code).toContain('<template>');
    expect(result.code).toContain('<button');
    expect(result.code).toContain('class="button"');
    expect(result.code).toContain('id="submit"');
    expect(result.code).toContain('@click="emit(\'submit\')"');
    expect(result.code).toContain('{{ props.text }}');
    expect(result.code).not.toContain('render(');
  });
});
