/**
 * Unit tests for v-model migration rules
 */

import {
  vModelEmitRule,
  vModelPropsRule,
  vModelRemoveModelOptionRule,
} from "../rules/vue-script/v-model-fixes";
import { scriptSetupThisEmitRule } from "../rules/vue-script/vue-script-setup";

describe("v-model migration rules", () => {
  describe("vModelEmitRule", () => {
    it("should replace this.$emit('input', x) with this.$emit('update:modelValue', x)", async () => {
      const content = `<script setup>
const props = defineProps({ value: String });
const update = (e) => { this.$emit('input', e.target.value); };
</script>`;

      const result = await vModelEmitRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("this.$emit('update:modelValue', e.target.value)");
      expect(result.content).not.toContain("this.$emit('input'");
    });

    it("should replace custom model event with update:prop", async () => {
      const content = `<script>
export default {
  model: { prop: 'title', event: 'change' },
  props: { title: String },
  methods: {
    update(val) { this.$emit('change', val); }
  }
}
</script>`;

      const result = await vModelEmitRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("this.$emit('update:title', val)");
      expect(result.content).not.toContain("this.$emit('change'");
    });
  });

  describe("vModelPropsRule", () => {
    it("should replace value with modelValue in defineProps", async () => {
      const content = `<script setup>
const props = defineProps({ value: String });
const update = (e) => { this.$emit('update:modelValue', e.target.value); };
</script>
<template><input :value="props.value" @input="update" /></template>`;

      const result = await vModelPropsRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("modelValue: String");
      expect(result.content).not.toContain("value: String");
      expect(result.content).toContain("props.modelValue");
      expect(result.content).not.toContain("props.value");
    });

    it("should replace value in destructuring and template", async () => {
      const content = `<script setup>
const { value } = defineProps({ value: String });
const update = (e) => { this.$emit('update:modelValue', e.target.value); };
</script>
<template><div>{{ value }}</div></template>`;

      const result = await vModelPropsRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("modelValue } = defineProps");
      expect(result.content).toContain("{{ modelValue }}");
    });
  });

  describe("vModelRemoveModelOptionRule", () => {
    it("should remove model option from Options API", async () => {
      const content = `<script>
export default {
  model: { prop: 'title', event: 'change' },
  props: { title: String }
}
</script>`;

      const result = await vModelRemoveModelOptionRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });

      expect(result.fixed).toBe(true);
      expect(result.content).not.toContain("model:");
      expect(result.content).toContain("props: { title: String }");
    });
  });

  describe("integration: v-model emit then scriptSetupThisEmit", () => {
    it("should produce emit('update:modelValue', x) after both rules", async () => {
      let content = `<script setup>
const props = defineProps({ value: String });
const update = (e) => { this.$emit('input', e.target.value); };
</script>`;

      const emitResult = await vModelEmitRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      content = emitResult.content;

      const setupResult = await scriptSetupThisEmitRule.apply("Input.vue", content, {
        enableTypeScript: false,
        isVueFile: true,
      });
      content = setupResult.content;

      expect(content).toContain("emit('update:modelValue', e.target.value)");
      expect(content).not.toContain("this.$emit");
    });
  });
});
