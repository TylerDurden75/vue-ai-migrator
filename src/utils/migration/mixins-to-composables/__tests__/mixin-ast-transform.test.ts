/**
 * Tests for AST-based mixin → composable transformation
 */

import * as path from "path";
import {
  transformMixinToComposableAST,
} from "../mixin-ast-transform";

describe("transformMixinToComposableAST", () => {
  it("migrates data() to ref()", async () => {
    const mixin = `
export default {
  data() {
    return {
      count: 0,
      name: 'test',
    };
  },
};
`;
    const result = await transformMixinToComposableAST(mixin, "counter", false);
    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    expect(result.code).toContain("const count = ref(0)");
    expect(result.code).toContain("const name = ref('test')");
    expect(result.code).toContain("return {");
    expect(result.analysis.dataKeys).toEqual(["count", "name"]);
  });

  it("migrates methods and transforms this. references", async () => {
    const mixin = `
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
`;
    const result = await transformMixinToComposableAST(mixin, "counter", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("count.value++");
    expect(result.code).not.toContain("this.count");
  });

  it("migrates computed and transforms this. references", async () => {
    const mixin = `
export default {
  data() {
    return { first: 'John', last: 'Doe' };
  },
  computed: {
    fullName() {
      return this.first + ' ' + this.last;
    },
  },
};
`;
    const result = await transformMixinToComposableAST(mixin, "user", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("computed(() => first.value + ' ' + last.value)");
    expect(result.code).not.toContain("this.first");
  });

  it("falls back with parse error", async () => {
    const invalid = "export default { invalid syntax !!";
    const result = await transformMixinToComposableAST(invalid, "foo", false);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles named export mixin (export const X = {})", async () => {
    const mixin = `
export const userMixin = {
  data() {
    return { count: 0 };
  },
  methods: {
    inc() { this.count++; }
  },
};
`;
    const result = await transformMixinToComposableAST(mixin, "userMixin", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("const count = ref(0)");
  });

  it("handles defineComponent mixins", async () => {
    const mixin = `
import { defineComponent } from 'vue';
export default defineComponent({
  data() {
    return { x: 1 };
  },
});
`;
    const result = await transformMixinToComposableAST(mixin, "mixin", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("const x = ref(1)");
  });

  it("migrates inject array to inject()", async () => {
    const mixin = `
export default {
  inject: ['userId', 'config'],
  methods: {
    useConfig() {
      return this.config;
    },
  },
};
`;
    const result = await transformMixinToComposableAST(mixin, "user", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("import { inject }");
    expect(result.code).toContain("const userId = inject('userId')");
    expect(result.code).toContain("const config = inject('config')");
    expect(result.code).toContain("return config");
    expect(result.code).not.toContain("this.config");
  });

  it("migrates watch to watch()", async () => {
    const mixin = `
export default {
  data() {
    return { count: 0 };
  },
  watch: {
    count() {
      console.log('changed');
    },
  },
};
`;
    const result = await transformMixinToComposableAST(mixin, "counter", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("watch(");
    expect(result.code).toContain("count.value");
    expect(result.code).toContain("console.log('changed')");
  });

  it("transforms this.$store.getters.currentUser when projectRoot has Pinia store", async () => {
    const mixin = `
export default {
  computed: {
    isUserAdmin() {
      const currentUser = this.$store.getters.currentUser;
      return currentUser && currentUser.role === 'admin';
    },
  },
};
`;
    const projectRoot = path.join(__dirname, "../../../../../test-project");
    const result = await transformMixinToComposableAST(mixin, "user", false, projectRoot);
    expect(result.success).toBe(true);
    expect(result.code).toContain("currentUser.value");
    expect(result.code).toMatch(/use(User|Index)Store/);
    expect(result.code).toContain("currentUser && currentUser.role === 'admin'");
  });

  it("migrates lifecycle hooks to onMounted, onBeforeUnmount", async () => {
    const mixin = `
export default {
  data() {
    return { loaded: false };
  },
  mounted() {
    this.loaded = true;
  },
  beforeDestroy() {
    console.log('cleanup');
  },
};
`;
    const result = await transformMixinToComposableAST(mixin, "loader", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("onMounted(");
    expect(result.code).toContain("onBeforeUnmount(");
    expect(result.code).toContain("loaded.value = true");
    expect(result.code).toContain("console.log('cleanup')");
  });
});
