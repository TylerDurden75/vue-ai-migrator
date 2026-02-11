/**
 * Rules for detecting and suggesting migration of Vue 2 event bus ($on/$off/$once)
 * Vue 3 removed instance event API - use mitt, tiny-emitter, or provide/inject
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";

/**
 * Detect event bus usage ($on, $off, $once) and add migration suggestion.
 * Does not auto-fix - migration to mitt/provide-inject is context-dependent.
 */
export const eventBusDetectionRule: FixRule = {
  id: "event-bus-detection",
  description: "Detect $on/$off/$once (event bus) and suggest mitt or provide/inject migration",
  priority: 50,
  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith(".vue") || filePath.endsWith(".js") || filePath.endsWith(".ts")) &&
      (content.includes("$on(") || content.includes("$off(") || content.includes("$once("))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };

    const suggestions: string[] = [];
    if (content.includes("$on(")) suggestions.push("$on");
    if (content.includes("$off(")) suggestions.push("$off");
    if (content.includes("$once(")) suggestions.push("$once");

    if (suggestions.length > 0) {
      result.issues.push(
        `Event bus detected (${suggestions.join(", ")}). Vue 3 no longer supports instance event API. ` +
          `Suggested migration: mitt (npm i mitt) or provide/inject for component communication. ` +
          `See: https://v3-migration.vuejs.org/breaking-changes/events-api.html`
      );
    }

    return result;
  },
};
