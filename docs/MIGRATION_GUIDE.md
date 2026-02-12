# Vue 2 → Vue 3 Migration Guide

This guide clarifies Vue 2.7 support, the compat build workflow, and when to use vue-ai-migrator vs. gradual migration strategies.

---

## Vue 2.7 Support

### Is vue-ai-migrator compatible with Vue 2.7?

**Yes.** vue-ai-migrator supports both Vue 2.6 and Vue 2.7 projects.

| Vue version | Support | Notes |
|-------------|---------|-------|
| **Vue 2.6.x** | ✅ Full | Options API, Vuex, filters — all standard patterns |
| **Vue 2.7.x** | ✅ Full | Same as 2.6; Composition API & `<script setup>` backported in 2.7 are also migrated |

Vue 2.7 backported the Composition API and `<script setup>`. If your project already uses them, vue-ai-migrator will still transform components to **native Vue 3** format (e.g. `defineComponent` → script setup, Vue 2 reactivity APIs → Vue 3 equivalents).

### Vue 2.7-specific considerations

- **Already using Composition API**: The codemod normalizes to Vue 3 style (correct imports, `ref`/`reactive` usage).
- **Mix of Options API and Composition API**: Both are handled; the tool outputs consistent `<script setup>`.
- **Vue 2.7 reached EOL** (with Vue 2 on Dec 31, 2023): Migrating to Vue 3 is strongly recommended.

---

## Compat Build vs. Full Migration

### Two official approaches

| Approach | Tool | Output | Use case |
|----------|------|--------|----------|
| **Full migration** | vue-ai-migrator | Native Vue 3 code | One-time, project-wide migration |
| **Gradual migration** | `@vue/compat` (Migration Build) | Vue 2 code running in Vue 3 compat mode | Incremental, per-component migration |

### What vue-ai-migrator does

vue-ai-migrator performs a **full migration** and outputs **native Vue 3 code**:

- **No compat layer** — No `@vue/compat`, no runtime compatibility mode
- **Direct Vue 3** — Composition API, Pinia, Vue Router 4, Vite-compatible
- **Zero runtime overhead** — No migration-build warnings or compatibility layer

### When to use the compat build instead

Use the [Vue 3 Migration Build](https://v3-migration.vuejs.org/migration-build.html) (`@vue/compat`) if you prefer:

1. **Incremental migration** — Migrate component by component over time
2. **Large codebase** — You want the app running on Vue 3 first, then fix deprecation warnings gradually
3. **Third-party dependencies** — Some libs (e.g. older Vuetify, Quasar) rely on Vue 2 internals and may need time before full Vue 3 support

### Workflow comparison

```
┌─────────────────────────────────────────────────────────────────┐
│ vue-ai-migrator (Full Migration)                                 │
├─────────────────────────────────────────────────────────────────┤
│ Vue 2 project → migrate → Vue 3 project (native)                  │
│ • One-shot or staged (e.g. migrate folders incrementally)         │
│ • Run fix command for post-migration corrections                 │
│ • Build and deploy                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ @vue/compat (Gradual Migration)                                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. Switch to Vue 3 + @vue/compat                                 │
│ 2. App runs, deprecation warnings in console                     │
│ 3. Fix components one by one until no warnings                  │
│ 4. Remove @vue/compat → native Vue 3                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recommended Workflow with vue-ai-migrator

### Standard workflow (recommended)

```bash
# 1. Analyze
vue-ai-migrator analyze ./my-project --classify

# 2. Backup and migrate
git checkout -b vue3-migration
vue-ai-migrator migrate ./my-project

# 3. Apply post-migration fixes
vue-ai-migrator fix ./my-project

# 4. Install dependencies and build
cd my-project
npm install
npm run build

# 5. Manual review and fix remaining edge cases
```

### With Vue 2.7 projects

Same workflow. No special flags. The tool detects Vue 2 (including 2.7) and migrates accordingly.

### Using the compat build as a fallback

If a full migration is too risky (e.g. complex legacy app):

1. First try vue-ai-migrator on a **branch** with `--dry-run`
2. If the diff looks too large or risky, use [@vue/compat](https://v3-migration.vuejs.org/migration-build.html) for gradual migration
3. You can still use vue-ai-migrator to **migrate specific files** or folders while keeping compat for the rest

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [README.md](../README.md) | Overview, features, quick start |
| [USAGE.md](../USAGE.md) | Commands, configuration, examples |
| [docs/MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) | Vue 2.7, compat build, migration workflow |
| [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common errors and solutions |
| [API_KEYS.md](../API_KEYS.md) | AI provider configuration |
| [docs/ROADMAP.md](ROADMAP.md) | Planned features and roadmap |
