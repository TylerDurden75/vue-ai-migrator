# Post-Migration Fixer

## Overview

The post-migration fixer corrects common issues after the main migration (Vuex→Pinia, computed syntax, store dependencies, imports, etc.). It uses a **single-pass rule engine** (`post-migration-fixer/index.ts`) with parallel processing.

## Usage

No CLI flag needed — the fixer runs automatically after the main migration:

```bash
vue-ai-migrator migrate ./my-project
```

## Architecture

- **Rule engine** with dependency ordering (topological sort)
- **Single pass** per file, with parallel batch processing
- **Modular rules** in `post-migration-fixer/rules/` (store-fixes, router-fixes, template-fixes, etc.)

See [post-migration-fixer-architecture.md](./post-migration-fixer-architecture.md) for structure and conventions.
