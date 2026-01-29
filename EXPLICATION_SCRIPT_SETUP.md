# Explanation: Generation of `<script setup lang="ts">`

## 🎯 Short Answer

**YES**, but it depends on the transformation applied:

1. **If you use `--typescript`**: The migrated code automatically generates `<script setup lang="ts">` in some cases
2. **If you explicitly use `--transformations "script-setup"`**: Always generates `<script setup>` (with `lang="ts"` if `--typescript` is enabled)

---

## 📋 Detailed Behavior

### Case 1: Default migration (without specifying transformations)

```bash
vue-ai-migrator migrate ./my-project --typescript
```

**What happens:**

- All transformations are applied by default (including `composition-api`)
- If `composition-api` transforms the code to Composition API (with `import { ... } from 'vue'` and without `export default`)
- **Then** the code is automatically converted to `<script setup lang="ts">`

**Source code:**

```vue
<script>
export default {
  data() {
    return { count: 0 };
  },
};
</script>
```

**Result with `--typescript`:**

```vue
<script setup lang="ts">
import { ref } from "vue";

const count = ref<number>(0);
</script>
```

---

### Case 2: Explicit `script-setup` transformation

```bash
vue-ai-migrator migrate ./my-project --transformations "script-setup" --typescript
```

**What happens:**

- The `script-setup` transformation is explicitly applied
- Always generates `<script setup>` (with `lang="ts"` if `--typescript` is enabled)

**Result:**

```vue
<script setup lang="ts">
import { ref } from "vue";

const count = ref<number>(0);
</script>
```

---

### Case 3: `composition-api` transformation alone (without `script-setup`)

```bash
vue-ai-migrator migrate ./my-project --transformations "composition-api" --typescript
```

**What happens:**

- `composition-api` transforms the code to Composition API
- If the transformed code contains imports from 'vue' and has no export default
- **Then** automatic conversion to `<script setup lang="ts">`

**Source code:**

```vue
<script>
export default {
  setup() {
    const count = ref(0);
    return { count };
  },
};
</script>
```

**Result:**

```vue
<script setup lang="ts">
import { ref } from "vue";

const count = ref<number>(0);
</script>
```

---

## 🔍 Code Responsible for This Logic

The code that handles this automatic conversion is in `src/codemods/runner.ts` (lines 227-245):

```typescript
// If composition-api transform was applied (without script-setup), check if we should convert to script setup
if (
  !transformationsToApply.includes("script-setup") &&
  transformationsToApply.includes("composition-api")
) {
  // If composition-api transform was applied, check if we should convert to script setup
  // Check if the transformed script is Composition API code (has imports from 'vue')
  if (
    transformedScript.includes("import {") &&
    transformedScript.includes("from 'vue'") &&
    !transformedScript.includes("export default")
  ) {
    // Convert to <script setup lang="ts">
    vueParts.script.setup = true;
    if (options.enableTypeScript) {
      vueParts.script.lang = "ts";
    }
  }
}
```

And also for the explicit `script-setup` transformation (lines 209-213):

```typescript
if (transformationsToApply.includes("script-setup")) {
  vueParts.script.setup = true;
  if (options.enableTypeScript) {
    vueParts.script.lang = "ts";
  }
  // ...
}
```

---

## ✅ Summary

| Command                                                              | Transformation applied | Result                                                 |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `migrate --typescript`                                               | All (default)          | `<script setup lang="ts">` if Composition API detected |
| `migrate --transformations "script-setup" --typescript`              | `script-setup`         | `<script setup lang="ts">` always                      |
| `migrate --transformations "composition-api" --typescript`           | `composition-api`      | `<script setup lang="ts">` if Composition API detected |
| `migrate --transformations "composition-api"` (without --typescript) | `composition-api`      | `<script setup>` (without `lang="ts"`)                 |

---

## 💡 Recommendation

To be **explicit** and guarantee the desired result:

```bash
# To generate <script setup lang="ts">
vue-ai-migrator migrate ./my-project --transformations "script-setup" --typescript
```

Or simply:

```bash
# Automatically generates <script setup lang="ts"> if Composition API detected
vue-ai-migrator migrate ./my-project --typescript
```

---

## 🐛 If It Doesn't Work as Expected

1. **Check that the source code is properly transformed to Composition API**
   - The code must contain `import { ... } from 'vue'`
   - The code must not contain `export default`

2. **Check that `--typescript` is enabled**
   - Use `--typescript` in the command
   - Or check in the migration report

3. **Check the applied transformations**
   - The migration report indicates which transformations were applied
   - If `script-setup` is not in the list, automatic conversion may not happen
