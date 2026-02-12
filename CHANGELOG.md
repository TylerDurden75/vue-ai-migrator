# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.8] - 2025-02-12

### Added

- **provide/inject Composition API**: Full transformation from Options API to `<script setup>` pattern
  - `inject: ['theme', 'locale']` → `const theme = inject('theme'); const locale = inject('locale')`
  - `inject: { local: 'remoteKey' }` and `inject: { local: { from: 'key', default: val } }` → `inject('key', val)`
  - **Default factory**: `inject: { theme: { from: 'theme', default: () => 'light' } }` → `inject('theme', () => 'light', true)`
  - `provide: { theme: 'dark' }` → `provide('theme', 'dark')`
  - `provide() { return { theme: this.theme } }` → `provide('theme', theme)` (reactive ref from data)
  - `this.injectedKey` → direct `injectedKey` in transformed code
- **Computed getter/setter**: Writable computed `computed: { fullName: { get(), set(v) } }` → `computed({ get: () => ..., set: (v) => ... })`
- **Functional components**: `props` → `$props` in addition to `attrs` → `$attrs`, `v-bind="props"` → `v-bind="$props"`
- **Directives**: Improved `binding.expression` warning — suggests `binding.value` (evaluated result) as primary replacement
- **bindingExpressionDirectiveRule**: Post-migration warning when `binding.expression` is used (removed in Vue 3)
- **v-model proxy pattern**: `this.$emit` in computed setters → `emit()` (computed get/set with modelValue/update:modelValue)
- **Test**: v-model proxy (computed get/set with emit) transformation

### Changed

- **README**: Documented full directive coverage, provide/inject, writable computed; added nested slots limitation
- **ROADMAP**: Marked provide/inject, computed get/set, directives, functional components as complete
- **Test count**: 620 unit tests

---

## [0.6.5] - 2025-02-XX

### Added

- **docs/MIGRATION_GUIDE.md**: Vue 2.7 support, compat build vs full migration, recommended workflow — linked from README and USAGE
- **Documentation index**: Centralized doc navigation in README and docs/README.md

### Fixed

- **vue-script-setup**: `prefer-const` and remove unused variable (lint)

---

## [0.6.4] - 2025-02-XX

### Added

- **Vuex → Pinia (root store)**: `mapState(['count'])` and `mapActions(['increment'])` with single argument now transform to Pinia `useIndexStore` (store/index.js → useIndexStore, aligns with fixer)
- **Export Pinia root store**: `export default new Vuex.Store()` in store/index.js now becomes `export const useIndexStore = defineStore('index', ...)` for component imports
- **Configuration**: `fixerRulesAdd` option to load custom post-migration fixer rules from project paths
- **Fixture**: `fixtures/custom-fixer-rule` demonstrating custom rule (TODO → FIXME) and config

### Fixed

- **vuex-pinia-components**: Remove unused Vuex import after mapState/mapActions transformation (no more stale `import { mapState, mapActions } from 'vuex'`)
- **Root store naming**: store/index.js now exports `useIndexStore` (was `useStoreStore`) to align with post-migration fixer and vue-hackernews
- **vue-parser**: HTML elements (button, div, span, etc.) no longer mistaken for custom blocks (fixes slot-scope migration crash)

### Changed

- **store/index.js migration**: Root store now exports named `useIndexStore` (aligns with fixer, vue-hackernews)

## [0.6.2] - 2025-02-XX

### Fixed

- **Post-migration fixer**: Resolved conflicting rules for detail views (e.g. `UserDetail.vue`)
  - `correctWrongStoreImportsRule` no longer replaces `useUserStore` with `useIndexStore` when the component uses methods exclusive to the module (e.g. `fetchUser`)
  - `fixStoreMemberMismatchRule` no longer replaces `userStore.loading`/`currentUser` with `indexStore` when the component uses `userStore.fetchUser` (or similar fetch-by-id methods)
- **Import paths**: Corrected index store import path from `@/store/modules/index` to `@/store/index` in both fixer rules
- **Lint**: Fixed unused variable in `final-fixes.test.ts`

### Added

- **Documentation**: `fix` command documented in [USAGE.md](./USAGE.md) (re-run post-migration fixes without full migration)
- **Known limitations**: Documented Vuex split structure and functional components in Troubleshooting
- **missingVueImportsRule**: Now adds lifecycle hooks (onMounted, onUnmounted, onBeforeMount, etc.) and reactive when used but not imported from vue
- **`--validate` option**: Run `npm run build` after `migrate` or `fix` to verify the project compiles (exits with error code if build fails)
- **Configuration (vue-migrator.config.js)**: Enriched with `storePaths`, `fixerRulesEnable`, `fixerRulesDisable`; `ignore` patterns now applied to migrate and fix commands

## [0.6.0] - 2025-01-XX

### 🎉 Major Changes

- **🆓 Free Mode by Default**: AI is now **opt-in** instead of opt-out. No API key required for basic migrations!
  - AST transformations work without any API key
  - Use `--ai` flag to enable AI assistance for complex cases
  - Reduces barrier to entry and makes the tool accessible to everyone

### Added

- **Free Mode**: Run migrations without API keys using AST transformations only
- **`--ai` / `--use-ai` flag**: Explicitly enable AI assistance (requires API key)
- **`VUE_AI_MIGRATOR_AI_PROVIDER`**: Environment variable to set AI provider (CLI > env > default `openai`) without `--provider`
- **Post-migration fixer**: `storeScriptSetupRule` now **replaces** `this.method()` / `this.property` with plain identifiers in `<script setup>` (no longer detection-only)
- **Post-migration fixer**: `routeQueryRedirectGuardRule` registered in pipeline (guards `route.query.redirect` with `typeof === 'string'`)
- **Improved user messages**: Clear indication of which mode is being used
- **Better error handling**: Graceful fallback when AI is requested but no key is provided

### Changed

- **Default behavior**: `useAI` is now `false` by default (was `true`)
- **CLI options**: `--no-ai` is now the default behavior (still available for explicit disabling)
- **Documentation**: Updated README to emphasize free mode and make AI optional

### Improved

- **User experience**: Clearer messaging about free vs AI-assisted mode
- **Adoption**: Lower barrier to entry - no API key needed to get started
- **Positioning**: Better market positioning as "free by default" tool

## [0.5.0] - 2025-01-28

### Added

- **Migration Classification System**: Automatic classification of migration complexity (🟢 Simple / 🟡 Medium / 🔴 Complex)
- **Advanced AI Agent**: Multi-provider AI agent (OpenAI, Mistral, Claude) with intelligent migration assistance
- **Test Generation**: Automatic Vitest test generation for migrated components
- **Diff System**: Enhanced dry-run mode with detailed diff visualization
- **Enhanced Reporting**: Comprehensive migration reports with classification statistics and recommendations
- **CLI Improvements**: New `report` command and enhanced `analyze --classify` command
- **Migration Agent**: Advanced AI agent with test generation, explanation, and migration planning capabilities

### Improved

- **Dry-run Mode**: Now shows detailed diffs for each file before migration
- **Analysis**: Enhanced project analysis with complexity classification
- **Documentation**: Updated README and usage guides with new features

## [0.4.0] - 2025-01-XX

### Added

- **Integration tests**: Complete tests for `.vue` files with parsing and transformation
- **Package.json migration**: Automatic dependency migration (Vue 2→3, Router 3→4, Vuex→Pinia)
- **Mixins support**: Transformation and detection of Vue 2 mixins
- **Plugins support**: Transformation Vue.use() → app.use()
- **Custom directives**: Transformation of directive hooks (bind → beforeMount, etc.)
- **Provide/Inject**: Detection and suggestions for Vue 3 improvements
- **Post-migration validation**: Automatic validation of migrated code with suggestions
- **Persistent cache**: Cache system with disk storage for incremental migrations
- **Incremental mode**: Process only modified files for faster migrations
- **Enhanced rollback**: Rollback system with individual file support

### Improved

- **Performance**: Persistent cache avoids reprocessing unchanged files
- **Reporting**: Detailed reports with post-migration suggestions
- **Documentation**: README updated with all new features

## [0.3.0] - 2025-01-XX

### Added

- **Vue SFC support**: Complete parser for SFC files (template, script, style)
- **Template transformations**: Slots, scoped slots, filters, $listeners in templates
- **Router transformations**: Complete Vue Router 3 → 4 migration
- **Vuex→Pinia transformations**: Complete store migration
- **Rollback system**: Automatic backup and file restoration

## [0.1.0] - 2024-11-27

### Added

- Initial release of vue-ai-migrator
- Automatic Vue 2 to Vue 3 migration with codemods
- AI integration (OpenAI) for complex migration cases
- Parallel file processing for improved performance (~10x faster)
- Comprehensive error handling with retry logic
- CLI with `migrate` and `analyze` commands
- Programmatic API for integration
- Support for multiple transformations:
  - Options API → Composition API
  - Global API (`new Vue()` → `createApp()`)
  - Filters removal
  - v-model Vue 2 → Vue 3
  - Event API ($on/$off/$once)
- Project analysis without migration
- Detailed migration reports
- Dry-run mode for testing
- 23+ unit tests with ~85% code coverage
- Complete documentation (README, USAGE, EXAMPLES)

### Features

- **Codemods**: Automatic code transformations using jscodeshift
- **AI Integration**: OpenAI GPT-4 for complex migration cases
- **Error Handling**: Typed errors, retry logic, input validation
- **Performance**: Batch parallel processing (10 files at a time)
- **Security**: Path validation, protection against path traversal
- **Testing**: Comprehensive test suite covering all modules
