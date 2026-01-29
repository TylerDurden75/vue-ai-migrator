# Usage Guide - vue-ai-migrator

## 📦 Installation

### Global Installation (recommended for CLI)

```bash
npm install -g vue-ai-migrator
```

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

**New in v0.5.0:** Use `--classify` to classify each file by complexity:

```bash
vue-ai-migrator analyze ./my-vue2-project --classify
```

This will show:

- 🟢 Simple: Files that can be migrated automatically
- 🟡 Medium: Files requiring validation
- 🔴 Complex: Files requiring AI assistance

### 2. Basic Migration (without AI)

For a quick migration without using AI:

```bash
vue-ai-migrator migrate ./my-vue2-project --no-ai
```

### 3. Migration with AI (recommended)

For complex migrations, use AI to handle difficult cases:

```bash
vue-ai-migrator migrate ./my-vue2-project \
  --ai-api-key <your-api-key> \
  --transformations "composition-api,script-setup" \
  --typescript
```

**New in v0.5.0:**

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

# Method 4: Using different providers (when supported)
export MISTRAL_API_KEY=your-mistral-key
vue-ai-migrator migrate ./my-vue2-project --provider mistral

export ANTHROPIC_API_KEY=sk-ant-your-key
vue-ai-migrator migrate ./my-vue2-project --provider anthropic
```

**Note**: See [API_KEYS.md](./API_KEYS.md) for detailed API key configuration guide.

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

## 📚 Resources

- [Vue 3 Migration Guide Documentation](https://v3-migration.vuejs.org/)
- [Vue 3 Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Migration Examples](./EXAMPLES.md)
