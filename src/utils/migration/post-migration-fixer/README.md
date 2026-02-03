# Post-Migration Fixer

Fixes applied automatically after migration (imports, stores, router, template, etc.) via a single-pass rule engine.

**Notable rules** : `storeScriptSetupRule` (replaces `this.ident` with `ident` in script setup), `routeQueryRedirectGuardRule` (guards `route.query.redirect` with `typeof === 'string'`), `fixStoreMemberMismatchRule` (correct store for methods/props + add import), plus Vue/router/import rules.

Detailed architecture : [docs/internal/post-migration-fixer-architecture.md](../../../../docs/internal/post-migration-fixer-architecture.md) and [POST_MIGRATION_FIXER.md](../../../../docs/internal/POST_MIGRATION_FIXER.md).
