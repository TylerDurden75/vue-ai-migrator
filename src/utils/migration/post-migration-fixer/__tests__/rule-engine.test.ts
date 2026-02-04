/**
 * Tests for rule engine
 */

import { RuleEngine } from "../rule-engine";
import type { FixRule } from "../types";

describe("RuleEngine", () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  describe("Rule Registration", () => {
    it("should register a single rule", () => {
      const rule: FixRule = {
        id: "test-rule",
        description: "Test rule",
        priority: 50,
        shouldApply: () => true,
        apply: async () => ({
          content: "",
          fixed: false,
          fixes: [],
          issues: []
        })
      };

      engine.registerRule(rule);
      const rules = engine.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("test-rule");
    });

    it("should register multiple rules", () => {
      const rules: FixRule[] = [
        {
          id: "rule-1",
          description: "Rule 1",
          priority: 50,
          shouldApply: () => true,
          apply: async () => ({ content: "", fixed: false, fixes: [], issues: [] })
        },
        {
          id: "rule-2",
          description: "Rule 2",
          priority: 40,
          shouldApply: () => true,
          apply: async () => ({ content: "", fixed: false, fixes: [], issues: [] })
        }
      ];

      engine.registerRules(rules);
      expect(engine.getRules()).toHaveLength(2);
    });
  });

  describe("Dependency Resolution", () => {
    it("should execute rules in dependency order", async () => {
      const executionOrder: string[] = [];

      const rule1: FixRule = {
        id: "rule-1",
        description: "Rule 1",
        priority: 50,
        shouldApply: () => true,
        apply: async () => {
          executionOrder.push("rule-1");
          return { content: "test", fixed: true, fixes: ["rule-1"], issues: [] };
        }
      };

      const rule2: FixRule = {
        id: "rule-2",
        description: "Rule 2",
        priority: 40,
        dependencies: ["rule-1"],
        shouldApply: () => true,
        apply: async () => {
          executionOrder.push("rule-2");
          return { content: "test", fixed: true, fixes: ["rule-2"], issues: [] };
        }
      };

      engine.registerRules([rule1, rule2]);
      await engine.execute("test.vue", "test", {
        enableTypeScript: false,
        isVueFile: true
      });

      expect(executionOrder).toEqual(["rule-1", "rule-2"]);
    });
  });

  describe("Priority Ordering", () => {
    it("should execute rules by priority (higher first)", async () => {
      const executionOrder: string[] = [];

      const rule1: FixRule = {
        id: "rule-1",
        description: "Rule 1",
        priority: 30,
        shouldApply: () => true,
        apply: async () => {
          executionOrder.push("rule-1");
          return { content: "test", fixed: true, fixes: ["rule-1"], issues: [] };
        }
      };

      const rule2: FixRule = {
        id: "rule-2",
        description: "Rule 2",
        priority: 50,
        shouldApply: () => true,
        apply: async () => {
          executionOrder.push("rule-2");
          return { content: "test", fixed: true, fixes: ["rule-2"], issues: [] };
        }
      };

      engine.registerRules([rule1, rule2]);
      await engine.execute("test.vue", "test", {
        enableTypeScript: false,
        isVueFile: true
      });

      expect(executionOrder).toEqual(["rule-2", "rule-1"]);
    });
  });

  describe("shouldApply Filtering", () => {
    it("should only apply rules that match shouldApply", async () => {
      const appliedRules: string[] = [];

      const rule1: FixRule = {
        id: "rule-1",
        description: "Rule 1",
        priority: 50,
        shouldApply: (filePath) => filePath.endsWith(".vue"),
        apply: async () => {
          appliedRules.push("rule-1");
          return { content: "test", fixed: true, fixes: ["rule-1"], issues: [] };
        }
      };

      const rule2: FixRule = {
        id: "rule-2",
        description: "Rule 2",
        priority: 40,
        shouldApply: (filePath) => filePath.endsWith(".ts"),
        apply: async () => {
          appliedRules.push("rule-2");
          return { content: "test", fixed: true, fixes: ["rule-2"], issues: [] };
        }
      };

      engine.registerRules([rule1, rule2]);
      await engine.execute("test.vue", "test", {
        enableTypeScript: false,
        isVueFile: true
      });

      expect(appliedRules).toEqual(["rule-1"]);
    });
  });
});
