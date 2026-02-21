/**
 * Generate composable file (useX.ts) for event bus replacement
 * Phase 1: trigger pattern - payload void
 */

/**
 * Convert event name to composable name: "refresh" -> "useRefresh"
 */
export function eventNameToComposableName(eventName: string): string {
  const pascal = eventName.charAt(0).toUpperCase() + eventName.slice(1).replace(/[-_\s](.)/g, (_, c) => c.toUpperCase());
  return `use${pascal}`;
}

/**
 * Convert event name to reactive var: "refresh" -> "refreshToken"
 * For trigger pattern we use a token that increments
 */
export function eventNameToTokenName(eventName: string): string {
  const base = eventName.replace(/[-_\s](.)/g, (_, c) => c.toUpperCase());
  return `${base}Token`;
}

/**
 * Generate useRefresh.ts content (trigger pattern, void payload)
 */
export function generateComposableContent(eventName: string): string {
  const composableName = eventNameToComposableName(eventName);
  const tokenName = eventNameToTokenName(eventName);

  return `import { ref } from 'vue'

const ${tokenName} = ref(0)

export function ${composableName}() {
  function trigger() {
    ${tokenName}.value++
  }

  return { ${tokenName}, trigger }
}
`;
}
