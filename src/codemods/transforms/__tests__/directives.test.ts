import * as jscodeshift from "jscodeshift";
import { directivesTransform } from "../directives";

const j = jscodeshift.withParser("tsx");

function runTransform(source: string): string {
  const api = {
    jscodeshift: j,
    j,
    stats: () => {},
    report: () => {},
  };
  const result = directivesTransform(
    { path: "test.js", source },
    api,
    { enableTypeScript: false }
  );
  return typeof result === "string" ? result : source;
}

describe("directivesTransform (Custom Directives breaking)", () => {
  describe("hook renames", () => {
    it("should transform bind → beforeMount", () => {
      const code = `
        export default {
          directives: {
            vFocus: {
              bind(el, binding) {
                el.focus();
              }
            }
          }
        };
      `;
      const result = runTransform(code);
      expect(result).toContain("beforeMount");
      expect(result).not.toMatch(/\bbind\s*\(/); // "bind(" as hook, not "binding"
    });

    it("should transform inserted → mounted", () => {
      const code = `
        export default {
          directives: {
            vHighlight: {
              inserted(el, binding) {
                el.style.background = binding.value;
              }
            }
          }
        };
      `;
      const result = runTransform(code);
      expect(result).toContain("mounted");
      expect(result).not.toContain("inserted");
    });

    it("should transform update → updated (Vue 3: use updated instead)", () => {
      const code = `
        export default {
          directives: {
            vFoo: {
              update(el, binding) {
                el.textContent = binding.value;
              }
            }
          }
        };
      `;
      const result = runTransform(code);
      expect(result).toContain("updated");
      expect(result).not.toMatch(/\bupdate\s*\(/); // "update(" as hook, not "updated"
    });

    it("should transform componentUpdated → updated", () => {
      const code = `
        export default {
          directives: {
            vBar: {
              componentUpdated(el, binding) {
                el.dataset.foo = binding.value;
              }
            }
          }
        };
      `;
      const result = runTransform(code);
      expect(result).toContain("updated");
      expect(result).not.toContain("componentUpdated");
    });

    it("should transform unbind → unmounted", () => {
      const code = `
        export default {
          directives: {
            vCleanup: {
              unbind(el) {
                el.removeEventListener('click', el._handler);
              }
            }
          }
        };
      `;
      const result = runTransform(code);
      expect(result).toContain("unmounted");
      expect(result).not.toContain("unbind");
    });
  });

  describe("vnode.context → binding.instance", () => {
    it("should replace vnode.context with binding.instance in component directives", () => {
      const code = `
        export default {
          directives: {
            vAccess: {
              bind(el, binding, vnode) {
                const vm = vnode.context;
                vm.$nextTick(() => {});
              }
            }
          }
        };
      `;
      const result = runTransform(code);
      expect(result).toContain("binding.instance");
      expect(result).not.toContain("vnode.context");
    });

    it("should replace vnode.context in Vue.directive() definitions", () => {
      const code = `
        Vue.directive('focus', {
          inserted(el, binding, vnode) {
            const vm = vnode.context;
            if (vm.$options.directives) {}
          }
        });
      `;
      const result = runTransform(code);
      expect(result).toContain("binding.instance");
      expect(result).not.toContain("vnode.context");
    });
  });

  describe("Vue.directive() hook names", () => {
    it("should transform hooks in Vue.directive() inline definitions", () => {
      const code = `
        Vue.directive('highlight', {
          bind(el, binding) {
            el.style.background = binding.value;
          }
        });
      `;
      const result = runTransform(code);
      expect(result).toContain("beforeMount");
      expect(result).not.toMatch(/\bbind\s*\(/);
    });
  });
});
