/**
 * Rules for fixing store-related issues in <script setup> components
 */

import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";
import { getStoreMethodMap } from "../utils/store-analysis-cache";

/**
 * Fix: Fix components using <script setup> that reference stores incorrectly
 * Pattern: this.methodName() → storeVar.methodName()
 */
export const storeScriptSetupRule: FixRule = {
  id: "store-script-setup",
  description: "Fix components using <script setup> that reference stores incorrectly",
  priority: 70,
  shouldApply: (filePath, content) => {
    return filePath.endsWith(".vue") &&
           content.includes("<script setup") &&
           content.includes("this.");
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    if (!context.scriptContent) {
      return result;
    }

    let fixed = content;
    let hasChanges = false;

    // Pattern: this.methodName() or this.propertyName
    // This requires store analysis which is complex, so for now we'll detect and warn
    const thisPattern = getCachedRegex(
      "this\\.(\\w+)",
      "g"
    );
    
    const thisReferences = new Set<string>();
    let match;
    
    while ((match = thisPattern.exec(context.scriptContent)) !== null) {
      thisReferences.add(match[1]);
    }

    if (thisReferences.size > 0) {
      // Note: Actual fixing requires store analysis which should be done
      // by the main post-migration-fixer.ts that has access to analyzePiniaStores
      // This rule mainly detects the issue
      result.issues.push(
        `Found ${thisReferences.size} this. references in <script setup> that may need store migration`
      );
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
  apply: async (filePath, content, context) => {
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
    const hasUseRouter = scriptContent.includes("useRouter");
    const hasUseRoute = scriptContent.includes("useRoute");

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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
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

/**
 * Fix: Template uses binding (e.g. currentTheme) with appStore.setTheme but no reactive binding defined.
 * Pattern: template has v-model="themeName" or {{ themeName }}, script has appStore.setTheme, no themeName → add computed from store.
 * Generic: store getter/setter binding - when store has setX and template uses x, add computed({ get: () => store.x, set: (v) => store.setX(v) }).
 */
export const storeThemeBindingRule: FixRule = {
  id: "store-theme-binding",
  description: "Add computed theme binding (currentTheme) from app store when template uses it and setTheme exists",
  priority: 66,
  shouldApply: (filePath, content) => {
    if (!filePath.endsWith(".vue") || !content.includes("<template>")) return false;
    const template = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? "";
    const script = content.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
    const templateUsesTheme = /(?:v-model=["']currentTheme["']|{{\s*currentTheme\s*}})/.test(template);
    const hasAppStoreSetTheme = /(?:appStore|app\s*Store)\.setTheme/.test(script) || /setTheme\s*\(/.test(script);
    const hasStore = /useAppStore|useStore\s*\(/.test(script);
    const noCurrentTheme = !/const\s+currentTheme\s*=/.test(script) && !/currentTheme\s*=\s*computed/.test(script);
    return templateUsesTheme && hasStore && hasAppStoreSetTheme && noCurrentTheme;
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    const scriptMatch = content.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
    if (!scriptMatch) return result;
    let scriptContent = scriptMatch[2];
    const storeVarMatch = scriptContent.match(/(\w+)\s*=\s*useAppStore\s*\(\s*\)/);
    const storeVar = storeVarMatch ? storeVarMatch[1] : "appStore";
    const computedImport = scriptContent.includes("computed") && /import\s*\{[^}]*\bcomputed\b/.test(scriptContent);
    const setterParam = context.enableTypeScript ? "(v: string)" : "(v)";
    const insertBlock = `const currentTheme = computed({\n  get: () => ${storeVar}.theme,\n  set: ${setterParam} => ${storeVar}.setTheme(v),\n});\n\n`;
    let insertPos = scriptContent.indexOf("const changeTheme");
    if (insertPos === -1) insertPos = scriptContent.indexOf("const " + storeVar);
    if (insertPos === -1) insertPos = scriptContent.search(/\n(?!\s*\/\/)/);
    if (insertPos >= 0) {
      if (!computedImport && !scriptContent.includes("import { computed }")) {
        scriptContent = scriptContent.replace(
          /(import\s*\{)([^}]+)(\}\s*from\s*['"]vue['"])/,
          (_: string, open: string, imports: string, close: string) =>
            imports.includes("computed") ? open + imports + close : open + imports.trim() + ", computed " + close
        );
      }
      scriptContent = scriptContent.slice(0, insertPos) + insertBlock + scriptContent.slice(insertPos);
      result.content = content.replace(scriptMatch[0], scriptMatch[1] + scriptContent + scriptMatch[3]);
      result.fixed = true;
      result.fixes.push("Added currentTheme computed from app store for v-model binding");
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
    // Only apply if TypeScript is enabled
    if (!context.enableTypeScript) {
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    if (!context.scriptContent || !context.projectRoot) return result;

    const storeMethodMap = await getStoreMethodMap(context.projectRoot);
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

    // Check storeVar.method()
    const methodPattern = /(\w+Store)\.(\w+)\s*\(/g;
    while ((m = methodPattern.exec(scriptContent)) !== null) {
      const [, storeVar, member] = m;
      const storeModule = storeVarToModule.get(storeVar);
      const memberModule = storeMethodMap[member];
      if (!memberModule || !storeModule) continue;
      const storeHasMember = moduleMembers.get(storeModule)?.has(member);
      if (storeHasMember) continue;
      const correctModule = memberModule.toLowerCase();
      const correctStoreVar = moduleToStoreVar.get(correctModule);
      if (!correctStoreVar) {
        const useStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
        storesToAdd.set(correctModule, {
          storeVar: `${correctModule}Store`,
          useStore,
          importPath: `@/store/modules/${correctModule}`
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
      if (!correctStoreVar) {
        const useStore = `use${correctModule.charAt(0).toUpperCase() + correctModule.slice(1)}Store`;
        storesToAdd.set(correctModule, {
          storeVar: `${correctModule}Store`,
          useStore,
          importPath: `@/store/modules/${correctModule}`
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
      const firstImport = scriptContent.match(/^import\s+/m);
      if (firstImport) {
        scriptContent = scriptContent.replace(/^import\s+/, importLine + "import ");
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
