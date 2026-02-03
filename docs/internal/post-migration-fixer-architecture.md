# Post-Migration Fixer - Modular Architecture

## Current status

- **Single fixer** : `post-migration-fixer/index.ts` (rule engine, one pass, parallel processing). No legacy mode.

## Goal (achieved)
Reduce multiple passes and split the fixer into separate modules. The former monolithic fixer is now a single-pass rule engine with modular rules in `rules/`.

## Current structure

```
post-migration-fixer/
├── index.ts                    # Main entry point
├── types.ts                    # Types and interfaces
├── rule-engine.ts              # Optimized rule engine
├── rules/
│   ├── vue-script-setup.ts     # Script tag formatting, remove export default
│   ├── store-fixes.ts          # Pinia store fixes (async, duplicate keys, etc.)
│   ├── router-fixes.ts         # Vue Router fixes (createWebHistory, redirect guard, etc.)
│   ├── template-fixes.ts       # Template fixes (components, filters, v-model)
│   ├── import-fixes.ts         # Import fixes (Vuex removal, merge, store imports)
│   ├── computed-fixes.ts       # Computed syntax fixes
│   ├── type-fixes.ts          # TypeScript fixes
│   ├── final-fixes.ts         # Wrong store property, null checks, detail view
│   ├── store-script-setup-fixes.ts  # this. replacement, router/route, secure push, etc.
│   └── vue-store-vuex.ts       # this.$store → Pinia in components
└── utils/
    ├── store-analyzer.ts       # Store analysis
    ├── store-analysis-cache.ts
    ├── ast-cache.ts
    ├── parallel-processor.ts
    └── regex-cache.ts          # Regex cache
```

## Principle: Single optimized pass

Instead of 3 separate passes, use a rule system with dependencies:
- Rule A → Rule B → Rule C (in order)
- Each rule checks whether it should apply
- No re-parsing of the file between rules

## Performance

- Caching of compiled regex
- AST analysis once
- Parallel processing of independent files
- Early exit when no rule applies

## Genericity and conventions

Rules are designed to **work on any Vue 2 project migrated to Vue 3**, without configuration:

- **scriptSetupTagSpaceRule**, **storeDefineStoreClosingRule**, **destructuringKeyValueParamRule**, **splitImportsOnSameLineRule**, **replaceThisRouterRouteRule**, **vueStoreVuexToPiniaRule** : 100% generic (syntax only, no path or store name required).
- **storeIndexNamedExportRule** : applies only to `store/index.ts` or `store/index.js` files that use `defineStore("index", ...)`. No effect if the project has no index store.
- **templateFilterFunctionImportsRule** : filter import path is **detected** from the project (`src/filters`, `src/utils/filters`, etc.) via `projectRoot`. If no filter folder exists, fallback to `@/filters`.
- **routerGuardPiniaRule** : assumes auth state (e.g. `isAuthenticated`) is exposed by the **root store** (`@/store/index`, `useIndexStore`). This is the most common case (Vue 2 with a single store or root store). If the project uses a dedicated auth store (e.g. `useAuthStore` in `@/store/modules/auth`), a manual replacement after running the fixer is enough.
- **app.mixin** (in vue2GlobalApiRule) : removal or commenting of `app.mixin(xxx)` when the mixin is not imported (detection via analysis of non-commented lines).

In summary: **it works out of the box on any Vue project** that follows usual structures (index store, filters in `src/filters` or `src/utils/filters`, auth in root store). Atypical cases can still be fixed with a targeted manual replacement.
