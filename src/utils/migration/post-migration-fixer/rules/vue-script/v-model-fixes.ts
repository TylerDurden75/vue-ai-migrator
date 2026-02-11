/**
 * Rules for v-model Vue 2 → Vue 3 migration in script
 *
 * Vue 3 changes:
 * - prop: value → modelValue
 * - event: input → update:modelValue
 * - model option removed, use v-model:propName on parent
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

/**
 * Extract model option from Options API component (model: { prop, event })
 */
function extractModelOption(scriptContent: string): { prop: string; event: string } | null {
  const modelMatch = scriptContent.match(
    /model\s*:\s*\{\s*prop\s*:\s*['"]([^'"]+)['"]\s*,\s*event\s*:\s*['"]([^'"]+)['"]\s*\}/
  );
  if (modelMatch) {
    return { prop: modelMatch[1], event: modelMatch[2] };
  }
  return null;
}

/**
 * Fix: Replace this.$emit('input', ...) with this.$emit('update:modelValue', ...)
 * Must run before scriptSetupThisEmitRule so the latter adds 'update:modelValue' to defineEmits.
 */
export const vModelEmitRule: FixRule = {
  id: "v-model-emit",
  description: "Replace v-model emit: input → update:modelValue in script setup",
  priority: 90,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      (content.includes("<script setup") || content.includes("<script ")) &&
      /this\.\$emit\s*\(\s*['"]input['"]\s*,\s*/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    const openTag = scriptMatch[0].slice(0, scriptMatch[0].indexOf(">") + 1);
    let scriptContent = scriptMatch[1];

    // Check for custom model option (Options API) - then event is model.event, not 'input'
    const model = extractModelOption(scriptContent);
    if (model && model.event !== "input") {
      // this.$emit('change', x) → this.$emit('update:title', x) when model = { prop: 'title', event: 'change' }
      const eventPattern = `this\\.\\$emit\\s*\\(\\s*['"]${model.event.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]\\s*,\\s*`;
      const eventRegex = new RegExp(eventPattern, "g");
      const newContent = scriptContent.replace(
        eventRegex,
        `this.$emit('update:${model.prop}', `
      );
      if (newContent !== scriptContent) {
        scriptContent = newContent;
        result.fixed = true;
        result.fixes.push(
          `Replaced this.$emit('${model.event}') with this.$emit('update:${model.prop}') for v-model`
        );
      }
    } else {
      // Default v-model: input → update:modelValue
      const inputEmitRegex = /this\.\$emit\s*\(\s*['"]input['"]\s*,\s*/g;
      if (inputEmitRegex.test(scriptContent)) {
        scriptContent = scriptContent.replace(
          /this\.\$emit\s*\(\s*['"]input['"]\s*,\s*/g,
          "this.$emit('update:modelValue', "
        );
        result.fixed = true;
        result.fixes.push("Replaced this.$emit('input') with this.$emit('update:modelValue') for v-model");
      }
    }

    if (result.fixed) {
      result.content = content.replace(
        /<script[^>]*>[\s\S]*?<\/script>/,
        `${openTag}${scriptContent}</script>`
      );
    }

    return result;
  }
};

/**
 * Fix: Replace props/defineProps value with modelValue (Vue 3 v-model default prop name)
 */
export const vModelPropsRule: FixRule = {
  id: "v-model-props",
  description: "Replace value prop with modelValue in v-model components",
  priority: 88,
  dependencies: ["v-model-emit"],
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return false;
    const script = scriptMatch[1];
    // Component likely has v-model if it has value prop and emits input/update:modelValue
    const hasValueProp =
      /\bvalue\s*:\s*\w+|defineProps\s*[<(]\s*[^>)]*\bvalue\b/.test(script) ||
      /['"]value['"]\s*:/.test(script);
    const hasVModelEmit =
      /this\.\$emit\s*\(\s*['"](?:input|update:modelValue)['"]/.test(script) ||
      /emit\s*\(\s*['"]update:modelValue['"]/.test(script);
    return hasValueProp && (hasVModelEmit || /['"]input['"]/.test(script));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    const openTag = scriptMatch[0].slice(0, scriptMatch[0].indexOf(">") + 1);
    let scriptContent = scriptMatch[1];

    // Also check model option - custom prop name (e.g. title) stays as-is
    const model = extractModelOption(scriptContent);
    // For default v-model we replace value→modelValue. For model option the prop stays the same.
    const needsValueToModelValue = !model;

    if (!needsValueToModelValue) {
      return result;
    }

    let changed = false;

    // defineProps({ value: String }) → defineProps({ modelValue: String })
    if (/defineProps\s*\(\s*\{[^}]*\bvalue\s*:\s*/.test(scriptContent)) {
      const before = scriptContent;
      scriptContent = scriptContent.replace(
        /(defineProps\s*\(\s*\{\s*)([^}]*(?:\bvalue\s*:\s*[^,}]+))([^}]*\}\s*\))/,
        (_, open, middle, close) => {
          const replaced = middle.replace(/\bvalue\s*:\s*/g, "modelValue: ");
          return open + replaced + close;
        }
      );
      if (scriptContent !== before) changed = true;
    }

    // defineProps<{ value: string }>() → defineProps<{ modelValue: string }>()
    const definePropsGenericRegex = /defineProps\s*<\s*\{([^>]*)\}\s*>\s*\(\s*\)/;
    const genericMatch = scriptContent.match(definePropsGenericRegex);
    if (genericMatch && /\bvalue\s*:\s*/.test(genericMatch[1])) {
      const inner = genericMatch[1].replace(/\bvalue\s*:\s*/g, "modelValue: ");
      scriptContent = scriptContent.replace(
        definePropsGenericRegex,
        `defineProps<{${inner}}>()`
      );
      changed = true;
    }

    // props.value → props.modelValue (when not destructured)
    const propsValueRegex = /(\bprops\s*\.\s*)value\b/g;
    if (propsValueRegex.test(scriptContent)) {
      scriptContent = scriptContent.replace(propsValueRegex, "$1modelValue");
      changed = true;
    }

    let didDestructureChange = false;
    scriptContent = scriptContent.replace(
      /const\s*\{\s*([^}]*)\bvalue\b([^}]*)\}\s*=\s*defineProps/,
      (m) => {
        didDestructureChange = true;
        changed = true;
        return m.replace(/\bvalue\b/g, "modelValue");
      }
    );

    if (changed) {
      result.fixed = true;
      result.fixes.push("Replaced value prop with modelValue for Vue 3 v-model");
      let fullContent = content.replace(
        /<script[^>]*>[\s\S]*?<\/script>/,
        `${openTag}${scriptContent}</script>`
      );
      // Also fix template: props.value → props.modelValue, and {{ value }} when destructured
      const templateBlock = fullContent.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
      if (templateBlock) {
        let templateContent = templateBlock[2];
        if (/(\bprops\s*\.\s*)value\b/.test(templateContent)) {
          templateContent = templateContent.replace(/(\bprops\s*\.\s*)value\b/g, "$1modelValue");
          result.fixes.push("Replaced props.value with props.modelValue in template");
        }
        // When destructured { modelValue } = defineProps(), template {{ value }} must become {{ modelValue }}
        if (didDestructureChange && /\{\{\s*value\s*\}\}/.test(templateContent)) {
          templateContent = templateContent.replace(/\{\{\s*value\s*\}\}/g, "{{ modelValue }}");
          result.fixes.push("Replaced {{ value }} with {{ modelValue }} in template");
        }
        if (templateContent !== templateBlock[2]) {
          fullContent = fullContent.replace(
            /<template[^>]*>[\s\S]*?<\/template>/,
            `${templateBlock[1]}${templateContent}${templateBlock[3]}`
          );
        }
      }
      result.content = fullContent;
    }

    return result;
  }
};

/**
 * Fix: Remove model option from Options API and ensure parent uses v-model:prop
 * The parent transformation (:title.sync → v-model:title) is done in the template codemod.
 * This rule removes the obsolete model option from the child component.
 */
export const vModelRemoveModelOptionRule: FixRule = {
  id: "v-model-remove-model-option",
  description: "Remove model component option (replaced by v-model:prop syntax)",
  priority: 87,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      /model\s*:\s*\{\s*prop\s*:/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    const openTag = scriptMatch[0].slice(0, scriptMatch[0].indexOf(">") + 1);
    let scriptContent = scriptMatch[1];

    // Remove model: { prop: 'x', event: 'y' } from export default { ... }
    const modelBlockRegex = /model\s*:\s*\{\s*prop\s*:\s*['"][^'"]+['"]\s*,\s*event\s*:\s*['"][^'"]+['"]\s*\}\s*,?\s*/g;
    const before = scriptContent;
    scriptContent = scriptContent.replace(modelBlockRegex, "");

    // Clean up trailing comma before } if it creates , }
    scriptContent = scriptContent.replace(/,\s*\}\s*}/g, " } }");
    scriptContent = scriptContent.replace(/,\s*\}\s*\)/g, " })");

    if (scriptContent !== before) {
      result.fixed = true;
      result.fixes.push("Removed model component option (use v-model:prop on parent)");
      result.content = content.replace(
        /<script[^>]*>[\s\S]*?<\/script>/,
        `${openTag}${scriptContent}</script>`
      );
    }

    return result;
  }
};
