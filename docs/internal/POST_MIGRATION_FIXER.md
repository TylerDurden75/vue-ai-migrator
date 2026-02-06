# Post-Migration Fixer

## Overview

The post-migration fixer corrects common issues after the main migration (Vuex→Pinia, computed syntax, store dependencies, imports, etc.). It uses a **single-pass rule engine** (`post-migration-fixer/index.ts`) with parallel processing.

## Usage

No CLI flag needed — the fixer runs automatically after the main migration:

```bash
vue-ai-migrator migrate ./my-project
```

Or run fixes only on an already-migrated project:

```bash
vue-ai-migrator fix ./my-project
```

## Architecture

- **Rule engine** with dependency ordering (topological sort)
- **Single pass** per file, with parallel batch processing
- **Modular rules** in `post-migration-fixer/rules/` (store-fixes, router-fixes, template-fixes, etc.)

## Rules Reference (Generic)

All rules are designed to work on **any Vue 2 project** without configuration. They detect patterns dynamically.

### Store fixes (`store-fixes.ts`)

| Rule | Description | Genericity |
|------|-------------|------------|
| `storeAddMissingAuthMethodsRule` | Adds no-op methods (fetchCurrentUser, etc.) when **called in project** but missing from store | Scans project for `storeVar.methodName()` calls |
| `storeIndexNamedExportRule` | Adds useIndexStore export to store/index | Applies only to store/index.js or store/index.ts |
| `storeCreateStoreToUseIndexRule` | createStore() → useIndexStore() | Generic |
| `fixStoreMemberMismatchRule` | Corrects storeVar.method when method belongs to different store | Uses store analysis (any project structure) |

### Store script setup (`store-script-setup-fixes.ts`)

| Rule | Description | Genericity |
|------|-------------|------------|
| `getStoreVarFromScript` | Detects store variable from `const X = useYStore()` | Prefers indexStore, store, mainStore; falls back to first found |
| `thisStoreToIndexStoreRule` | this.$store → storeVar | Uses getStoreVarFromScript |
| `storeRefsFromIndexStoreRule` | lists/itemsPerPage → storeVar.lists/itemsPerPage | Uses getStoreVarFromScript |
| `indexStoreDuplicateRule` | storeVar.storeVar.X → storeVar.X | Generic (any duplicate) |
| `returnThisInScriptSetupRule` | return this → api + defineExpose | Generic (method chaining) |

### Template fixes (`template-fixes.ts`)

| Rule | Description | Genericity |
|------|-------------|------------|
| `routerLinkUserContentRule` | router-link to user: username in link, timeAgo in "ago" part | Generic (item, comment, user, etc.) |
| `templateFilterFunctionImportsRule` | Adds filter imports | Detects path from project (src/filters, src/util/filters) |

### SSR fixes (`ssr-fixes.ts`)

| Rule | Description | Genericity |
|------|-------------|------------|
| `listsPropsGuardRule` | storeVar.lists[props.X] ?? [] | Generic (any store variable) |

## Conventions

- **No hardcoded store names**: Use `getStoreVarFromScript()` or store analysis
- **No hardcoded paths**: Detect from `projectRoot` (filters, store modules)
- **Add only when needed**: e.g. storeAddMissingAuthMethodsRule scans project before adding

See [post-migration-fixer-architecture.md](./post-migration-fixer-architecture.md) for structure.
