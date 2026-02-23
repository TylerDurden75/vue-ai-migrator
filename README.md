<div align="center">

# vue-ai-migrator

**The most comprehensive and performant Vue 2 → Vue 3 migration tool**  
_AST-based transformations + AI integration for reliable migrations_

[![Getting Started](https://img.shields.io/badge/Getting_Started-5_min-10B981?style=for-the-badge&logo=rocket)](#quick-start-5-minutes)
[![npm version](https://img.shields.io/npm/v/vue-ai-migrator?style=for-the-badge)](https://www.npmjs.com/package/vue-ai-migrator)
[![npm downloads](https://img.shields.io/npm/dm/vue-ai-migrator?style=for-the-badge)](https://www.npmjs.com/package/vue-ai-migrator)
[![license](https://img.shields.io/npm/l/vue-ai-migrator?style=for-the-badge)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/TylerDurden75/vue-ai-migrator?style=for-the-badge&logo=github)](https://github.com/TylerDurden75/vue-ai-migrator)
[![CI Status](https://img.shields.io/github/actions/workflow/status/TylerDurden75/vue-ai-migrator/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/TylerDurden75/vue-ai-migrator/actions)
[![codecov](https://codecov.io/gh/TylerDurden75/vue-ai-migrator/branch/main/graph/badge.svg)](https://codecov.io/gh/TylerDurden75/vue-ai-migrator)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D16.0.0-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

**[⚡ Getting Started (5 min)](#-quick-start-5-minutes)** • [Usage](./USAGE.md) • [Cheat Sheet](./docs/CHEATSHEET.md) • [Migration Guide](./docs/MIGRATION_GUIDE.md) • [API Keys](./API_KEYS.md) • [Changelog](./CHANGELOG.md)

</div>

> 🎯 **Vision**: Build a migration tool that is **assisted, reliable, explainable and secure**, not a magic one-click migration.

> 📌 **Target format**: Migrated components use **Composition API** with **`<script setup>`** (template → script → style).

Automatic Vue 2 → Vue 3 migration combining:

- **🆓 Free Mode (Default)**: AST-based transformations - **No API key required**
- **AST Analysis** for deterministic transformations (covers ~83% of breaking changes)
- **Migration Rules** for Vue 2 → Vue 3 patterns
- **🤖 Optional AI Agent** (LLM) for complex cases - Enable with `--ai` flag

> 📖 **Full usage** → [USAGE.md](./USAGE.md) — installation, commands, configuration, and examples.  
> 📘 **Migration strategy** → [Migration Guide](./docs/MIGRATION_GUIDE.md) — Vue 2.7, compat build, recommended workflow.

> ✅ **Successfully tested** on [vue-hackernews-2.0](https://github.com/vuejs/vue-hackernews-2.0) — full migration, build and runtime verified (Vuex, slots, SSR).

### ⚡ Quick Start (5 minutes)

```bash
npm install -g vue-ai-migrator          # 1. Install
vue-ai-migrator analyze ./my-project --classify   # 2. Analyze
vue-ai-migrator migrate ./my-project             # 3. Migrate (no API key needed)
```

**That's it.** Free mode covers ~83% of cases. Use `--dry-run` to preview, `--ai` for complex files. → [Cheat sheet](./docs/CHEATSHEET.md) | [Full usage](./USAGE.md)

---

## 📑 Table of Contents

- [⚡ Quick Start (5 min)](#-quick-start-5-minutes)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [GitHub Action](#-github-action)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Supported Transformations](#-supported-transformations)
- [AI Integration](#-ai-integration)
- [Performance](#-performance)
- [Safety & Rollback](#-safety--rollback)
- [Testing](#-testing)
- [Roadmap](#-roadmap)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

## 🚀 Features

- **🆓 Free mode by default**: AST-based transformations — no API key required
- **Composition API + script setup**: Migrated components use `<script setup>` format
- **Vuex → Pinia, Router 3 → 4**: Automatic store and router transformations
- **Template & SFC**: Slots, filters, v-model, directives, full `.vue` support
- **🤖 Optional AI**: Complex cases with `--ai` (OpenAI)
- **TypeScript**: `--typescript` adds type annotations
- **Safety**: Rollback, dry-run, validation, 677+ tests
- **GitHub Action**: CI/CD integration

→ [Full feature list](./USAGE.md) • [Cheat sheet](./docs/CHEATSHEET.md)

## 🏗️ Architecture

Vue 2 → **Analyze** → **Classify** (🟢 Simple / 🟡 Medium / 🔴 Complex) → **AST Transform** (or AI for complex) → **Validate** → Vue 3

→ [Full workflow & diagrams](./docs/ARCHITECTURE.md)

## 📖 Documentation

- **[USAGE.md](./USAGE.md)** — Installation, commands, configuration, examples (main user guide)
- **[Cheat Sheet](./docs/CHEATSHEET.md)** — Quick reference: CLI commands & most used options
- **[API_KEYS.md](./API_KEYS.md)** — Configure AI provider API keys (optional, for `--ai` mode)
- **[docs/MIGRATION_GUIDE.md](./docs/MIGRATION_GUIDE.md)** — Vue 2.7, compat build, workflow
- **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** — Common errors and solutions
- **[CHANGELOG.md](./CHANGELOG.md)** — Version history
- **[docs/ROADMAP.md](./docs/ROADMAP.md)** — Roadmap and planned features

## 📦 Installation

### Requirements

- **Node.js >= 16** to run vue-ai-migrator
- **Node.js >= 18** for the migrated project (Vue 3 + Vite). The migration sets `engines.node` in package.json and creates `.nvmrc` (run `nvm use` to switch automatically).
- npm or yarn
- **(Optional)** OpenAI/Mistral/Claude API key - **Only needed if you want AI assistance** (free mode works without it!)

> 🆓 **Free Mode**: The tool works perfectly fine without any API key. AST transformations cover ~83% of migration cases automatically.

### Install

**Global installation** (recommended for CLI usage):

```bash
npm install -g vue-ai-migrator
```

You can use the short alias **`vam`** (e.g. `vam migrate ./my-project`) instead of `vue-ai-migrator`.

**Local installation** (for programmatic usage):

```bash
npm install vue-ai-migrator --save-dev
```

## 🆓 Free Mode vs AI Mode

**vue-ai-migrator** offers two modes:

### 🆓 Free Mode (Default) - No API Key Required

- ✅ **AST-based transformations** - Covers ~83% of migration cases
- ✅ **Fast and reliable** - Deterministic transformations
- ✅ **No API costs** - Completely free to use
- ✅ **Works offline** - No internet connection needed for AST transformations

**Perfect for**: Most Vue 2 projects, especially those with standard patterns.

```bash
# Just run it - no API key needed!
vue-ai-migrator migrate ./my-project
```

### 🤖 AI Mode (Optional) - Requires API Key

- ✅ **Handles complex cases** - AI assistance for edge cases
- ✅ **Intelligent refactoring** - Context-aware transformations
- ✅ **Test generation** - Automatic test creation
- ✅ **Migration planning** - AI-powered prioritization

**Perfect for**: Complex projects with custom patterns, legacy code, or when you need extra assistance.

```bash
# Enable AI assistance
export OPENAI_API_KEY=sk-your-key
vue-ai-migrator migrate ./my-project --ai
```

> 💡 **Tip**: Start with free mode! Most projects can be migrated without AI. Use `--ai` only if you encounter complex cases that need assistance.

## 🚀 Quick Start

1. **Analyze** `vue-ai-migrator analyze ./my-project --classify`
2. **Dry-run** `vue-ai-migrator migrate ./my-project --dry-run --show-diff`
3. **Migrate** `vue-ai-migrator migrate ./my-project`

All migrations work in **free mode** (Vue components, Vuex→Pinia, Router, mixins, etc.). Use `--ai` only for complex files. → [Cheat sheet](./docs/CHEATSHEET.md) | [Full usage](./USAGE.md)

### Before & After Example

**Vue 2 (Before):**

```vue
<template>
  <div>{{ message | capitalize }}</div>
</template>

<script>
export default {
  data() {
    return {
      message: "hello vue",
    };
  },
  filters: {
    capitalize(value) {
      return value.toUpperCase();
    },
  },
};
</script>
```

**Vue 3 (After):**

```vue
<template>
  <div>{{ capitalize(message) }}</div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const message = ref("hello vue");

function capitalize(value: string) {
  return value.toUpperCase();
}
</script>
```

### GitHub Action

Validate your Vue 2 project in CI with a dry-run, or run full migration:

```yaml
# .github/workflows/vue-migrate.yml
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

See [.github/actions/migrate/README.md](.github/actions/migrate/README.md) for all options (path, version, ai, typescript, etc.).

## 🎯 Usage

| Command | Description |
|---------|-------------|
| `analyze <path>` | Detect migration needs, use `--classify` for complexity |
| `migrate <path>` | Full migration; `--dry-run` to preview |
| `fix <path>` | Re-apply post-migration fixes |
| `rollback <path>` | Restore from backup |
| `plan <path>` | AI migration plan (requires `--ai`) |

→ [Cheat sheet](./docs/CHEATSHEET.md) — all options • [USAGE.md](./USAGE.md) — Programmatic API & configuration

## 🔧 Configuration

**API keys** (optional, for `--ai` mode): `export OPENAI_API_KEY=sk-...` → [API_KEYS.md](./API_KEYS.md)

**Config file** `vue-migrator.config.js`: ignore patterns, custom rules, store paths → [USAGE.md](./USAGE.md#-advanced-configuration)

## 📋 Supported Transformations

**Script**: Options API → Composition API, script setup, Vuex → Pinia, Router 3 → 4, filters, mixins, directives, async components, render functions.

**Template**: Slots, filters, v-model, v-for/v-if, transitions, $listeners → $attrs.

→ [Complete list](./docs/TRANSFORMATIONS.md)

## 📘 TypeScript Support

`--typescript` adds type annotations: typed refs, computed, props, functions. Generates `<script setup lang="ts">` and Pinia store types.

```bash
vue-ai-migrator migrate ./my-project --typescript
```

→ [USAGE.md](./USAGE.md) for full examples

## 🔄 Vuex → Pinia

Converts `new Vuex.Store()` to Pinia Setup Store (`defineStore` + `ref`/`computed`).

```bash
vue-ai-migrator migrate ./src/store --transformations vuex-pinia --typescript
```

→ [docs/TRANSFORMATIONS.md](./docs/TRANSFORMATIONS.md) | [USAGE.md](./USAGE.md) for full Vuex→Pinia example

## 🤖 AI Integration

Optional: `--ai` for complex cases. OpenAI today; Mistral/Claude planned. → [API_KEYS.md](./API_KEYS.md)

## ⚡ Performance

Parallel processing, smart caching, ~10x faster than sequential. Incremental mode: < 10s for 200 files. → [docs/internal/PERFORMANCE_OPTIMIZATION.md](./docs/internal/PERFORMANCE_OPTIMIZATION.md)

## 🛡️ Safety & Rollback

Backups, dry-run, validation, rollback. Tested on [vue-hackernews-2.0](https://github.com/vuejs/vue-hackernews-2.0). AI code validated against AST.

`vue-ai-migrator rollback ./my-project` — [Cheat sheet](./docs/CHEATSHEET.md)

## 🧪 Testing

- **605+ unit tests** covering all modules and transformations
- **100% pass rate** - All tests passing
- **AST-based transformations** for robust code generation
- Tests for error handling, transformations, and migration flow
- Comprehensive tests for:
  - Composition API and Script Setup transformations
  - Template transformations (v-for, v-if, slots, transitions)
  - Async components and render functions
  - Vuex → Pinia migration
  - TypeScript type inference

## 📚 Documentation

- **[USAGE.md](./USAGE.md)** — Full guide, Programmatic API
- **[Cheat Sheet](./docs/CHEATSHEET.md)** — CLI commands & options
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — Workflow diagrams
- **[docs/TRANSFORMATIONS.md](./docs/TRANSFORMATIONS.md)** — Complete transformations list
- **[docs/MIGRATION_GUIDE.md](./docs/MIGRATION_GUIDE.md)** — Vue 2.7, compat build
- **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** — Common errors
- **[API_KEYS.md](./API_KEYS.md)** — AI providers

## 🗺️ Roadmap

See [ROADMAP.md](./docs/ROADMAP.md) for detailed roadmap and future plans.

**Current Version**: v0.6.4 - Vuex/Pinia & Validation

- ✅ **Free Mode by Default** - No API key required!
- ✅ Core migration features
- ✅ **Vuex → Pinia** (mapState/mapActions root store, useIndexStore)
- ✅ **Custom fixer rules** (fixerRulesAdd)
- ✅ AI Agent integration (optional)
- ✅ Classification system with free mode coverage
- ✅ Tested on vue-hackernews-2.0

**Next Version**: v0.7.0 - Multi-Provider Support

- 🔄 Complete Mistral API support
- 🔄 Complete Claude/Anthropic API support
- 🔄 Enhanced Composition API transformations
- 🔄 Performance optimizations

## 🤝 Contributing

Contributions are welcome! We appreciate your help in making vue-ai-migrator better.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and add tests
4. **Run tests**: `npm test`
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to the branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Current Priorities

1. Improve Composition API transformations
2. Add more test cases
3. Document complex use cases
4. Optimize performance
5. Add support for Mistral and Claude APIs

### Development Setup

```bash
# Clone the repository
git clone https://github.com/TylerDurden75/vue-ai-migrator.git
cd vue-ai-migrator

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in watch mode
npm run dev
```

## ❓ FAQ

### Do I need an API key?

**No!** Free mode works without any API key. The tool uses AST transformations that cover ~83% of migration cases automatically. Only use `--ai` if you have complex files that need extra assistance.

### When should I use AI mode?

Use `--ai` flag when:
- You have many "Complex" files (shown in classification)
- Your project has custom patterns not covered by AST
- You want automatic test generation
- You need migration planning assistance

### Is free mode reliable?

Yes! Free mode uses deterministic AST transformations that are:
- ✅ Fast and reliable
- ✅ Cover ~83% of migration cases
- ✅ Tested with 340+ unit tests
- ✅ Used by default for most projects

### How much does AI mode cost?

AI mode uses your own API key. Costs depend on:
- Your provider (OpenAI, Mistral, Claude)
- Number of complex files
- Model used

**Typical costs**: $0.10-$2.00 for a medium-sized project (50-200 files)

## 🔧 Troubleshooting

### Common Issues

#### "AI API key required"

**Solution**: This error only appears if you use `--ai` flag. For free mode (default), no API key is needed! 

If you want AI assistance:
- Set the `OPENAI_API_KEY` environment variable or use `--ai-api-key` option
- See [API_KEYS.md](./API_KEYS.md) for detailed configuration
- Or simply remove `--ai` flag to use free mode

#### "Invalid OpenAI API key format"

**Solution**: Ensure your key starts with `sk-` and is the correct length. Check [API_KEYS.md](./API_KEYS.md) for validation details.

#### "No Vue files found in the project"

**Solution**: Ensure you're running the command from the correct directory and that your project contains `.vue` files.

#### "Provider not yet implemented"

**Solution**: Currently only OpenAI is fully supported. Mistral and Claude support is coming in v0.7.0. Use `--provider openai` or omit the provider option.

#### Migration fails on specific files

**Solution**:

1. Check the migration report for details
2. Use `--dry-run` mode to preview changes
3. Try enabling AI assistance: `--ai` (if you have an API key)
4. Check if the file needs manual intervention (marked as Complex)
5. Most files work fine in free mode - try without `--ai` first

#### Errors after migration (userStore not defined, computed syntax, etc.)

**Solution**: Run `vue-ai-migrator fix ./your-project` to re-apply post-migration fixes. If issues persist, re-run the migration from a clean state (or rollback then migrate again). Check the report and fix manually; open an issue if you think it's a bug.

### Known Limitations

#### Vuex split structure (actions.js, mutations.js)

If your store uses separate files for `actions`, `mutations`, or `getters` imported by `store/index.js`, the automatic Vuex→Pinia transform may not resolve them. **Workaround**: Manually merge these into the main store file before migration, or adapt the generated Pinia store after migration.

#### Functional components

SFCs using `functional` or `{ functional: true }` are automatically transformed: props→$props, attrs→$attrs, listeners removed. Define props in script setup via `defineProps()` as usual.

#### Slots: nested same-tag with slot attribute

When using `slot="name"` on an element that contains nested elements with the same tag (e.g. `<div slot="header"><div>inner</div></div>`), the regex-based transform may incorrectly match the inner closing tag. **Workaround**: Prefer `<template v-slot:name>...</template>` syntax, or manually convert affected slots before migration.

#### "Cannot find module '../parser/tsx'" or dependency conflicts

**Solution**: The migrator no longer auto-removes `node_modules` when conflicts are detected (this could break jscodeshift). If you see dependency conflict warnings:

- Run the migration as-is; run `npm install` **after** migration to resolve conflicts
- Or use `--clean-install` only **after** migration (e.g. `vue-ai-migrator migrate ./my-project --install` to reinstall deps, or run `npm install` manually in the project afterward)
- Avoid manually removing `node_modules` before migrating

#### Node version: "The engine "node" is incompatible" or build fails after migration

**Solution**: Vue 3 + Vite require Node 18+. The migration adds `engines.node` to package.json. Use `nvm use 18` or `nvm use 20`, or update your CI (e.g. `node-version: '20'` in the GitHub Action).

#### Rollback not working

**Solution**: Ensure backups exist. Check `.vue-migrator-backup/` directory in your project root.

### Getting Help

- **GitHub Issues**: [Report a bug or request a feature](https://github.com/TylerDurden75/vue-ai-migrator/issues)
- **Documentation**: Check [USAGE.md](./USAGE.md)
- **API Keys**: See [API_KEYS.md](./API_KEYS.md) for configuration help

## 📝 License

MIT

## 🙏 Acknowledgments

Built with ❤️ by the Vue community. Special thanks to:

- Vue.js team for the excellent migration guide
- jscodeshift for AST transformations
- OpenAI for AI capabilities
````
