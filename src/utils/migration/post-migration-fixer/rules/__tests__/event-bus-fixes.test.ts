/**
 * Tests for event-bus migration rule ($bus/bus/eventBus → mitt)
 * Never replaces this.$emit (Vue component emit)
 */

import {
  eventBusDetectionRule,
  hasEventBusUsage,
} from "../event-bus/event-bus-fixes";

const baseContext = {
  enableTypeScript: false,
  isVueFile: false,
};

describe("eventBusDetectionRule", () => {
  it("replaces this.$bus.$on with eventBus.on and adds import", async () => {
    const content = `<script>
export default {
  mounted() {
    this.$bus.$on('custom', this.handler);
  },
};
</script>`;
    const result = await eventBusDetectionRule.apply("src/Comp.vue", content, {
      ...baseContext,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("eventBus.on(");
    expect(result.content).not.toContain("this.$bus.$on(");
    expect(result.content).toContain("import { eventBus } from '@/event-bus';");
  });

  it("replaces this.$bus.$off with eventBus.off", async () => {
    const content = `<script>
export default {
  beforeUnmount() {
    this.$bus.$off('custom');
  },
};
</script>`;
    const result = await eventBusDetectionRule.apply("src/Foo.vue", content, {
      ...baseContext,
      isVueFile: true,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("eventBus.off(");
    expect(result.content).not.toContain("$bus.$off");
  });

  it("replaces bus.$once with eventBus.once", async () => {
    const content = `bus.$once('done', () => {});`;
    const result = await eventBusDetectionRule.apply("src/util/bus.js", content, baseContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("eventBus.once(");
  });

  it("replaces bus.$emit with eventBus.emit", async () => {
    const content = `bus.$emit('event', data);`;
    const result = await eventBusDetectionRule.apply("src/event.js", content, baseContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("eventBus.emit(");
  });

  it("replaces eventBus.$on (legacy var name) with new eventBus", async () => {
    const content = `eventBus.$on('x', fn);`;
    const result = await eventBusDetectionRule.apply("src/bar.js", content, baseContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("eventBus.on(");
  });

  it("replaces globalBus.$emit with eventBus.emit", async () => {
    const content = `globalBus.$emit('notify');`;
    const result = await eventBusDetectionRule.apply("src/notify.js", content, baseContext);
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("eventBus.emit(");
  });

  it("does NOT replace this.$emit (Vue component emit)", async () => {
    const content = `<script>
export default {
  methods: {
    submit() { this.$emit('submit', this.form); }
  },
};
</script>`;
    const result = await eventBusDetectionRule.apply("src/Form.vue", content, {
      ...baseContext,
      isVueFile: true,
    });
    expect(result.fixed).toBe(false);
    expect(result.content).toContain("this.$emit(");
  });

  it("does NOT replace this.$on (component instance)", async () => {
    const content = `this.$on('custom', handler);`;
    const result = await eventBusDetectionRule.apply("src/Comp.vue", content, baseContext);
    expect(result.fixed).toBe(false);
    expect(result.content).toContain("this.$on(");
  });

  it("does not add duplicate import when eventBus import exists", async () => {
    const content = `import { eventBus } from '@/event-bus';
bus.$on('x', fn);
`;
    const result = await eventBusDetectionRule.apply("src/bar.js", content, baseContext);
    expect(result.fixed).toBe(true);
    const importCount = (result.content.match(/import\s+.*eventBus.*from\s+['"]@\/event-bus['"]/g) || []).length;
    expect(importCount).toBe(1);
  });

  it("does not apply when no event bus usage", () => {
    expect(eventBusDetectionRule.shouldApply("src/foo.vue", "const x = 1;")).toBe(false);
  });

  it("applies when $bus or bus var used", () => {
    expect(eventBusDetectionRule.shouldApply("src/foo.vue", "this.$bus.$on('e', f)")).toBe(true);
    expect(eventBusDetectionRule.shouldApply("src/bar.js", "bus.$emit('x')")).toBe(true);
  });

  it("applies when eventBus or globalBus used", () => {
    expect(eventBusDetectionRule.shouldApply("src/a.js", "eventBus.$on('e')")).toBe(true);
    expect(eventBusDetectionRule.shouldApply("src/b.js", "globalBus.$emit('x')")).toBe(true);
  });

  it("replaces bus.$emit('refresh') with useRefresh().trigger() when composable eligible", async () => {
    const content = `bus.$emit('refresh');`;
    const result = await eventBusDetectionRule.apply("src/bar.js", content, {
      ...baseContext,
      eventBusClassification: {
        composable: new Set(["refresh"]),
        mitt: new Set(),
      },
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("useRefresh().trigger()");
    expect(result.content).toContain("import { useRefresh } from '@/composables/useRefresh'");
  });

  it("replaces bus.$on('refresh', fn) with watch when composable eligible", async () => {
    const content = `<script setup>
bus.$on('refresh', fetchData);
</script>`;
    const result = await eventBusDetectionRule.apply("src/Foo.vue", content, {
      ...baseContext,
      isVueFile: true,
      eventBusClassification: {
        composable: new Set(["refresh"]),
        mitt: new Set(),
      },
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("watch(useRefresh().refreshToken,");
    expect(result.content).toContain("import { watch }");
  });
});

describe("hasEventBusUsage", () => {
  it("returns true for this.$bus and bus patterns", () => {
    expect(hasEventBusUsage("this.$bus.$on('e')")).toBe(true);
    expect(hasEventBusUsage("bus.$emit('x')")).toBe(true);
    expect(hasEventBusUsage("eventBus.$once('d')")).toBe(true);
  });

  it("returns false for this.$emit and this.$on", () => {
    expect(hasEventBusUsage("this.$emit('submit')")).toBe(false);
    expect(hasEventBusUsage("this.$on('e', fn)")).toBe(false);
  });

  it("returns false when no bus usage", () => {
    expect(hasEventBusUsage("const x = 1")).toBe(false);
  });
});
