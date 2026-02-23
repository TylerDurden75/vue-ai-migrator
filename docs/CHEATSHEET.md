# vue-ai-migrator — Cheat Sheet

Quick reference for the most used CLI options.

## Commands

| Command | Description |
|---------|-------------|
| `vue-ai-migrator analyze <path>` | Analyze project, detect Vue 2 patterns |
| `vue-ai-migrator migrate <path>` | Run full migration |
| `vue-ai-migrator fix <path>` | Re-apply post-migration fixes only |
| `vue-ai-migrator rollback <path>` | Restore from backup |
| `vue-ai-migrator plan <path>` | Generate AI migration plan (requires `--ai`) |

## migrate — Most Used Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without modifying files |
| `--show-diff` | Show diff per file (use with `--dry-run`) |
| `--ai` | Enable AI for complex cases (requires `OPENAI_API_KEY`) |
| `--typescript` | Add TypeScript types to migrated code |
| `--install` | Run `npm install` after migration |
| `--clean-install` | Remove `node_modules` + lockfile, then install |
| `--validate` | Run `npm run build` after migration (fails if build fails) |
| `--generate-tests` | Generate Vitest tests for migrated components |
| `--no-rollback` | Disable automatic backups |
| `-o, --output <file>` | Save migration report to file |
| `--transformations <list>` | Limit to specific transforms (e.g. `vuex-pinia`) |

## Examples

```bash
# Safe preview
vue-ai-migrator migrate ./my-project --dry-run --show-diff

# Full migration with TypeScript
vue-ai-migrator migrate ./my-project --typescript --clean-install

# Migrate only Vuex stores
vue-ai-migrator migrate ./src/store --transformations vuex-pinia

# With AI for complex files
export OPENAI_API_KEY=sk-...
vue-ai-migrator migrate ./my-project --ai

# Fix post-migration issues (e.g. store references)
vue-ai-migrator fix ./my-project --typescript
```

## analyze — Options

| Option | Description |
|--------|-------------|
| `--classify` | Show Simple/Medium/Complex per file |
| `--output <file>` | Save analysis to file |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for `--ai` mode |
| `VUE_AI_MIGRATOR_AI_PROVIDER` | AI provider: `openai`, `mistral`, `claude` |

## Alias

Use `vam` instead of `vue-ai-migrator`:

```bash
vam migrate ./my-project --dry-run
```
