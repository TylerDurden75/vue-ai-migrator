# Simple Guide - vue-ai-migrator

## 🤔 What is it?

**vue-ai-migrator** is a tool that automatically transforms your Vue 2 code into Vue 3 code.

### Vue 2 vs Vue 3 - Simple Explanation

Imagine you have a car (Vue 2) and you want to transform it into a modern electric car (Vue 3). The problem is:

- Some parts are no longer compatible
- The way to drive has changed
- Many things need to be adapted manually

**vue-ai-migrator** does this work automatically for you! 🚗➡️🚗⚡

---

## 🎯 What is it used for concretely?

### Concrete Example

**BEFORE (Vue 2)** - Your current code:

```vue
<script>
export default {
  data() {
    return {
      message: 'Hello',
    };
  },
  methods: {
    greet() {
      alert(this.message);
    },
  },
};
</script>
```

**AFTER (Vue 3)** - What the tool automatically generates:

```vue
<script setup>
import { ref } from 'vue';

const message = ref('Hello');

const greet = () => {
  alert(message.value);
};
</script>
```

The tool has transformed your code to work with Vue 3, **without you having to rewrite everything manually**!

> 💡 **Note**:
>
> - **Without `--typescript`**: Generates `<script setup>` (modern Vue 3 syntax)
> - **With `--typescript`**: Generates `<script setup lang="ts">` with TypeScript types (`ref<string>()`)

---

## 📦 Installation

### Step 1: Install Node.js

If you don't have Node.js installed:

1. Go to [nodejs.org](https://nodejs.org/)
2. Download the "LTS" version (recommended)
3. Install it by following the instructions

### Step 2: Install vue-ai-migrator

Open a terminal (or command prompt) and type:

```bash
npm install -g vue-ai-migrator
```

This installs the tool on your computer so you can use it anywhere.

---

## 🚀 Usage - Step by step guide

### Use Case 1: Migrate a complete project

You have a folder with all your Vue 2 files and you want to migrate everything:

```bash
vue-ai-migrator migrate ./my-project
```

**What it does:**

- ✅ Scans all `.vue`, `.js`, `.ts` files in your project
- ✅ Automatically transforms Vue 2 code to Vue 3
- ✅ Creates a backup of your original files (just in case)
- ✅ Shows you a report of what was changed

**Example:**

```bash
# You are in your project folder
cd /path/to/my-project

# Launch the migration
vue-ai-migrator migrate .

# Result:
# ✅ 15 files transformed
# ✅ 3 files require manual verification
# ✅ Backup created in ./backup/
```

---

### Use Case 2: Test before migrating (Dry-run mode)

You want to see what will change **without modifying your files**:

```bash
vue-ai-migrator migrate ./my-project --dry-run
```

**What it does:**

- ✅ Analyzes your code
- ✅ Shows you what would be changed
- ✅ **DOES NOT MODIFY ANYTHING** (test mode)

It's like trying on clothes before buying them! 👔

---

### Use Case 3: Migrate only certain files

You want to migrate only a specific folder:

```bash
vue-ai-migrator migrate ./src/components
```

**What it does:**

- ✅ Migrates only files in `./src/components`
- ✅ Leaves the rest of your project intact

---

### Use Case 4: Migrate with AI assistance

For complex cases, the tool can use AI to better understand your code:

```bash
vue-ai-migrator migrate ./my-project --ai-api-key YOUR_API_KEY
```

**What it does:**

- ✅ Uses AI for complex transformations
- ✅ Generates smarter code
- ✅ Explains why certain changes were made

**Note:** You need to have an API key (OpenAI, Mistral, Claude, etc.)

---

## 🎨 Examples of automatic transformations

### Transformation 1: Data

**Vue 2:**

```vue
<script>
export default {
  data() {
    return {
      count: 0,
      name: 'John',
    };
  },
};
</script>
```

**Vue 3 (automatic):**

```vue
<script setup>
import { ref } from 'vue';

const count = ref(0);
const name = ref('John');
</script>
```

> 💡 **With `--typescript`**: `<script setup lang="ts">` with `ref<number>(0)` and `ref<string>('John')`

---

### Transformation 2: Methods

**Vue 2:**

```vue
<script>
export default {
  data() {
    return { count: 0 };
  },
  methods: {
    increment() {
      this.count++;
    },
  },
};
</script>
```

**Vue 3 (automatic):**

```vue
<script setup>
import { ref } from 'vue';

const count = ref(0);

const increment = () => {
  count.value++;
};
</script>
```

> 💡 **With `--typescript`**: `<script setup lang="ts">` with `ref<number>(0)` and TypeScript types

---

### Transformation 3: Templates (HTML)

**Vue 2:**

```vue
<template>
  <template slot-scope="props">
    {{ props.data }}
  </template>
</template>
```

**Vue 3 (automatic):**

```vue
<template>
  <template v-slot="props">
    {{ props.data }}
  </template>
</template>
```

---

## 📋 Useful Options

### See differences in detail

```bash
vue-ai-migrator migrate ./my-project --show-diff
```

Shows exactly what changed in each file.

---

### Generate tests automatically

```bash
vue-ai-migrator migrate ./my-project --generate-tests
```

Automatically creates tests to verify everything works.

---

### Migrate without using AI

```bash
vue-ai-migrator migrate ./my-project --no-ai
```

Uses only automatic transformations (faster, free).

---

### Migrate with TypeScript

```bash
vue-ai-migrator migrate ./my-project --typescript
```

Automatically adds TypeScript types to migrated code.

**Result example:**

- **Without `--typescript`**: `<script setup>` with `const count = ref(0)`
- **With `--typescript`**: `<script setup lang="ts">` with `const count = ref<number>(0)`

---

## ⚠️ Important: Automatic backup

**The tool automatically creates a backup** of your original files before modifying them.

If something goes wrong, you can always go back!

---

## 🔄 Undo a migration (Rollback)

If you want to cancel the changes:

```bash
vue-ai-migrator rollback ./my-project
```

This restores your original files from the backup.

---

## 📊 Understanding the migration report

After migration, you will see something like:

```
✅ Migration completed!

📊 Statistics:
   - 25 files analyzed
   - 20 files automatically transformed
   - 3 files require manual verification
   - 2 files not modified (already Vue 3)

⚠️ Files to verify:
   - src/components/ComplexComponent.vue (complex case)
   - src/store/oldStore.js (requires manual migration)

💾 Backup created: ./backup/2024-01-29_14-30-00/
```

---

## 🆘 Common problems and solutions

### Problem 1: "Command not found"

**Solution:** The tool is not installed globally. Try again:

```bash
npm install -g vue-ai-migrator
```

---

### Problem 2: "Permission denied"

**Solution:** On Mac/Linux, use `sudo`:

```bash
sudo npm install -g vue-ai-migrator
```

---

### Problem 3: "No files found"

**Solution:** Check that you are in the correct folder and that it contains `.vue` or `.js` files.

---

### Problem 4: Code doesn't work after migration

**Solution:**

1. Check the migration report
2. Look at files marked "require verification"
3. Use `--dry-run` to see what will change before
4. Consult Vue 3 documentation for complex cases

---

## 💡 Tips for using the tool well

### ✅ TO DO

1. **Always test first** with `--dry-run`
2. **Make a manual backup** before (even if the tool makes one)
3. **Migrate gradually**: start with one folder, test, then continue
4. **Read the report**: it tells you exactly what changed
5. **Test your application** after migration

### ❌ NOT TO DO

1. **Don't migrate directly to production**: test first!
2. **Don't ignore warnings**: they indicate important things
3. **Don't delete backups** too quickly
4. **Don't migrate without understanding**: read at least the report

---

## 🎓 Learning resources

If you want to understand what the tool does:

- **Vue 3 Documentation**: [v3.vuejs.org](https://v3.vuejs.org/)
- **Official migration guide**: [v3-migration.vuejs.org](https://v3-migration.vuejs.org/)
- **Vue 3 Tutorials**: Search for "Vue 3 tutorial" on YouTube

---

## 📞 Need help?

If you encounter a problem:

1. Check this guide
2. Look at error messages (they are often explicit)
3. Consult the complete documentation in `README.md`
4. Open an issue on GitHub if it's a bug

---

## 🎉 Summary in 3 steps

1. **Install**: `npm install -g vue-ai-migrator`
2. **Test**: `vue-ai-migrator migrate ./my-project --dry-run`
3. **Migrate**: `vue-ai-migrator migrate ./my-project`

It's that simple! 🚀

---

## 📝 Complete workflow example

```bash
# 1. Go to your project
cd /path/to/my-vue2-project

# 2. See what will change (without modifying)
vue-ai-migrator migrate . --dry-run --show-diff

# 3. If it suits you, migrate for real
vue-ai-migrator migrate . --typescript

# 4. Test your application
npm run dev

# 5. If everything works, you're good! Otherwise, rollback
vue-ai-migrator rollback .
```

---

**Good luck with your migration! 💪**
