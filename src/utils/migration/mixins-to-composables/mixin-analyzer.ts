/**
 * Analyzes mixin file content to extract structure for composable generation
 * Uses regex for Phase 1 - can be enhanced with AST later
 */

export interface MixinAnalysis {
  dataKeys: string[];
  methodNames: string[];
  computedNames: string[];
  hasLifecycle: boolean;
}

/** Extract keys from data() { return { k1: v1, k2: v2 } } */
function extractDataKeys(content: string): string[] {
  const keys: string[] = [];
  const dataMatch = content.match(/data\s*\(\s*\)\s*\{\s*return\s*\{([\s\S]*?)\}\s*[,;]/);
  if (!dataMatch) return keys;
  const inner = dataMatch[1];
  const keyRegex = /(\w+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRegex.exec(inner)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

/** Extract method names from methods: { name() {}, name2() {} } */
function extractMethodNames(content: string): string[] {
  const names: string[] = [];
  const methodsMatch = content.match(/methods\s*:\s*\{([\s\S]*?)\}\s*(?:,\s*computed|,\s*data|,\s*mixins|,\s*[\w]+|\s*$)/);
  if (!methodsMatch) return names;
  const inner = methodsMatch[1];
  const methodRegex = /(\w+)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(inner)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Extract computed names from computed: { name() {} } */
function extractComputedNames(content: string): string[] {
  const names: string[] = [];
  const computedMatch = content.match(/computed\s*:\s*\{([\s\S]*?)\}\s*(?:,\s*methods|,\s*data|,\s*mixins|,\s*[\w]+|\s*$)/);
  if (!computedMatch) return names;
  const inner = computedMatch[1];
  const computedRegex = /(\w+)\s*(?:\([^)]*\)\s*\{|:\s*function)/g;
  let m: RegExpExecArray | null;
  while ((m = computedRegex.exec(inner)) !== null) {
    names.push(m[1]);
  }
  return names;
}

function hasLifecycle(content: string): boolean {
  return /(?:beforeCreate|created|beforeMount|mounted|beforeUpdate|updated|beforeDestroy|destroyed|beforeUnmount|unmounted)\s*\(/i.test(content);
}

/**
 * Check if file content looks like a Vue mixin (no template, has data/methods/computed/inject/watch)
 */
export function looksLikeMixin(content: string, _filePath: string): boolean {
  if (content.includes("<template")) return false;
  const hasData = /data\s*\(\s*\)\s*\{/.test(content);
  const hasMethods = /methods\s*:\s*\{/.test(content);
  const hasComputed = /computed\s*:\s*\{/.test(content);
  const hasInject = /inject\s*:\s*(\[|\{)/.test(content);
  const hasWatch = /watch\s*:\s*\{/.test(content);
  const hasLifecycle = /(?:beforeCreate|created|mounted|beforeDestroy|destroyed)\s*\(/.test(content);
  const hasDefaultExport = /export\s+default\s+(\{|defineComponent)/.test(content);
  const hasNamedExport = /export\s+(const|let|var)\s+\w+\s*=\s*(\{|defineComponent)/.test(content);
  return (
    (hasDefaultExport || hasNamedExport) &&
    (hasData || hasMethods || hasComputed || hasInject || hasWatch || hasLifecycle)
  );
}

export function analyzeMixin(content: string): MixinAnalysis {
  return {
    dataKeys: extractDataKeys(content),
    methodNames: extractMethodNames(content),
    computedNames: extractComputedNames(content),
    hasLifecycle: hasLifecycle(content),
  };
}
