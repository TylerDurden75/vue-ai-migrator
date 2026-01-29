# CLI Screenshot - Help Command

## Command: `vue-ai-migrator --help`

```
$ vue-ai-migrator --help

Usage: vue-ai-migrator [options] [command]

Automatic Vue 2 → Vue 3 migration with codemods + AI combination

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  analyze <path>        Analyze a Vue 2 project
  migrate <path>        Migrate a Vue 2 project to Vue 3
  plan <projectPath>    Generate a prioritized migration plan
  report <report-file>  Generate detailed migration report
  rollback <path>       Rollback the last migration
  help [command]        display help for command
```

## Command: `vue-ai-migrator migrate --help`

```
$ vue-ai-migrator migrate --help

Usage: vue-ai-migrator migrate [options] <path>

Migrate a Vue 2 project to Vue 3

Arguments:
  path                       Path to the project to migrate

Options:
  -k, --ai-api-key <key>     API key for AI
  -p, --provider <provider>   AI provider (default: "openai")
  -d, --dry-run              Dry run mode
  --show-diff                Show detailed diff
  --generate-tests           Generate Vitest tests
  --no-ai                    Disable AI usage
  --transformations <list>   List of transformations
  --no-rollback              Disable automatic backups
  -o, --output <file>        Output file for report
  -h, --help                 display help for command
```
