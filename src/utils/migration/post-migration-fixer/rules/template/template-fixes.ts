/**
 * Rules for fixing template issues
 */

import * as path from "path";
import * as fs from "fs";
import type { FixRule, FixContext, FixRuleResult } from "../../types";
import { getCachedRegex } from "../../utils/regex-cache";

/** Normalize script attrs: ensure " setup" has leading space (fix <scriptsetup> → <script setup>) */
function normalizeScriptAttrs(attrs: string): string {
  const t = attrs.trim();
  if (/^setup\b/.test(t)) return " " + t;
  return attrs.startsWith(" ") ? attrs : (attrs ? " " + attrs : attrs);
}

/** Extract root template block (handles nested <template>) */
function extractRootTemplateBlock(
  content: string
): { full: string; attrs: string; inner: string } | null {
  const openMatch = content.match(/<template([^>]*)>/i);
  if (!openMatch) return null;
  const startIdx = openMatch.index! + openMatch[0].length;
  let depth = 1;
  let i = startIdx;
  const len = content.length;
  while (i < len && depth > 0) {
    const open = content.indexOf("<template", i);
    const close = content.indexOf("</template>", i);
    if (close === -1) return null;
    if (open !== -1 && open < close) {
      depth++;
      i = open + 9;
    } else {
      depth--;
      if (depth === 0) {
        const inner = content.slice(startIdx, close);
        const full = content.slice(openMatch.index!, close + 11);
        return { full, attrs: openMatch[1], inner };
      }
      i = close + 11;
    }
  }
  return null;
}

/**
 * Fix: Vue 2 → Vue 3 transition-group pattern.
 * Vue 3: transition-group with position: absolute in leave-active causes items to jump to top-left.
 * Pattern: transition > div[v-if] > transition-group with v-for.
 * Solution: add :key on the div (so outer transition animates the whole block), replace transition-group with ul,
 * add mode="out-in". Generic: infers key from v-if (e.g. displayedPage from "displayedPage > 0") or script refs.
 */
export const transitionGroupVue3Rule: FixRule = {
  id: "transition-group-vue3",
  description: "Fix transition-group for Vue 3 (add :key on parent, replace with ul, mode out-in)",
  priority: 61,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const hasTransitionGroup =
      /<transition-group\s+/.test(content) &&
      /<transition[\s>]/.test(content) &&
      /v-for\s*=/.test(content);
    const hasLeaveAbsolute =
      /\.\w+-leave-active\s*\{[\s\S]*?position\s*:\s*absolute/.test(content) ||
      /position\s*:\s*absolute[\s\S]*?\.\w+-leave/.test(content);
    const divHasVifNoKey =
      /<div[^>]*v-if=[^>]*>[\s\S]*?<transition-group/.test(content) &&
      !/<div[^>]*:key\s*=/.test(content);
    return hasTransitionGroup && (hasLeaveAbsolute || divHasVifNoKey);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const block = extractRootTemplateBlock(content);
    if (!block) return result;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    let fixed = block.inner;

    const tgMatch = fixed.match(/<transition-group\s+([^>]*)>([\s\S]*?)<\/transition-group>/i);
    if (!tgMatch) return result;
    const listTag = tgMatch[1].match(/tag\s*=\s*["'](\w+)["']/i)?.[1] ?? "ul";

    const divWithVif = fixed.match(
      /<div\s+([^>]*v-if\s*=\s*["']([^"']+)["'][^>]*)>[\s\S]*?<transition-group/
    );
    const keyVar =
      divWithVif?.[2]?.match(/(\w+)/)?.[1] ??
      ["displayedPage", "displayedTab", "currentPage", "page"].find((v) =>
        new RegExp(`\\b${v}\\s*(=|\\.value)`).test(script)
      ) ??
      null;

    if (keyVar) {
      const divBeforeTg = fixed.match(
        /(<div\s+[^>]*v-if\s*=\s*["'][^"']+["'][^>]*)(>)\s*<transition-group/
      );
      if (divBeforeTg && !divBeforeTg[1].includes(":key")) {
        fixed = fixed.replace(
          new RegExp(
            `(<div\\s+[^>]*v-if\\s*=\\s*["'][^"']+["'][^>]*)(>)\\s*<transition-group`
          ),
          `$1 :key="${keyVar}"$2\n        <transition-group`
        );
      }
    }

    fixed = fixed.replace(
      /<transition-group\s+[^>]*>([\s\S]*?)<\/transition-group>/i,
      `<${listTag}>$1</${listTag}>`
    );

    if (!fixed.match(/<transition[^>]*\s+mode\s*=/)) {
      fixed = fixed.replace(
        /<transition\s+([^>]*)>/,
        (m) => (m.includes('mode="') ? m : m.replace(/>$/, ' mode="out-in">'))
      );
    }

    if (fixed !== block.inner) {
      let fullContent = content.replace(block.full, block.full.replace(block.inner, fixed));
      // Remove position: absolute from .xxx-leave-active (causes jump in Vue 3 when using ul instead of transition-group)
      fullContent = fullContent.replace(
        /(\.\w+-leave-active\s*\{[^}]*?)position\s*:\s*absolute;?\s*/g,
        "$1"
      );
      result.content = fullContent;
      result.fixed = true;
      result.fixes.push("Fixed transition-group for Vue 3 (add :key, mode out-in, replace with list, remove leave-active position)");
    }
    return result;
  },
};

/**
 * Fix: Vue Router 4 - <router-view> can no longer be used directly inside <transition>.
 * Use slot props: <router-view v-slot="{ Component }"><transition><component :is="Component" /></transition></router-view>
 */
export const routerViewTransitionRule: FixRule = {
  id: "router-view-transition",
  description: "Fix router-view inside transition for Vue Router 4 (use slot props)",
  priority: 60,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      /<transition[^>]*>[\s\S]*?<router-view[\s>]/.test(content) &&
      !content.includes('v-slot="{ Component }"')
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: [],
    };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    // <transition ...><router-view ...></router-view></transition> (flexible whitespace/newlines)
    const pattern = /<transition\s+([^>]*)>[\s\S]*?<router-view\s*([^>]*)>\s*<\/router-view>[\s\S]*?<\/transition>/;
    const match = template.match(pattern);
    if (!match) return result;
    const [, transitionAttrs, routerViewAttrs] = match;
    const fixed = template.replace(
      pattern,
      `<router-view v-slot="{ Component }">
      <transition ${transitionAttrs}>
        <component :is="Component" ${routerViewAttrs.trim()} />
      </transition>
    </router-view>`
    );
    result.content = content.replace(
      /<template[^>]*>[\s\S]*?<\/template>/,
      `${openTag}${fixed}${closeTag}`
    );
    result.fixed = true;
    result.fixes.push("Fixed router-view inside transition for Vue Router 4");
    return result;
  },
};

/**
 * Fix: Transition as Root (Vue 3 breaking) - <transition> as component root no longer triggers on external toggle.
 * Migration: add show prop + v-if="show" on child. Parent must change v-if="x" to :show="x".
 * Generic: handles Options API, script setup, and template-only components. Output is always script setup.
 */
export const transitionAsRootRule: FixRule = {
  id: "transition-as-root",
  description: "Fix transition as root - add show prop + v-if on child for Vue 3",
  priority: 59,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!templateMatch) return false;
    const inner = templateMatch[1].trim();
    if (!/^\s*<transition(\s|>)/i.test(inner)) return false;
    if (/\bv-if=["']show["']/i.test(inner)) return false;
    return true;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    const scriptMatch = content.match(/<script([^>]*)>([\s\S]*?)(<\/script>)/);
    if (!templateMatch) return result;

    const [, templateOpen, templateInner, templateClose] = templateMatch;
    const trimmed = templateInner.trim();

    const transitionChildRegex = /(<transition\s*)([^>]*)(>)\s*<(slot|[\w-]+)(\s|>)/i;
    const childMatch = trimmed.match(transitionChildRegex);
    if (!childMatch) return result;

    const [, , , , childTag] = childMatch;
    let fixedTemplate = templateInner;

    if (childTag.toLowerCase() === "slot") {
      fixedTemplate = templateInner.replace(
        /(<transition\s*[^>]*>)\s*(<slot\s*[^>]*>[\s\S]*?<\/slot>)\s*(<\/transition>)/i,
        "$1<div v-if=\"show\">$2</div>$3"
      );
    } else {
      const escapedTag = childTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      fixedTemplate = templateInner.replace(
        new RegExp(
          `(<transition\\s*[^>]*>)\\s*(<${escapedTag})(\\s[^>]*)?(>)`,
          "i"
        ),
        (_m: string, transTag: string, childOpen: string, attrs: string | undefined, close: string) => {
          const vIf = ' v-if="show"';
          const attrsStr = attrs ? `${attrs}${vIf}` : vIf;
          return `${transTag}${childOpen}${attrsStr}${close}`;
        }
      );
    }

    if (fixedTemplate === templateInner) return result;

    let fixedContent = content.replace(
      /<template[^>]*>[\s\S]*?<\/template>/,
      `${templateOpen}${fixedTemplate}${templateClose}`
    );

    // Prefer script setup (vue-ai-migrator target). Add/update defineProps.
    if (scriptMatch) {
      const [, scriptAttrs, scriptInner, scriptClose] = scriptMatch;
      let newScript = scriptInner;
      const isScriptSetup = scriptAttrs.includes("setup");

      if (isScriptSetup || scriptInner.includes("defineProps")) {
        const arrayMatch = scriptInner.match(/defineProps\s*\(\s*\[([^\]]*)\]\s*\)/);
        const objParamsMatch = scriptInner.match(/defineProps\s*\(\s*\{([^}]*)}\s*\)/);
        if (arrayMatch && !/['"]show['"]/.test(arrayMatch[1])) {
          const props = arrayMatch[1].trim();
          const newProps = props ? `${props}, 'show'` : "'show'";
          newScript = scriptInner.replace(
            /defineProps\s*\(\s*\[([^\]]*)\]\s*\)/,
            `defineProps([${newProps}])`
          );
        } else if (objParamsMatch && !/show\s*[:?]/.test(objParamsMatch[1])) {
          const inner = objParamsMatch[1];
          const sep = inner.trim().endsWith(",") || !inner.trim() ? "" : ", ";
          newScript = scriptInner.replace(
            /defineProps\s*\(\s*\{([^}]*)}\s*\)/,
            `defineProps({${inner}${sep}show: Boolean})`
          );
        } else if (!/defineProps/.test(scriptInner) && !/['"]show['"]|show\s*[:?]/.test(scriptInner)) {
          newScript = "defineProps(['show']);\n" + scriptInner.trim();
        }
      } else if (/export\s+default\s*\{/.test(scriptInner)) {
        // Convert to script setup (vue-ai-migrator target) with defineProps
        const propsArrayMatch = scriptInner.match(/props:\s*\[\s*([^\]]*)\]/);
        const propsObjMatch = scriptInner.match(/props:\s*\{\s*([^}]*)\}/);
        let propsList = "'show'";
        if (propsArrayMatch && !/['"]show['"]/.test(propsArrayMatch[1])) {
          const existing = propsArrayMatch[1].trim();
          propsList = existing ? `${existing}, 'show'` : propsList;
        } else if (propsObjMatch && !/show\s*:/.test(propsObjMatch[1])) {
          const keys = propsObjMatch[1].match(/(\w+)\s*:/g);
          if (keys) {
            const names = keys.map((k) => `'${k.replace(/:$/, "")}'`);
            propsList = [...names, "'show'"].join(", ");
          }
        }
        newScript = `defineProps([${propsList}]);\n`;
      }

      if (newScript !== scriptInner) {
        const convertingFromOptionsApi = !scriptAttrs.includes("setup") && /export\s+default\s*\{/.test(scriptInner);
        const attrs = convertingFromOptionsApi
          ? " setup" + (scriptAttrs.trim() ? " " + scriptAttrs.trim() : "")
          : scriptAttrs.startsWith(" ") ? scriptAttrs : " " + scriptAttrs; // normalize <scriptsetup> → <script setup>
        fixedContent = fixedContent.replace(
          /<script[^>]*>[\s\S]*?<\/script>/,
          `<script${attrs}>${newScript}${scriptClose}`
        );
      }
    } else {
      // No script block: add script setup (Vue 2 → 3 Composition API / script setup target)
      const scriptSetupBlock = "\n<script setup>\ndefineProps(['show']);\n</script>\n";
      fixedContent = content.replace(
        /<template[^>]*>[\s\S]*?<\/template>/,
        `${templateOpen}${fixedTemplate}${templateClose}${scriptSetupBlock}`
      );
    }

    result.content = fixedContent;
    result.fixed = true;
    result.fixes.push(
      "Transition as root: added show prop + v-if on child. Update parent: v-if=\"x\" → :show=\"x\""
    );
    result.issues.push(
      "Parent usages must change v-if to :show (e.g. <Modal v-if=\"visible\"> → <Modal :show=\"visible\">)"
    );
    return result;
  },
};

/**
 * Fix: Variable shadowing component - when variable `comment` shadows imported component `Comment`.
 * Convention: component PascalCase, data variable camelCase + "Data" suffix.
 * Renames variable (comment → commentData) in script + template to avoid Vue "reactive object as component" warning.
 * Generic: applies when const x = computed/ref and import X (PascalCase) coexist with <x> or x. in template.
 */
export const componentVariableShadowingRule: FixRule = {
  id: "component-variable-shadowing",
  description: "Fix variable shadowing component - rename variable to XData (convention: component PascalCase, data camelCase)",
  priority: 58,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const baseName = filePath.replace(/^.*\//, "").replace(/\.vue$/i, "");
    const varMatches = script.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:computed|ref)\s*\(/g);
    for (const m of varMatches) {
      const varName = m[1];
      const pascalName = varName.charAt(0).toUpperCase() + varName.slice(1);
      const hasComponent =
        script.includes(`import ${pascalName}`) ||
        script.includes(`import { ${pascalName} }`) ||
        (baseName === pascalName && (new RegExp(`<${varName}[\\s>]`).test(template) || new RegExp(`\\b${varName}\\.`).test(template)));
      const hasConflict =
        (new RegExp(`<${varName}[\\s>]`).test(template) || new RegExp(`\\b${varName}\\.`).test(template)) &&
        hasComponent;
      if (hasConflict) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!scriptMatch || !templateMatch) return result;
    const [, scriptOpen, script, scriptClose] = scriptMatch;
    const [, templateOpen, template, templateClose] = templateMatch;
    const varMatches = [...script.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:computed|ref)\s*\(/g)];
    let fixedScript = script;
    let fixedTemplate = template;
    const baseName = filePath.replace(/^.*\//, "").replace(/\.vue$/i, "");
    for (const m of varMatches) {
      const varName = m[1];
      const pascalName = varName.charAt(0).toUpperCase() + varName.slice(1);
      const newVarName = varName + "Data";
      const hasComponent =
        script.includes(`import ${pascalName}`) ||
        script.includes(`import { ${pascalName} }`) ||
        baseName === pascalName;
      const hasConflict =
        (new RegExp(`<${varName}[\\s>]`).test(template) || new RegExp(`\\b${varName}\\.`).test(template)) &&
        hasComponent;
      if (!hasConflict) continue;
      const varRegex = new RegExp(`\\b${varName}\\b`, "g");
      fixedScript = fixedScript.replace(varRegex, newVarName);
      fixedTemplate = fixedTemplate.replace(new RegExp(`<${varName}([\\s>])`, "g"), `<${pascalName}$1`);
      fixedTemplate = fixedTemplate.replace(new RegExp(`</${varName}>`, "g"), `</${pascalName}>`);
      fixedTemplate = fixedTemplate.replace(varRegex, newVarName);
      result.fixed = true;
    }
    if (result.fixed) {
      result.content = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/, `${scriptOpen}${fixedScript}${scriptClose}`)
        .replace(/<template[^>]*>[\s\S]*?<\/template>/, `${templateOpen}${fixedTemplate}${templateClose}`);
      result.fixes.push("Renamed variable to avoid component shadowing (convention: component PascalCase, data XData)");
    }
    return result;
  },
};

/** HTML elements - never convert to PascalCase */
const HTML_TAGS = new Set(["div", "span", "ul", "ol", "li", "a", "p", "button", "input", "form", "table", "tr", "td", "th", "thead", "tbody", "img", "template", "slot", "router-link", "router-view", "transition", "transition-group", "keep-alive", "component"]);

/**
 * Fix: Use PascalCase for imported component tags (<comment> → <Comment>).
 * Generic: when import X from "..." and template has <x, convert to <X for Vue best practices.
 */
export const componentTagPascalCaseRule: FixRule = {
  id: "component-tag-pascal-case",
  description: "Convert kebab-case component tags to PascalCase when component is imported",
  priority: 57,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    const imports = script.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"][^'"]+\.vue['"]/g);
    for (const m of imports) {
      const names = (m[1] ?? m[2] ?? "").trim();
      for (const name of names.split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim())) {
        if (!name || name.charAt(0) !== name.charAt(0).toUpperCase()) continue;
        const kebab = name.charAt(0).toLowerCase() + name.slice(1).replace(/([A-Z])/g, "-$1").toLowerCase();
        if (!HTML_TAGS.has(kebab) && new RegExp(`<${kebab}[\\s>]|</${kebab}>`).test(template)) return true;
      }
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const [, templateOpen, template, templateClose] = templateMatch;
    let fixed = template;
    const imports = script.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"][^'"]+\.vue['"]/g);
    for (const m of imports) {
      const names = (m[1] ?? m[2] ?? "").trim();
      for (const name of names.split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim())) {
        if (!name || name.charAt(0) !== name.charAt(0).toUpperCase()) continue;
        const kebab = name.charAt(0).toLowerCase() + name.slice(1).replace(/([A-Z])/g, "-$1").toLowerCase();
        if (HTML_TAGS.has(kebab)) continue;
        if (new RegExp(`<${kebab}[\\s>]|</${kebab}>`).test(fixed)) {
          fixed = fixed.replace(new RegExp(`<${kebab}([\\s>])`, "g"), `<${name}$1`);
          fixed = fixed.replace(new RegExp(`</${kebab}>`, "g"), `</${name}>`);
        }
      }
    }
    if (fixed !== template) {
      result.content = content.replace(/<template[^>]*>[\s\S]*?<\/template>/, `${templateOpen}${fixed}${templateClose}`);
      result.fixed = true;
      result.fixes.push("Converted component tags to PascalCase");
    }
    return result;
  },
};

/**
 * Fix: Webpack alias ~public/ to Vite path /public/
 */
export const webpackPublicAliasRule: FixRule = {
  id: "webpack-public-alias",
  description: "Replace ~public/ with /public/ for Vite",
  priority: 59,
  shouldApply: (filePath, content) =>
    filePath.endsWith(".vue") && content.includes("~public/"),
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    const fixed = content.replace(/~public\//g, "/public/");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced ~public/ with /public/ (Vite)");
    }
    return result;
  }
};

/**
 * Fix: Adjacent template interpolations or tag+mustache missing space (e.g. "user56 minutes").
 * Patterns: }}{{ → }} {{ ; ></tag>{{ → ></tag> {{
 * Generic: applies to any Vue template.
 */
export const templateAdjacentMustacheSpacingRule: FixRule = {
  id: "template-adjacent-mustache-spacing",
  description: "Add space between adjacent {{ }} or tag+{{ to fix formatting",
  priority: 59,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return /\}\}\{\{/.test(template) || /<\/(?:[\w-]+)[^>]*>\{\{/.test(template);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    let fixed = template.replace(/\}\}\{\{/g, "}} {{ ");
    fixed = fixed.replace(/(<\/(?:[\w-]+)[^>]*>)(\{\{)/g, "$1 $2");
    if (fixed !== template) {
      result.content = content.replace(
        /<template[^>]*>[\s\S]*?<\/template>/,
        `${openTag}${fixed}${closeTag}`
      );
      result.fixed = true;
      result.fixes.push("Added space between adjacent template interpolations");
    }
    return result;
  }
};

/**
 * Fix: Malformed template interpolations - missing or extra parentheses in {{ }}
 * - {{ fn(arg }} → {{ fn(arg) }} (missing closing paren)
 * - {{ expr) }} → {{ expr }} (extra closing paren before }})
 */
export const templateInterpolationParensRule: FixRule = {
  id: "template-interpolation-parens",
  description: "Fix malformed {{ }} parentheses (missing ) or extra ) before }})",
  priority: 58,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return /\{\{[^}]*\)\s*\}\}|\{\{[^}]*(?:\w+\s*\([^)]*)\s*\}\}/.test(template);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    let fixed = template;
    // 1) Extra ) before }}: {{ expr) }} → {{ expr }}
    fixed = fixed.replace(/\{\{([^}]*)\)\s*\}\}/g, (_, expr) => {
      const open = (expr.match(/\(/g) || []).length;
      const close = (expr.match(/\)/g) || []).length;
      if (open <= close) {
        result.fixed = true;
        return `{{ ${expr.trim()} }}`;
      }
      return `{{ ${expr}) }}`;
    });
    // 2) Missing ) before }}: {{ fn(... }} → {{ fn(...) }}
    fixed = fixed.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, expr) => {
      const trimmed = expr.trim();
      const open = (trimmed.match(/\(/g) || []).length;
      const close = (trimmed.match(/\)/g) || []).length;
      if (open > close && !trimmed.endsWith(")")) {
        result.fixed = true;
        return `{{ ${trimmed}) }}`;
      }
      return match;
    });
    if (result.fixed) {
      result.content = content.replace(
        /<template[^>]*>[\s\S]*?<\/template>/,
        `${openTag}${fixed}${closeTag}`
      );
      result.fixes.push("Fixed template interpolation parentheses");
    }
    return result;
  }
};

/** Resolve filter module path from project root (generic: works for any Vue project structure) */
function resolveFilterPath(projectRoot: string | undefined): string {
  if (projectRoot) {
    const candidates = [
      path.join(projectRoot, "src", "filters", "index.js"),
      path.join(projectRoot, "src", "filters", "index.ts"),
      path.join(projectRoot, "src", "utils", "filters", "index.js"),
      path.join(projectRoot, "src", "utils", "filters.ts"),
      path.join(projectRoot, "src", "util", "filters.js"),
      path.join(projectRoot, "src", "util", "filters.ts"),
      path.join(projectRoot, "src", "filters.js")
    ];
    const hit = candidates.find((p) => fs.existsSync(p));
    if (hit && hit.includes("util") && hit.includes("filters")) return "@/util/filters";
    if (hit && hit.includes("utils") && hit.includes("filters")) return "@/utils/filters";
    if (hit) return "@/filters";
  }
  return "@/filters";
}

/**
 * Fix: Add missing component imports detected from template
 */
export const missingComponentImportsRule: FixRule = {
  id: "missing-component-imports",
  description: "Add missing component imports detected from template usage",
  priority: 60,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("<template>");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.templateContent || !_context.scriptContent) {
      return result;
    }

    // Extract component names from template (PascalCase)
    const componentPattern = getCachedRegex(
      "<([A-Z][a-zA-Z0-9]+)",
      "g"
    );
    
    const usedComponents = new Set<string>();
    let match;
    while ((match = componentPattern.exec(_context.templateContent)) !== null) {
      const componentName = match[1];
      // Skip built-in HTML tags and Vue components
      if (!["RouterView", "RouterLink", "Transition", "KeepAlive", "Teleport", "Suspense"].includes(componentName)) {
        usedComponents.add(componentName);
      }
    }

    // Check which components are not imported
    const baseName = filePath.replace(/^.*\//, "").replace(/\.vue$/i, "");
    const missingComponents: string[] = [];
    usedComponents.forEach(componentName => {
      if (componentName === baseName) return; // Recursive component - no self-import needed
      const importPattern = new RegExp(`import\\s+.*?${componentName}.*?from`, "g");
      if (!importPattern.test(_context.scriptContent!)) {
        missingComponents.push(componentName);
      }
    });

    if (missingComponents.length > 0) {
      let fixed = content;
      const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        
        // Try to find component files (generic approach)
        // Look for common component paths
        const componentPaths = [
          "@/components/",
          "@/components/",
          "../components/",
          "./components/",
          "./"
        ];

        missingComponents.forEach(componentName => {
          // Try to find the component file
          let componentPath = "";
          for (const basePath of componentPaths) {
            // Check if file exists (would need fs access, but for now use common pattern)
            componentPath = `${basePath}${componentName}.vue`;
            break; // Use first path (would need actual file system check in real implementation)
          }

          // Add import
          const importLine = `import ${componentName} from '${componentPath}';\n`;
          
          // Find first non-import line
          const firstCodeLine = scriptContent.match(/^[^i]*?(\n|$)/);
          const insertPos = firstCodeLine ? firstCodeLine.index! : 0;
          
          scriptContent = importLine + scriptContent.substring(insertPos).trim();
        });

        const rawAttrs = scriptMatch[0].match(/<script([^>]*)>/)?.[1] ?? "";
        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${normalizeScriptAttrs(rawAttrs)}>${scriptContent}</script>`
        );

        result.content = fixed;
        result.fixed = true;
        result.fixes.push(`Added missing component imports: ${missingComponents.join(", ")}`);
      }
    }

    return result;
  }
};

/** Author prop aliases (username): .by (HN), .author */
const AUTHOR_PROPS = "by|author";
/** Timestamp prop aliases: .time (HN), .createdAt */
const TIME_PROPS = "time|createdAt";

/**
 * Fix: router-link to profile/user page with wrong content - link should show username (x.by), not time.
 * Pattern: <router-link :to="'/user/' + x.by">{{ timeAgo(x.time) }}</router-link>{{ x.time }} ago
 * → <router-link :to="...">{{ x.by }}</router-link> {{ timeAgo(x.time) }} ago
 * Generic: .by/.author for username, .time/.createdAt for timestamp.
 */
export const routerLinkUserContentRule: FixRule = {
  id: "router-link-user-content",
  description: "Fix router-link: show username in link, timeAgo in 'ago' part",
  priority: 58,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return (
      new RegExp(`<router-link[^>]*:to="[^"]*\\+\\s*\\w+\\.(?:${AUTHOR_PROPS})"[^>]*>\\s*\\{\\{\\s*timeAgo\\s*\\(\\s*\\w+\\.(?:${TIME_PROPS})\\s*\\)\\s*\\}\\}\\s*<\\/router-link>`).test(template) &&
      new RegExp(`\\{\\{\\s*\\w+\\.(?:${TIME_PROPS})\\s*\\}\\}\\s*ago`).test(template)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    const pattern = new RegExp(
      `(<router-link[^>]*:to="[^"]*\\+\\s*(\\w+)\\.(${AUTHOR_PROPS})"[^>]*>)\\s*\\{\\{\\s*timeAgo\\s*\\(\\s*\\2\\.(${TIME_PROPS})\\s*\\)\\s*\\}\\}\\s*(<\\/router-link>)\\s*\\{\\{\\s*\\2\\.\\4\\s*\\}\\}\\s*ago`,
      "g"
    );
    const fixed = template.replace(pattern, "$1{{ $2.$3 }}$5 {{ timeAgo($2.$4) }} ago");
    if (fixed !== template) {
      result.content = content.replace(/<template[^>]*>[\s\S]*?<\/template>/, `${openTag}${fixed}${closeTag}`);
      result.fixed = true;
      result.fixes.push("Fixed router-link to user: username in link, timeAgo in ago part");
    }
    return result;
  },
};

/**
 * Fix: timeAgo(x.by) → timeAgo(x.time) - timeAgo expects timestamp, .by is username.
 * Generic: .by/.author (username) → .time/.createdAt (timestamp).
 */
const WRONG_TIMEAGO_PROPS = "by|author";
const RIGHT_TIMEAGO_PROPS: Record<string, string> = { by: "time", author: "createdAt" };

export const timeAgoWrongArgRule: FixRule = {
  id: "time-ago-wrong-arg",
  description: "Replace timeAgo(x.by/author) with timeAgo(x.time/createdAt) - timeAgo expects timestamp",
  priority: 57,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return new RegExp(`timeAgo\\s*\\(\\s*\\w+\\.(?:${WRONG_TIMEAGO_PROPS})\\s*\\)`).test(template);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    const pattern = new RegExp(`timeAgo\\s*\\(\\s*(\\w+)\\.(${WRONG_TIMEAGO_PROPS})\\s*\\)`, "g");
    const fixed = template.replace(pattern, (_, varName, prop) =>
      `timeAgo(${varName}.${RIGHT_TIMEAGO_PROPS[prop] ?? "time"})`
    );
    if (fixed !== template) {
      result.content = content.replace(/<template[^>]*>[\s\S]*?<\/template>/, `${openTag}${fixed}${closeTag}`);
      result.fixed = true;
      result.fixes.push("Fixed timeAgo(.by/.author) → timeAgo(.time/.createdAt)");
    }
    return result;
  },
};

/** Properties that are NOT URLs - host() expects URL, passing these is wrong */
const NON_URL_PROPS = "score|id|count|amount|name|title|price|value|index|key|type|status|date|time";

/**
 * Fix: host(item.score) → item.score (host expects URL, not numeric/text props).
 * Generic: host(x.prop) when prop is non-URL (score, id, count, etc.) → raw value.
 */
export const hostWrongArgRule: FixRule = {
  id: "host-wrong-arg",
  description: "Replace host(non-URL) with raw value (host expects URL)",
  priority: 57,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return new RegExp(`host\\s*\\(\\s*[^)]*\\.(?:${NON_URL_PROPS})\\s*\\)`).test(template);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const template = templateMatch[2];
    const fixed = template.replace(new RegExp(`host\\s*\\(\\s*([^)]*\\.(?:${NON_URL_PROPS}))\\s*\\)`, "g"), "$1");
    if (fixed !== template) {
      result.content = content.replace(templateMatch[0], templateMatch[1] + fixed + templateMatch[3]);
      result.fixed = true;
      result.fixes.push("Replaced host(non-URL) with raw value");
    }
    return result;
  },
};

/**
 * Fix: Add filter imports when template uses filter as function (e.g. {{ capitalize(x) }}, {{ currency(price) }})
 * Vue 3 has no global filters - each component must import. Generic: detects any fn(x) in template.
 */
export const templateFilterFunctionImportsRule: FixRule = {
  id: "template-filter-function-imports",
  description: "Add filter imports when template uses filter functions (path from project)",
  priority: 56,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script setup") || !content.includes("<template>")) return false;
    const templateSection = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return /\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(templateSection);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateSection = content.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? "";
    const scriptMatch = content.match(/<script([^>]*)>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;
    const usedFilters = new Set<string>();
    const fnCallRe = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    const SKIP_BUILTINS = new Set(["JSON", "parseFloat", "parseInt", "Number", "String", "Boolean", "Array", "Object", "Math", "Date", "RegExp", "Map", "Set", "Promise", "Symbol", "BigInt"]);
    let m;
    while ((m = fnCallRe.exec(templateSection)) !== null) {
      if (!SKIP_BUILTINS.has(m[1])) usedFilters.add(m[1]);
    }
    if (usedFilters.size === 0) return result;
    let scriptContent = scriptMatch[2];
    const toAdd = Array.from(usedFilters).filter((f) => !new RegExp(`import\\s+.*\\b${f}\\b.*from`).test(scriptContent));
    if (toAdd.length === 0) return result;
    const filterPath = resolveFilterPath(_context.projectRoot);
    const importLine = `import { ${toAdd.join(", ")} } from "${filterPath}";\n`;
    const firstImport = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
    const insertIdx = firstImport ? firstImport[0].length : 0;
    scriptContent = scriptContent.slice(0, insertIdx) + importLine + scriptContent.slice(insertIdx);
    result.content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/, `<script${normalizeScriptAttrs(scriptMatch[1])}>${scriptContent}</script>`);
    result.fixed = true;
    result.fixes.push(`Added filter imports: ${toAdd.join(", ")}`);
    return result;
  }
};

/** Convert Vue 2 pipe filter to Vue 3 function call. Handles {{ x | f }} and {{ x | f1 | f2 }}. */
function convertPipeToFunction(inner: string): { result: string; modified: boolean } {
  if (!inner.includes("|") || / \|\|\s*/.test(inner)) return { result: inner, modified: false };
  const singleFilterRegex = /([^|{}]+)\s*\|\s*(\w+)(?:\(([^)]*)\))?/g;
  let prev = "";
  let innerResult = inner;
  let modified = false;
  while (prev !== innerResult) {
    prev = innerResult;
    innerResult = innerResult.replace(
      singleFilterRegex,
      (_m: string, value: string, filterName: string, args?: string) => {
        const trimmedValue = value.trim();
        if (!trimmedValue) return _m;
        modified = true;
        const trimmedArgs = args ? args.trim() : "";
        if (trimmedArgs) return `${filterName}(${trimmedValue}, ${trimmedArgs})`;
        return `${filterName}(${trimmedValue})`;
      }
    );
  }
  return { result: innerResult.trim(), modified };
}

/**
 * Fix: Vue 2 pipe filter syntax → Vue 3 function calls.
 * Converts {{ value | filterName }} to {{ filterName(value) }}, and :attr="x | filter" to :attr="filter(x)".
 * Uses depth-aware template extraction to handle nested <template> (v-if, v-slot).
 * Generic: any filter name, supports chained filters.
 */
export const vue2FilterPipeToFunctionRule: FixRule = {
  id: "vue2-filter-pipe-to-function",
  description: "Convert Vue 2 {{ x | filter }} and :attr=\"x | filter\" to Vue 3 function calls",
  priority: 58,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const block = extractRootTemplateBlock(content);
    const template = block?.inner ?? "";
    const hasMustachePipe = /\{\{[^}]*\|\s*[a-zA-Z_][a-zA-Z0-9_]*/.test(template) && !/ \|\|\s*/.test(template);
    const hasVBindPipe = /=\s*["'][^"']*\|\s*[a-zA-Z_][a-zA-Z0-9_]*/.test(template);
    return hasMustachePipe || hasVBindPipe;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const block = extractRootTemplateBlock(content);
    if (!block) return result;
    const template = block.inner;
    let fixed = template;
    let modified = false;

    fixed = fixed.replace(/\{\{([^}]*)\}\}/g, (fullMatch, inner) => {
      const { result: innerResult, modified: m } = convertPipeToFunction(inner);
      if (m) modified = true;
      return `{{ ${innerResult} }}`;
    });

    fixed = fixed.replace(
      /(=\s*["'])([^"']*?)(["'])/g,
      (fullMatch, prefix: string, attrValue: string, suffix: string) => {
        if (!/\S\s*\|\s*\w+/.test(attrValue)) return fullMatch;
        const { result: conv, modified: m } = convertPipeToFunction(attrValue);
        if (m) modified = true;
        return `${prefix}${conv}${suffix}`;
      }
    );

    if (modified) {
      const openTag = block.full.match(/<template[^>]*>/i)?.[0] ?? "<template>";
      result.content = content.replace(block.full, openTag + fixed + "</template>");
      result.fixed = true;
      result.fixes.push("Converted Vue 2 filter pipe syntax to Vue 3 function calls");
    }
    return result;
  },
};

/**
 * Fix: Add missing filter imports (capitalize, currency, etc.) - Vue 2 pipe syntax
 */
export const missingFilterImportsRule: FixRule = {
  id: "missing-filter-imports",
  description: "Add missing filter imports detected from template usage (pipe syntax)",
  priority: 55,
  dependencies: ["missing-component-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("|");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.templateContent || !_context.scriptContent) {
      return result;
    }

    // Extract filter names from template (pattern: {{ value | filterName }})
    // Must match Vue filter syntax: expression | filterName - NOT || (logical OR)
    // Use negative lookahead to exclude || 0, || '', etc. which are JS operators
    const filterPattern = getCachedRegex(
      "\\{\\{\\s*[^|]+\\|(?!\\s*\\|)\\s*([a-zA-Z_][a-zA-Z0-9_]*)",
      "g"
    );
    
    const usedFilters = new Set<string>();
    let match;
    while ((match = filterPattern.exec(_context.templateContent)) !== null) {
      const filterName = match[1];
      // Skip invalid identifiers (e.g. pure numbers - false positive from || 0)
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(filterName)) {
        usedFilters.add(filterName);
      }
    }

    // Common Vue 2 filters that need to be converted to functions
    const filterFunctions = new Set<string>();
    usedFilters.forEach(filterName => {
      // Check if filter function is imported
      const importPattern = new RegExp(`import\\s+.*?${filterName}.*?from`, "g");
      const functionPattern = new RegExp(`(const|function)\\s+${filterName}\\s*=`, "g");
      
      if (!importPattern.test(_context.scriptContent!) && 
          !functionPattern.test(_context.scriptContent!)) {
        filterFunctions.add(filterName);
      }
    });

    if (filterFunctions.size > 0) {
      let fixed = content;
      const scriptMatch = fixed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      
      if (scriptMatch) {
        let scriptContent = scriptMatch[1];
        
        // Add filter functions (would need to import from filters file or define inline)
        // For now, add as simple functions
        const ts = _context.enableTypeScript;
        const filterDefs: string[] = [];
        filterFunctions.forEach(filterName => {
          // Skip invalid JS identifiers (e.g. "0" from false positive || 0)
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(filterName)) return;
          // Common filter implementations
          if (filterName === "capitalize") {
            filterDefs.push(ts
              ? `const ${filterName} = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';`
              : `const ${filterName} = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';`);
          } else if (filterName === "currency") {
            filterDefs.push(ts
              ? `const ${filterName} = (val: number) => val ? \`$\${val.toFixed(2)}\` : '$0.00';`
              : `const ${filterName} = (val) => val ? \`$\${val.toFixed(2)}\` : '$0.00';`);
          } else {
            filterDefs.push(ts
              ? `const ${filterName} = (val: any) => val; // TODO: Implement ${filterName} filter`
              : `const ${filterName} = (val) => val; // TODO: Implement ${filterName} filter`);
          }
        });

        // Find first non-import line
        const firstCodeLine = scriptContent.match(/^[^i]*?(\n|$)/);
        const insertPos = firstCodeLine ? firstCodeLine.index! : 0;
        
        scriptContent = filterDefs.join("\n") + "\n" + scriptContent.substring(insertPos).trim();

        const rawAttrs = scriptMatch[0].match(/<script([^>]*)>/)?.[1] ?? "";
        fixed = fixed.replace(
          /<script[^>]*>([\s\S]*?)<\/script>/,
          `<script${normalizeScriptAttrs(rawAttrs)}>${scriptContent}</script>`
        );

        result.content = fixed;
        result.fixed = true;
        result.fixes.push(`Added missing filter functions: ${Array.from(filterFunctions).join(", ")}`);
      }
    }

    return result;
  }
};

/**
 * Fix: currency() applied to non-numeric template expressions (e.g. product.name, product.category).
 * Pattern: {{ currency(expr.name) }} or {{ currency(expr.category) }} → {{ expr.name }} (currency is for numbers).
 * Generic: currency(expression.prop) where prop is name/category/title/email/role/description/text → remove currency().
 */
const NON_NUMERIC_PROPS = "name|category|title|email|role|description|text|label|type";
export const templateCurrencyNonNumericRule: FixRule = {
  id: "template-currency-non-numeric",
  description: "Remove currency() from non-numeric template expressions (e.g. .name, .category)",
  priority: 57,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    return new RegExp(`currency\\s*\\([^)]+\\.(?:${NON_NUMERIC_PROPS})\\s*\\)`, "g").test(template);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const templateMatch = content.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (!templateMatch) return result;
    const [, openTag, template, closeTag] = templateMatch;
    const pattern = getCachedRegex(
      `\\{\\{\\s*currency\\s*\\(([^)]+\\.(?:${NON_NUMERIC_PROPS}))\\s*\\)\\s*\\}\\}`,
      "g"
    );
    const fixed = template.replace(pattern, "{{ $1 }}");
    if (fixed !== template) {
      result.content = content.replace(
        /<template[^>]*>[\s\S]*?<\/template>/,
        `${openTag}${fixed}${closeTag}`
      );
      result.fixed = true;
      result.fixes.push("Removed currency() from non-numeric template expressions");
    }
    return result;
  }
};

/**
 * Fix: Functional components (Vue 3 breaking)
 * - Remove functional attribute, keep props (compatible with defineProps), attrs→$attrs, remove v-on="listeners"
 */
export const functionalComponentRule: FixRule = {
  id: "functional-component",
  description: "Convert functional SFC: attrs→$attrs, remove listeners (props kept for script setup)",
  priority: 57,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      (content.includes("functional") ||
        content.includes('v-bind="attrs"') ||
        content.includes("v-on=\"listeners\""))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const block = extractRootTemplateBlock(content);
    if (!block) return result;

    const { full: fullBlock, inner: template } = block;
    let fixed = template;

    const needsConversion =
      block.attrs.includes("functional") ||
      fixed.includes('v-bind="attrs"') ||
      fixed.includes('v-on="listeners"');
    if (needsConversion) {
      fixed = fixed.replace(/\battrs\./g, "$attrs.");
      fixed = fixed.replace(/(^|[^\w$])attrs\b/g, "$1$attrs");
      fixed = fixed.replace(/\bv-bind\s*=\s*["']attrs["']/gi, 'v-bind="$attrs"');
      fixed = fixed.replace(/\s+v-on\s*=\s*["']listeners["']/gi, "");
      fixed = fixed.replace(/\s+v-on\s*=\s*["']data\.listeners["']/gi, "");
      fixed = fixed.replace(/\s+v-bind\s*=\s*["']data\.attrs["']/gi, ' v-bind="$attrs"');
      result.fixes.push("Functional: attrs→$attrs, listeners removed (props kept for script setup)");
    }

    const fullBlockNew = fullBlock
      .replace(/\s+functional\b/i, "")
      .replace(template, fixed);
    if (fullBlockNew !== fullBlock) {
      result.content = content.replace(fullBlock, fullBlockNew);
      result.fixed = true;
    }

    return result;
  }
};

/**
 * Fix: Remove .native modifier (removed in Vue 3)
 * Vue 3: listeners not in emits go to root element. Document emitted events with emits option.
 */
export const nativeModifierRemovalRule: FixRule = {
  id: "native-modifier-removal",
  description: "Remove .native modifier from v-on (removed in Vue 3)",
  priority: 56,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && /\.native(?=\s|>|"|'|=)/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const fixed = content.replace(/\.native(?=\s|>|"|'|=)/g, "");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed .native modifier - add emits option to child components if needed");
    }

    return result;
  }
};

/**
 * Fix: v-bind merge behavior (Vue 3)
 * Vue 2: individual attrs always overwrote v-bind="object". Vue 3: order matters (last wins).
 * To preserve Vue 2 behavior: put v-bind before individual attributes.
 */
export const vBindMergeOrderRule: FixRule = {
  id: "v-bind-merge-order",
  description: "Reorder v-bind before individual attrs to preserve Vue 2 merge behavior",
  priority: 53,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    return /[^\s>]\s+v-bind\s*=\s*["']/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const block = extractRootTemplateBlock(content);
    if (!block) return result;

    const { full: fullBlock, inner: template } = block;
    let fixed = template;

    const vBindRegex = /<(\w+)([^>]*)\s+v-bind\s*=\s*(["'])([\s\S]*?)\3([^>]*)>/gi;
    fixed = fixed.replace(vBindRegex, (match, tag, before, q, vBindExpr, after) => {
      if (!before.trim()) return match;
      result.fixes.push("Reordered v-bind before individual attrs (Vue 3 merge)");
      return `<${tag} v-bind=${q}${vBindExpr}${q}${before}${after}>`;
    });

    if (fixed !== template) {
      result.content = content.replace(fullBlock, fullBlock.replace(template, fixed));
      result.fixed = true;
    }

    return result;
  }
};

/**
 * Fix: v-for and v-if on same element (Vue 3 precedence breaking change)
 * Vue 2: v-for had precedence. Vue 3: v-if has precedence (breaks behavior).
 * Wrap in <template v-for> with v-if on inner element.
 */
export const vForVIfPrecedenceRule: FixRule = {
  id: "v-for-v-if-precedence",
  description: "Wrap v-for and v-if on same element in template (Vue 3 precedence)",
  priority: 54,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    return (
      /v-for\s*=[^>]*v-if\s*=/.test(content) ||
      /v-if\s*=[^>]*v-for\s*=/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const block = extractRootTemplateBlock(content);
    if (!block) return result;

    const { full: fullBlock, inner: template } = block;
    let fixed = template;

    const wrapInTemplate = (match: string, tag: string, attrs: string, vForExpr: string, vIfExpr: string) => {
      const keyMatch = attrs.match(/(?::key|key)\s*=\s*["']([^"']+)["']/);
      const keyAttr = keyMatch ? ` :key="${keyMatch[1]}"` : "";
      const cleanAttrs = attrs
        .replace(/\s*(?::key|key)\s*=\s*["'][^"']+["']/, "")
        .replace(/\s*v-for\s*=\s*["'][^"']+["']/, "")
        .replace(/\s*v-if\s*=\s*["'][^"']+["']/, "")
        .trim();
      result.fixes.push("Wrapped v-for+v-if on same element in template");
      return `<template v-for="${vForExpr}"${keyAttr}><${tag}${cleanAttrs ? " " + cleanAttrs : ""} v-if="${vIfExpr}">`;
    };

    const vForVIfRegex = /<(\w+)([^>]*)\s+v-for\s*=\s*["']([^"']+)["']([^>]*)\s+v-if\s*=\s*["']([^"']+)["']([^>]*)>/gi;
    fixed = fixed.replace(vForVIfRegex, (m, tag, a1, vFor, a2, vIf, a3) =>
      wrapInTemplate(m, tag, a1 + a2 + a3, vFor, vIf)
    );

    const vIfVForRegex = /<(\w+)([^>]*)\s+v-if\s*=\s*["']([^"']+)["']([^>]*)\s+v-for\s*=\s*["']([^"']+)["']([^>]*)>/gi;
    fixed = fixed.replace(vIfVForRegex, (m, tag, a1, vIf, a2, vFor, a3) =>
      wrapInTemplate(m, tag, a1 + a2 + a3, vFor, vIf)
    );

    if (fixed !== template) {
      result.content = content.replace(fullBlock, fullBlock.replace(template, fixed));
      result.fixed = true;
    }

    return result;
  }
};

/**
 * Fix: Vue 3 key attribute breaking changes
 * - Remove keys from v-if/v-else/v-else-if (Vue 3 auto-generates them)
 * - Move key from template v-for children onto the <template> tag
 */
export const keyAttributesRule: FixRule = {
  id: "key-attributes",
  description: "Fix key attributes for Vue 3 (remove from v-if/v-else/v-else-if, move to template v-for)",
  priority: 55,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!templateMatch) return false;
    const template = templateMatch[1];
    return (
      (/(?:v-if|v-else-if|v-else)[^>]*(?::key|key)\s*=|(?::key|key)\s*=[^>]*(?:v-if|v-else-if|v-else)/.test(template)) ||
      (/<template\s+v-for[^>]*>[\s\S]*?<[^>]+\s+:key\s*=/.test(content))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    // Extract root template block (handles nested <template> tags)
    const block = extractRootTemplateBlock(content);
    if (!block) return result;

    const { full: fullBlock, inner: template } = block;
    let fixed = template;

    // 1. Remove key from v-if/v-else/v-else-if branches
    const conditionalWithKey = /<(div|span|\w+)([^>]*)\b(v-(?:if|else-if|else)(?:\s+[^>]*)?)([^>]*)>/gi;
    fixed = fixed.replace(conditionalWithKey, (match) => {
      if (!/(?::key|key)\s*=\s*["']/.test(match)) return match;
      const cleaned = match
        .replace(/\s*(?::key|key)\s*=\s*["'][^"']+["']/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s>/, ">");
      if (cleaned !== match) {
        result.fixes.push("Removed key from v-if/v-else/v-else-if branch");
        return cleaned;
      }
      return match;
    });

    // 2. Move key from template v-for children to <template> tag (handles nested template)
    const templateVForKeyRegex =
      /<template\s+v-for\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/template>/gi;
    fixed = fixed.replace(templateVForKeyRegex, (fullMatch, vForExpr, templateAttrs, innerContent) => {
      if (templateAttrs.includes(":key") || templateAttrs.includes("key")) return fullMatch;
      const keyOnChild = innerContent.match(/(?:<[^>]+\s)(?::key|key)\s*=\s*["']([^"']+)["']/);
      if (!keyOnChild) return fullMatch;
      const keyValue = keyOnChild[1];
      const innerWithoutKeys = innerContent.replace(
        /\s*(?::key|key)\s*=\s*["'][^"']+["']/g,
        ""
      );
      result.fixes.push("Moved key from template v-for children onto <template>");
      return `<template v-for="${vForExpr}" :key="${keyValue}"${templateAttrs}>${innerWithoutKeys}</template>`;
    });

    if (fixed !== template) {
      result.content = content.replace(fullBlock, fullBlock.replace(template, fixed));
      result.fixed = true;
    }

    return result;
  }
};

/**
 * Fix: Fix v-model bindings in template
 */
export const vModelBindingsRule: FixRule = {
  id: "v-model-bindings",
  description: "Fix v-model bindings that might be missing or incorrect",
  priority: 50,
  dependencies: ["missing-filter-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("v-model");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!_context.templateContent || !_context.scriptContent) {
      return result;
    }

    // Fix: v-model="value" where value is not defined as ref
    // This is a basic check - more complex logic would need AST parsing
    const vModelPattern = getCachedRegex(
      'v-model="([^"]+)"',
      "g"
    );
    
    const vModelBindings = new Set<string>();
    let match;
    while ((match = vModelPattern.exec(_context.templateContent ?? "")) !== null) {
      vModelBindings.add(match[1]);
    }

    // Check if bindings are defined as refs
    vModelBindings.forEach(binding => {
      // Check if it's a ref
      const refPattern = new RegExp(`const\\s+${binding}\\s*=\\s*ref\\(`, "g");
      // Check if it's a computed (shouldn't be used with v-model)
      const computedPattern = new RegExp(`const\\s+${binding}\\s*=\\s*computed\\(`, "g");
      
      if (!refPattern.test(_context.scriptContent!) && 
          computedPattern.test(_context.scriptContent!)) {
        // This is a computed property used with v-model - should be a ref
        result.issues.push(`v-model="${binding}" uses computed property, should use ref`);
      }
    });

    // Note: Actual fixing would require more complex logic
    // For now, just detect issues

    return result;
  }
};

/**
 * Fix: Add pointer-events: none when overlay has opacity: 0 (prevents blocking clicks)
 * Generic: opacity: cond ? 1 : 0 in fixed overlay → add pointer-events: cond ? 'auto' : 'none'
 */
export const overlayPointerEventsWhenHiddenRule: FixRule = {
  id: "overlay-pointer-events-when-hidden",
  description: "Add pointer-events for overlay with conditional opacity to avoid blocking clicks",
  priority: 62,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue")) return false;
    return (
      /opacity:\s*\w+\s*\?\s*1\s*:\s*0/.test(content) &&
      !/['"]pointer-events['"]\s*:/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const match = content.match(/opacity:\s*(\w+)\s*\?\s*1\s*:\s*0/);
    if (!match) return result;
    const cond = match[1];
    const fixed = content.replace(
      /(opacity:\s*\w+\s*\?\s*1\s*:\s*0)(\s*,?\s*)/,
      `$1,\n      'pointer-events': ${cond} ? 'auto' : 'none'$2`
    );
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Added pointer-events for overlay when hidden");
    }
    return result;
  },
};
