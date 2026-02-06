# Usage Guide - vue-ai-migrator

## 📦 Installation

### Global Installation (recommended for CLI)

```bash
npm install -g vue-ai-migrator
```

You can use the short alias **`vam`** (e.g. `vam migrate ./my-project`) instead of `vue-ai-migrator`.

### Local Installation (for programmatic usage)

```bash
npm install vue-ai-migrator --save-dev
```

### Installation from Source

```bash
cd vue-ai-migrator
npm install
npm run build
```

## 🆓 Free Mode vs AI Mode

**vue-ai-migrator** works in two modes:

### 🆓 Free Mode (Default) - Recommended for Most Projects

**No API key required!** The tool uses AST transformations to migrate your code automatically.

```bash
# Just run it - works immediately, no setup needed!
vue-ai-migrator migrate ./my-vue2-project
```

**What you get:**
- ✅ Automatic AST-based transformations (~83% coverage)
- ✅ Vuex → Pinia migration
- ✅ Router 3 → Router 4 migration
- ✅ Composition API conversion
- ✅ Template transformations
- ✅ Post-migration fixes
- ✅ TypeScript support (with `--typescript`)

**Perfect for:** Most Vue 2 projects with standard patterns.

### 🤖 AI Mode (Optional) - For Complex Cases

Enable AI assistance for complex migrations:

```bash
export OPENAI_API_KEY=sk-your-key
vue-ai-migrator migrate ./my-vue2-project --ai
```

**What you get (in addition to free mode):**
- ✅ AI-powered complex case handling
- ✅ Automatic test generation
- ✅ Migration planning with AI
- ✅ Intelligent refactoring suggestions

**Perfect for:** Projects with custom patterns, legacy code, or when you need extra help.

> 💡 **Recommendation**: Start with free mode! Most projects migrate successfully without AI. Only use `--ai` if you encounter complex cases.

## 🚀 Basic Usage

### 1. Analyze a Vue 2 Project

Before migrating, analyze your project to see what needs to be migrated:

```bash
vue-ai-migrator analyze ./my-vue2-project
```

This command will:

- Detect Vue version
- Identify Vue files
- List detected Vue 2 patterns
- Provide a complexity estimate

**Use `--classify` to classify each file by complexity:**

```bash
vue-ai-migrator analyze ./my-vue2-project --classify
```

This will show:

- 🟢 Simple: Files that can be migrated automatically (free mode handles these)
- 🟡 Medium: Files requiring validation (free mode usually handles these too)
- 🔴 Complex: Files that might benefit from AI assistance

### 2. Basic Migration (Free Mode - Recommended)

**No API key needed!** Just run:

```bash
vue-ai-migrator migrate ./my-vue2-project
```

This uses AST transformations and works for most projects.

**After migration, reinstall dependencies:**

After migrating, your `package.json` will be updated with Vue 3 dependencies. You should reinstall dependencies:

```bash
# Option 1: Automatic reinstall after migration (recommended)
vue-ai-migrator migrate ./my-vue2-project --install

# Option 2: Clean install (removes node_modules first, recommended for clean state)
vue-ai-migrator migrate ./my-vue2-project --clean-install

# Option 3: Manual reinstall
cd ./my-vue2-project
rm -rf node_modules package-lock.json
npm install
```

> 💡 **Tip**: Use `--clean-install` for a fresh dependency installation, especially if you encounter dependency conflicts after migration.

### 3. Migration with AI (Optional)

For complex migrations, enable AI assistance:

```bash
export OPENAI_API_KEY=sk-your-key
vue-ai-migrator migrate ./my-vue2-project --ai \
  --transformations "composition-api,script-setup" \
  --typescript
```

**New in v0.6.0:**

- **Migration Classification**: Automatic complexity classification (🟢 Simple / 🟡 Medium / 🔴 Complex)
- **Advanced AI Agent**: Multi-provider AI support with intelligent migration assistance
- **Test Generation**: Automatic Vitest test generation for migrated components
- **Enhanced Diff**: Detailed diff visualization in dry-run mode
- **Enhanced Reporting**: Comprehensive reports with classification statistics
- **TypeScript Support**: Automatic type annotations with `--typescript` flag
  - Typed props with interfaces for complex cases
  - Typed refs, computed, and functions
  - Intelligent type inference from Vue 2 code

**Previous versions (v0.4.0):**

- **Script Setup Conversion**: Automatically converts Options API components to `<script setup lang="ts">` format
- **AST-based Transformations**: More robust and accurate code transformations
- **Improved Composition API**: Complete transformation with proper import generation

For a complete migration with AI assistance:

```bash
# Method 1: Environment variable (recommended for security)
export OPENAI_API_KEY=sk-your-api-key
vue-ai-migrator migrate ./my-vue2-project

# Method 2: CLI option
vue-ai-migrator migrate ./my-vue2-project --ai-api-key sk-your-api-key

# Method 3: Specify provider explicitly
vue-ai-migrator migrate ./my-vue2-project \
  --ai-api-key sk-your-api-key \
  --provider openai

# Method 4: Provider via environment (e.g. for CI)
export VUE_AI_MIGRATOR_AI_PROVIDER=openai
export OPENAI_API_KEY=sk-your-api-key
vue-ai-migrator migrate ./my-vue2-project --ai

# Method 5: Other providers (when supported in future releases)
# Currently only OpenAI is implemented; Mistral/Claude planned.
# export MISTRAL_API_KEY=your-mistral-key
# vue-ai-migrator migrate ./my-vue2-project --provider mistral
```

**Note**: See [API_KEYS.md](./API_KEYS.md) for detailed API key configuration. Only **OpenAI** is fully supported today; other providers are planned.

### 4. Dry-run Mode (test without modification)

To test the migration without modifying files:

```bash
vue-ai-migrator migrate ./my-vue2-project \
  --ai-api-key sk-your-api-key \
  --dry-run \
  --output ./report.json
```

### 5. Migration with Specific Transformations

To apply only certain transformations:

```bash
vue-ai-migrator migrate ./my-vue2-project \
  --transformations "composition-api,global-api,filters"
```

Available transformations:

- `composition-api` : Options API → Composition API
- `global-api` : `new Vue()` → `createApp()`
- `filters` : Remove filters
- `v-model` : Adapt v-model Vue 2 → Vue 3
- `event-api` : Replace $on/$off/$once

### 6. Dependency Management

After migration, your dependencies need to be updated. The tool provides flags to automate this:

```bash
# Automatic reinstall after migration
vue-ai-migrator migrate ./my-vue2-project --install

# Clean install (removes node_modules and package-lock.json first)
vue-ai-migrator migrate ./my-vue2-project --clean-install

# With TypeScript support
vue-ai-migrator migrate ./my-vue2-project --typescript --clean-install
```

**When to use `--clean-install`:**
- After migration to ensure clean dependency state
- If you encounter dependency conflicts
- When switching between Vue 2 and Vue 3 during testing

**Rollback with dependency reinstall:**

```bash
# Rollback and reinstall Vue 2 dependencies
vue-ai-migrator rollback ./my-vue2-project --all --install

# Rollback with clean install
vue-ai-migrator rollback ./my-vue2-project --all --clean-install
```

### 7. Re-run Post-Migration Fixes (`fix` command)

If you've already migrated a project and want to re-apply post-migration fixes (e.g. correct `indexStore.fetchUser` → `userStore.fetchUser`), use the `fix` command:

```bash
# Re-run fixes on an already migrated project
vue-ai-migrator fix ./my-vue2-project

# With TypeScript mode
vue-ai-migrator fix ./my-vue2-project --typescript

# Verbose output (see which fixes were applied)
vue-ai-migrator fix ./my-vue2-project -v
```

**Options:**
- `--typescript`: Enable TypeScript mode for fixes
- `-v, --verbose`: Show detailed fix information

> 💡 **Use case**: After updating vue-ai-migrator, run `fix` to apply the latest corrections without re-migrating the entire project.

## 🔧 Advanced Configuration

### Create a Configuration File

Create `vue-migrator.config.js` at the root of your project:

```javascript
module.exports = {
  // Paths to ignore
  ignore: ['node_modules', 'dist', 'build', '.git'],

  // Use AI
  useAI: true,

  // API key (or via OPENAI_API_KEY)
  aiApiKey: process.env.OPENAI_API_KEY,

  // Transformations to apply
  transformations: ['composition-api', 'global-api', 'filters', 'v-model', 'event-api'],
};
```

## 💻 Programmatic Usage

### Basic Example

```typescript
import { migrate, analyzeProject } from 'vue-ai-migrator';

// Analyze the project
const analysis = await analyzeProject('./my-project');
console.log('Vue version:', analysis.vueVersion);
console.log('Vue 2 patterns:', analysis.vue2Patterns);

// Migrate the project
const result = await migrate({
  projectPath: './my-project',
  aiApiKey: process.env.OPENAI_API_KEY,
  dryRun: false,
});

console.log(`Files modified: ${result.filesModified}`);
console.log(`Transformations applied: ${result.transformationsApplied}`);
```

### Example with Custom Options

```typescript
import { migrate } from 'vue-ai-migrator';

const result = await migrate({
  projectPath: './my-project',
  aiApiKey: process.env.OPENAI_API_KEY,
  dryRun: true, // Test mode
  useAI: true,
  outputReport: './custom-report.json',
  transformations: ['composition-api', 'global-api'],
});

// Check results
if (result.errors.length > 0) {
  console.error('Errors:', result.errors);
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

## 📋 Recommended Workflow

### Step 1: Preparation

```bash
# 1. Save your project (git commit)
git add .
git commit -m "Before Vue 3 migration"

# 2. Create a branch
git checkout -b vue3-migration
```

### Step 2: Analysis

```bash
# Analyze the project
vue-ai-migrator analyze ./my-project

# Examine detected patterns
```

### Step 3: Test Migration

```bash
# Test migration without modifying
vue-ai-migrator migrate ./my-project \
  --ai-api-key sk-your-key \
  --dry-run \
  --output ./migration-test-report.json

# Examine generated report
cat migration-test-report.json
```

### Step 4: Real Migration

```bash
# Migrate the project
vue-ai-migrator migrate ./my-project \
  --ai-api-key sk-your-key \
  --output ./migration-report.json
```

### Step 5: Verification

```bash
# Install Vue 3 dependencies
npm install vue@^3.0.0

# Test the project
npm run dev
npm run test
```

## 🎯 Specific Use Cases

### Progressive Migration

To migrate component by component:

```bash
# Migrate only a specific directory
vue-ai-migrator migrate ./src/components/Button \
  --transformations "composition-api,v-model"
```

### Migration without AI (for small projects)

```bash
vue-ai-migrator migrate ./my-project --no-ai
```

Automatic codemods will handle:

- `new Vue()` → `createApp()`
- Remove filters
- Basic v-model transformation

### Migration with Detailed Report

```bash
vue-ai-migrator migrate ./my-project \
  --ai-api-key sk-your-key \
  --output ./detailed-report.json
```

The report contains:

- List of modified files
- Applied transformations
- Encountered errors
- Warnings
- Post-migration suggestions

## ⚡ Performance

vue-ai-migrator uses parallel processing to optimize performance:

- **Batch processing**: Files are processed in batches of 10 in parallel
- **~10x faster** for projects with many files
- **Optimized memory management**: Sequential batch processing to avoid overload

## 🛡️ Error Handling

The project includes robust error handling:

- **Automatic retry**: AI calls are automatically retried (2-3 attempts)
- **Input validation**: Validation of paths, API keys, and file sizes
- **Typed errors**: Clear error codes to facilitate debugging
- **Security protection**: Protection against path traversal attacks

## ⚠️ Important Points

1. **Backup**: Always backup your project before migration
2. **Tests**: Run tests after migration
3. **Review**: Examine modified files
4. **AI**: AI can make errors, always verify generated code
5. **Dependencies**: Update `package.json` for Vue 3
6. **Performance**: Parallel processing significantly improves performance

## 🔍 Troubleshooting

For a detailed guide of common errors and solutions, see **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

### Error: "This project does not appear to be a Vue 2 project"

Check that your `package.json` contains Vue 2:

```json
{
  "dependencies": {
    "vue": "^2.6.14"
  }
}
```

### Error: "No response from AI"

- Check your OpenAI API key
- Check your internet connection
- Check your OpenAI credits

### Partial Migration

If migration fails, the report contains the details. You can:

1. Fix errors manually
2. Rerun the migration
3. Use `--transformations` to migrate step by step

### Known Limitations

- **Vuex split structure**: If your store uses separate `actions.js`, `mutations.js`, or `getters.js` files imported by `store/index.js`, manual merge may be required before migration.
- **Functional components**: SFCs with `functional` or `{ functional: true }` are not auto-converted; manual conversion is needed.

## 📚 Resources

- [Vue 3 Migration Guide Documentation](https://v3-migration.vuejs.org/)
- [Vue 3 Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Migration Examples](./EXAMPLES.md)
