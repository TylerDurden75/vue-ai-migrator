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
 * Parse a Vue SFC file into its component parts
 */
export function parseVueFile(content: string): VueFileParts {
  const parts: VueFileParts = {
    styles: [],
    customBlocks: [],
  };

  // Match template block
  const templateMatch = content.match(
    /<template(?:\s+lang=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/template>/i
  );
  if (templateMatch) {
    parts.template = {
      content: templateMatch[2].trim(),
      lang: templateMatch[1] || 'html',
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
 * Transform Vue file parts (including template transformation)
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

  return { parts, modified, issues };
}

/**
 * Check if content is a Vue SFC file
 */
export function isVueFile(content: string): boolean {
  return /<template|<script|<style/.test(content);
}
