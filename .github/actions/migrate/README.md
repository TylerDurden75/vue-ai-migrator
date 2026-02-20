# Vue AI Migrator - GitHub Action

Run [vue-ai-migrator](https://github.com/TylerDurden75/vue-ai-migrator) in your CI/CD pipeline to validate or migrate Vue 2 projects.

## Usage

### Basic - Dry run on every push

```yaml
name: Validate Vue migration
on: [push, pull_request]
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: TylerDurden75/vue-ai-migrator/.github/actions/migrate@main
        with:
          command: migrate
          dry-run: 'true'
```

### With custom path

```yaml
- uses: TylerDurden75/vue-ai-migrator/.github/actions/migrate@main
  with:
    command: migrate
    path: ./frontend
    dry-run: 'true'
```

### Analyze only (no migration)

```yaml
- uses: TylerDurden75/vue-ai-migrator/.github/actions/migrate@main
  with:
    command: analyze
    path: .
```

### Full migration with TypeScript and tests (use with caution)

```yaml
- uses: TylerDurden75/vue-ai-migrator/.github/actions/migrate@main
  with:
    command: migrate
    dry-run: 'false'
    typescript: 'true'
    generate-tests: 'true'
```

### With AI assistance (requires OPENAI_API_KEY secret)

```yaml
- uses: TylerDurden75/vue-ai-migrator/.github/actions/migrate@main
  with:
    command: migrate
    dry-run: 'true'
    ai: 'true'
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Pin to a specific version

```yaml
- uses: TylerDurden75/vue-ai-migrator/.github/actions/migrate@main
  with:
    version: '0.7.0'
    command: migrate
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `node-version` | Node.js version (16, 18, or 20). Use 18+ for Vue 3 + Vite. | `20` |
| `command` | `migrate`, `analyze`, `fix`, or `report` | `migrate` |
| `path` | Path to the Vue 2 project | `.` |
| `version` | vue-ai-migrator npm version | `latest` |
| `dry-run` | Preview only, no file changes | `true` |
| `ai` | Enable AI (needs OPENAI_API_KEY) | `false` |
| `typescript` | Add TypeScript annotations | `false` |
| `generate-tests` | Generate Vitest tests | `false` |
| `extra-args` | Additional CLI flags | `` |

## Node.js version

- **vue-ai-migrator** runs on Node 16+.
- **Migrated projects** (Vue 3 + Vite) require Node 18+. The migration sets `engines.node` in package.json.
- Use `node-version: '20'` (default) or `'18'` in the action. Match your project's `.nvmrc` or `package.json` engines if needed.

## Recommendations

- **CI**: Use `dry-run: 'true'` to validate the project can be migrated without modifying files.
- **Pin version**: Use `version: '0.7.0'` (or current) for reproducible builds.
- **Large projects**: Run `analyze` first to get a classification report.
