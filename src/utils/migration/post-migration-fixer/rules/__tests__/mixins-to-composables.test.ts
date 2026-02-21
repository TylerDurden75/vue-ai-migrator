/**
 * Tests for mixins → composables migration rule
 */

import * as path from "path";
import { mixinsToComposablesRule } from "../mixins/mixins-to-composables";

const projectRoot = "/fake/project";

function makeMap(entries: Array<{ mixinPath: string; composableName: string; returnKeys: string[] }>) {
  const m = new Map<
    string,
    { composableName: string; returnKeys: string[]; composablePath: string }
  >();
  for (const e of entries) {
    const abs = path.resolve(projectRoot, e.mixinPath);
    m.set(abs, {
      composableName: e.composableName,
      returnKeys: e.returnKeys,
      composablePath: path.join(projectRoot, "src", "composables", `${e.composableName}.ts`),
    });
  }
  return m;
}

const baseContext = {
  enableTypeScript: false,
  isVueFile: false,
  projectRoot,
};

describe("mixinsToComposablesRule", () => {
  it("replaces mixins with composable when import resolves to mapped mixin", async () => {
    const map = makeMap([
      {
        mixinPath: "src/mixins/userMixin.js",
        composableName: "useUserMixin",
        returnKeys: ["name", "load"],
      },
    ]);

    const content = `<script>
import userMixin from '@/mixins/userMixin';
export default {
  mixins: [userMixin],
  template: '<div></div>',
};
</script>`;

    const result = await mixinsToComposablesRule.apply(
      path.join(projectRoot, "src", "views", "User.vue"),
      content,
      { ...baseContext, mixinComposablesMap: map, isVueFile: true }
    );

    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import { useUserMixin } from '@/composables/useUserMixin'");
    expect(result.content).toContain("const { name, load } = useUserMixin();");
    expect(result.content).not.toContain("mixins: [userMixin]");
    expect(result.content).not.toContain("mixins:");
  });

  it("uses heuristic fallback when import path not in map", async () => {
    const map = makeMap([
      {
        mixinPath: "src/mixins/userMixin.js",
        composableName: "useUserMixin",
        returnKeys: [],
      },
    ]);

    const content = `<script>
import userMixin from './mixins/userMixin';
export default {
  mixins: [userMixin],
};
</script>`;

    const filePath = path.join(projectRoot, "src", "views", "User.vue");
    const result = await mixinsToComposablesRule.apply(filePath, content, {
      ...baseContext,
      mixinComposablesMap: map,
      isVueFile: true,
    });

    // Heuristic: userMixin matches useUserMixin
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("useUserMixin");
  });

  it("does not apply when no mixins in map", async () => {
    const content = `<script>
export default {
  mixins: [someMixin],
};
</script>`;

    const result = await mixinsToComposablesRule.apply("src/Foo.vue", content, baseContext);
    expect(result.fixed).toBe(false);
  });

  it("does not apply when content has no mixins block", () => {
    expect(mixinsToComposablesRule.shouldApply("src/bar.vue", "export default {}")).toBe(false);
  });

  it("applies when mixins array present", () => {
    expect(mixinsToComposablesRule.shouldApply("src/foo.vue", "mixins: [x]")).toBe(true);
  });
});
