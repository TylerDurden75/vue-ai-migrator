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
  priority: 5, // Run near the end so it fixes scriptsetup reintroduced by other rules
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
 * Extract import statements that are inside blocks (e.g. watch callback) and remove them.
 * Returns cleaned script + list of extracted import strings.
 * extractScriptSections treats watch( as a block and swallows imports inside it - they never get reordered.
 * Handles both: imports on their own line, and imports mid-line (e.g. after ; on same line).
 */
function extractMisplacedImportsAndRemove(script: string): { cleaned: string; extractedImports: string[] } {
  const extractedImports: string[] = [];
  const addImport = (raw: string) => {
    const normalized = raw.trim().replace(/\s*;\s*$/, ";");
    if (normalized && !extractedImports.includes(normalized)) {
      extractedImports.push(normalized);
    }
  };
  // 1. Imports on their own line
  const importRe = /^\s*import\s+(?:(?:\{[\s\S]*?\}|\*\s+as\s+\w+|\w+)\s+from\s+['"][^'"]+['"]|['"][^'"]+['"])\s*;?\s*$/gm;
  let cleaned = script.replace(importRe, (match) => {
    addImport(match);
    return "";
  });
  cleaned = cleaned.replace(/^\s*\n/gm, "");
  // 2. Imports mid-line (e.g. fetchComments();import { x } from "y"; - common after bad AST merge)
  const midLineImportRe = /;\s*import\s+(\{[^}]*\}\s+from\s+['"][^'"]+['"])\s*;?/g;
  cleaned = cleaned.replace(midLineImportRe, (match, importPart) => {
    addImport(`import ${importPart};`);
    return ";";
  });
  return { cleaned, extractedImports };
}

/**
 * Section order for script setup (Vue style guide + clean structure)
 * 1. Imports (grouped: vue, store, components, other)
 * 2. Stores (useXxxStore)
 * 3. Composables (inject, useRoute, useRouter, etc.)
 * 4. defineProps / defineEmits
 * 5. let/var
 * 6. refs
 * 7. computed
 * 8. methods
 * 9. watch
 * 10. lifecycle
 */
function extractScriptSections(script: string): {
  imports: string[];
  stores: string[];
  composables: string[];
  defineProps: string[];
  defineEmits: string[];
  letVar: string[];
  refs: string[];
  computed: string[];
  watch: string[];
  methods: string[];
  lifecycle: string[];
  other: string[];
} {
  const sections = {
    imports: [] as string[],
    stores: [] as string[],
    composables: [] as string[],
    defineProps: [] as string[],
    defineEmits: [] as string[],
    letVar: [] as string[],
    refs: [] as string[],
    computed: [] as string[],
    watch: [] as string[],
    methods: [] as string[],
    lifecycle: [] as string[],
    other: [] as string[],
  };
  const LIFECYCLE = /^(onBeforeMount|onMounted|onBeforeUpdate|onUpdated|onBeforeUnmount|onUnmounted|onActivated|onDeactivated|onErrorCaptured)\s*\(/m;
  const lines = script.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (/^import\s+/.test(trimmed)) {
      const block: string[] = [line];
      i++;
      while (i < lines.length && /^import\s+/.test(lines[i].trim())) {
        block.push(lines[i]);
        i++;
      }
      sections.imports.push(block.join("\n"));
      continue;
    }
    // Stores: useXxxStore()
    if (/^const\s+\w+\s*=\s*use\w+Store\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.stores.push(block.text);
      i = block.next;
      continue;
    }
    // Composables: inject, useRoute, useRouter, getCurrentInstance
    if (
      /^const\s+\w+\s*=\s*useRoute\s*\(/.test(trimmed) ||
      /^const\s+\w+\s*=\s*useRouter\s*\(/.test(trimmed) ||
      /^const\s+\w+\s*=\s*getCurrentInstance\s*\(/.test(trimmed) ||
      /^const\s+\{[^}]*\}\s*=\s*inject\s*\(/.test(trimmed) ||
      /^const\s+\w+\s*=\s*use\w+\s*\(/.test(trimmed)
    ) {
      const block = extractBlock(lines, i);
      sections.composables.push(block.text);
      i = block.next;
      continue;
    }
    if (/^const\s+\w+\s*=\s*defineProps\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.defineProps.push(block.text);
      i = block.next;
      continue;
    }
    if (/^const\s+\w+\s*=\s*defineEmits\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.defineEmits.push(block.text);
      i = block.next;
      continue;
    }
    if (/^(let|var)\s+\w+/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.letVar.push(block.text);
      i = block.next;
      continue;
    }
    if (/^const\s+\w+\s*=\s*ref\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.refs.push(block.text);
      i = block.next;
      continue;
    }
    if (/^const\s+\w+\s*=\s*computed\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.computed.push(block.text);
      i = block.next;
      continue;
    }
    if (/^watch\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.watch.push(block.text);
      i = block.next;
      continue;
    }
    if (LIFECYCLE.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.lifecycle.push(block.text);
      i = block.next;
      continue;
    }
    if (/^const\s+\w+\s*=\s*\(/.test(trimmed) || /^const\s+\w+\s*=\s*[^(]+=>\s*\{/.test(trimmed) || /^function\s+\w+\s*\(/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.methods.push(block.text);
      i = block.next;
      continue;
    }
    if (/^const\s+\w+\s*=/.test(trimmed)) {
      const block = extractBlock(lines, i);
      sections.other.push(block.text);
      i = block.next;
      continue;
    }
    sections.other.push(line);
    i++;
  }
  return sections;
}

function extractBlock(lines: string[], start: number): { text: string; next: number } {
  const block: string[] = [lines[start]];
  let inParen = 0;
  let inBrace = 0;
  let i = start;
  const first = lines[start];
  for (const c of first) {
    if (c === "(") inParen++;
    if (c === ")") inParen--;
    if (c === "{") inBrace++;
    if (c === "}") inBrace--;
  }
  i++;
  while (i < lines.length && (inParen > 0 || inBrace > 0 || (!block[block.length - 1].trim().endsWith(";") && !block[block.length - 1].trim().endsWith("}")))) {
    const line = lines[i];
    block.push(line);
    for (const c of line) {
      if (c === "(") inParen++;
      if (c === ")") inParen--;
      if (c === "{") inBrace++;
      if (c === "}") inBrace--;
    }
    i++;
  }
  return { text: block.join("\n").replace(/\s*$/, ""), next: i };
}

/** Sort imports: vue first, then @/store, then @/components/composables, then others */
function sortImports(importLines: string[]): string[] {
  const allImports = importLines.flatMap((block) => block.split("\n").filter((l) => l.trim()));
  return allImports.sort((a, b) => {
    const fromA = a.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? "";
    const fromB = b.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? "";
    const tier = (s: string) => {
      if (s === "vue") return 0;
      if (s.includes("@/store") || s.includes("@/stores")) return 2;
      if (s.includes("@/components") || s.includes("@/composables")) return 3;
      return 4;
    };
    const tA = tier(fromA);
    const tB = tier(fromB);
    if (tA !== tB) return tA - tB;
    return fromA.localeCompare(fromB);
  });
}

function buildOrganizedScript(sections: ReturnType<typeof extractScriptSections>): string {
  const parts: string[] = [];
  // Imports: grouped together, sorted (vue → store → components → other)
  if (sections.imports.length) {
    parts.push(sortImports(sections.imports).join("\n"));
  }
  // Stores, composables, etc.: each block on one line, groups separated by blank line
  if (sections.stores.length) parts.push(sections.stores.join("\n"));
  if (sections.composables.length) parts.push(sections.composables.join("\n"));
  if (sections.defineProps.length) parts.push(sections.defineProps.join("\n"));
  if (sections.defineEmits.length) parts.push(sections.defineEmits.join("\n"));
  if (sections.letVar.length) parts.push(sections.letVar.join("\n"));
  if (sections.refs.length) parts.push(sections.refs.join("\n"));
  if (sections.computed.length) parts.push(sections.computed.join("\n"));
  if (sections.methods.length) parts.push(sections.methods.join("\n"));
  if (sections.watch.length) parts.push(sections.watch.join("\n"));
  if (sections.lifecycle.length) parts.push(sections.lifecycle.join("\n"));
  if (sections.other.length) parts.push(sections.other.join("\n"));
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Fix: Organize script setup into consistent section order
 * Order: imports → composables → defineProps/Emits → refs → computed → methods → watch → lifecycle
 */
export const scriptSetupOrganizationRule: FixRule = {
  id: "script-setup-organization",
  description: "Organize script setup: imports at top, composables, props, refs, computed, methods, lifecycle",
  priority: 8,
  dependencies: ["script-setup-formatting"],
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup")) return false;
    const script = content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!script) return false;
    const importsOutOfOrder = /[;}]\s*\n\s*import\s+/.test(script) || /\n\s*(?:const|let)\s+[\s\S]*?\n\s*import\s+/.test(script);
    const importInsideBlock = /\{\s*[\s\S]*?import\s+[\s\S]*?\}/.test(script);
    const watchBeforeComputed = /\bwatch\s*\(/.test(script) && /\bconst\s+\w+\s*=\s*computed\s*\(/.test(script) &&
      (script.indexOf("watch(") < script.search(/const\s+\w+\s*=\s*computed\s*\(/));
    // watch must come after methods (avoids TDZ when watch calls fn() with immediate:true)
    const firstMethodPos = script.search(/(?:^|\n)\s*(?:function\s+\w+\s*\(|const\s+\w+\s*=\s*(?:\([^)]*\)|async\s*\([^)]*\))\s*=>\s*\{)/m);
    const firstWatchPos = script.search(/(?:^|\n)\s*watch\s*\(/m);
    const watchBeforeMethods = firstWatchPos >= 0 && firstMethodPos >= 0 && firstWatchPos < firstMethodPos;
    return importsOutOfOrder || importInsideBlock || watchBeforeComputed || watchBeforeMethods;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;
    let script = scriptMatch[1];
    // Extract imports embedded in blocks (watch callbacks, etc.) - extractScriptSections can't see them
    const { cleaned, extractedImports } = extractMisplacedImportsAndRemove(script);
    script = cleaned;
    const sections = extractScriptSections(script);
    // Prepend extracted imports to the imports section
    if (extractedImports.length) {
      sections.imports = [...extractedImports, ...sections.imports];
      result.fixes.push("Moved misplaced imports to top");
    }
    const organized = buildOrganizedScript(sections);
    if (organized !== script.trim() || extractedImports.length > 0) {
      const openTag = scriptMatch[0].match(/^<script[^>]*>/)![0];
      result.content = content.replace(scriptMatch[0], openTag + "\n" + organized + "\n</script>");
      result.fixed = true;
      result.fixes.push("Reorganized script setup sections");
    }
    return result;
  },
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
