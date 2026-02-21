/**
 * Event bus usage analyzer - scans files for bus.$emit/$on/$once patterns
 * Aggregates by event name for heuristics (composable vs mitt)
 */

export interface EventBusUsage {
  eventName: string;
  emitters: number;
  listeners: number;
  /** Phase 1: void only. Phase 2: primitive. */
  payloadType: "void" | "primitive" | "object" | "unknown";
  hasDynamicName: boolean;
  hasOffWithHandler: boolean;
}

const BUS_PREFIX =
  /(?:this\.\$bus|\b(?:bus|eventBus|EventBus|globalBus)\b)\s*\.\s*\$/;

/** Match bus.$emit('X') or bus.$emit("X") - static name, captures X */
const EMIT_STATIC = new RegExp(
  BUS_PREFIX.source + "emit\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)",
  "g"
);
/** Match bus.$emit('X', ...) - has payload */
const EMIT_WITH_PAYLOAD = new RegExp(
  BUS_PREFIX.source + "emit\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*,\\s*[^)]+\\)",
  "g"
);

/** Match bus.$on('X', ...) or bus.$once('X', ...) */
const ON_STATIC = new RegExp(
  BUS_PREFIX.source + "(?:on|once)\\s*\\(\\s*['\"]([^'\"]+)['\"]",
  "g"
);

/** Match bus.$off('X', handler) - off with explicit handler */
const OFF_WITH_HANDLER = new RegExp(
  BUS_PREFIX.source + "off\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*,\\s*[^)]+\\)",
  "g"
);

function hasOffWithHandler(content: string): Set<string> {
  const events = new Set<string>();
  let m: RegExpExecArray | null;
  const r = new RegExp(OFF_WITH_HANDLER.source, OFF_WITH_HANDLER.flags);
  while ((m = r.exec(content)) !== null) {
    events.add(m[1]);
  }
  return events;
}

/**
 * Analyze event bus usage across file contents
 */
export function analyzeEventBusUsage(
  fileContents: Array<{ filePath: string; content: string }>
): Map<string, EventBusUsage> {
  const byEvent = new Map<string, EventBusUsage>();
  const offWithHandlerEvents = new Set<string>();

  for (const { content } of fileContents) {
    const script = extractScriptContent(content);
    if (!script) continue;

    // Emitters - static, void (no payload)
    let m: RegExpExecArray | null;
    const emitStatic = new RegExp(EMIT_STATIC.source, EMIT_STATIC.flags);
    while ((m = emitStatic.exec(script)) !== null) {
      const name = m[1];
      const cur = byEvent.get(name) ?? {
        eventName: name,
        emitters: 0,
        listeners: 0,
        payloadType: "void" as const,
        hasDynamicName: false,
        hasOffWithHandler: false,
      };
      cur.emitters++;
      byEvent.set(name, cur);
    }

    // Emitters - with payload
    const emitPayload = new RegExp(EMIT_WITH_PAYLOAD.source, EMIT_WITH_PAYLOAD.flags);
    while ((m = emitPayload.exec(script)) !== null) {
      const name = m[1];
      const cur = byEvent.get(name) ?? {
        eventName: name,
        emitters: 0,
        listeners: 0,
        payloadType: "object" as const,
        hasDynamicName: false,
        hasOffWithHandler: false,
      };
      cur.emitters++;
      cur.payloadType = "object";
      byEvent.set(name, cur);
    }

    // Listeners - static
    const onStatic = new RegExp(ON_STATIC.source, ON_STATIC.flags);
    while ((m = onStatic.exec(script)) !== null) {
      const name = m[1];
      const cur = byEvent.get(name) ?? {
        eventName: name,
        emitters: 0,
        listeners: 0,
        payloadType: "void" as const,
        hasDynamicName: false,
        hasOffWithHandler: false,
      };
      cur.listeners++;
      byEvent.set(name, cur);
    }

    // $off with handler
    const offHandler = hasOffWithHandler(script);
    offHandler.forEach((e) => offWithHandlerEvents.add(e));
  }

  // Apply offWithHandler
  offWithHandlerEvents.forEach((name) => {
    const u = byEvent.get(name);
    if (u) u.hasOffWithHandler = true;
  });

  return byEvent;
}

function extractScriptContent(content: string): string | null {
  const match =
    content.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/) ??
    content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (match) return match[1];
  // Plain .js/.ts - use full content
  return content;
}
