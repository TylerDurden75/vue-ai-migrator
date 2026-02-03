# Post-Migration Fixer - Two Modes

## Overview

The post-migration fixer corrects common issues after the main migration (Vuex→Pinia, computed syntax, store dependencies, etc.). Two implementations exist:

| Mode | File | CLI Flag | Status |
|------|------|----------|--------|
| **Legacy** | `post-migration-fixer-multi-pass.ts` | `--legacy` | ✅ Stable, recommended |
| **Optimized** | `post-migration-fixer/index.ts` (rule engine) | default | 🔄 Being stabilized |

## Recommended Usage

```bash
vue-ai-migrator migrate ./my-project --legacy
```

## Why Two Modes?

- **Legacy**: Multi-pass system, battle-tested, handles edge cases
- **Optimized**: Single-pass rule engine, modular, faster — but has known issues to fix

## Fixes Applied (Optimized)

- **piniaStoreCrossStoreDepsRule**: No longer depends on `getStoreMethodMap` (disk read). Now infers module from store var (userStore → user) - works regardless of file processing order.

## Roadmap

See [ROADMAP.md](../ROADMAP.md) - Post-Migration Fixer section for stabilization tasks.
