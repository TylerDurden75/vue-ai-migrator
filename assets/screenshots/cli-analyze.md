# CLI Screenshot - Analyze Command

## Command: `vue-ai-migrator analyze`

```
$ vue-ai-migrator analyze ./test-project

✔ Analyzing project...
✔ Analysis completed!

📊 Project Analysis:
  Vue Version: 2.7.14
  Vue Files Found: 2
  Total Files: 2

📋 Detected Patterns:
  - Options API components
  - Filters in templates
  - Lifecycle hooks (mounted)
  - Props definitions

🎯 Migration Complexity: Medium
  Estimated time: 15-30 minutes
```

## Command: `vue-ai-migrator analyze --classify`

```
$ vue-ai-migrator analyze ./test-project --classify

✔ Analyzing project...
✔ Classification completed!

📋 File Classification:
  🟢 Simple: 0
  🟡 Medium: 2
  🔴 Complex: 0

  Sample classifications:
    🟡 HelloWorld.vue: medium
      Reasons: filters, lifecycle hooks
    🟡 App.vue: medium
      Reasons: component imports
```
