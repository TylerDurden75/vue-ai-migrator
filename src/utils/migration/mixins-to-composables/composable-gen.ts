/**
 * Generate composable from mixin analysis
 */

import type { MixinAnalysis } from "./mixin-analyzer";
import { transformMixinToComposableAST } from "./mixin-ast-transform";

function toCamelCase(str: string): string {
  return str.replace(/[-_\s](.)/g, (_, c) => c.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Derive composable name from mixin file name: userMixin -> useUserMixin, user-mixin -> useUserMixin */
export function mixinNameToComposable(mixinName: string): string {
  const base = mixinName.replace(/\.(js|ts)$/, "");
  const pascal = toPascalCase(base);
  return `use${pascal}`;
}

export function getMixinReturnKeys(analysis: MixinAnalysis): string[] {
  return [
    ...analysis.dataKeys,
    ...analysis.methodNames,
    ...analysis.computedNames,
  ];
}

/**
 * Generate stub composable (fallback when AST transform fails)
 */
function generateStubComposable(
  mixinName: string,
  analysis: MixinAnalysis,
  enableTypeScript: boolean
): string {
  const composableName = mixinNameToComposable(mixinName);
  const lines: string[] = [];
  const returns: string[] = [];

  lines.push("import { ref, computed } from 'vue';");
  lines.push("");

  for (const key of analysis.dataKeys) {
    if (enableTypeScript) {
      lines.push(`const ${key} = ref<unknown>(undefined);`);
    } else {
      lines.push(`const ${key} = ref(undefined);`);
    }
    returns.push(key);
  }

  for (const name of analysis.methodNames) {
    lines.push(`function ${name}() { /* TODO: implement from mixin */ }`);
    returns.push(name);
  }

  for (const name of analysis.computedNames) {
    lines.push(`const ${name} = computed(() => undefined); // TODO: implement from mixin`);
    returns.push(name);
  }

  if (analysis.hasLifecycle) {
    lines.push("// Lifecycle hooks - add onMounted, onBeforeUnmount etc. as needed");
  }

  const returnStr = returns.length > 0 ? `return { ${returns.join(", ")} };` : "return {};";
  lines.push("");
  lines.push(`export function ${composableName}() {`);
  lines.push(`  ${returnStr}`);
  lines.push("}");

  return lines.join("\n");
}

/**
 * Generate composable content from mixin source.
 * Tries AST-based migration first (real logic); falls back to stubs on parse failure.
 */
export function generateComposableFromMixin(
  mixinName: string,
  analysis: MixinAnalysis,
  enableTypeScript: boolean = false,
  mixinSource?: string
): string {
  if (mixinSource) {
    const astResult = transformMixinToComposableAST(
      mixinSource,
      mixinName,
      enableTypeScript
    );
    if (astResult.success && astResult.code) {
      return astResult.code;
    }
  }
  return generateStubComposable(mixinName, analysis, enableTypeScript);
}
