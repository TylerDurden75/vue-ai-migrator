/**
 * Rules for fixing <script setup> specific issues
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

/**
 * Fix: Malformed script setup tag (missing space): <scriptsetup → <script setup
 */
export const scriptSetupTagSpaceRule: FixRule = {
  id: "script-setup-tag-space",
  description: "Fix <scriptsetup to <script setup",
  priority: 99,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && /<scriptsetup\b/i.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(/<scriptsetup\b/gi, "<script setup");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed script setup tag (scriptsetup → script setup)");
    }
    return result;
  }
};

/**
 * Fix: Remove export default in <script setup>
 */
export const removeExportDefaultRule: FixRule = {
  id: "remove-export-default",
  description: "Remove export default in <script setup>",
  priority: 100,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("export default");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptSetupMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptSetupMatch) {
      return result;
    }

    let scriptContent = scriptSetupMatch[1];
    const originalScriptContent = scriptContent;

    // Remove export default { ... }
    let braceCount = 0;
    const startIndex = scriptContent.indexOf("export default");
    if (startIndex !== -1) {
      const braceStart = scriptContent.indexOf("{", startIndex);
      if (braceStart !== -1) {
        braceCount = 1;
        let i = braceStart + 1;
        while (i < scriptContent.length && braceCount > 0) {
          if (scriptContent[i] === "{") braceCount++;
          if (scriptContent[i] === "}") braceCount--;
          i++;
        }
        if (braceCount === 0) {
          scriptContent = scriptContent.substring(0, startIndex) + scriptContent.substring(i);
        }
      }
    }

    if (scriptContent !== originalScriptContent) {
      result.content = content.replace(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
        `<script setup>${scriptContent}</script>`
      );
      result.fixed = true;
      result.fixes.push("Removed export default in <script setup>");
    }

    return result;
  }
};

/**
 * Fix: Replace this.$emit / $emit with emit() in script setup (Vue 3 Composition API).
 * - Script: this.$emit('event') → emit('event')
 * - Template: $emit('event') → emit('event')
 * - Adds defineEmits if missing (Vue 3 emits option).
 */
export const scriptSetupThisEmitRule: FixRule = {
  id: "script-setup-this-emit",
  description: "Replace this.$emit and template $emit with emit() in script setup",
  priority: 85,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script setup") &&
      (content.includes("this.$emit") || content.includes("$emit("))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptSetupMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptSetupMatch) {
      return result;
    }

    const openTag = scriptSetupMatch[0].slice(0, scriptSetupMatch[0].indexOf(">") + 1);
    let scriptContent = scriptSetupMatch[1];

    // Collect event names from script (this.$emit)
    const scriptEmitPattern = /this\.\$emit\(['"]([^'"]+)['"]/g;
    const eventNames = new Set<string>();
    let match;
    while ((match = scriptEmitPattern.exec(scriptContent)) !== null) {
      eventNames.add(match[1]);
    }

    // Collect event names from template ($emit) - Vue 2 style
    const templateEmitPattern = /\$emit\s*\(\s*['"]([^'"]+)['"]/g;
    const templateSection =
      content.indexOf("<script") >= 0 ? content.slice(0, content.indexOf("<script")) : content;
    while ((match = templateEmitPattern.exec(templateSection)) !== null) {
      eventNames.add(match[1]);
    }

    const hasScriptOrTemplateEmits = eventNames.size > 0;
    const hasTemplateDollarEmit = /\$emit\s*\(/.test(templateSection);
    const hasScriptThisEmit = scriptContent.includes("this.$emit");

    if (!hasScriptOrTemplateEmits && !hasTemplateDollarEmit && !hasScriptThisEmit) {
      return result;
    }

    const hasDefineEmits = /const\s+emit\s*=\s*defineEmits/.test(scriptContent);

    if (!hasDefineEmits && eventNames.size > 0) {
      const eventsArray = Array.from(eventNames)
        .map((e) => `"${e}"`)
        .join(", ");
      const defineEmitsLine = `const emit = defineEmits([${eventsArray}]);\n`;
      const importMatch = scriptContent.match(/(import\s+[^;]+;?\s*\n*)+/);
      const insertIndex = importMatch ? importMatch[0].length : 0;
      scriptContent =
        scriptContent.slice(0, insertIndex) +
        defineEmitsLine +
        scriptContent.slice(insertIndex);
      result.fixes.push(`Added defineEmits for events: ${Array.from(eventNames).join(", ")}`);
    }

    // Replace this.$emit with emit in script
    if (hasScriptThisEmit) {
      scriptContent = scriptContent.replace(
        /this\.\$emit\s*\(\s*(['"][^'"]+['"])/g,
        "emit($1"
      );
      result.fixed = true;
      result.fixes.push("Replaced this.$emit with emit()");
    }

    // Replace $emit with emit in template (Vue 3 script setup - no $ prefix)
    // Match $emit( but not this.$emit (negative lookbehind)
    let outputContent = content;
    if (hasTemplateDollarEmit) {
      outputContent = outputContent.replace(/(?<![.\w])\$emit\s*\(/g, "emit(");
      result.fixed = true;
      result.fixes.push("Replaced template $emit with emit()");
    }

    outputContent = outputContent.replace(
      /<script\s+setup[^>]*>[\s\S]*?<\/script>/,
      `${openTag}${scriptContent}</script>`
    );
    result.content = outputContent;

    return result;
  }
};

/**
 * Fix: Script setup tag formatting
 */
export const scriptSetupFormattingRule: FixRule = {
  id: "script-setup-formatting",
  description: "Fix script setup tag formatting (imports on new line, closing tag on new line)",
  priority: 10,
  dependencies: ["remove-export-default"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && content.includes("<script setup");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix: <script setup lang="ts">import ... → <script setup lang="ts">\nimport ...
    fixed = fixed.replace(/<script\s+setup[^>]*>import/g, (match) => {
      const scriptTagMatch = match.match(/<script\s+setup[^>]*>/);
      if (scriptTagMatch) {
        return scriptTagMatch[0] + "\nimport";
      }
      return match;
    });

    // Fix: ...;</script> → ...;\n</script>
    fixed = fixed.replace(/([^;\n]);\s*<\/script>/g, "$1;\n</script>");

    // Fix: code before </script> without semicolon
    fixed = fixed.replace(/([^\n}])\s*<\/script>/g, (match, beforeTag) => {
      if (!beforeTag.includes("\n") && beforeTag.trim().length > 0 && !beforeTag.endsWith(";")) {
        if (beforeTag.trim().endsWith("}") || beforeTag.trim().endsWith(")")) {
          return beforeTag + "\n</script>";
        }
      }
      return match;
    });

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed script setup tag formatting");
    }

    return result;
  }
};
