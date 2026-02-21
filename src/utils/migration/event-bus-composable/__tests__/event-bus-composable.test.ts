/**
 * Tests for event-bus-composable (analyzer, heuristics, composable-gen)
 */

import {
  analyzeEventBusUsage,
  isEligibleForComposable,
  classifyEvents,
  generateComposableContent,
  eventNameToComposableName,
  eventNameToTokenName,
} from "../index";

describe("analyzeEventBusUsage", () => {
  it("aggregates emitters and listeners by event name", () => {
    const files = [
      { filePath: "a.vue", content: "bus.$emit('refresh');" },
      { filePath: "b.vue", content: "bus.$on('refresh', fn);" },
      { filePath: "c.vue", content: "bus.$emit('refresh');" },
    ];
    const usages = analyzeEventBusUsage(files);
    const refresh = usages.get("refresh");
    expect(refresh).toBeDefined();
    expect(refresh!.emitters).toBe(2);
    expect(refresh!.listeners).toBe(1);
    expect(refresh!.payloadType).toBe("void");
  });

  it("marks payload as object when $emit has second arg", () => {
    const files = [{ filePath: "a.js", content: "bus.$emit('select', item);" }];
    const usages = analyzeEventBusUsage(files);
    const select = usages.get("select");
    expect(select!.payloadType).toBe("object");
  });

  it("detects $off with handler", () => {
    const files = [
      { filePath: "a.vue", content: "bus.$on('refresh', fn); bus.$off('refresh', this.fetch);" },
    ];
    const usages = analyzeEventBusUsage(files);
    const refresh = usages.get("refresh");
    expect(refresh!.hasOffWithHandler).toBe(true);
  });

  it("extracts script from Vue SFC", () => {
    const files = [
      {
        filePath: "Comp.vue",
        content: `<template></template>
<script>
bus.$emit('refresh');
</script>`,
      },
    ];
    const usages = analyzeEventBusUsage(files);
    expect(usages.get("refresh")).toBeDefined();
  });
});

describe("heuristics", () => {
  it("eligible: < 3 listeners, void payload, no $off", () => {
    const usage = {
      eventName: "refresh",
      emitters: 2,
      listeners: 1,
      payloadType: "void" as const,
      hasDynamicName: false,
      hasOffWithHandler: false,
    };
    expect(isEligibleForComposable(usage)).toBe(true);
  });

  it("not eligible: >= 3 listeners", () => {
    const usage = {
      eventName: "refresh",
      emitters: 1,
      listeners: 3,
      payloadType: "void" as const,
      hasDynamicName: false,
      hasOffWithHandler: false,
    };
    expect(isEligibleForComposable(usage)).toBe(false);
  });

  it("not eligible: object payload", () => {
    const usage = {
      eventName: "select",
      emitters: 1,
      listeners: 1,
      payloadType: "object" as const,
      hasDynamicName: false,
      hasOffWithHandler: false,
    };
    expect(isEligibleForComposable(usage)).toBe(false);
  });

  it("classifyEvents splits composable vs mitt", () => {
    const usages = new Map();
    usages.set("refresh", {
      eventName: "refresh",
      emitters: 1,
      listeners: 1,
      payloadType: "void" as const,
      hasDynamicName: false,
      hasOffWithHandler: false,
    });
    usages.set("select", {
      eventName: "select",
      emitters: 1,
      listeners: 5,
      payloadType: "void" as const,
      hasDynamicName: false,
      hasOffWithHandler: false,
    });
    const { composable, mitt } = classifyEvents(usages);
    expect(composable.has("refresh")).toBe(true);
    expect(mitt.has("select")).toBe(true);
  });
});

describe("composable-gen", () => {
  it("generates useRefresh content", () => {
    const content = generateComposableContent("refresh");
    expect(content).toContain("useRefresh");
    expect(content).toContain("refreshToken");
    expect(content).toContain("trigger()");
    expect(content).toContain("ref(0)");
  });

  it("eventNameToComposableName", () => {
    expect(eventNameToComposableName("refresh")).toBe("useRefresh");
    expect(eventNameToComposableName("data-updated")).toBe("useDataUpdated");
  });

  it("eventNameToTokenName", () => {
    expect(eventNameToTokenName("refresh")).toBe("refreshToken");
  });
});
