# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
