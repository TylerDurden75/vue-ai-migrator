# CLI Screenshot - Report Command

## Command: `vue-ai-migrator report`

```
$ vue-ai-migrator report migration-report.json

✔ Report loaded

📊 Migration Report

Summary:
  Total Files: 2
  Files Migrated: 2
  Files Skipped: 0

Classification:
  🟢 Simple: 0
  🟡 Medium: 2
  🔴 Complex: 0

Recommendations:
  • Review filter transformations in templates
  • Verify lifecycle hook migrations
  • Test component functionality after migration
```

## Command: `vue-ai-migrator report --format markdown`

```
$ vue-ai-migrator report migration-report.json --format markdown --output report.md

✔ Markdown report saved to report.md
```
