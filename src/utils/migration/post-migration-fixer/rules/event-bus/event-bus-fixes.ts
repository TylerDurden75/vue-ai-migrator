/**
 * Event bus migration: composables (preferred) or mitt (fallback)
 * When eventBusClassification is set: composable for eligible events, mitt for others
 * Otherwise: mitt for all (legacy/standalone fix)
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";
import {
  eventNameToComposableName,
  eventNameToTokenName,
} from "../../../event-bus-composable";

const EVENT_BUS_IMPORT = "import { eventBus } from '@/event-bus';";

const BUS_PREFIX =
  /(?:this\.\$bus|\b(?:bus|eventBus|EventBus|globalBus)\b)\s*\.\s*\$/.source;

/** bus.$emit('X') - void payload */
const EMIT_VOID = new RegExp(
  `${BUS_PREFIX}emit\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)`,
  "g"
);
/** bus.$on('X',  - $once uses mitt for Phase 1 (watch once is complex) */
const ON_PREFIX = new RegExp(
  `${BUS_PREFIX}on\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*`,
  "g"
);
/** bus.$once('X',  - use mitt (composable watch+stop is complex) */
const ONCE_PREFIX = new RegExp(
  `${BUS_PREFIX}once\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*`,
  "g"
);
/** bus.$off('X') or bus.$off('X', handler) - use mitt */
const OFF_PREFIX = new RegExp(
  `${BUS_PREFIX}off\\s*\\(\\s*['"]([^'"]+)['"]\\s*`,
  "g"
);
/** bus.$emit('X', payload) - has payload, use mitt */
const EMIT_WITH_PAYLOAD = new RegExp(
  `${BUS_PREFIX}emit\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*`,
  "g"
);

function hasEventBusImport(content: string): boolean {
  return /import\s+.*\beventBus\b.*from\s+['"]@\/event-bus['"]/.test(content);
}

function hasWatchImport(content: string): boolean {
  return /import\s+.*\bwatch\b.*from\s+['"]vue['"]/.test(content);
}

function addImport(
  script: string,
  importLine: string,
  afterExisting: boolean = true
): string {
  if (script.includes(importLine)) return script;
  const firstImport = script.match(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?/m);
  if (firstImport && firstImport.index !== undefined && afterExisting) {
    const pos = firstImport.index + firstImport[0].length;
    return script.slice(0, pos) + "\n" + importLine + script.slice(pos);
  }
  return importLine + "\n" + script;
}

function extractScript(content: string): { fullMatch: string; script: string } | null {
  const match =
    content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/) ??
    content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  return match ? { fullMatch: match[0], script: match[1] } : null;
}

/** Detect event bus usage (used by migrator) */
export function hasEventBusUsage(content: string): boolean {
  return (
    content.includes("$bus.$on(") ||
    content.includes("$bus.$off(") ||
    content.includes("$bus.$once(") ||
    content.includes("$bus.$emit(") ||
    /\b(bus|eventBus|EventBus|globalBus)\.\$(on|off|once|emit)\(/.test(content)
  );
}

function isComposableEvent(
  eventName: string,
  classification: FixContext["eventBusClassification"]
): boolean {
  return !!classification?.composable?.has(eventName);
}

export const eventBusDetectionRule: FixRule = {
  id: "event-bus-detection",
  description: "Replace event bus with composables (when eligible) or mitt",
  priority: 55,

  shouldApply: (filePath, content) => {
    return (
      (filePath.endsWith(".vue") ||
        filePath.endsWith(".js") ||
        filePath.endsWith(".ts")) &&
      (content.includes("$bus.$") ||
        content.includes("bus.$") ||
        content.includes("eventBus.$") ||
        content.includes("EventBus.$") ||
        content.includes("globalBus.$"))
    );
  },

  apply: async (filePath, content, context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };

    const isVue = context.isVueFile;
    let script = content;
    let extracted: ReturnType<typeof extractScript> | null = null;

    if (isVue) {
      extracted = extractScript(content);
      if (!extracted) return result;
      script = extracted.script;
    }

    const classification = context.eventBusClassification;
    let modified = script;
    const composableImports = new Set<string>();
    let needsEventBus = false;
    let needsWatch = false;
    const changes: string[] = [];

    // Replace bus.$emit('X') - void, composable
    modified = modified.replace(EMIT_VOID, (_, eventName: string) => {
      if (isComposableEvent(eventName, classification)) {
        const comp = eventNameToComposableName(eventName);
        composableImports.add(comp);
        changes.push(`emit('${eventName}')→${comp}().trigger()`);
        return `${comp}().trigger()`;
      }
      needsEventBus = true;
      changes.push(`emit('${eventName}')`);
      return `eventBus.emit('${eventName}')`;
    });

    // Replace bus.$on('X', handler)
    modified = modified.replace(ON_PREFIX, (_, eventName: string) => {
      if (isComposableEvent(eventName, classification)) {
        const comp = eventNameToComposableName(eventName);
        const token = eventNameToTokenName(eventName);
        composableImports.add(comp);
        needsWatch = true;
        changes.push(`on('${eventName}')→watch`);
        return `watch(${comp}().${token}, `;
      }
      needsEventBus = true;
      changes.push(`on('${eventName}')`);
      return `eventBus.on('${eventName}', `;
    });

    // Replace bus.$once - always mitt (Phase 1)
    modified = modified.replace(ONCE_PREFIX, (_, eventName: string) => {
      needsEventBus = true;
      changes.push(`once('${eventName}')`);
      return `eventBus.once('${eventName}', `;
    });

    // Replace bus.$off - always mitt (composable events don't use $off in Phase 1)
    modified = modified.replace(OFF_PREFIX, (_, eventName: string) => {
      needsEventBus = true;
      changes.push(`off('${eventName}')`);
      return `eventBus.off('${eventName}'`;
    });

    // Replace bus.$emit('X', payload) - has payload, always mitt
    modified = modified.replace(EMIT_WITH_PAYLOAD, (_, eventName: string) => {
      needsEventBus = true;
      changes.push(`emit('${eventName}', payload)`);
      return `eventBus.emit('${eventName}', `;
    });

    if (modified === script) return result;

    // Add imports
    for (const comp of composableImports) {
      modified = addImport(
        modified,
        `import { ${comp} } from '@/composables/${comp}';`
      );
    }
    if (needsWatch && !hasWatchImport(modified)) {
      const vueImport = modified.match(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/);
      if (vueImport) {
        if (!/watch\b/.test(vueImport[1])) {
          modified = modified.replace(
            /import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/,
            (_, s) => `import { ${s.trim()}, watch } from 'vue'`
          );
        }
      } else {
        modified = addImport(modified, "import { watch } from 'vue';");
      }
    }
    if (needsEventBus && !hasEventBusImport(modified)) {
      modified = addImport(modified, EVENT_BUS_IMPORT);
    }

    if (isVue && extracted) {
      result.content = content.replace(
        extracted.fullMatch,
        extracted.fullMatch.replace(extracted.script, modified)
      );
    } else {
      result.content = modified;
    }

    result.fixed = true;
    result.fixes.push(
      `Event bus: ${[...new Set(changes)].slice(0, 3).join(", ")}${changes.length > 3 ? "…" : ""}`
    );

    return result;
  },
};
