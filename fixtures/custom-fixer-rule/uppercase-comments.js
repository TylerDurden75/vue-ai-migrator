/**
 * Example custom rule for fixerRulesAdd - converts // TODO to // FIXME (demo only)
 * Export FixRule or FixRule[] for vue-migrator.config.js fixerRulesAdd
 */
module.exports = {
  id: "custom-uppercase-comments",
  description: "Custom rule: demo - replace TODO with FIXME in comments",
  priority: 50,
  shouldApply: (_filePath, content) => content.includes("// TODO"),
  apply: async (filePath, content) => {
    const fixed = content.replace(/\/\/ TODO/g, "// FIXME");
    return {
      content: fixed,
      fixed: fixed !== content,
      fixes: fixed !== content ? ["Replaced TODO with FIXME (custom rule)"] : [],
      issues: [],
    };
  },
};
