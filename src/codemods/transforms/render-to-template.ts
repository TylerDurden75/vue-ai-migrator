import * as jscodeshift from "jscodeshift";

export interface RenderToTemplateResult {
  script: string;
  template: string;
  converted: boolean;
}

/**
 * Convert Vue 2 render function to Vue 3 script setup + template.
 * Target: script setup + Composition API.
 */
export function convertRenderToTemplate(
  scriptContent: string,
  options: { enableTypeScript?: boolean } = {}
): RenderToTemplateResult {
  const j = jscodeshift.withParser("tsx");
  let root: any;
  try {
    root = j(scriptContent);
  } catch {
    return { script: scriptContent, template: "", converted: false };
  }

  let propsDef: any[] = [];
  let emitsList: string[] = [];
  let rootHCall: any = null;

  // Find export default { ... }
  root.find(j.ExportDefaultDeclaration).forEach((path: any) => {
    const decl = path.value.declaration;
    if (!decl || decl.type !== "ObjectExpression") return;

    const props = decl.properties || [];
    const getProp = (name: string) => props.find((p: any) => (p.key?.name ?? p.key?.value) === name);

    // Extract props
    const propsOpt = getProp("props");
    if (propsOpt?.value) {
      if (propsOpt.value.type === "ArrayExpression") {
        propsDef = (propsOpt.value.elements || [])
          .filter((e: any) => e?.type === "StringLiteral" || (e?.value && typeof e.value === "string"))
          .map((e: any) => ({
            name: typeof e?.value === "string" ? e.value : e?.name,
            type: "String"
          }));
      } else if (propsOpt.value.type === "ObjectExpression") {
        propsDef = (propsOpt.value.properties || []).map((p: any) => {
          const name = p.key?.name ?? p.key?.value;
          let type = "String";
          if (p.value?.type === "Identifier") type = p.value.name;
          else if (p.value?.type === "StringLiteral") type = "String";
          else if (p.value?.type === "NumberLiteral" || p.value?.value?.type === "Number") type = "Number";
          return { name, type };
        });
      }
    }

    // Extract emits
    const emitsOpt = getProp("emits");
    if (emitsOpt?.value?.type === "ArrayExpression") {
      emitsList = (emitsOpt.value.elements || [])
        .map((e: any) => (e?.type === "StringLiteral" ? e.value : e?.value ?? e?.name))
        .filter(Boolean);
    }

    // Find render and extract root h() call (ObjectMethod or ObjectProperty)
    const renderOpt = props.find((p: any) => (p.key?.name ?? p.key?.value) === "render");
    if (!renderOpt) return;

    const renderFn = renderOpt.type === "ObjectMethod" ? renderOpt : renderOpt.value;
    if (!renderFn) return;
    let renderBody = renderFn.body;
    if (renderBody?.type !== "BlockStatement") {
      renderBody = { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: renderBody }] };
    }

    const findReturnH = (node: any): any => {
      if (!node) return null;
      if (node.type === "ReturnStatement" && node.argument?.type === "CallExpression") {
        const callee = node.argument.callee;
        if (callee?.type === "Identifier" && callee.name === "h" && node.argument.arguments?.length >= 1) {
          return node.argument;
        }
      }
      if (node.body) {
        const stmts = Array.isArray(node.body) ? node.body : [node.body];
        for (const stmt of stmts) {
          const found = findReturnH(stmt);
          if (found) return found;
        }
      }
      return null;
    };

    rootHCall = findReturnH(renderBody);
  });

  if (!rootHCall || rootHCall.arguments.length < 1) {
    return { script: scriptContent, template: "", converted: false };
  }

  const tag = rootHCall.arguments[0];
  const tagName = tag?.type === "StringLiteral" ? tag.value : tag?.type === "Identifier" ? tag.name : "div";
  const propsObj = rootHCall.arguments[1];
  const children = rootHCall.arguments.slice(2);

  // Collect emits from on/onClick handlers
  const emitRegex = /(?:this\.)?\$?emit\s*\(\s*['"]([^'"]+)['"]/g;
  if (propsObj?.type === "ObjectExpression") {
    const onProp = (propsObj.properties || []).find((p: any) => (p.key?.name ?? p.key?.value) === "on");
    if (onProp?.value?.type === "ObjectExpression") {
      (onProp.value.properties || []).forEach((p: any) => {
        const src = j(p.value).toSource();
        let m;
        while ((m = emitRegex.exec(src)) !== null) emitsList.push(m[1]);
      });
    }
    (propsObj.properties || []).forEach((p: any) => {
      const key = p.key?.name ?? p.key?.value;
      if (key?.startsWith("on") && key.length > 2) {
        const src = j(p.value).toSource();
        let m;
        while ((m = emitRegex.exec(src)) !== null) emitsList.push(m[1]);
      }
    });
  }
  emitsList = [...new Set(emitsList)];

  // Convert h() props to template attrs
  const attrs: string[] = [];
  if (propsObj?.type === "ObjectExpression") {
    const getProp = (key: string) =>
      (propsObj.properties || []).find((p: any) => (p.key?.name ?? p.key?.value) === key);

    // class: staticClass (string) + class (object/array)
    const staticClass = getProp("staticClass");
    const classProp = getProp("class");
    if (staticClass?.value?.type === "StringLiteral") {
      attrs.push(`class="${staticClass.value.value}"`);
    }
    if (classProp) {
      if (classProp.value?.type === "StringLiteral") {
        attrs.push(`class="${classProp.value.value}"`);
      } else {
        attrs.push(`:class="${j(classProp.value).toSource()}"`);
      }
    }
    if (!staticClass && !classProp) {
      // key might be used for other things
    }

    // style
    const style = getProp("style") ?? getProp("staticStyle");
    if (style?.value?.type === "ObjectExpression") {
      const styleStr = (style.value.properties || [])
        .map((p: any) => {
          const k = p.key?.name ?? p.key?.value ?? "unknown";
          return `${String(k).replace(/([A-Z])/g, "-$1").toLowerCase()}: ${j(p.value).toSource()}`;
        })
        .join("; ");
      attrs.push(`:style="{ ${styleStr} }"`);
    } else if (style?.value?.type === "StringLiteral") {
      attrs.push(`style="${style.value.value}"`);
    }

    // attrs
    const attrsProp = getProp("attrs");
    if (attrsProp?.value?.type === "ObjectExpression") {
      (attrsProp.value.properties || []).forEach((p: any) => {
        const k = p.key?.name ?? p.key?.value;
        if (p.value?.type === "StringLiteral") attrs.push(`${k}="${p.value.value}"`);
        else attrs.push(`:${k}="${j(p.value).toSource()}"`);
      });
    }

    // on / onClick etc.
    const onProp = getProp("on");
    if (onProp?.value?.type === "ObjectExpression") {
      (onProp.value.properties || []).forEach((p: any) => {
        const event = p.key?.name ?? p.key?.value;
        let handler = j(p.value).toSource();
        handler = handler.replace(/\bthis\.\$emit\s*\(\s*(['"][^'"]+['"])/g, "emit($1");
        // Simplify () => emit('x') to emit('x') for zero-arg arrow
        if (/^\s*\(\s*\)\s*=>\s*/.test(handler)) {
          handler = handler.replace(/^\s*\(\s*\)\s*=>\s*/, "").trim();
        }
        attrs.push(`@${event}="${handler}"`);
      });
    }
    (propsObj.properties || []).forEach((p: any) => {
      const key = p.key?.name ?? p.key?.value;
      if (key?.startsWith("on") && key.length > 2 && key !== "on" && !getProp("on")) {
        const event = key.charAt(2).toLowerCase() + key.slice(3);
        let handler = j(p.value).toSource();
        handler = handler.replace(/\bthis\.\$emit\s*\(\s*(['"][^'"]+['"])/g, "emit($1");
        if (/^\s*\(\s*\)\s*=>\s*/.test(handler)) {
          handler = handler.replace(/^\s*\(\s*\)\s*=>\s*/, "").trim();
        }
        attrs.push(`@${event}="${handler}"`);
      }
    });
  }

  // Children to template content
  let content = "";
  if (children.length > 0) {
    content = children
      .map((c: any) => {
        if (c.type === "StringLiteral") return c.value;
        const src = j(c).toSource();
        if (c.type === "MemberExpression" && c.object?.name === "this") {
          const prop = c.property?.name ?? c.property?.value;
          return `{{ props.${prop} }}`;
        }
        if (c.type === "Identifier") return `{{ ${c.name} }}`;
        return `{{ ${src.replace(/^this\./, "props.")} }}`;
      })
      .join("\n    ");
  }

  const templateTag = /^[a-z]/.test(tagName) ? tagName : tagName; // component vs element
  const attrsStr = attrs.length > 0 ? "\n    " + attrs.join("\n    ") : "";
  const template = `<${templateTag}${attrsStr}>
  ${content || ""}
</${templateTag}>`;

  // Generate script setup (defineProps/defineEmits are compiler macros - no import needed)
  const ts = options.enableTypeScript ?? false;
  const propsDecl =
    propsDef.length > 0
      ? `const props = defineProps(${
          ts && propsDef.some((p) => p.type)
            ? `{\n  ${propsDef.map((p) => `${p.name}: ${p.type}`).join(",\n  ")}\n}`
            : `[${propsDef.map((p) => `'${p.name}'`).join(", ")}]`
        });`
      : "";
  const emitsDecl =
    emitsList.length > 0
      ? `const emit = defineEmits([${emitsList.map((e) => `'${e}'`).join(", ")}]);`
      : "";

  const scriptLines = [propsDecl, emitsDecl].filter(Boolean);

  return {
    script: scriptLines.join("\n\n"),
    template: template.trim(),
    converted: true
  };
}
