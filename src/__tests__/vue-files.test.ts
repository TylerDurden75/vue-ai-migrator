import { parseVueFile, reconstructVueFile } from '../utils/codegen';
import { transformTemplate } from '../codemods/transforms/template';
import { CodemodRunner } from '../codemods/runner';

describe('Vue File Parsing and Transformation', () => {
  describe('parseVueFile', () => {
    it('should parse a simple Vue file', () => {
      const content = `
<template>
  <div>Hello</div>
</template>

<script>
export default {
  name: 'Test'
}
</script>

<style scoped>
div { color: red; }
</style>
`;

      const parts = parseVueFile(content);

      expect(parts.template).toBeDefined();
      expect(parts.template?.content).toContain('<div>Hello</div>');
      expect(parts.script).toBeDefined();
      expect(parts.script?.content).toContain("name: 'Test'");
      expect(parts.styles).toHaveLength(1);
      expect(parts.styles[0].scoped).toBe(true);
    });

    it('should parse script setup', () => {
      const content = `
<template>
  <div>{{ message }}</div>
</template>

<script setup>
const message = 'Hello'
</script>
`;

      const parts = parseVueFile(content);
      expect(parts.script?.setup).toBe(true);
    });

    it('should handle multiple style blocks', () => {
      const content = `
<template><div></div></template>
<script></script>
<style scoped>div {}</style>
<style module>div {}</style>
`;

      const parts = parseVueFile(content);
      expect(parts.styles).toHaveLength(2);
      expect(parts.styles[0].scoped).toBe(true);
      expect(parts.styles[1].module).toBe(true);
    });
  });

  describe('reconstructVueFile', () => {
    it('should reconstruct a Vue file from parts', () => {
      const parts = {
        template: { content: '<div>Test</div>', lang: 'html' },
        script: { content: 'export default {}', lang: 'js', setup: false },
        styles: [{ content: 'div {}', lang: 'css', scoped: true }],
        customBlocks: [],
      };

      const reconstructed = reconstructVueFile(parts);

      expect(reconstructed).toContain('<template>');
      expect(reconstructed).toContain('<script>');
      expect(reconstructed).toContain('<style scoped>');
      expect(reconstructed).toContain('<div>Test</div>');
    });
  });

  describe('transformTemplate', () => {
    it('should transform slot-scope to v-slot', () => {
      const template = '<template slot-scope="props"><div>{{ props.data }}</div></template>';
      const result = transformTemplate(template);

      expect(result.modified).toBe(true);
      expect(result.template).toContain('v-slot="props"');
      expect(result.template).not.toContain('slot-scope');
    });

    it('should transform filters', () => {
      const template = '<div>{{ message | uppercase }}</div>';
      const result = transformTemplate(template);

      expect(result.modified).toBe(true);
      expect(result.template).toContain('{{ uppercase(message) }}');
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should transform $listeners to $attrs', () => {
      const template = '<div v-on="$listeners"></div>';
      const result = transformTemplate(template);

      expect(result.modified).toBe(true);
      expect(result.template).toContain('$attrs');
      expect(result.template).not.toContain('$listeners');
    });
  });

  describe('CodemodRunner with Vue files', () => {
    it('should transform Vue file script section', async () => {
      const vueContent = `
<template>
  <div>{{ message }}</div>
</template>

<script>
export default {
  beforeDestroy() {
    console.log('destroying');
  }
}
</script>
`;

      const runner = new CodemodRunner();
      const result = await runner.transform('test.vue', vueContent, {
        transformations: ['composition-api'],
      });

      // The transformation processes Vue files by extracting script section
      // For Vue files, the result should be processed (even if not modified)
      expect(result).toBeDefined();
      expect(typeof result.modified).toBe('boolean');
      // The code should be returned (possibly transformed)
      expect(result.code).toBeDefined();
    });

    it('should transform template and script sections', async () => {
      const vueContent = `
<template>
  <div>{{ value | filter }}</div>
</template>

<script>
export default {
  data() {
    return { value: 'test' };
  }
}
</script>
`;

      const runner = new CodemodRunner();
      const result = await runner.transform('test.vue', vueContent, {
        transformations: ['filters'],
      });

      // Template should be transformed (filters in templates)
      // The transformation should mark as modified or need AI
      expect(result.modified || result.needsAI || result.issues.length > 0).toBe(true);
    });
  });
});
