# Supported Transformations

Complete list of Vue 2 → Vue 3 transformations applied by vue-ai-migrator.

## Script Transformations

- ✅ **Options API → Composition API**: Complete transformation using AST manipulation
  - `data()` → `ref()`/`reactive()`
  - `computed` → `computed()` (including writable computed with get/set)
  - `methods` → functions
  - `props` → `defineProps()`
  - `emits` → `defineEmits()`
  - `watch` → `watch()`
  - `provide`/`inject` → `provide()`/`inject()` (Composition API)
  - Lifecycle hooks → `onMounted()`, `onUpdated()`, etc.
  - `$listeners` → `$attrs`
- ✅ **Script Setup Conversion**: Automatic conversion to `<script setup lang="ts">` format
- ✅ **Global API changes**: `new Vue()` → `createApp()`, Vue.component() → app.component()
- ✅ **Router Vue 2 → Vue Router 4**: `new Router()` → `createRouter()`, mode → history functions
- ✅ **Vuex → Pinia**: Complete store transformation using Setup Store syntax
  - `new Vuex.Store()` → `defineStore('name', () => { ... })`
  - `state` → `ref()`/`reactive()` declarations
  - `getters` → `computed()` declarations
  - `mutations` → functions (direct state mutation)
  - `actions` → functions
  - Automatic import updates (`vuex` → `pinia`)
- ✅ **Filters removal**: Automatic filter detection and removal from script
- ✅ **Event API changes**: `$on`/`$off`/`$once` detection and marking for AI
- ✅ **v-model changes**: Props/emits transformation (value → modelValue, input → update:modelValue); v-model proxy (computed get/set + emit) supported
- ✅ **Mixins**: Detection and transformation of mixins
- ✅ **Plugins**: Vue.use() → app.use() transformation
- ✅ **Directives**: Full custom directive support
  - Hook renames: bind→beforeMount, inserted→mounted, update/componentUpdated→updated, unbind→unmounted
  - `vnode.context` → `binding.instance`
  - `Vue.directive()` → `app.directive()` (global API)
  - Warning when `binding.expression` is used (removed in Vue 3; use `binding.value`)
- ✅ **Provide/Inject**: Full transformation to `provide()`/`inject()` (Composition API, including default factory)
- ✅ **Async Components**: `() => import('./Comp.vue')` → `defineAsyncComponent(() => import('./Comp.vue'))`
  - Handles both arrow functions and object component definitions
- ✅ **Render Functions**: Vue 3 Render Function API (Composition API / script setup compatible)
  - **Render-only .vue** → converted to **script setup + template**
  - `render(h)` → `render()` with `import { h } from 'vue'` (for .js/.ts with render)
  - `h('ComponentName')` → `h(resolveComponent('ComponentName'))` for registered components
  - VNode props flattening: `attrs`, `domProps`, `on`, `staticClass`, `staticStyle` → Vue 3 flat structure

## Template Transformations

- ✅ **Scoped slots**: `slot-scope` → `v-slot` syntax, `this.$scopedSlots` → `useSlots()`
- ✅ **Named slots**: `slot="name"` → `v-slot:name` (any attribute order)
- ✅ **Filters in templates**: `{{ value | filter }}` → `{{ filter(value) }}`
- ✅ **$listeners**: `$listeners` → `$attrs` in templates
- ✅ **Functional components**: Full transformation
  - Removal of `functional` attribute and `{ functional: true }`
  - `props` → `$props`, `attrs` → `$attrs`, removal of `listeners`
- ✅ **v-for template key**: Moves `key` from inner element to `<template>` in `v-for`
- ✅ **v-else-if key**: Automatically adds `key` to `v-else-if` when `v-if` has one
- ✅ **v-for/v-if precedence**: Wraps elements with both `v-for` and `v-if` in `<template>`
- ✅ **transition-group root**: Ensures `<transition-group>` has single root element
- ✅ **v-bind.sync**: `v-bind:prop.sync` / `:prop.sync` → `v-model:prop`
- ✅ **Keyboard modifiers**: Keycodes (`.112`, `.13`) → key names (`.f1`, `.enter`)
- ✅ **@hook lifecycle**: `@hook:mounted` → `@vnode-mounted`
- ✅ **Custom Elements Interop**: `is` attribute on non-`<component>` tags
- ✅ **Vue.config.ignoredElements**: → `app.config.compilerOptions.isCustomElement` (plugins + post-fixer)
- ✅ **.native modifier**: Removed (events in `$attrs` in Vue 3)
- ✅ **Transition classes** (in `<style>`): `.v-enter` → `.v-enter-from`, `.v-leave` → `.v-leave-from`
- ✅ **Vue.set / $set**: Replaced with direct assignment (`obj[key] = value`)
- ✅ **Vue.delete / $delete**: Replaced with `delete obj[key]`
- ⚠️ **ref with v-for**: Detection and warning (Vue 3 behavior changed)

## File Support

- ✅ **Vue SFC**: Full `.vue` file parsing (template, script, style sections)
- ✅ **JavaScript/TypeScript**: `.js`, `.ts`, `.jsx`, `.tsx` files
