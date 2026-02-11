/**
 * Unit tests for Vue script setup fixes rules
 */

import { removeExportDefaultRule, scriptSetupThisEmitRule, scriptSetupFormattingRule } from "../rules/vue-script/vue-script-setup";

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

    it("should replace template $emit with emit() and add defineEmits", async () => {
      const content = `<template>
  <div>
    <p>{{ text }}</p>
    <button v-on:click="$emit('accepted')">OK</button>
  </div>
</template>
<script setup>
defineProps(['text']);
</script>`;

      const result = await scriptSetupThisEmitRule.apply(
        "src/components/Confirm.vue",
        content,
        { enableTypeScript: false, isVueFile: true, scriptContent: "" }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("emit('accepted')");
      expect(result.content).not.toContain("$emit(");
      expect(result.content).toContain("const emit = defineEmits([\"accepted\"]);");
    });

    it("should handle both template $emit and script this.$emit", async () => {
      const content = `<template>
  <button @click="$emit('click', $event)">Click</button>
</template>
<script setup>
const handleSubmit = () => { this.$emit('submit'); };
</script>`;

      const result = await scriptSetupThisEmitRule.apply(
        "src/components/Button.vue",
        content,
        { enableTypeScript: false, isVueFile: true, scriptContent: "" }
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toMatch(/emit\s*\(\s*["']click["']\s*,\s*\$event\s*\)/);
      expect(result.content).toContain("emit('submit')");
      expect(result.content).not.toContain("$emit(");
      expect(result.content).not.toContain("this.$emit");
      expect(result.content).toContain("defineEmits(");
      expect(result.content).toContain("click");
      expect(result.content).toContain("submit");
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
