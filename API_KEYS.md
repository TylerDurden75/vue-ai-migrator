# API Keys Configuration Guide

This guide explains how to configure API keys for different AI providers in `vue-ai-migrator`.

## 🔑 Supported Providers

- **OpenAI** (GPT-4, GPT-3.5) - ✅ Fully supported
- **Mistral** - 🚧 Planned (v0.7.0)
- **Claude/Anthropic** - 🚧 Planned (v0.7.0)

## 📝 Configuration Methods

### Method 1: Environment Variables (Recommended)

Set the API key as an environment variable before running the command:

#### OpenAI

```bash
export OPENAI_API_KEY=sk-your-api-key-here
vue-ai-migrator migrate ./my-project
```

#### Windows (PowerShell)

```powershell
$env:OPENAI_API_KEY="sk-your-api-key-here"
vue-ai-migrator migrate ./my-project
```

#### Windows (CMD)

```cmd
set OPENAI_API_KEY=sk-your-api-key-here
vue-ai-migrator migrate ./my-project
```

### Method 2: CLI Option

Pass the API key directly via command line:

```bash
vue-ai-migrator migrate ./my-project --ai-api-key sk-your-api-key-here
```

### Method 3: Configuration File

Create a `vue-migrator.config.js` file in your project root:

```javascript
module.exports = {
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4-turbo-preview', // Optional
    temperature: 0.3, // Optional
  },
  // ... other options
};
```

### Method 4: Programmatic Usage

```typescript
import { migrate, UnifiedAIService } from 'vue-ai-migrator';

// Option 1: Pass API key directly
await migrate({
  projectPath: './my-project',
  aiApiKey: 'sk-your-api-key-here',
  useAI: true,
});

// Option 2: Create AI service with custom config
const aiService = new UnifiedAIService({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY || 'sk-your-api-key-here',
  model: 'gpt-4-turbo-preview',
  temperature: 0.3,
});
```

## 🔐 Security Best Practices

### ✅ DO:

- Use environment variables for API keys
- Add `.env` files to `.gitignore`
- Use different API keys for development and production
- Rotate API keys regularly
- Use read-only API keys when possible

### ❌ DON'T:

- Commit API keys to version control
- Share API keys in public repositories
- Use the same API key across multiple projects
- Hardcode API keys in source files

## 📋 Environment Variables Reference

### API keys (per provider)

| Provider  | Environment Variable | Format       | Example             |
| --------- | -------------------- | ------------ | ------------------- |
| OpenAI    | `OPENAI_API_KEY`     | `sk-...`     | `sk-proj-abc123...` |
| Mistral   | `MISTRAL_API_KEY`    | `...`        | (Coming soon)       |
| Anthropic | `ANTHROPIC_API_KEY`  | `sk-ant-...` | (Coming soon)       |

### Provider selection

| Purpose | Environment Variable | Values | Example |
| ------- | -------------------- | ------ | ------- |
| Choose AI provider (optional) | `VUE_AI_MIGRATOR_AI_PROVIDER` | `openai`, `mistral`, `claude`, `anthropic` | `openai` (default) |

When set, this overrides the default provider without passing `--provider` on the CLI (useful in CI or scripts). Only `openai` is implemented today.

## 🛠️ Getting API Keys

### OpenAI

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Click **Create new secret key**
5. Copy the key (it starts with `sk-`)
6. Store it securely

### Mistral (Coming Soon)

1. Go to [Mistral AI Platform](https://console.mistral.ai/)
2. Sign up or log in
3. Navigate to **API Keys**
4. Create a new key
5. Copy and store securely

### Anthropic/Claude (Coming Soon)

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to **API Keys**
4. Create a new key
5. Copy and store securely

## 🔍 Validation

The tool automatically validates API key formats:

- **OpenAI**: Must start with `sk-` and be at least 20 characters
- **Mistral**: (Validation coming soon)
- **Anthropic**: (Validation coming soon)

If an invalid key is provided, you'll see an error:

```
Error: Invalid OpenAI API key format
```

## 💡 Usage Examples

### Basic Migration with OpenAI

```bash
export OPENAI_API_KEY=sk-your-key
vue-ai-migrator migrate ./my-vue2-project
```

### Dry-run with Custom Model

```bash
export OPENAI_API_KEY=sk-your-key
vue-ai-migrator migrate ./my-vue2-project \
  --dry-run \
  --show-diff
```

### Migration Plan Generation

```bash
export OPENAI_API_KEY=sk-your-key
vue-ai-migrator plan ./my-vue2-project \
  --output migration-plan.json
```

### Using .env File (with dotenv)

If you use `dotenv` in your project:

```bash
# .env file
OPENAI_API_KEY=sk-your-api-key-here
```

```bash
# Load and run
source .env  # or use dotenv-cli
vue-ai-migrator migrate ./my-project
```

## 🚨 Troubleshooting

### "AI API key required"

**Solution**: Set the `OPENAI_API_KEY` environment variable or use `--ai-api-key` option.

### "Invalid OpenAI API key format"

**Solution**: Ensure your key starts with `sk-` and is the correct length.

### "Provider not yet implemented"

**Solution**: Currently only OpenAI is fully supported. Mistral and Claude support is coming in v0.7.0.

### API Rate Limits

**Solution**:

- Use `--no-ai` to disable AI for simple migrations
- Implement retry logic (already included)
- Consider upgrading your OpenAI plan

## 📚 Related Documentation

- [Usage Guide](./USAGE.md)
- [Usage & examples](./USAGE.md)
- [README](./README.md)
