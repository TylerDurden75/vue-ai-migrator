import { transformTemplate } from '../../codemods/transforms/template';

/**
 * Vue Single File Component (SFC) Parser
 * Parses .vue files into template, script, and style sections
 */

export interface VueFileParts {
  template?: {
    content: string;
    lang?: string;
  };
  script?: {
    content: string;
    lang?: string;
    setup?: boolean;
  };
  styles: Array<{
    content: string;
    lang?: string;
    scoped?: boolean;
    module?: boolean;
  }>;
  customBlocks: Array<{
    type: string;
    content: string;
    attrs: Record<string, string>;
  }>;
}

/**
 * Extract root template block (handles nested <template> from v-if, v-slot, etc.)
 */
function extractRootTemplateBlock(content: string): { inner: string; attrs: string; lang?: string } | null {
  const openMatch = content.match(/<template(\s[^>]*|)>/i);
  if (!openMatch) return null;
  const startIdx = openMatch.index! + openMatch[0].length;
  let depth = 1;
  let i = startIdx;
  const len = content.length;
  while (i < len && depth > 0) {
    const open = content.toLowerCase().indexOf("<template", i);
    const close = content.toLowerCase().indexOf("</template>", i);
    if (close === -1) return null;
    if (open !== -1 && open < close) {
      depth++;
      i = open + 9;
    } else {
      depth--;
      if (depth === 0) {
        const inner = content.slice(startIdx, close);
        const attrs = (openMatch[1] || "").trim();
        const langMatch = attrs.match(/lang=["']([^"']+)["']/);
        return { inner: inner.trim(), attrs, lang: langMatch?.[1] || "html" };
      }
      i = close + 11;
    }
  }
  return null;
}

/**
 * Parse a Vue SFC file into its component parts
 */
export function parseVueFile(content: string): VueFileParts {
  const parts: VueFileParts = {
    styles: [],
    customBlocks: [],
  };

  const templateBlock = extractRootTemplateBlock(content);
  if (templateBlock) {
    parts.template = {
      content: templateBlock.inner,
      lang: templateBlock.lang,
    };
  }

  // Match script block (handle both <script> and <script setup>)
  const scriptMatch = content.match(
    /<script(?:\s+setup)?(?:\s+lang=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/script>/i
  );
  if (scriptMatch) {
    parts.script = {
      content: scriptMatch[2].trim(),
      lang: scriptMatch[1] || 'js',
      setup: scriptMatch[0].includes('setup'),
    };
  }

  // Match all style blocks
  const styleRegex =
    /<style(?:\s+lang=["']([^"']+)["'])?(?:\s+scoped)?(?:\s+module)?[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(content)) !== null) {
    parts.styles.push({
      content: styleMatch[2].trim(),
      lang: styleMatch[1] || 'css',
      scoped: styleMatch[0].includes('scoped'),
      module: styleMatch[0].includes('module'),
    });
  }

  // Match custom blocks (e.g., <docs>, <i18n>)
  const customBlockRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/gi;
  const processedBlocks = new Set<string>();
  let customMatch;
  while ((customMatch = customBlockRegex.exec(content)) !== null) {
    const blockType = customMatch[1].toLowerCase();
    if (
      !['template', 'script', 'style'].includes(blockType) &&
      !processedBlocks.has(customMatch[0])
    ) {
      processedBlocks.add(customMatch[0]);
      const attrs: Record<string, string> = {};
      const attrsMatch = customMatch[2].match(/(\w+)=["']([^"']+)["']/g);
      if (attrsMatch) {
        attrsMatch.forEach((attr) => {
          const [key, value] = attr.split('=');
          attrs[key] = value.replace(/["']/g, '');
        });
      }
      parts.customBlocks.push({
        type: blockType,
        content: customMatch[3].trim(),
        attrs,
      });
    }
  }

  return parts;
}

/**
 * Reconstruct a Vue file from its parts
 */
export function reconstructVueFile(parts: VueFileParts): string {
  const sections: string[] = [];

  // Template section
  if (parts.template) {
    const langAttr =
      parts.template.lang && parts.template.lang !== 'html' ? ` lang="${parts.template.lang}"` : '';
    sections.push(`<template${langAttr}>\n${parts.template.content}\n</template>`);
  }

  // Script section
  if (parts.script) {
    const setupAttr = parts.script.setup ? ' setup' : '';
    const langAttr =
      parts.script.lang && parts.script.lang !== 'js' ? ` lang="${parts.script.lang}"` : '';
    sections.push(`<script${setupAttr}${langAttr}>\n${parts.script.content}\n</script>`);
  }

  // Style sections
  parts.styles.forEach((style) => {
    const attrs: string[] = [];
    if (style.lang && style.lang !== 'css') {
      attrs.push(`lang="${style.lang}"`);
    }
    if (style.scoped) {
      attrs.push('scoped');
    }
    if (style.module) {
      attrs.push('module');
    }
    const attrsStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
    sections.push(`<style${attrsStr}>\n${style.content}\n</style>`);
  });

  // Custom blocks
  parts.customBlocks.forEach((block) => {
    const attrsStr =
      Object.keys(block.attrs).length > 0
        ? ` ${Object.entries(block.attrs)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ')}`
        : '';
    sections.push(`<${block.type}${attrsStr}>\n${block.content}\n</${block.type}>`);
  });

  let result = sections.join('\n\n');
  // Safety: never emit <scriptsetup (typo) — ensure <script setup> in output
  if (/<scriptsetup\b/i.test(result)) {
    result = result.replace(/<scriptsetup\b/gi, '<script setup');
  }
  return result;
}

/**
 * Transform Vue 2 transition CSS classes to Vue 3
 * Vue 3: .v-enter → .v-enter-from, .v-leave → .v-leave-from
 */
export function transformTransitionClasses(css: string): { css: string; modified: boolean } {
  let modified = false;
  // Match .name-enter and .name-leave (not followed by -from, -to, -active)
  const result = css.replace(/\.([a-zA-Z0-9_-]*)(enter|leave)(?!-)/g, (match) => {
    modified = true;
    return `${match}-from`;
  });
  return { css: result, modified };
}

/**
 * Transform Vue file parts (including template and style transformations)
 */
export function transformVueFileParts(parts: VueFileParts): {
  parts: VueFileParts;
  modified: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  let modified = false;

  // Transform template if present
  if (parts.template) {
    const templateResult = transformTemplate(parts.template.content);
    if (templateResult.modified) {
      parts.template.content = templateResult.template;
      modified = true;
      issues.push(...templateResult.issues);
    }
  }

  // Transform transition classes in style sections (Vue 3: .v-enter → .v-enter-from)
  let transitionClassesModified = false;
  parts.styles.forEach((style) => {
    const styleResult = transformTransitionClasses(style.content);
    if (styleResult.modified) {
      style.content = styleResult.css;
      modified = true;
      transitionClassesModified = true;
    }
  });
  if (transitionClassesModified) {
    issues.push('Transition classes updated: .v-enter → .v-enter-from, .v-leave → .v-leave-from');
  }

  return { parts, modified, issues };
}

/**
 * Check if content is a Vue SFC file
 */
export function isVueFile(content: string): boolean {
  return /<template|<script|<style/.test(content);
}
