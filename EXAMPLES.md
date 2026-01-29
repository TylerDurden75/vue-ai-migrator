# Examples - vue-ai-migrator

## 🆕 New in v0.4.0

### Script Setup Conversion

The library now supports automatic conversion to `<script setup lang="ts">` format:

**Before (Options API):**

```vue
<template>
  <div>{{ message }}</div>
</template>

<script>
export default {
  data() {
    return {
      message: 'Hello Vue',
    };
  },
  methods: {
    greet() {
      console.log(this.message);
    },
  },
};
</script>
```

**After (Script Setup):**

```vue
<template>
  <div>{{ message }}</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const message = ref('Hello Vue');

function greet() {
  console.log(message.value);
}
</script>
```

### AST-based Composition API Transformation

The Composition API transformation now uses AST manipulation for more accurate code generation:

**Before:**

```javascript
export default {
  data() {
    return {
      count: 0,
      name: 'Vue',
    };
  },
  computed: {
    doubleCount() {
      return this.count * 2;
    },
  },
  methods: {
    increment() {
      this.count++;
    },
  },
};
```

**After:**

```javascript
import { ref, computed } from 'vue';

const count = ref(0);
const name = ref('Vue');
const doubleCount = computed(() => count.value * 2);

function increment() {
  count.value++;
}
```

---

## Basic Migration

```bash
vue-ai-migrator migrate ./my-vue2-project
```

## Migration with Options

```bash
vue-ai-migrator migrate ./my-vue2-project \
  --ai-api-key sk-... \
  --dry-run \
  --output ./report.json
```

## Migration without AI

```bash
vue-ai-migrator migrate ./my-vue2-project --no-ai
```

## Migration with Specific Transformations

```bash
vue-ai-migrator migrate ./my-vue2-project \
  --transformations "composition-api,script-setup,global-api,filters"
```

## Analysis without Migration

```bash
vue-ai-migrator analyze ./my-vue2-project
```

## Programmatic Usage

```typescript
import { migrate } from 'vue-ai-migrator';

const result = await migrate({
  projectPath: './my-project',
  aiApiKey: process.env.OPENAI_API_KEY,
  dryRun: false,
});

console.log(`Files modified: ${result.filesModified}`);
```

## Transformation Examples

### Before (Vue 2)

```vue
<template>
  <div>
    <p>{{ message | capitalize }}</p>
    <button @click="increment">Count: {{ count }}</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      message: 'hello world',
      count: 0,
    };
  },
  filters: {
    capitalize(value) {
      return value.charAt(0).toUpperCase() + value.slice(1);
    },
  },
  methods: {
    increment() {
      this.count++;
    },
  },
};
</script>
```

### After (Vue 3)

```vue
<template>
  <div>
    <p>{{ capitalizedMessage }}</p>
    <button @click="increment">Count: {{ count }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const message = ref('hello world');
const count = ref(0);

const capitalizedMessage = computed(() => {
  return message.value.charAt(0).toUpperCase() + message.value.slice(1);
});

function increment() {
  count.value++;
}
</script>
```

## Complete Component Transformation

### Options API → Composition API

**Before:**

```javascript
export default {
  props: {
    title: String,
    count: Number,
  },
  emits: ['update'],
  data() {
    return {
      message: 'Hello',
      items: [],
    };
  },
  computed: {
    doubleCount() {
      return this.count * 2;
    },
  },
  methods: {
    updateMessage(newMessage) {
      this.message = newMessage;
      this.$emit('update', newMessage);
    },
  },
  watch: {
    count(newVal) {
      console.log('Count changed:', newVal);
    },
  },
  mounted() {
    console.log('Component mounted');
  },
  beforeDestroy() {
    console.log('Component destroying');
  },
};
```

**After:**

```javascript
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  title: String,
  count: Number,
});

const emit = defineEmits(['update']);

const message = ref('Hello');
const items = ref([]);

const doubleCount = computed(() => props.count * 2);

function updateMessage(newMessage) {
  message.value = newMessage;
  emit('update', newMessage);
}

watch(
  () => props.count,
  (newVal) => {
    console.log('Count changed:', newVal);
  }
);

onMounted(() => {
  console.log('Component mounted');
});

onBeforeUnmount(() => {
  console.log('Component destroying');
});
```

## Vuex → Pinia Migration

### Complete Store Migration

**Before (Vuex Store):**

```javascript
import Vue from 'vue';
import Vuex from 'vuex';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    count: 0,
    todos: [],
    user: null,
  },

  getters: {
    doubleCount: (state) => state.count * 2,
    todoCount: (state) => state.todos.length,
    isAuthenticated: (state) => !!state.user,
  },

  mutations: {
    INCREMENT(state) {
      state.count++;
    },
    ADD_TODO(state, todo) {
      state.todos.push(todo);
    },
    SET_USER(state, user) {
      state.user = user;
    },
  },

  actions: {
    increment({ commit }) {
      commit('INCREMENT');
    },

    async addTodo({ commit }, todo) {
      const savedTodo = await api.saveTodo(todo);
      commit('ADD_TODO', savedTodo);
      return savedTodo;
    },

    async login({ commit }, credentials) {
      const user = await api.login(credentials);
      commit('SET_USER', user);
      return user;
    },

    logout({ commit }) {
      commit('SET_USER', null);
    },
  },
});
```

**After (Pinia Setup Store):**

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useStore = defineStore('store', () => {
  // State with ref/reactive
  const count = ref(0);
  const todos = ref<Array<{ id: number; text: string }>>([]);
  const user = ref<{ name: string; email: string } | null>(null);

  // Getters with computed
  const doubleCount = computed(() => count.value * 2);
  const todoCount = computed(() => todos.value.length);
  const isAuthenticated = computed(() => !!user.value);

  // Mutations → Functions
  function INCREMENT() {
    count.value++;
  }

  function ADD_TODO(todo: { id: number; text: string }) {
    todos.value.push(todo);
  }

  function SET_USER(newUser: { name: string; email: string } | null) {
    user.value = newUser;
  }

  // Actions → Functions
  function increment() {
    INCREMENT();
  }

  async function addTodo(todo: { id: number; text: string }) {
    const savedTodo = await api.saveTodo(todo);
    ADD_TODO(savedTodo);
    return savedTodo;
  }

  async function login(credentials: { email: string; password: string }) {
    const loggedInUser = await api.login(credentials);
    SET_USER(loggedInUser);
    return loggedInUser;
  }

  function logout() {
    SET_USER(null);
  }

  // Return all state, getters, and actions
  return {
    // State
    count,
    todos,
    user,
    // Getters
    doubleCount,
    todoCount,
    isAuthenticated,
    // Actions
    increment,
    addTodo,
    login,
    logout,
  };
});
```

### Usage in Components

**Before (Vuex):**

```vue
<script>
import { mapState, mapGetters, mapActions } from 'vuex';

export default {
  computed: {
    ...mapState(['count', 'user']),
    ...mapGetters(['doubleCount', 'isAuthenticated']),
  },
  methods: {
    ...mapActions(['increment', 'login']),
  },
};
</script>
```

**After (Pinia):**

```vue
<script setup lang="ts">
import { useStore } from '@/stores/store';

const store = useStore();

// Direct access to state, getters, and actions
const count = store.count;
const doubleCount = store.doubleCount;
const isAuthenticated = store.isAuthenticated;

function handleLogin() {
  store.login({ email: 'user@example.com', password: 'pass' });
}
</script>
```

## TypeScript Migration Examples

### With `--typescript` Flag

**Before (Vue 2 - JavaScript):**

```vue
<script>
export default {
  props: {
    title: String,
    count: Number,
    items: Array,
  },
  data() {
    return {
      message: 'Hello',
      active: false,
    };
  },
  computed: {
    total() {
      return this.items.length;
    },
  },
  methods: {
    updateMessage(newMessage) {
      this.message = newMessage;
    },
  },
};
</script>
```

**After (Vue 3 - TypeScript with `--typescript`):**

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

interface Props {
  title: string;
  count: number;
  items: unknown[];
}

const props = defineProps<Props>();

const message = ref<string>('Hello');
const active = ref<boolean>(false);

const total = computed<number>(() => props.items.length);

function updateMessage(newMessage: string): void {
  message.value = newMessage;
}
</script>
```

### Complex Props with TypeScript

**Before:**

```vue
<script>
export default {
  props: {
    user: {
      type: Object,
      required: true,
    },
    settings: {
      type: Object,
      default: () => ({ theme: 'light' }),
    },
  },
};
</script>
```

**After (with `--typescript`):**

```vue
<script setup lang="ts">
interface User {
  id: number;
  name: string;
  email: string;
}

interface Settings {
  theme: 'light' | 'dark';
  language: string;
}

interface Props {
  user: User;
  settings?: Settings;
}

const props = withDefaults(defineProps<Props>(), {
  settings: () => ({ theme: 'light', language: 'en' }),
});
</script>
```

### Typed Store with TypeScript

**Before (Vuex - JavaScript):**

```javascript
export default new Vuex.Store({
  state: {
    users: [],
  },
  mutations: {
    ADD_USER(state, user) {
      state.users.push(user);
    },
  },
});
```

**After (Pinia - TypeScript with `--typescript`):**

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';

interface User {
  id: number;
  name: string;
  email: string;
}

export const useUserStore = defineStore('user', () => {
  const users = ref<User[]>([]);

  function ADD_USER(user: User): void {
    users.value.push(user);
  }

  return {
    users,
    ADD_USER,
  };
});
```
