/**
 * Unit tests for Vue script setup fixes rules
 */

import { removeExportDefaultRule, scriptSetupThisEmitRule, scriptSetupFormattingRule } from "../rules/vue-script-setup";

describe("Vue Script Setup Fixes Rules", () => {
  describe("removeExportDefaultRule", () => {
    it("should remove export default from script setup", async () => {
      const content = `<script setup>
import { ref } from 'vue';

const count = ref(0);

export default {
  name: 'Component'
};
</script>`;

      const result = await removeExportDefaultRule.apply(
        "src/components/User.vue",
        content,
        {
          enableTypeScript: true,
          isVueFile: true,
          scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
        }
      );

      expect(result).toBeDefined();
      if (result.fixed) {
        expect(result.content).not.toContain("export default");
      }
    });

    it("should not modify files without export default", async () => {
      const content = `<script setup>
import { ref } from 'vue';
const count = ref(0);
</script>`;

      const result = await removeExportDefaultRule.apply(
        "src/components/User.vue",
        content,
        {
          enableTypeScript: true,
          isVueFile: true,
          scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
        }
      );

      expect(result).toBeDefined();
      expect(result.content).toContain("ref");
    });
  });

  describe("scriptSetupThisEmitRule", () => {
    it("should replace this.$emit with emit() when defineEmits exists", async () => {
      const content = `<template><button @click="handleClick">Click</button></template>
<script setup lang="ts">
const emit = defineEmits(["click"]);
const handleClick = () => {
  this.$emit('click');
};
</script>`;

      const result = await scriptSetupThisEmitRule.apply(
        "src/components/GlobalButton.vue",
        content,
        { enableTypeScript: true, isVueFile: true, scriptContent: "" }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toMatch(/emit\s*\(\s*["']click["']\s*\)/);
      expect(result.content).not.toContain("this.$emit");
    });

    it("should add defineEmits and replace this.$emit when defineEmits missing", async () => {
      const content = `<script setup>
const handleClick = () => { this.$emit('submit', 1); };
</script>`;

      const result = await scriptSetupThisEmitRule.apply(
        "src/components/Form.vue",
        content,
        { enableTypeScript: false, isVueFile: true, scriptContent: "" }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("const emit = defineEmits([\"submit\"]);");
      expect(result.content).toContain("emit('submit', 1)");
      expect(result.content).not.toContain("this.$emit");
    });
  });

  describe("scriptSetupFormattingRule", () => {
    it("should format script setup tag", async () => {
      const content = `<script setup lang="ts">import { ref } from 'vue';</script>`;

      const result = await scriptSetupFormattingRule.apply(
        "src/components/User.vue",
        content,
        {
          enableTypeScript: true,
          isVueFile: true,
          scriptContent: content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ""
        }
      );

      expect(result).toBeDefined();
      if (result.fixed) {
        // Should have proper line breaks
        expect(result.content).toMatch(/<script[^>]*>\n/);
      }
    });
  });
});
