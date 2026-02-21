/**
 * Heuristics for event bus → composable eligibility
 * Phase 1: payload void only, < 3 listeners
 */

import type { EventBusUsage } from "./analyzer";

const MAX_LISTENERS_FOR_COMPOSABLE = 3;

/**
 * Event is eligible for composable (useX) if:
 * - < 3 listeners
 * - payload is void (no second argument to $emit)
 * - no $off with explicit handler for this event
 */
export function isEligibleForComposable(usage: EventBusUsage): boolean {
  if (usage.listeners >= MAX_LISTENERS_FOR_COMPOSABLE) {
    return false;
  }
  if (usage.payloadType !== "void") {
    return false;
  }
  if (usage.hasOffWithHandler) {
    return false;
  }
  if (usage.hasDynamicName) {
    return false;
  }
  return true;
}

export function classifyEvents(
  usages: Map<string, EventBusUsage>
): { composable: Set<string>; mitt: Set<string> } {
  const composable = new Set<string>();
  const mitt = new Set<string>();

  for (const [name, usage] of usages) {
    if (isEligibleForComposable(usage)) {
      composable.add(name);
    } else {
      mitt.add(name);
    }
  }

  return { composable, mitt };
}
