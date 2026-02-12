# Roadmap - vue-ai-migrator

## 🎯 Vision

Build a Vue 2 → Vue 3 migration tool that is **assisted, reliable, explainable and secure**, not a magic one-click migration.

## ✅ v0.5.0 - Complete MVP

## ✅ v0.6.x - Current (Core improvements, free mode by default)

### Implemented Features

- ✅ **Complete CLI** : `analyze`, `migrate`, `fix`, `report`, `plan`, `rollback`
- ✅ **AST Analysis** : Complete detection of Vue 2 patterns
- ✅ **Smart Classification** : 🟢 Simple / 🟡 Medium / 🔴 Complex
- ✅ **Advanced MigrationAgent** : Multi-providers, test generation, explanation
- ✅ **Prioritized Migration Plan** : Automatic generation with AI
- ✅ **Vitest Test Generation** : Automatic tests for migrated components
- ✅ **Diff with Justification** : Display changes with explanations
- ✅ **Dry-run Mode** : Test without modification
- ✅ **Detailed Reports** : JSON and Markdown with statistics
- ✅ **Syntax Validation** : Post-migration with suggestions
- ✅ **Hallucination Management** : Strict rules + AST validation
- ✅ **Security** : No execution without validation
- ✅ **Explicability** : Diff + justification for every change
- ✅ **TypeScript Support** : Automatic type annotations with `--typescript` flag
  - Typed props with interfaces for complex cases
  - Typed refs, computed, and reactive values
  - Typed function parameters and return types
  - Intelligent type inference from Vue 2 code

## 🚀 v0.6.0 - Core Improvements (Q1 2025)

### AI / Configuration

- [x] Free mode by default (AI opt-in with `--ai`)
- [x] Provider configurable via env `VUE_AI_MIGRATOR_AI_PROVIDER` (CLI > env > default openai)
- [x] Documentation: README, USAGE, API_KEYS updated (provider env, OpenAI-only note)

### Composition API Transformation Improvements

- [x] `data()` → `ref()`/`reactive()` transformation (composition-api.ts)
- [x] `computed` → `computed()` transformation
- [x] `methods` → functions transformation
- [x] `watch` → `watch()` transformation
- [x] Lifecycle hooks → `onMounted()`, etc. transformation
- [x] Handle `this.ident` in script setup → plain `ident` (storeScriptSetupRule)
- [x] provide/inject Options API → provide()/inject() Composition API
- [x] Computed getter/setter (writable computed) → computed({ get, set })
- [x] v-model proxy: this.$emit in computed setters → emit() (modelValue/update:modelValue pattern)
- [ ] Edge cases: improve coverage for remaining complex patterns

### Template Improvements

- [x] Slots: $scopedSlots → useSlots() (script), slot-scope/slot order (template)
- [x] Functional components: props→$props, attrs→$attrs, listeners removed
- [x] Custom directives: hooks, vnode.context→binding.instance, Vue.directive→app.directive, binding.expression warning
- [ ] Nested same-tag slots: `<div slot="x"><div>inner</div></div>` — known limitation (see README)

### Post-Migration Fixer

- [x] Rule engine as single fixer (legacy multi-pass removed)
- [x] storeScriptSetupRule: replace `this.method()` / `this.property` with plain identifier in script setup
- [x] routeQueryRedirectGuardRule registered (guard `route.query.redirect` with `typeof === 'string'`)
- [x] fixStoreMemberMismatchRule: fix missing store import insertion (script not starting with `import`)
- [x] fix command: re-run post-migration fixes without full migration (`vue-ai-migrator fix <path>`)
- [x] correctWrongStoreImportsRule / fixStoreMemberMismatchRule: no longer revert userStore→indexStore in detail views (fetchUser, etc.)
- [x] Import path fix: `@/store/index` (not `@/store/modules/index`) for index store
- [x] missingVueImportsRule: add lifecycle hooks (onMounted, onUnmounted, etc.) and reactive when used but not imported
- [x] E2E test: full migration flow (fixtures/vue2-minimal → migrate → fix → build)
- [x] Store imports: do not add imports for non-existent store modules (existingModules check)
- [x] Computed filtered: storeComputedRefMissingValueRule, storeComputedResultRule

### Performance

- [x] Regex cache and AST cache (single parse per file)
- [x] Parallel processing with batching (parallel-processor)
- [ ] Further cache optimization (improved incremental mode) if needed

## 🎨 v0.7.0 - Multi-Providers & LangChain (Q2 2025)

### Multi-Provider Support

- [ ] Complete Mistral API support
- [ ] Complete Claude/Anthropic API support
- [ ] LangChain JS support for action chaining
- [ ] Vercel AI SDK support for easy integration

### AI Agent Improvements

- [ ] Prompt chaining for complex migrations
- [ ] Contextual memory between files
- [ ] Project pattern learning
- [ ] Advanced refactoring suggestions

## 📊 v0.8.0 - Web Dashboard (Q3 2025)

### Web Dashboard (Optional)

- [ ] Web interface to visualize migration
- [ ] Progress charts
- [ ] Interactive transformation editing
- [ ] Before/after preview
- [ ] Visual conflict management

### Integrations

- [ ] VS Code plugin
- [ ] WebStorm/IntelliJ plugin
- [ ] GitHub Action
- [ ] GitLab CI/CD

## 🏗️ v0.9.0 - Monorepo Architecture (Q4 2025)

### Restructuring

- [ ] Migration to monorepo (Turbo/Nx)
- [ ] Separate packages: `core`, `ai-engine`, `cli`, `ui`
- [ ] Documented public API
- [ ] Plugin system for extensions

### Ecosystem

- [ ] Vue 2.7 support (Composition API)
- [ ] Nuxt 2 → Nuxt 3 support
- [ ] Quasar 1 → Quasar 2 support
- [ ] Migration templates for frameworks

## 🎯 v1.0.0 - Production Ready (2026)

### Quality & Performance

- [ ] 100% test coverage
- [ ] Documented performance benchmarks
- [ ] Complete API documentation
- [ ] Complete migration guide
- [ ] Tutorial videos

### Community

- [ ] Dedicated website
- [ ] Blog with use cases
- [ ] Discord/Slack for support
- [ ] Contributor program

## 🔮 Future (Post v1.0)

### Advanced Features

- [ ] Automatic third-party dependency migration
- [ ] Anti-pattern detection and migration
- [ ] Vue 3 optimization suggestions
- [x] Automatic TypeScript migration (completed in v0.5.0)
- [ ] Support for other frameworks (React, Angular)

### Intelligence

- [ ] Automatic pattern learning
- [ ] Personalized project suggestions
- [ ] Regression detection
- [ ] Post-migration performance analysis

## 📈 Success Metrics

### Technical

- ✅ 90%+ simple cases migrated automatically
- ✅ 80%+ medium cases migrated with validation
- ✅ 70%+ complex cases migrated with AI
- ✅ <5% post-migration regressions

### Community

- 🎯 1000+ GitHub stars
- 🎯 100+ migrated projects
- 🎯 50+ contributors
- 🎯 Complete documentation

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Current Priorities

1. Improve Composition API transformations
2. Add more tests
3. Document complex use cases
4. Optimize performance

## 📝 Notes

This roadmap is flexible and may evolve based on community needs and user feedback.
