/**
 * Rules for fixing store-related issues in <script setup> components
 */

import type { FixRule, FixContext, FixRuleResult } from "../../types";
import { getCachedRegex } from "../../utils/regex-cache";
import { getStoreMethodMap } from "../../utils/store-analysis-cache";

/** Detect store variable from const X = useYStore(). Prefer indexStore, store, mainStore. */
export function getStoreVarFromScript(scriptContent: string): string | null {
  const storeVars = [...scriptContent.matchAll(/const\s+(\w+)\s*=\s*use\w+Store\s*\(\s*\)/g)].map((m) => m[1]);
  const preferred = ["indexStore", "store", "mainStore"];
  return storeVars.find((v) => preferred.includes(v)) ?? storeVars[0] ?? null;
}

/**
 * Fix: Replace this.methodName() / this.propertyName in <script setup> with methodName / propertyName.
 * (this.$router / this.$route are handled by replaceThisRouterRouteRule.)
 */
export const storeScriptSetupRule: FixRule = {
  id: "store-script-setup",
  description: "Replace this. references in script setup with plain identifiers (migration from Options API)",
  priority: 70,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("this.");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch || !_context.scriptContent) {
      return result;
    }

    const scriptContent = scriptMatch[2];
    // Only replace this.ident where ident is a word (excludes this.$router / this.$route)
    const thisPattern = getCachedRegex("this\\.(\\w+)", "g");
    const replaced = new Set<string>();
    let m;
    while ((m = thisPattern.exec(scriptContent)) !== null) {
      replaced.add(m[1]);
    }
    if (replaced.size > 0) {
      const newScript = scriptContent.replace(/this\.(\w+)/g, (_, ident) => ident);
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + newScript + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push(`Replaced this.${[...replaced].join(", this.")} with plain identifiers in script setup`);
    }

    return result;
  }
};

/**
 * Fix: Replace this.$router and this.$route with useRouter() / useRoute() in <script setup>
 * Adds vue-router import and const router = useRouter() / const route = useRoute() when needed.
 */
export const replaceThisRouterRouteRule: FixRule = {
  id: "replace-this-router-route",
  description: "Replace this.$router / this.$route with useRouter() / useRoute() in script setup",
  priority: 68,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script setup") &&
      (content.includes("this.$router") || content.includes("this.$route"))
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const scriptMatch = content.match(/<script([^>]*)>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    let scriptContent = scriptMatch[2];
    const hasThisRouter = /this\.\$router/.test(scriptContent);
    const hasThisRoute = /this\.\$route/.test(scriptContent);
    const _hasUseRouter = scriptContent.includes("useRouter");
    const _hasUseRoute = scriptContent.includes("useRoute");

    if (!hasThisRouter && !hasThisRoute) return result;

    if (hasThisRouter) {
      if (!scriptContent.includes("useRouter")) {
        const importBlock = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        if (importBlock) {
          scriptContent = scriptContent.replace(
            /(import\s+[^;]+;[\s\n]*)+/,
            `$&import { useRouter } from 'vue-router';\n`
          );
        } else {
          scriptContent = "import { useRouter } from 'vue-router';\n" + scriptContent;
        }
      }
      if (!scriptContent.includes("const router = useRouter()")) {
        const afterImports = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        const insertPos = afterImports ? afterImports[0].length : 0;
        scriptContent =
          scriptContent.slice(0, insertPos) +
          "\nconst router = useRouter();\n" +
          scriptContent.slice(insertPos);
      }
      scriptContent = scriptContent.replace(/this\.\$router/g, "router");
      result.fixed = true;
      result.fixes.push("Replaced this.$router with useRouter()");
    }

    if (hasThisRoute) {
      if (!scriptContent.includes("useRoute")) {
        const importBlock = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        if (importBlock) {
          scriptContent = scriptContent.replace(
            /(import\s+[^;]+;[\s\n]*)+/,
            `$&import { useRoute } from 'vue-router';\n`
          );
        } else {
          scriptContent = "import { useRoute } from 'vue-router';\n" + scriptContent;
        }
      }
      if (!scriptContent.includes("const route = useRoute()")) {
        const afterImports = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        const insertPos = afterImports ? afterImports[0].length : 0;
        scriptContent =
          scriptContent.slice(0, insertPos) +
          "\nconst route = useRoute();\n" +
          scriptContent.slice(insertPos);
      }
      scriptContent = scriptContent.replace(/this\.\$route/g, "route");
      result.fixed = true;
      result.fixes.push("Replaced this.$route with useRoute()");
    }

    if (result.fixed) {
      const scriptTag = scriptMatch[0].replace(scriptMatch[2], scriptContent);
      result.content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/, scriptTag);
    }

    return result;
  }
};

/**
 * Fix: useRoute() used in script but not imported from vue-router.
 * Pattern: script contains useRoute() or const route = useRoute() but import from 'vue-router' lacks useRoute.
 */
export const missingUseRouteImportRule: FixRule = {
  id: "missing-use-route-import",
  description: "Add useRoute to vue-router import when used but not imported",
  priority: 69,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const usesUseRoute = /\buseRoute\s*\(\)/.test(script) || /=\s*useRoute\s*\(\)/.test(script);
    const hasUseRouteInImport = /import\s*\{[^}]*\buseRoute\b[^}]*\}\s*from\s*['"]vue-router['"]/.test(script);
    return usesUseRoute && !hasUseRouteInImport;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]vue-router['"]\s*;?/;
    const m = scriptContent.match(importRegex);
    if (m) {
      const imports = m[1].trim();
      if (/\buseRoute\b/.test(imports)) return result;
      const newImports = imports + (imports ? ", " : "") + "useRoute";
      scriptContent = scriptContent.replace(importRegex, `import { ${newImports} } from 'vue-router';`);
    } else {
      const firstImportMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
      const afterImports = firstImportMatch ? firstImportMatch[0].length : 0;
      scriptContent =
        scriptContent.slice(0, afterImports) +
        "import { useRoute } from 'vue-router';\n" +
        scriptContent.slice(afterImports);
    }
    result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push("Added useRoute to vue-router import");
    return result;
  }
};

/**
 * Fix: useRouter() used in script but not imported from vue-router.
 */
export const missingUseRouterImportRule: FixRule = {
  id: "missing-use-router-import",
  description: "Add useRouter to vue-router import when used but not imported",
  priority: 69,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const usesUseRouter = /\buseRouter\s*\(\)/.test(script) || /=\s*useRouter\s*\(\)/.test(script);
    const hasUseRouterInImport = /import\s*\{[^}]*\buseRouter\b[^}]*\}\s*from\s*['"]vue-router['"]/.test(script);
    return usesUseRouter && !hasUseRouterInImport;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]vue-router['"]\s*;?/;
    const m = scriptContent.match(importRegex);
    if (m) {
      const imports = m[1].trim();
      if (/\buseRouter\b/.test(imports)) return result;
      const newImports = imports + (imports ? ", " : "") + "useRouter";
      scriptContent = scriptContent.replace(importRegex, `import { ${newImports} } from 'vue-router';`);
    } else {
      const firstImportMatch = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
      const afterImports = firstImportMatch ? firstImportMatch[0].length : 0;
      scriptContent =
        scriptContent.slice(0, afterImports) +
        "import { useRouter } from 'vue-router';\n" +
        scriptContent.slice(afterImports);
    }
    result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push("Added useRouter to vue-router import");
    return result;
  }
};

/**
 * Fix: watch(() => propName.value) when propName is a prop (defineProps) → watch(() => props.propName).
 * Pattern: watch uses refName.value but refName is a prop, not a ref.
 */
export const watchPropsRefRule: FixRule = {
  id: "watch-props-ref",
  description: "Replace watch(() => propName.value) with watch(() => props.propName) when propName is a prop",
  priority: 67,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("watch(")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const hasDefineProps = /defineProps\s*\(/.test(script);
    const watchDotValue = /watch\s*\(\s*\(\s*\)\s*=>\s*(\w+)\.value\s*/.test(script);
    return hasDefineProps && watchDotValue;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    const scriptContent = scriptMatch[2];
    const propsMatch = scriptContent.match(/defineProps\s*\(\s*\{([^}]+)\}/);
    const propNames = new Set<string>();
    if (propsMatch) {
      const propsBlock = propsMatch[1];
      const propNameMatches = propsBlock.matchAll(/(\w+)\s*:/g);
      for (const pm of propNameMatches) propNames.add(pm[1]);
    }
    let fixed = scriptContent;
    const watchPattern = /watch\s*\(\s*\(\s*\)\s*=>\s*(\w+)\.value\s*,/g;
    let m;
    while ((m = watchPattern.exec(scriptContent)) !== null) {
      const name = m[1];
      if (propNames.has(name)) {
        fixed = fixed.replace(
          new RegExp(`watch\\s*\\(\\s*\\(\\)\\s*=>\\s*${name}\\.value\\s*,`, "g"),
          `watch(() => props.${name},`
        );
        result.fixed = true;
        result.fixes.push(`Replaced watch(() => ${name}.value) with watch(() => props.${name})`);
      }
    }
    if (result.fixed) {
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + fixed + scriptMatch[3]);
    }
    return result;
  }
};

/** Extract store vars and their setters (setX) from script */
function getStoreSetters(script: string): Array<{ storeVar: string; setter: string; getter: string }> {
  const stores = [...script.matchAll(/const\s+(\w+)\s*=\s*use\w+Store\s*\(\s*\)/g)].map((m) => m[1]);
  const result: Array<{ storeVar: string; setter: string; getter: string }> = [];
  for (const storeVar of stores) {
    const setterRe = new RegExp(`${storeVar}\\.(set\\w+)\\s*\\(`, "g");
    let m;
    while ((m = setterRe.exec(script)) !== null) {
      const setter = m[1];
      const getter = setter.slice(3, 4).toLowerCase() + setter.slice(4);
      result.push({ storeVar, setter, getter });
    }
  }
  return result;
}

/** Extract v-model and {{ prop }} bindings from template */
function getTemplateBindings(template: string): Set<string> {
  const bindings = new Set<string>();
  for (const m of template.matchAll(/v-model=["']([^"']+)["']/g)) bindings.add(m[1]);
  for (const m of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) bindings.add(m[1]);
  return bindings;
}

/**
 * Fix: Template uses binding (e.g. v-model="currentTheme") but no reactive binding defined.
 * Generic: when store has setX and template uses x/currentX, add computed({ get: () => store.x, set: (v) => store.setX(v) }).
 */
export const storeThemeBindingRule: FixRule = {
  id: "store-theme-binding",
  description: "Add computed binding from store when template uses v-model/{{ prop }} and store has setX",
  priority: 66,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const bindings = getTemplateBindings(template);
    const setters = getStoreSetters(script);
    for (const { getter } of setters) {
      const currentName = "current" + getter.charAt(0).toUpperCase() + getter.slice(1);
      const templateName = bindings.has(getter) ? getter : bindings.has(currentName) ? currentName : null;
      if (templateName && !new RegExp(`const\\s+${templateName}\\s*=`).test(script)) {
        return true;
      }
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const bindings = getTemplateBindings(template);
    const setters = getStoreSetters(scriptContent);
    for (const { storeVar, setter, getter } of setters) {
      const currentName = "current" + getter.charAt(0).toUpperCase() + getter.slice(1);
      const templateName = bindings.has(getter) ? getter : bindings.has(currentName) ? currentName : null;
      if (!templateName) continue;
      if (new RegExp(`const\\s+${templateName}\\s*=`).test(scriptContent)) continue;
      const setterParam = _context.enableTypeScript ? "(v: string)" : "(v)";
      const insertBlock = `const ${templateName} = computed({\n  get: () => ${storeVar}.${getter},\n  set: ${setterParam} => ${storeVar}.${setter}(v),\n});\n\n`;
      const storeVarRe = new RegExp(`const\\s+${storeVar}\\s*=\\s*\\w+\\([^)]*\\)[^\\n]*\\n`);
      const storeVarMatch = scriptContent.match(storeVarRe);
      let insertPos = storeVarMatch
        ? scriptContent.indexOf(storeVarMatch[0]) + storeVarMatch[0].length
        : -1;
      if (insertPos === -1) insertPos = scriptContent.search(/\n(?!\s*\/\/)/);
      if (insertPos >= 0) {
        if (!/import\s*\{[^}]*\bcomputed\b/.test(scriptContent)) {
          scriptContent = scriptContent.replace(
            /(import\s*\{)([^}]+)(\}\s*from\s*['"]vue['"])/,
            (_: string, open: string, imports: string, close: string) =>
              imports.includes("computed") ? open + imports + close : open + imports.trim() + ", computed " + close
          );
        }
        scriptContent = scriptContent.slice(0, insertPos) + insertBlock + scriptContent.slice(insertPos);
        result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
        result.fixed = true;
        result.fixes.push(`Added ${templateName} computed from ${storeVar} for v-model binding`);
        break;
      }
    }
    return result;
  }
};

/**
 * Fix: Secure router.push with params
 * Pattern: router.push({ name: 'route', params: { id } }) → ensure params are defined
 * Handles shorthand { id }, { id, type }, and explicit { id: id }, multiple params.
 */
export const secureRouterPushRule: FixRule = {
  id: "secure-router-push",
  description: "Secure router.push with params - Vue Router 4 requires params to be defined",
  priority: 65,
  dependencies: ["store-script-setup"],
  shouldApply: (filePath, content) => {
    return content.includes("router.push") && content.includes("params");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Match router.push({ ... params: { ... } ... }) with any param names
    const routerPushPattern = getCachedRegex(
      "router\\.push\\s*\\(\\s*\\{[^}]*params:\\s*\\{([^}]+)\\}[^}]*\\}\\s*\\)",
      "g"
    );

    let match;
    const fixes: string[] = [];

    while ((match = routerPushPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const paramsBody = match[1];

      if (fullMatch.includes("||") || fullMatch.includes("??")) {
        continue;
      }

      // Parse params: "id", "id: id", "id: id, type: type", "slug", etc. Build fixed params per part.
      const parts = paramsBody.split(",").map(p => p.trim());

      // Build fixed params by replacing each part (avoid double-replacement of shorthand)
      const fixedParts = parts.map((part) => {
        const colonIdx = part.indexOf(":");
        let key: string;
        let value: string;
        let needsFallback: boolean;
        if (colonIdx === -1) {
          key = part.trim();
          value = key;
          needsFallback = /^\w+$/.test(key) && !fullMatch.includes(`${key} || ''`) && !fullMatch.includes(`${key} ?? ''`);
        } else {
          key = part.slice(0, colonIdx).trim();
          value = part.slice(colonIdx + 1).trim();
          needsFallback = !/ \|\| | \?\? /.test(value) && !value.includes("?.");
        }
        if (!needsFallback) return part;
        return `${key}: ${value} || ''`;
      });
      const fixedParamsBody = fixedParts.join(", ");
      const didFix = fixedParamsBody !== paramsBody;
      if (didFix) {
        const fixedMatch = fullMatch.replace(paramsBody, fixedParamsBody);
        fixed = fixed.replace(fullMatch, fixedMatch);
        fixes.push(`Secured router.push with params fallback`);
      }
    }

    if (fixes.length > 0) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(...fixes);
    }

    return result;
  }
};

/**
 * Fix: Add type checking for router.push functions
 */
export const routerPushTypeCheckRule: FixRule = {
  id: "router-push-type-check",
  description: "Add type checking and undefined checks for router.push functions",
  priority: 64,
  dependencies: ["secure-router-push"],
  shouldApply: (filePath, content) => {
    return content.includes("router.push");
  },
  apply: async (filePath, content, _context: FixContext) => {
    // Only apply if TypeScript is enabled
    if (!_context.enableTypeScript) {
      return {
        content,
        fixed: false,
        fixes: [],
        issues: []
      };
    }

    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Add type annotations for router.push calls
    // Pattern: router.push({ name: 'route' }) → router.push({ name: 'route' as string })
    const routerPushTypePattern = getCachedRegex(
      "router\\.push\\s*\\(\\s*\\{[^}]*name:\\s*['\"]([^'\"]+)['\"][^}]*\\}\\s*\\)",
      "g"
    );
    
    let match;
    const fixes: string[] = [];
    
    while ((match = routerPushTypePattern.exec(content)) !== null) {
      const routeName = match[1];
      const fullMatch = match[0];
      const nameLiteral = fullMatch.match(/name:\s*(["'])([^"']+)\1/);
      const quote = nameLiteral ? nameLiteral[1] : "'";

      // Add type assertion if not present
      if (!fullMatch.includes("as string")) {
        const search = `name: ${quote}${routeName}${quote}`;
        const replacement = `name: ${quote}${routeName}${quote} as string`;
        const fixedMatch = fullMatch.replace(search, replacement);
        fixed = fixed.replace(fullMatch, fixedMatch);
        fixes.push(`Added type checking for router.push route name: ${routeName}`);
      }
    }

    if (fixes.length > 0) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push(...fixes);
    }

    return result;
  }
};

function moduleToStore(module: string): { storeVar: string; storeName: string; importPath: string } {
  if (module === "index") {
    return { storeVar: "indexStore", storeName: "useIndexStore", importPath: "@/store/index" };
  }
  const storeVar = `${module}Store`;
  const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
  const importPath = `@/store/modules/${module}`;
  return { storeVar, storeName, importPath };
}

/** Derive useXxxStore and import path from storeVar (userStore → useUserStore, @/store/modules/user). Generic. */
function storeVarToUseStore(storeVar: string): { storeName: string; importPath: string } {
  if (storeVar === "indexStore") {
    return { storeName: "useIndexStore", importPath: "@/store/index" };
  }
  const module = storeVar.replace(/Store$/, "").toLowerCase();
  const storeName = `use${module.charAt(0).toUpperCase() + module.slice(1)}Store`;
  const importPath = `@/store/modules/${module}`;
  return { storeName, importPath };
}

/**
 * Fix: this.$xxxStore → xxxStore (use useXxxStore() when not already present).
 * In Pinia, stores are accessed via useXxxStore(), not globalProperties.$xxxStore.
 * Generic: handles any this.$userStore, this.$cartStore, this.$productStore, etc.
 */
export const thisStoreNameToUseStoreRule: FixRule = {
  id: "this-store-name-to-use-store",
  description: "Replace this.$xxxStore with useXxxStore() (Pinia has no global $xxxStore)",
  priority: 63,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script") &&
      /this\.\$\w+Store\b/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;

    let scriptContent = scriptMatch[2];
    const storeVars = new Set<string>();
    const re = /this\.\$(\w+Store)\b/g;
    let m;
    while ((m = re.exec(scriptContent)) !== null) {
      storeVars.add(m[1]);
    }
    if (storeVars.size === 0) return result;

    const storesToAdd = new Map<string, { storeName: string; importPath: string }>();
    for (const storeVar of storeVars) {
      const hasUseStore = new RegExp(`const\\s+${storeVar}\\s*=\\s*use\\w+Store\\s*\\(`).test(scriptContent);
      if (!hasUseStore) {
        const { storeName, importPath } = storeVarToUseStore(storeVar);
        storesToAdd.set(storeVar, { storeName, importPath });
      }
      scriptContent = scriptContent.replace(new RegExp(`this\\.\\$${storeVar}\\b`, "g"), storeVar);
    }

    if (storesToAdd.size > 0) {
      const afterImports = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/)?.[0]?.length ?? 0;
      for (const [storeVar, { storeName, importPath }] of storesToAdd) {
        const hasImport = scriptContent.includes(`from "${importPath}"`) || scriptContent.includes(`from '${importPath}'`);
        if (!hasImport) {
          scriptContent =
            scriptContent.slice(0, afterImports) +
            `import { ${storeName} } from '${importPath}';\n` +
            scriptContent.slice(afterImports);
        }
        const hasInit = new RegExp(`const\\s+${storeVar}\\s*=\\s*${storeName}\\s*\\(`).test(scriptContent);
        if (!hasInit) {
          const impEnd = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/)?.[0]?.length ?? 0;
          scriptContent =
            scriptContent.slice(0, impEnd) +
            `const ${storeVar} = ${storeName}();\n` +
            scriptContent.slice(impEnd);
        }
      }
    }

    let fullContent = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);

    const templateMatch = fullContent.match(/(<template[^>]*>)([\s\S]*?)(<\/template>)/);
    if (templateMatch) {
      let templateContent = templateMatch[2];
      for (const storeVar of storeVars) {
        templateContent = templateContent.replace(new RegExp(`\\$${storeVar}\\b`, "g"), storeVar);
      }
      if (templateContent !== templateMatch[2]) {
        fullContent = fullContent.replace(templateMatch[0], templateMatch[1] + templateContent + templateMatch[3]);
      }
    }

    result.content = fullContent;
    result.fixed = true;
    result.fixes.push(`Replaced this.$${[...storeVars].join(", this.$")} with useXxxStore()`);
    return result;
  },
};

/**
 * Fix: storeVar.dispatch('module/action') → moduleStore.action() (Pinia)
 * Prevents storeDispatchToDirectRule from producing invalid indexStore.module/action() (division).
 * Generic: handles any storeVar and module/action pattern.
 */
export const storeDispatchModuleActionRule: FixRule = {
  id: "store-dispatch-module-action",
  description: "Replace storeVar.dispatch('module/action') with moduleStore.action() in components",
  priority: 88,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script setup") &&
      /\.dispatch\s*\(\s*['"][^'"]+\/[^'"]+['"]/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    let scriptContent = scriptMatch[1];
    const storesToAdd = new Map<string, { storeVar: string; storeName: string; importPath: string }>();

    const ensureStore = (module: string) => {
      const { storeVar, storeName, importPath } = moduleToStore(module);
      if (!storesToAdd.has(storeVar)) storesToAdd.set(storeVar, { storeVar, storeName, importPath });
    };

    // storeVar.dispatch('module/action') or storeVar.dispatch('module/action', args)
    const dispatchRe = /(\w+)\.dispatch\s*\(\s*['"]([^'"]+)\/([^'"]+)['"]\s*(?:,\s*([^)]+))?\s*\)/g;
    let m;
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    while ((m = dispatchRe.exec(scriptContent)) !== null) {
      const module = m[2];
      const action = m[3];
      const args = m[4]?.trim() ?? "";
      ensureStore(module);
      const { storeVar } = moduleToStore(module);
      const replacement = args ? `${storeVar}.${action}(${args})` : `${storeVar}.${action}()`;
      replacements.push({ start: m.index, end: m.index + m[0].length, replacement });
    }

    for (const { start, end, replacement } of replacements.sort((a, b) => b.start - a.start)) {
      scriptContent = scriptContent.slice(0, start) + replacement + scriptContent.slice(end);
    }

    if (replacements.length === 0) return result;

    for (const { storeVar, storeName, importPath } of storesToAdd.values()) {
      const hasImport = scriptContent.includes(`from "${importPath}"`) || scriptContent.includes(`from '${importPath}'`);
      if (!hasImport) {
        const lastImport = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
        const insertAfter = lastImport ? lastImport[0].length : 0;
        scriptContent =
          scriptContent.slice(0, insertAfter) +
          `import { ${storeName} } from '${importPath}';\n` +
          scriptContent.slice(insertAfter);
      }
      const hasInit = new RegExp(`const\\s+${storeVar}\\s*=\\s*${storeName}\\s*\\(\\s*\\)`).test(scriptContent);
      if (!hasInit) {
        const afterImports = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/)?.[0]?.length ?? 0;
        scriptContent =
          scriptContent.slice(0, afterImports) +
          `const ${storeVar} = ${storeName}();\n` +
          scriptContent.slice(afterImports);
      }
    }

    result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], scriptContent));
    result.fixed = true;
    result.fixes.push("Replaced storeVar.dispatch('module/action') with moduleStore.action()");
    return result;
  }
};

/**
 * Fix: Malformed storeVar.module / action() → moduleStore.action() (repair broken storeDispatchToDirectRule output)
 */
export const fixMalformedStoreDispatchRule: FixRule = {
  id: "fix-malformed-store-dispatch",
  description: "Fix storeVar.module / action() (division) to moduleStore.action()",
  priority: 86,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script setup") &&
      /\w+Store\.\w+\s*\/\s*\w+\s*\(/.test(content)
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    const scriptContent = scriptMatch[1];
    const storesToAdd = new Map<string, { storeVar: string; storeName: string; importPath: string }>();

    const ensureStore = (module: string) => {
      const { storeVar, storeName, importPath } = moduleToStore(module);
      if (!storesToAdd.has(storeVar)) storesToAdd.set(storeVar, { storeVar, storeName, importPath });
    };

    // storeVar.module / action() or storeVar.module / action(args)
    const malformedRe = /(\w+Store)\.(\w+)\s*\/\s*(\w+)\s*\(([^)]*)\)/g;
    let fixed = scriptContent;
    let m;
    while ((m = malformedRe.exec(scriptContent)) !== null) {
      const module = m[2];
      const action = m[3];
      const args = m[4].trim();
      ensureStore(module);
      const { storeVar } = moduleToStore(module);
      const replacement = args ? `${storeVar}.${action}(${args})` : `${storeVar}.${action}()`;
      fixed = fixed.replace(m[0], replacement);
    }

    if (fixed === scriptContent) return result;

    for (const { storeVar, storeName, importPath } of storesToAdd.values()) {
      const hasImport = fixed.includes(`from "${importPath}"`) || fixed.includes(`from '${importPath}'`);
      if (!hasImport) {
        const lastImport = fixed.match(/(import\s+[^;]+;[\s\n]*)+/);
        const insertAfter = lastImport ? lastImport[0].length : 0;
        fixed = fixed.slice(0, insertAfter) + `import { ${storeName} } from '${importPath}';\n` + fixed.slice(insertAfter);
      }
      const hasInit = new RegExp(`const\\s+${storeVar}\\s*=\\s*${storeName}\\s*\\(\\s*\\)`).test(fixed);
      if (!hasInit) {
        const afterImports = fixed.match(/(import\s+[^;]+;[\s\n]*)+/)?.[0]?.length ?? 0;
        fixed = fixed.slice(0, afterImports) + `const ${storeVar} = ${storeName}();\n` + fixed.slice(afterImports);
      }
    }

    result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], fixed));
    result.fixed = true;
    result.fixes.push("Fixed malformed storeVar.module / action() to moduleStore.action()");
    return result;
  }
};

/**
 * Fix: Store member mismatch - when storeVar.method/property belongs to a different store
 * Generic: uses store analysis to detect indexStore.fetchUser (user store) etc.
 * Also fixes unknown properties like allIndexs -> allUsers when inferred from component name.
 */
export const fixStoreMemberMismatchRule: FixRule = {
  id: "fix-store-member-mismatch",
  description: "Fix storeVar.member when member belongs to a different store (uses store analysis)",
  priority: 80,
  dependencies: ["remove-vuex-imports"],
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           /\w+Store\.\w+/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    if (!_context.scriptContent || !_context.projectRoot) return result;

    const storeMethodMap = await getStoreMethodMap(_context.projectRoot);
    if (Object.keys(storeMethodMap).length === 0) return result;

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return result;

    let scriptContent = scriptMatch[1];

    // Build storeVar -> module from imports (modules + index)
    const storeVarToModule = new Map<string, string>();
    const moduleToStoreVar = new Map<string, string>();

    const moduleImportPattern = /import\s+\{\s*use(\w+)Store\s*\}\s+from\s+['"]@\/store\/modules\/(\w+)['"]/g;
    let m;
    while ((m = moduleImportPattern.exec(scriptContent)) !== null) {
      const storeName = m[1];
      const module = m[2].toLowerCase();
      const storeVar = `${storeName.charAt(0).toLowerCase() + storeName.slice(1)}Store`;
      storeVarToModule.set(storeVar, module);
      moduleToStoreVar.set(module, storeVar);
    }

    // Root/index store: import from path ending with /store/index or exactly @/store (generic)
    const indexStoreImportPattern = /import\s+\{\s*use(\w+)Store\s*\}\s+from\s+['"]([^'"]+)['"]/g;
    while ((m = indexStoreImportPattern.exec(scriptContent)) !== null) {
      const storeName = m[1];
      const importPath = m[2];
      const isRootStore = /\/store\/index['"]?$/.test(importPath) || /@\/store['"]?$/.test(importPath) || importPath === "@/store";
      if (isRootStore) {
        const storeVar = `${storeName.charAt(0).toLowerCase() + storeName.slice(1)}Store`;
        const module = "index";
        storeVarToModule.set(storeVar, module);
        if (!moduleToStoreVar.has(module)) moduleToStoreVar.set(module, storeVar);
      }
    }

    // Build module -> Set<member> from storeMethodMap
    const moduleMembers = new Map<string, Set<string>>();
    for (const [member, module] of Object.entries(storeMethodMap)) {
      const mod = module.toLowerCase();
      if (!moduleMembers.has(mod)) moduleMembers.set(mod, new Set());
      moduleMembers.get(mod)!.add(member);
    }

    // Infer correct "allXxx" property from filename + store analysis (generic, no project names)
    const entityFromFilename = (): string => {
      const baseName = filePath.split("/").pop() || "";
      const entityMatch = baseName.match(/^(\w+)(Detail|List|View|Page)?\.vue$/i);
      return entityMatch ? entityMatch[1].toLowerCase() : "";
    };

    const inferAllProperty = (wrongProp: string): { correctProp: string; module: string } | null => {
      if (!wrongProp.startsWith("all")) return null;
      const entity = entityFromFilename();
      for (const [member, mod] of Object.entries(storeMethodMap)) {
        if (!member.startsWith("all")) continue;
        const memberLower = member.toLowerCase();
        const withoutAll = memberLower.slice(3);
        const singular = withoutAll.endsWith("s") ? withoutAll.slice(0, -1) : withoutAll.endsWith("ies") ? withoutAll.slice(0, -3) + "y" : withoutAll;
        if (entity === "" || memberLower.includes(entity) || singular.includes(entity) || entity.includes(singular)) {
          return { correctProp: member, module: mod };
        }
      }
      return null;
    };

    const replacements: Array<{ wrongStore: string; wrongMember: string; correctStore: string; correctMember: string }> = [];
    const storesToAdd = new Map<string, { storeVar: string; useStore: string; importPath: string }>();

    // Collect storeVar -> Set<member> for "don't replace module with index when fetchXxx is used" check
    const storeVarUsedMembers = new Map<string, Set<string>>();
    const addUsedMember = (storeVar: string, member: string) => {
      if (!storeVarUsedMembers.has(storeVar)) storeVarUsedMembers.set(storeVar, new Set());
      storeVarUsedMembers.get(storeVar)!.add(member);
    };

    const indexMembers = new Set(
      Object.entries(storeMethodMap).filter(([, mod]) => mod === "index").map(([m]) => m)
    );

    const shouldSkipReplaceWithIndex = (
      wrongStore: string,
      correctStore: string,
      correctModule: string
    ): boolean => {
      if (correctModule !== "index") return false;
      const wrongModule = storeVarToModule.get(wrongStore);
      if (!wrongModule || wrongModule === "index") return false;
      const usedMembers = storeVarUsedMembers.get(wrongStore);
      if (!usedMembers) return false;
      // If wrongStore uses a method exclusive to its module (e.g. fetchUser), keep it for all usages
      const usesExclusiveMethod = [...usedMembers].some(
        (member) =>
          storeMethodMap[member] === wrongModule && !indexMembers.has(member)
      );
      return usesExclusiveMethod;
    };

    // Check storeVar.method()
    const methodPattern = /(\w+Store)\.(\w+)\s*\(/g;
    while ((m = methodPattern.exec(scriptContent)) !== null) {
      const [, storeVar, member] = m;
      addUsedMember(storeVar, member);
      const storeModule = storeVarToModule.get(storeVar);
      const memberModule = storeMethodMap[member];
      if (!memberModule || !storeModule) continue;
      const storeHasMember = moduleMembers.get(storeModule)?.has(member);
      if (storeHasMember) continue;
      const correctModule = memberModule.toLowerCase();
      const correctStoreVar = moduleToStoreVar.get(correctModule);
      const importPath = correctModule === "index" ? "@/store/index" : `@/store/modules/${correctModule}`;
      if (!correctStoreVar) {
        const useStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
        storesToAdd.set(correctModule, {
          storeVar: `${correctModule}Store`,
          useStore,
          importPath
        });
        replacements.push({ wrongStore: storeVar, wrongMember: member, correctStore: `${correctModule}Store`, correctMember: member });
      } else if (correctStoreVar !== storeVar) {
        replacements.push({ wrongStore: storeVar, wrongMember: member, correctStore: correctStoreVar, correctMember: member });
      }
    }

    // Check storeVar.property (not method)
    const propPattern = /(\w+Store)\.(\w+)(?!\s*\()/g;
    const propMatches: Array<{ storeVar: string; member: string }> = [];
    while ((m = propPattern.exec(scriptContent)) !== null) {
      propMatches.push({ storeVar: m[1], member: m[2] });
      addUsedMember(m[1], m[2]);
    }
    for (const { storeVar, member } of propMatches) {
      const storeModule = storeVarToModule.get(storeVar);
      let memberModule = storeMethodMap[member];
      let correctMember = member;

      if (!memberModule && member.startsWith("all")) {
        const inferred = inferAllProperty(member);
        if (inferred) {
          memberModule = inferred.module;
          correctMember = inferred.correctProp;
        }
      }

      if (!memberModule) continue;
      const storeHasMember = storeModule && moduleMembers.get(storeModule)?.has(member);
      if (storeHasMember && member === correctMember) continue;

      const correctModule = memberModule.toLowerCase();
      const correctStoreVar = moduleToStoreVar.get(correctModule);
      const importPath = correctModule === "index" ? "@/store/index" : `@/store/modules/${correctModule}`;
      if (shouldSkipReplaceWithIndex(storeVar, correctStoreVar || `${correctModule}Store`, correctModule)) continue;
      if (!correctStoreVar) {
        const useStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
        storesToAdd.set(correctModule, {
          storeVar: `${correctModule}Store`,
          useStore,
          importPath
        });
        replacements.push({ wrongStore: storeVar, wrongMember: member, correctStore: `${correctModule}Store`, correctMember });
      } else if (correctStoreVar !== storeVar || correctMember !== member) {
        replacements.push({ wrongStore: storeVar, wrongMember: member, correctStore: correctStoreVar, correctMember });
      }
    }

    if (replacements.length === 0) return result;

    // Add missing store imports and inits
    for (const { useStore, storeVar, importPath } of storesToAdd.values()) {
      if (scriptContent.includes(useStore)) continue;
      const importLine = `import { ${useStore} } from '${importPath}';\n`;
      const firstImportMatch = scriptContent.match(/\n?(import\s+)/m);
      if (firstImportMatch) {
        const insertIndex = scriptContent.indexOf(firstImportMatch[1]);
        scriptContent = scriptContent.slice(0, insertIndex) + importLine + scriptContent.slice(insertIndex);
      } else {
        scriptContent = importLine + scriptContent;
      }
      const initLine = `const ${storeVar} = ${useStore}();\n`;
      const afterImports = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/);
      if (afterImports) {
        const insertPos = afterImports[0].length;
        scriptContent = scriptContent.slice(0, insertPos) + initLine + scriptContent.slice(insertPos);
      } else {
        scriptContent = initLine + scriptContent;
      }
    }

    // Apply replacements (dedupe by wrongStore.wrongMember)
    const seen = new Set<string>();
    for (const { wrongStore, wrongMember, correctStore, correctMember } of replacements) {
      const key = `${wrongStore}.${wrongMember}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pattern = new RegExp(`\\b${wrongStore}\\.${wrongMember.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      scriptContent = scriptContent.replace(pattern, `${correctStore}.${correctMember}`);
      result.fixes.push(`Fixed ${wrongStore}.${wrongMember} → ${correctStore}.${correctMember}`);
    }

    // Fallback: any storeVar.allXxx not in store analysis -> infer from filename + storeMethodMap (generic)
    const allWrongPropPattern = /(\w+Store)\.(all\w+)\b/g;
    let wrongPropMatch;
    const wrongAllProps = new Map<string, string>();
    while ((wrongPropMatch = allWrongPropPattern.exec(scriptContent)) !== null) {
      const wrongProp = wrongPropMatch[2];
      if (storeMethodMap[wrongProp]) continue;
      const inferred = inferAllProperty(wrongProp);
      if (inferred) {
        const correctStoreVar = moduleToStoreVar.get(inferred.module) ?? `${inferred.module}Store`;
        wrongAllProps.set(wrongProp, `${correctStoreVar}.${inferred.correctProp}`);
      }
    }
    for (const [wrongProp, replacement] of wrongAllProps) {
      const pattern = new RegExp(`(\\w+Store)\\.${wrongProp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      scriptContent = scriptContent.replace(pattern, replacement);
      result.fixes.push(`Fixed unknown .${wrongProp} → ${replacement} (inferred from filename)`);
    }

    // Detail view: allXxx?.find(...) → currentXxx when store has both (generic from store analysis)
    const allToCurrentFromAnalysis = new Map<string, string>();
    for (const [member, module] of Object.entries(storeMethodMap)) {
      if (!member.startsWith("all")) continue;
      const pluralSuffix = member.slice(3);
      const singular = pluralSuffix.endsWith("ies") ? pluralSuffix.slice(0, -3) + "y" : pluralSuffix.endsWith("s") ? pluralSuffix.slice(0, -1) : pluralSuffix;
      const currentCandidate = "current" + singular.charAt(0).toUpperCase() + singular.slice(1);
      if (storeMethodMap[currentCandidate] === module) {
        allToCurrentFromAnalysis.set(member, currentCandidate);
      }
    }
    const baseName = filePath.split("/").pop() || "";
    if (baseName.includes("Detail") && allToCurrentFromAnalysis.size > 0) {
      const allPropsList = [...allToCurrentFromAnalysis.keys()].map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const findPattern = new RegExp(`(\\w+Store)\\.(${allPropsList})\\s*\\?\\.find\\s*\\([^)]*\\)\\s*\\|\\|\\s*null`, "g");
      const beforeDetail = scriptContent;
      scriptContent = scriptContent.replace(findPattern, (fullMatch, storeVar, allProp) => {
        const currentProp = allToCurrentFromAnalysis.get(allProp);
        if (currentProp) return `${storeVar}.${currentProp}?.value ?? null`;
        return fullMatch;
      });
      if (scriptContent !== beforeDetail) {
        result.fixes.push("Detail view: replaced allXxx.find() with currentXxx (from store analysis)");
      }
    }

    result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], scriptContent));
    result.fixed = true;
    return result;
  }
};

/** List/pagination props often on store - bare refs need storeVar prefix */
const STORE_LIST_PROPS = ["lists"] as const;
const STORE_PAGINATION_PROPS = ["itemsPerPage", "pageSize", "perPage"] as const;

/**
 * Fix: Bare lists/itemsPerPage/pageSize etc. used without store prefix when useXStore exists.
 * Generic: any list/pagination prop (lists, items, data, itemsPerPage, pageSize, perPage).
 */
export const storeRefsFromIndexStoreRule: FixRule = {
  id: "store-refs-from-index-store",
  description: "Replace bare lists/itemsPerPage/pageSize with storeVar prefix when useXStore exists",
  priority: 66,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const storeVar = getStoreVarFromScript(script);
    if (!storeVar) return false;
    for (const prop of [...STORE_LIST_PROPS, ...STORE_PAGINATION_PROPS]) {
      const bareUse = STORE_LIST_PROPS.includes(prop as typeof STORE_LIST_PROPS[number])
        ? new RegExp(`\\b${prop}\\s*\\[`).test(script)
        : new RegExp(`(^|[^.\\w])${prop}\\b`).test(script);
      const hasPrefix = new RegExp(`${storeVar}\\.${prop}`).test(script);
      if (bareUse && !hasPrefix) return true;
    }
    return false;
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const storeVar = getStoreVarFromScript(scriptContent);
    if (!storeVar) return result;
    const fixedProps: string[] = [];
    for (const prop of STORE_LIST_PROPS) {
      const pattern = new RegExp(`\\b${prop}\\s*\\[`, "g");
      const prefixPattern = new RegExp(`${storeVar}\\.${prop}`);
      if (pattern.test(scriptContent) && !prefixPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(new RegExp(`\\b${prop}\\s*\\[`, "g"), `${storeVar}.${prop}[`);
        fixedProps.push(prop);
      }
    }
    for (const prop of STORE_PAGINATION_PROPS) {
      const pattern = new RegExp(`(^|[^.\\w])${prop}\\b`, "g");
      const prefixPattern = new RegExp(`${storeVar}\\.${prop}`);
      if (pattern.test(scriptContent) && !prefixPattern.test(scriptContent)) {
        scriptContent = scriptContent.replace(new RegExp(`(^|[^.\\w])${prop}\\b`, "g"), `$1${storeVar}.${prop}`);
        fixedProps.push(prop);
      }
    }
    if (fixedProps.length > 0) {
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push(`Replaced bare ${fixedProps.join("/")} with ${storeVar}. prefix`);
    }
    return result;
  },
};

/** Vue 2 global properties handled by other rules - do not convert to getCurrentInstance */
const RESERVED_GLOBAL_PROPS = new Set(["router", "route", "store"]);

/** Vue 2 instance properties removed in Vue 3 (no globalProperties equivalent) */
const REMOVED_INSTANCE_PROPS = new Set(["children"]);

/** Pinia store names (userStore, appStore, etc.) - use useXStore(), not getCurrentInstance */
function isStoreGlobalProp(prop: string): boolean {
  return prop.endsWith("Store");
}

/**
 * Fix: this.$xxx → getCurrentInstance()?.appContext.config.globalProperties.$xxx in script setup.
 * Generic: applies to any global plugin ($bar, $progress, $toast, etc.) - varName = xxx without $.
 * Excludes: router, route, store (handled elsewhere) and *Store (Pinia - use useXStore()).
 */
export const thisBarToGetCurrentInstanceRule: FixRule = {
  id: "this-bar-to-get-current-instance",
  description: "Replace this.$xxx with getCurrentInstance for any global plugin",
  priority: 65,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<script")) return false;
    const match = content.match(/this\.\$(\w+)/g);
    return (
      match?.some(
        (m) => {
          const prop = m.replace("this.$", "");
          return (
            !RESERVED_GLOBAL_PROPS.has(prop) &&
            !REMOVED_INSTANCE_PROPS.has(prop) &&
            !isStoreGlobalProp(prop)
          );
        }
      ) ?? false
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const props = new Set<string>();
    let m;
    const re = /this\.\$(\w+)/g;
    while ((m = re.exec(scriptContent)) !== null) {
      if (
        !RESERVED_GLOBAL_PROPS.has(m[1]) &&
        !REMOVED_INSTANCE_PROPS.has(m[1]) &&
        !isStoreGlobalProp(m[1])
      ) {
        props.add(m[1]);
      }
    }
    if (props.size === 0) return result;

    if (!scriptContent.includes("getCurrentInstance")) {
      const vueImport = scriptContent.match(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/);
      if (vueImport) {
        const imports = vueImport[1].trim();
        scriptContent = scriptContent.replace(
          /import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/,
          `import { ${imports}, getCurrentInstance } from 'vue'`
        );
      } else {
        scriptContent = "import { getCurrentInstance } from 'vue';\n" + scriptContent;
      }
    }

    const afterImports = scriptContent.match(/(import\s+[^;]+;[\s\n]*)+/)?.[0]?.length ?? 0;
    const decls: string[] = [];
    for (const prop of props) {
      const varName = prop;
      const decl = `const ${varName} = getCurrentInstance()?.appContext.config.globalProperties.$${prop};`;
      if (!scriptContent.includes(`const ${varName} = getCurrentInstance()`)) {
        decls.push(decl);
      }
      scriptContent = scriptContent.replace(new RegExp(`this\\.\\$${prop}\\b`, "g"), varName);
    }
    if (decls.length > 0) {
      scriptContent = scriptContent.slice(0, afterImports) + "\n" + decls.join("\n") + "\n" + scriptContent.slice(afterImports);
    }
    result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push(`Replaced this.$${[...props].join(", this.$")} with getCurrentInstance`);
    return result;
  },
};

/** Vue 3: $children removed - placeholder returns [] and warns. Migrate to template refs. */
const $CHILDREN_PLACEHOLDER =
  `(console.warn("[vue-ai-migrator] $children was removed in Vue 3 - use template refs: https://v3-migration.vuejs.org/breaking-changes/children.html"), [])`;

/**
 * Fix: this.$children → placeholder (Vue 3 removed $children - use template refs)
 * Generic: applies to .vue (all script blocks) and .js/.ts. Compatible with script setup migration.
 */
export const childrenRemovedRule: FixRule = {
  id: "children-removed",
  description: "Replace this.$children with placeholder ($children removed in Vue 3)",
  priority: 70,
  shouldApply: (filePath, content) => content.includes("this.$children"),
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    if (!content.includes("this.$children")) return result;
    // Replace in entire file - handles .vue (all script blocks) and .js/.ts generically
    const fixedContent = content.replace(
      /this\.\$children\b/g,
      $CHILDREN_PLACEHOLDER
    );
    result.content = fixedContent;
    result.fixed = true;
    result.fixes.push(
      "Replaced this.$children with [] (Vue 3 removed - migrate to template refs)"
    );
    result.issues.push(
      "$children was removed in Vue 3. Use template refs to access child components: https://v3-migration.vuejs.org/breaking-changes/children.html"
    );
    return result;
  },
};

/**
 * Fix: Remove duplicate store declaration when both getCurrentInstance and useXStore exist.
 * Pattern: const storeVar = getCurrentInstance()?.appContext...$storeVar + const storeVar = useXStore()
 * → keep only useXStore.
 */
export const removeDuplicateStoreGetCurrentInstanceRule: FixRule = {
  id: "remove-duplicate-store-get-current-instance",
  description: "Remove getCurrentInstance store decl when useXStore already exists",
  priority: 66,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("getCurrentInstance")) return false;
    return /const\s+(\w+Store)\s*=\s*getCurrentInstance\(\)\?\.appContext\.config\.globalProperties\.\$\1/.test(content)
      && /\buse\w+Store\s*\(\s*\)/.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return result;
    let script = scriptMatch[1];
    const re = /const\s+(\w+Store)\s*=\s*getCurrentInstance\(\)\?\.appContext\.config\.globalProperties\.\$\1\s*;?\s*\n?/g;
    const before = script;
    script = script.replace(re, (match, storeVar) => {
      if (new RegExp(`const\\s+${storeVar}\\s*=\\s*use\\w+Store\\s*\\(`, "g").test(before)) {
        return "";
      }
      return match;
    });
    if (script !== before) {
      result.content = content.replace(scriptMatch[0], scriptMatch[0].replace(scriptMatch[1], script));
      result.fixed = true;
      result.fixes.push("Removed duplicate getCurrentInstance store declarations");
    }
    return result;
  },
};

/**
 * Fix: storeVar.storeVar.METHOD → storeVar.METHOD (duplicate store name). Generic for any store.
 */
export const indexStoreDuplicateRule: FixRule = {
  id: "index-store-duplicate",
  description: "Fix storeVar.storeVar.METHOD to storeVar.METHOD (duplicate store name)",
  priority: 64,
  shouldApply: (filePath, content) => {
    return /\b(\w+)\.\1\./.test(content) || /\b(\w+)\s*\n\s*\.\1\./.test(content);
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content
      .replace(/\b(\w+)\.\1\./g, "$1.")
      .replace(/\b(\w+)\s*\n\s*\.\1\./g, "$1.");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed storeVar.storeVar to storeVar");
    }
    return result;
  },
};

/**
 * Fix: this.$store.commit("X", args) → indexStore.X(args) when indexStore exists.
 */
export const thisStoreCommitToStoreRule: FixRule = {
  id: "this-store-commit-to-store",
  description: "Replace this.$store.commit with store mutation call in script setup",
  priority: 63,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && content.includes("this.$store.commit");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const storeVar = getStoreVarFromScript(scriptContent);
    if (!storeVar) return result;
    scriptContent = scriptContent.replace(
      /this\.\$store\.commit\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g,
      `${storeVar}.$1($2)`
    );
    if (scriptContent !== scriptMatch[2]) {
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push("Replaced this.$store.commit with store mutation");
    }
    return result;
  },
};

/**
 * Fix: this.$store → storeVar in script setup. Generic: detects store from const X = useYStore().
 * In Composition API, this doesn't exist - use the store variable from useXStore().
 */
export const thisStoreToIndexStoreRule: FixRule = {
  id: "this-store-to-index-store",
  description: "Replace this.$store with store variable (Composition API has no this)",
  priority: 64,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script") &&
      content.includes("this.$store")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch || !/this\.\$store/.test(scriptMatch[2])) return result;
    const scriptContent = scriptMatch[2];
    const storeVar = getStoreVarFromScript(scriptContent);
    if (!storeVar) return result;
    const newScript = scriptContent.replace(/this\.\$store/g, storeVar);
    if (newScript !== scriptContent) {
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + newScript + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push(`Replaced this.$store with ${storeVar}`);
    }
    return result;
  },
};

/**
 * Fix: this.$root._isMounted → !import.meta.env.SSR (Vue 3: $root._isMounted was SSR guard).
 */
export const thisRootIsMountedRule: FixRule = {
  id: "this-root-is-mounted",
  description: "Replace this.$root._isMounted with !import.meta.env.SSR for client check",
  priority: 64,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && content.includes("this.$root._isMounted");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const fixed = content.replace(/this\.\$root\._isMounted/g, "!import.meta.env.SSR");
    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Replaced this.$root._isMounted with !import.meta.env.SSR");
    }
    return result;
  },
};

/**
 * Fix: this.$nextTick → nextTick in script setup. In Composition API, this doesn't exist.
 */
export const thisNextTickRule: FixRule = {
  id: "this-next-tick",
  description: "Replace this.$nextTick with nextTick from vue",
  priority: 64,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") && content.includes("this.$nextTick");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    if (!scriptContent.includes("this.$nextTick")) return result;
    if (!scriptContent.includes("nextTick")) {
      const vueImport = scriptContent.match(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"]/);
      if (vueImport) {
        const imports = vueImport[1];
        if (!/nextTick/.test(imports)) {
          scriptContent = scriptContent.replace(
            /import\s+\{([^}]+)\}\s+from\s+['"]vue['"]/,
            (m, imps) => `import { ${imps.trim()}, nextTick } from 'vue'`
          );
        }
      } else {
        scriptContent = "import { nextTick } from 'vue';\n" + scriptContent;
      }
    }
    scriptContent = scriptContent.replace(/this\.\$nextTick/g, "nextTick");
    if (scriptContent !== scriptMatch[2]) {
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push("Replaced this.$nextTick with nextTick");
    }
    return result;
  },
};

/**
 * Fix: return this in script setup (method chaining). In Composition API, this doesn't exist.
 * Replaces with api object + defineExpose for components used as bar.start().finish() etc.
 */
export const returnThisInScriptSetupRule: FixRule = {
  id: "return-this-in-script-setup",
  description: "Replace return this with api object + defineExpose for method chaining in script setup",
  priority: 64,
  shouldApply: (filePath, content) => {
    return (
      filePath.endsWith(".vue") &&
      content.includes("<script") &&
      content.includes("return this")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch || !/return this/.test(scriptMatch[2])) return result;
    let scriptContent = scriptMatch[2];
    // Find const fnName = (...) => { ... return this } - collect fnNames
    const methodNames = new Set<string>();
    const fnPattern = /const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>\s*\{/g;
    let fnMatch;
    while ((fnMatch = fnPattern.exec(scriptContent)) !== null) {
      const fnName = fnMatch[1];
      const start = fnMatch.index + fnMatch[0].length;
      const brace = findMatchingBrace(scriptContent, start - 1);
      if (brace >= 0) {
        const body = scriptContent.slice(start, brace);
        if (/return\s+this\b/.test(body)) methodNames.add(fnName);
      }
    }
    if (methodNames.size === 0) return result;
    const names = [...methodNames];
    const apiName = "api";
    if (scriptContent.includes("defineExpose")) return result;
    scriptContent = scriptContent.replace(/\breturn\s+this\b/g, `return ${apiName}`);
    const apiDecl = `\nconst ${apiName} = { ${names.join(", ")} };\ndefineExpose(${apiName});`;
    scriptContent = scriptContent.trimEnd() + apiDecl;
    result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
    result.fixed = true;
    result.fixes.push("Replaced return this with api object + defineExpose");
    return result;
  },
};

function findMatchingBrace(str: string, openIdx: number): number {
  if (str[openIdx] !== "{") return -1;
  let depth = 1;
  for (let i = openIdx + 1; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
