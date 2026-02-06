# Troubleshooting Guide - vue-ai-migrator

## Common Errors and Solutions

### "This project does not appear to be a Vue 2 project"

**Cause**: The `package.json` does not contain Vue 2 or the version is not detected.

**Solution**:
```json
{
  "dependencies": {
    "vue": "^2.6.14"
  }
}
```

Ensure `vue` is in `dependencies`, `devDependencies`, or `peerDependencies`.

---

### "fetchCurrentUser is not a function" / "store.methodName is not a function"

**Cause**: The migrated Pinia store does not expose all methods called by components.

**Solution**:
- The `storeAddMissingAuthMethodsRule` automatically adds missing methods detected in the project.
- It scans the project for any method called on `indexStore`, `store`, or `$store` (generic, no hardcoded list).
- If the error persists, verify the method is called with one of these variable names.
- You can manually add the method to the store:
  ```ts
  function fetchCurrentUser() { /* ... */ }
  return { ..., fetchCurrentUser };
  ```

---

### "process is not defined" (browser / Vite client)

**Cause**: `process.env` is Node.js only. Vite bundles client code for the browser where `process` does not exist.

**Solution**:
- The `processEnvToImportMetaRule` automatically replaces `process.env.X` with `import.meta.env.X` in client-side files.
- For custom vars, use the `VITE_` prefix: `process.env.MY_VAR` → `import.meta.env.VITE_MY_VAR`.
- Add `VITE_MY_VAR` to your `.env` file.
- Server-only files (entry-server, create-api-server) are skipped.

---

### Firebase "require is not defined" / CommonJS in ESM

**Cause**: Firebase 4.x uses CommonJS (`require`); incompatible with Vite/ESM client bundle.

**Solution**:
- **Upgrade to Firebase 9+** (modular ESM): `npm i firebase@^9`
  ```ts
  import { initializeApp } from 'firebase/app';
  import { getDatabase } from 'firebase/database';
  ```
- Or use the create-api split (index.client.js / index.server.js) so Firebase runs only on the server.
- See: https://firebase.google.com/docs/web/modular-upgrade

---

### "module is not defined" (postcss.config.js, ESM)

**Cause**: `postcss.config.js` uses `module.exports` while the project is ESM.

**Solution**:
- Rename to `postcss.config.cjs` to force CommonJS.
- Or remove the file if PostCSS config is not needed (Vite has defaults).

---

### "ReferenceError: _timer is not defined" (script setup)

**Cause**: Variables like `_timer`, `_cut` used in setInterval/clearInterval were implicit in Vue 2 Options API but must be declared in `<script setup>`.

**Solution**:
- The `scriptSetupUndeclaredVarsRule` automatically adds `let _timer = null` and `let _cut = 0` when detected.
- If the error persists, add declarations manually after imports:
  ```js
  import { ref } from "vue";
  let _timer = null;
  let _cut = 0;
  ```

---

### Filters not converted / "filter is not a function"

**Cause**: Vue 2 filters `{{ x | filter }}` are converted to `{{ filter(x) }}` but the function is not imported.

**Solution**:
- Create a file `src/filters/index.js` or `src/util/filters.js` with your filters.
- The `missingFilterImportsRule` adds missing imports if filters are defined in `filterPaths` (config).
- Example:
  ```ts
  // src/filters/index.ts
  export function capitalize(s: string) { return s?.charAt(0).toUpperCase() + s?.slice(1) ?? ''; }
  export function currency(n: number, sym = '€') { return `${sym} ${n.toFixed(2)}`; }
  ```

---

### Event bus ($on, $off, $once) detected

**Cause**: Vue 3 removed the instance event API.

**Solution**:
- **Option 1**: Use [mitt](https://github.com/developit/mitt): `npm i mitt`
  ```ts
  import mitt from 'mitt';
  const bus = mitt();
  bus.emit('event', data);
  bus.on('event', handler);
  ```
- **Option 2**: Use `provide`/`inject` for parent-child communication.
- See: https://v3-migration.vuejs.org/breaking-changes/events-api.html

---

### "return this" in script setup

**Cause**: Some Vue 2 components returned `this` for chaining (e.g. progress bar, toast plugins).

**Solution**: The `returnThisInScriptSetupRule` replaces with an `api` object + `defineExpose(api)`. If the fix does not apply, create manually:
  ```ts
  const api = { start, finish, /* ... */ };
  defineExpose(api);
  return api;
  ```

---

### v-model with computed (warning)

**Cause**: `v-model` must be bound to a `ref`, not a writable `computed`.

**Solution**: Replace the computed with a ref + getter/setter:
  ```ts
  const value = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v)
  });
  // Then v-model="value" → use :model-value and @update:model-value
  ```
  Or use a local ref if the component owns the state.

---

### Build fails after migration

**Possible causes**:
1. **Missing imports**: Run `vue-ai-migrator fix ./project` to apply post-migration fixes.
2. **Pinia store**: Ensure `createPinia()` is called in `main.ts`.
3. **Router**: Ensure `app.use(router)` is after `app.use(pinia)` if the router uses the store.
4. **Types**: With `--typescript`, some types may be incorrect; fix the reported errors.

---

### Fix rules disabled / customized

**Configuration**: Create `vue-migrator.config.js` at the project root:

```js
module.exports = {
  // Disable a rule
  fixerRulesDisable: ["detail-view-store-rule", "event-bus-detection"],

  // Run only specific rules
  fixerRulesEnable: ["missing-vue-imports", "missing-filter-imports"],

  // Custom paths
  storePaths: ["src/store", "src/stores"],
  filterPaths: ["src/filters", "src/util/filters"],
  routerPaths: ["src/router", "src/routes"],
};
```

---

### Dry-run mode and report

```bash
# Preview changes without applying
vue-ai-migrator migrate ./project --dry-run

# Generate JSON report
vue-ai-migrator migrate ./project --output ./report.json
```

---

### Resources

- [Vue 3 Migration Guide](https://v3-migration.vuejs.org/)
- [Pinia](https://pinia.vuejs.org/)
- [Vue Router 4](https://router.vuejs.org/)
