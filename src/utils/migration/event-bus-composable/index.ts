/**
 * Event bus → composables migration
 * Analyzes usage, applies heuristics, generates composables, provides replacement data
 */

export { analyzeEventBusUsage, type EventBusUsage } from "./analyzer";
export { isEligibleForComposable, classifyEvents } from "./heuristics";
export {
  eventNameToComposableName,
  eventNameToTokenName,
  generateComposableContent,
} from "./composable-gen";

import type { EventBusUsage } from "./analyzer";
import { classifyEvents } from "./heuristics";

export interface EventBusClassification {
  composable: Set<string>;
  mitt: Set<string>;
}

// Cache: projectRoot -> classification (set by migrator before fix phase)
let classificationCache: EventBusClassification | null = null;
let classificationProjectRoot: string | null = null;

export function setEventBusClassification(
  projectRoot: string,
  classification: EventBusClassification
): void {
  classificationCache = classification;
  classificationProjectRoot = projectRoot;
}

export function getEventBusClassification(
  projectRoot?: string
): EventBusClassification | null {
  if (!projectRoot) return null;
  if (classificationCache && classificationProjectRoot === projectRoot) {
    return classificationCache;
  }
  return null;
}

export function clearEventBusClassification(): void {
  classificationCache = null;
  classificationProjectRoot = null;
}

export function buildClassification(
  usages: Map<string, EventBusUsage>
): EventBusClassification {
  return classifyEvents(usages);
}
