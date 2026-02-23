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

/** Derive composable name from mixin file name: userMixin -> useUser, authMixin -> useAuth (no Mixin suffix) */
export function mixinNameToComposable(mixinName: string): string {
  let base = mixinName.replace(/\.(js|ts)$/, "");
  // Remove "Mixin" suffix - we generate composables, not mixins
  if (base.endsWith("Mixin")) {
    base = base.slice(0, -5);
  }
  const pascal = toPascalCase(base);
  return `use${pascal}`;
}

/** Derive provide key from composable name: useUser -> user, useUserMixin -> user (for app.provide) */
export function composableNameToProvideKey(composableName: string): string {
  if (composableName.startsWith("use") && composableName.length > 3) {
    let rest = composableName.slice(3);
    if (rest.endsWith("Mixin")) rest = rest.slice(0, -5);
    return rest.charAt(0).toLowerCase() + rest.slice(1);
  }
  return composableName;
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
export async function generateComposableFromMixin(
  mixinName: string,
  analysis: MixinAnalysis,
  enableTypeScript: boolean = false,
  mixinSource?: string,
  projectRoot?: string
): Promise<string> {
  if (mixinSource) {
    const astResult = await transformMixinToComposableAST(
      mixinSource,
      mixinName,
      enableTypeScript,
      projectRoot
    );
    if (astResult.success && astResult.code) {
      return astResult.code;
    }
  }
  return generateStubComposable(mixinName, analysis, enableTypeScript);
}
