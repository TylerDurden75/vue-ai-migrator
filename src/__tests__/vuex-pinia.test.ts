import { CodemodRunner } from '../codemods/runner';

describe('Vuex to Pinia Migration', () => {
  let runner: CodemodRunner;

  beforeEach(() => {
    runner = new CodemodRunner();
  });

  describe('vuex-pinia-setup transform', () => {
    it('should transform basic Vuex store to Pinia setup store', async () => {
      const vuexCode = `
import Vue from 'vue';
import Vuex from 'vuex';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    count: 0,
    user: {
      name: 'John',
      age: 30
    }
  },
  getters: {
    doubleCount: (state) => state.count * 2,
    userName: (state) => state.user.name
  },
  mutations: {
    INCREMENT(state) {
      state.count++;
    },
    SET_USER(state, user) {
      state.user = user;
    }
  },
  actions: {
    increment({ commit }) {
      commit('INCREMENT');
    },
    updateUser({ commit }, user) {
      commit('SET_USER', user);
    }
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      expect(result.code).toContain('defineStore');
      expect(result.code).toContain('pinia');
      expect(result.code).not.toContain('Vuex.Store');
      expect(result.code).not.toContain('Vue.use(Vuex)');
    });

    it('should transform state to ref/reactive', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {
    count: 0,
    items: []
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      // Should use ref or reactive for state
      expect(
        result.code.includes('ref') ||
          result.code.includes('reactive') ||
          result.code.includes('const count')
      ).toBe(true);
    });

    it('should transform getters to computed', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {
    count: 0
  },
  getters: {
    doubleCount: (state) => state.count * 2
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      // Should use computed for getters
      expect(result.code.includes('computed') || result.code.includes('doubleCount')).toBe(true);
    });

    it('should transform mutations to functions', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {
    count: 0
  },
  mutations: {
    INCREMENT(state) {
      state.count++;
    }
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      // Mutations should become functions
      expect(result.code).not.toContain('mutations:');
      expect(result.code.includes('INCREMENT') || result.code.includes('increment')).toBe(true);
    });

    it('should transform actions to functions', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {
    count: 0
  },
  mutations: {
    INCREMENT(state) {
      state.count++;
    }
  },
  actions: {
    increment({ commit }) {
      commit('INCREMENT');
    }
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      // Actions should become functions without commit parameter
      expect(result.code).not.toContain('actions:');
      expect(result.code.includes('increment') || result.code.includes('function')).toBe(true);
    });

    it('should remove Vuex imports', async () => {
      const vuexCode = `
import Vue from 'vue';
import Vuex from 'vuex';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {}
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      expect(result.code).not.toContain("from 'vuex'");
      expect(result.code).not.toContain('Vue.use(Vuex)');
    });

    it('should add Pinia imports', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {
    count: 0
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      // Check for pinia import (can be single or double quotes)
      expect(
        result.code.includes("from 'pinia'") ||
          result.code.includes('from "pinia"') ||
          result.code.includes('from `pinia`')
      ).toBe(true);
      expect(result.code).toContain('defineStore');
    });

    it('should handle complex store with modules', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {
    user: null,
    settings: {}
  },
  getters: {
    isAuthenticated: (state) => !!state.user,
    userRole: (state) => state.user?.role || 'guest'
  },
  mutations: {
    SET_USER(state, user) {
      state.user = user;
    },
    UPDATE_SETTINGS(state, settings) {
      state.settings = { ...state.settings, ...settings };
    }
  },
  actions: {
    async login({ commit }, credentials) {
      const user = await api.login(credentials);
      commit('SET_USER', user);
      return user;
    },
    logout({ commit }) {
      commit('SET_USER', null);
    }
  }
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      expect(result.code).toContain('defineStore');
      expect(result.code).not.toContain('Vuex.Store');
    });

    it('should handle empty store', async () => {
      const vuexCode = `
export default new Vuex.Store({
  state: {}
});
      `.trim();

      const result = await runner.transform('store.js', vuexCode, {
        transformations: ['vuex-pinia'],
      });

      expect(result.modified).toBe(true);
      expect(result.code).toContain('defineStore');
    });

    it('should not modify non-Vuex code', async () => {
      const regularCode = `
const store = {
  state: {
    count: 0
  }
};
      `.trim();

      const result = await runner.transform('store.js', regularCode, {
        transformations: ['vuex-pinia'],
      });

      // Should not modify if it's not a Vuex store
      expect(result.modified).toBe(false);
    });

    it('should add TypeScript types when enableTypeScript is true', async () => {
      const vuexCode = `
import Vuex from 'vuex';

export default new Vuex.Store({
  state: {
    count: 0,
    message: 'Hello',
    items: []
  },
  getters: {
    doubleCount: (state) => state.count * 2
  },
  mutations: {
    INCREMENT(state) {
      state.count++;
    },
    SET_MESSAGE(state, message) {
      state.message = message;
    }
  },
  actions: {
    increment({ commit }) {
      commit('INCREMENT');
    },
    updateMessage({ commit }, message) {
      commit('SET_MESSAGE', message);
    }
  }
});
      `.trim();

      const result = await runner.transform('store.ts', vuexCode, {
        transformations: ['vuex-pinia'],
        enableTypeScript: true,
      });

      expect(result.modified).toBe(true);

      // Debug: log the generated code to see if interface is there
      // console.log('Generated code:', result.code);

      // Check for TypeScript types in refs - the types should be added
      // Note: The regex replacement should transform ref(0) to ref<number>(0)
      // Using more flexible regex patterns to handle formatting variations
      expect(result.code).toMatch(/ref\s*<\s*number\s*>/);
      expect(result.code).toMatch(/ref\s*<\s*string\s*>/);
      // items should use Item[] interface instead of any[]
      expect(result.code).toMatch(/ref\s*<\s*Item\[\]\s*>/);
      // Computed should have inferred types (number for doubleCount: state.count * 2)
      expect(result.code).toMatch(/computed\s*<\s*number\s*>/);
      expect(result.code).toMatch(/function\s+INCREMENT\s*\(\s*\)\s*:\s*void/);
      expect(result.code).toMatch(
        /function\s+SET_MESSAGE\s*\(\s*message\s*:\s*string\s*\)\s*:\s*void/
      );
      expect(result.code).toMatch(/function\s+increment\s*\(\s*\)\s*:\s*void/);
      expect(result.code).toMatch(
        /function\s+updateMessage\s*\(\s*message\s*:\s*string\s*\)\s*:\s*void/
      );

      // Check for TypeScript interface for store state
      expect(result.code).toContain('interface StoreState');
      expect(result.code).toMatch(/count\s*:\s*number/);
      expect(result.code).toMatch(/message\s*:\s*string/);
      // Check for Item interface and Item[] type
      expect(result.code).toContain('interface Item');
      expect(result.code).toMatch(/items\s*:\s*Item\[\]/);
      // Check that ref uses Item[] instead of any[]
      expect(result.code).toMatch(/ref\s*<\s*Item\[\]\s*>/);
    });

    it('should generate interfaces for any array or object type', async () => {
      const vuexCode = `
import Vuex from 'vuex';

export default new Vuex.Store({
  state: {
    products: [],
    categories: [],
    userPreferences: {},
    shoppingCart: {},
    dataList: [],
    customItems: []
  }
});
      `.trim();

      const result = await runner.transform('store.ts', vuexCode, {
        transformations: ['vuex-pinia'],
        enableTypeScript: true,
      });

      expect(result.modified).toBe(true);

      // Check that interfaces are generated for all arrays
      expect(result.code).toContain('interface Product');
      expect(result.code).toContain('interface Category');
      // dataList doesn't end with 's', so it generates DataList (not DataListItem)
      expect(result.code).toContain('interface DataList');
      expect(result.code).toContain('interface CustomItem');

      // Check that interfaces are generated for objects
      expect(result.code).toContain('interface UserPreferences');
      expect(result.code).toContain('interface ShoppingCart');

      // Check that types are used correctly
      expect(result.code).toMatch(/products\s*:\s*Product\[\]/);
      expect(result.code).toMatch(/categories\s*:\s*Category\[\]/);
      expect(result.code).toMatch(/dataList\s*:\s*DataList\[\]/);
      expect(result.code).toMatch(/customItems\s*:\s*CustomItem\[\]/);
      expect(result.code).toMatch(/userPreferences\s*:\s*UserPreferences/);
      expect(result.code).toMatch(/shoppingCart\s*:\s*ShoppingCart/);
    });
  });

  describe('vuex-pinia-components (mapState/mapActions root store)', () => {
    it('should transform mapState and mapActions with single arg and remove Vuex import', async () => {
      const componentCode = `
<template>
  <div>
    <p>Count: {{ count }}</p>
    <button @click="increment">Increment</button>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';
export default {
  computed: {
    ...mapState(['count']),
  },
  methods: {
    ...mapActions(['increment']),
  },
};
</script>
      `.trim();

      const result = await runner.transform('views/Home.vue', componentCode, {
        transformations: ['vuex-pinia-components'],
      });

      expect(result.modified).toBe(true);
      expect(result.code).toContain('useIndexStore');
      expect(result.code).toMatch(/from\s+['"]\.\.\/store['"]/);
      expect(result.code).toContain('setup');
      expect(result.code).toContain('computed');
      expect(result.code).toMatch(/indexStore\.(count|increment)/);
      expect(result.code).not.toMatch(/from\s+['"]vuex['"]/);
    });
  });
});
