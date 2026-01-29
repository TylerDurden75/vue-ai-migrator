# CLI Screenshot - Migrate Command

## Command: `vue-ai-migrator migrate --dry-run`

```
$ vue-ai-migrator migrate ./test-project --dry-run --no-ai

✔ Analyzing project...
✔ Vue version detected: 2.7.14
✔ Starting migration...

📝 Migration Results:
  Files analyzed: 2
  Files modified: 2
  Transformations applied: 5

  Classification:
    🟢 Simple: 0
    🟡 Medium: 2
    🔴 Complex: 0

  Diff summary:
    src/components/HelloWorld.vue: +15 -8 lines
    src/App.vue: +3 -2 lines

✔ Migration completed! (dry-run mode)
```

## Command: `vue-ai-migrator migrate --dry-run --show-diff`

```
$ vue-ai-migrator migrate ./test-project --dry-run --show-diff

✔ Analyzing project...
✔ Starting migration...

📝 Detailed Diff:

File: src/components/HelloWorld.vue
─────────────────────────────────────
- <script>
- export default {
-   name: 'HelloWorld',
-   data() {
-     return {
-       count: 0,
-       description: 'Welcome to Vue 2'
-     }
-   },
-   filters: {
-     capitalize(value) {
-       return value.toString().toUpperCase()
-     }
-   },
-   methods: {
-     increment() {
-       this.count++
-     }
-   },
-   mounted() {
-     console.log('Component mounted')
-   }
- }
- </script>

+ <script setup lang="ts">
+ import { ref, onMounted } from 'vue'
+
+ const count = ref(0)
+ const description = ref('Welcome to Vue 2')
+
+ function capitalize(value: string) {
+   return value.toString().toUpperCase()
+ }
+
+ function increment() {
+   count.value++
+ }
+
+ onMounted(() => {
+   console.log('Component mounted')
+ })
+ </script>
─────────────────────────────────────
```
