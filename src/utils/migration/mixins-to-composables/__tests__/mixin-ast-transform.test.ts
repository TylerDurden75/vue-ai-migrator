/**
 * Tests for AST-based mixin → composable transformation
 */

import {
  transformMixinToComposableAST,
} from "../mixin-ast-transform";

describe("transformMixinToComposableAST", () => {
  it("migrates data() to ref()", () => {
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
    const result = transformMixinToComposableAST(mixin, "counter", false);
    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    expect(result.code).toContain("const count = ref(0)");
    expect(result.code).toContain("const name = ref('test')");
    expect(result.code).toContain("return {");
    expect(result.analysis.dataKeys).toEqual(["count", "name"]);
  });

  it("migrates methods and transforms this. references", () => {
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
    const result = transformMixinToComposableAST(mixin, "counter", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("count.value++");
    expect(result.code).not.toContain("this.count");
  });

  it("migrates computed and transforms this. references", () => {
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
    const result = transformMixinToComposableAST(mixin, "user", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("computed(() => first.value + ' ' + last.value)");
    expect(result.code).not.toContain("this.first");
  });

  it("falls back with parse error", () => {
    const invalid = "export default { invalid syntax !!";
    const result = transformMixinToComposableAST(invalid, "foo", false);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles defineComponent mixins", () => {
    const mixin = `
import { defineComponent } from 'vue';
export default defineComponent({
  data() {
    return { x: 1 };
  },
});
`;
    const result = transformMixinToComposableAST(mixin, "mixin", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("const x = ref(1)");
  });

  it("migrates inject array to inject()", () => {
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
    const result = transformMixinToComposableAST(mixin, "user", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("import { inject }");
    expect(result.code).toContain("const userId = inject('userId')");
    expect(result.code).toContain("const config = inject('config')");
    expect(result.code).toContain("return config");
    expect(result.code).not.toContain("this.config");
  });

  it("migrates watch to watch()", () => {
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
    const result = transformMixinToComposableAST(mixin, "counter", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("watch(");
    expect(result.code).toContain("count.value");
    expect(result.code).toContain("console.log('changed')");
  });

  it("migrates lifecycle hooks to onMounted, onBeforeUnmount", () => {
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
    const result = transformMixinToComposableAST(mixin, "loader", false);
    expect(result.success).toBe(true);
    expect(result.code).toContain("onMounted(");
    expect(result.code).toContain("onBeforeUnmount(");
    expect(result.code).toContain("loaded.value = true");
    expect(result.code).toContain("console.log('cleanup')");
  });
});
