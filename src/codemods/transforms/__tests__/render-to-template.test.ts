import { convertRenderToTemplate } from "../render-to-template";

describe("convertRenderToTemplate", () => {
  it("should convert simple render to script setup + template", () => {
    const script = `
export default {
  props: ['text'],
  render(h) {
    return h('button', {
      class: 'button',
      attrs: { id: 'submit' },
      on: { click: () => this.$emit('submit') }
    }, this.text);
  }
}
`;
    const result = convertRenderToTemplate(script);
    expect(result.converted).toBe(true);
    expect(result.script).toContain("defineProps");
    expect(result.script).toContain("defineEmits");
    expect(result.script).toContain("submit");
    expect(result.template).toContain("<button");
    expect(result.template).toContain('class="button"');
    expect(result.template).toContain('id="submit"');
    expect(result.template).toContain("emit('submit')");
    expect(result.template).toContain("props.text");
  });
});
