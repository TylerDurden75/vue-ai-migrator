/**
 * Rules for fixing Vue Router issues
 */

import * as fsSync from "fs";
import * as path from "path";
import type { FixRule, FixContext, FixRuleResult } from "../../types";
import { getCachedRegex } from "../../utils/regex-cache";
import { getStoreMethodMap, getStoreConfigForModule } from "../../utils/store-analysis-cache";
import {
  mixinNameToComposable,
  composableNameToProvideKey,
} from "../../../mixins-to-composables";

/**
 * Fix: createApp syntax in main.js/main.ts
 */
export const createAppSyntaxRule: FixRule = {
  id: "create-app-syntax",
  description: "Fix createApp syntax in main.js/main.ts",
  priority: 95,
  shouldApply: (filePath, content) => {
    return (filePath.includes("main.js") || filePath.includes("main.ts")) &&
           content.includes("createApp");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Remove Vuex store import from main (Vue 3 uses Pinia)
    if (/import\s+store\s+from\s+['"]\.\/store['"]/.test(fixed)) {
      fixed = fixed.replace(/import\s+store\s+from\s+['"]\.\/store['"];?\n?/g, "");
      result.fixed = true;
      result.fixes.push("Removed store import from main.js (Vue 3 uses Pinia)");
    }

    // Fix incorrect createApp syntax: createApp({ router, render: () => h(App) })
    const incorrectPattern = getCachedRegex(
      "createApp\\s*\\(\\s*\\{\\s*router[^}]*render:\\s*\\(\\)\\s*=>\\s*h\\s*\\([^)]+\\)\\s*\\}\\s*\\)",
      "g"
    );
    
    if (incorrectPattern.test(fixed)) {
      fixed = fixed.replace(
        /createApp\s*\(\s*\{\s*router[^}]*render:\s*\(\)\s*=>\s*h\s*\(([^)]+)\)\s*\}\s*\)/g,
        "createApp($1)"
      );
      result.fixed = true;
      result.fixes.push("Fixed createApp syntax");
    }

    // Vue.config.keyCodes removed in Vue 3 - use key names in templates (handled by template transform)
    if (/Vue\.config\.keyCodes\s*=/.test(fixed)) {
      fixed = fixed.replace(/Vue\.config\.keyCodes\s*=\s*\{[^}]*\}\s*;?\s*\n?/g, "");
      result.fixed = true;
      result.fixes.push("Removed Vue.config.keyCodes (use key names in templates, e.g. .enter instead of .13)");
    }

    // Vue.config.ignoredElements → app.config.compilerOptions.isCustomElement (Vue 3 Custom Elements Interop)
    // Note: plugins codemod removes Vue.config - this rule handles leftover or if plugins didn't run
    const ignoredElementsMatch = fixed.match(
      /Vue\.config\.ignoredElements\s*=\s*(\[[^\]]*\]|\/[^/]+\/[gimuy]*)\s*;?\s*\n?/
    );
    if (ignoredElementsMatch) {
      const value = ignoredElementsMatch[1];
      let replacement = "";
      if (value.startsWith("[")) {
        replacement = `app.config.compilerOptions.isCustomElement = (tag) => ${value}.includes(tag);\n`;
      } else {
        replacement = `app.config.compilerOptions.isCustomElement = (tag) => ${value}.test(tag);\n`;
      }
      fixed = fixed.replace(ignoredElementsMatch[0], "");
      const createAppMatch = fixed.match(/const app = createApp\([^)]+\)/);
      const insertPos =
        createAppMatch && createAppMatch.index !== undefined
          ? createAppMatch.index + createAppMatch[0].length
          : 0;
      fixed = fixed.slice(0, insertPos) + "\n" + replacement + fixed.slice(insertPos);
      result.fixed = true;
      result.fixes.push("Converted Vue.config.ignoredElements to app.config.compilerOptions.isCustomElement");
    }

    // Ensure app.use(router) is present when router is imported (main.js order)
    if (fixed.includes("import router from") && !fixed.includes("app.use(router)")) {
      const appUsePiniaMatch = fixed.match(/app\.use\(createPinia\(\)\)\s*;?\s*\n/);
      const createAppMatch = fixed.match(/const app = createApp\([^)]+\)/);
      const insertAfter = appUsePiniaMatch
        ? fixed.indexOf(appUsePiniaMatch[0]) + appUsePiniaMatch[0].length
        : createAppMatch && createAppMatch.index !== undefined
          ? createAppMatch.index + createAppMatch[0].length
          : 0;
      fixed = fixed.slice(0, insertAfter) + "app.use(router);\n" + fixed.slice(insertAfter);
      result.fixed = true;
      result.fixes.push("Added app.use(router)");
    }

    // Fix order: Pinia must be initialized BEFORE router
    if (fixed.includes("createPinia") && fixed.includes("createRouter")) {
      const piniaIndex = fixed.indexOf("createPinia");
      const routerIndex = fixed.indexOf("createRouter");
      
      if (routerIndex < piniaIndex) {
        // Extract Pinia initialization
        const piniaMatch = fixed.match(/const\s+pinia\s*=\s*createPinia\(\)[\s\S]*?app\.use\(pinia\)/);
        const routerMatch = fixed.match(/const\s+router\s*=\s*createRouter\([\s\S]*?app\.use\(router\)/);
        
        if (piniaMatch && routerMatch) {
          // Remove both
          fixed = fixed.replace(piniaMatch[0], "");
          fixed = fixed.replace(routerMatch[0], "");
          
          // Add in correct order
          const appMatch = fixed.match(/const\s+app\s*=\s*createApp\([^)]+\)/);
          if (appMatch) {
            const insertPos = appMatch.index! + appMatch[0].length;
            fixed = fixed.substring(0, insertPos) + 
                   `\nconst pinia = createPinia();\napp.use(pinia);\n` +
                   routerMatch[0].replace(/const\s+router/, "const router") +
                   fixed.substring(insertPos);
            result.fixed = true;
            result.fixes.push("Fixed Pinia initialization order (Pinia before Router)");
          }
        }
      }
    }

    if (result.fixed) {
      result.content = fixed;
    }

    return result;
  }
};

/**
 * Fix: Convert Vue 2 global API calls to Vue 3 app API (main.ts/main.js).
 * Vue.filter → commented out (filters removed in Vue 3)
 * Vue.directive → app.directive, Vue.component → app.component, Vue.mixin → app.mixin
 * Comment out app.mixin when mixin was transformed to composable.
 * Ensures app is created first and API calls are after createApp()
 */
export const vue2GlobalApiRule: FixRule = {
  id: "vue2-global-api",
  description: "Convert Vue 2 global API to Vue 3 app API (comment out filters)",
  priority: 94,
  dependencies: ["create-app-syntax"],
  shouldApply: (filePath, content) => {
    return (filePath.includes("main.js") || filePath.includes("main.ts")) &&
           (content.includes("Vue.filter") || content.includes("Vue.directive") ||
            content.includes("Vue.component") || content.includes("Vue.mixin") ||
            content.includes("Vue.use(") ||
            content.includes("app.mixin("));
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const hasCreateApp = content.includes("createApp");
    const hasAppVar = /const\s+app\s*=/.test(content);
    if (!hasCreateApp || !hasAppVar) {
      result.issues.push("Vue.* calls found but createApp() not detected - manual conversion needed");
      return result;
    }

    let fixed = content;
    const projectRoot = _context.projectRoot;

    // Vue.filter → comment out (filters removed in Vue 3 - use functions/computed instead)
    // Only process lines that are NOT already commented (avoid re-commenting on each run)
    const filterPattern = /^(\s*)(Vue\.filter\s*\([^)]+\)\s*;?)\s*$/gm;
    fixed = fixed.replace(filterPattern, (_, indent, match) => {
      result.fixed = true;
      result.fixes.push("Commented out Vue.filter() - filters removed in Vue 3");
      return `${indent}// ${match} // Filters removed in Vue 3 - use functions/computed instead`;
    });

    // Vue.directive() → app.directive()
    if (fixed.includes("Vue.directive")) {
      fixed = fixed.replace(/Vue\.directive\(/g, "app.directive(");
      result.fixed = true;
      result.fixes.push("Converted Vue.directive() to app.directive()");
    }

    // Vue.component() → app.component()
    if (fixed.includes("Vue.component")) {
      fixed = fixed.replace(/Vue\.component\(/g, "app.component(");
      result.fixed = true;
      result.fixes.push("Converted Vue.component() to app.component()");
    }

    // Vue.mixin() → app.mixin()
    if (fixed.includes("Vue.mixin")) {
      fixed = fixed.replace(/Vue\.mixin\(/g, "app.mixin(");
      result.fixed = true;
      result.fixes.push("Converted Vue.mixin() to app.mixin()");
    }

    // Vue.use(plugin) → app.use(plugin) for generic plugins (exclude Vuex, VueRouter - handled elsewhere)
    fixed = fixed.replace(/Vue\.use\s*\(\s*([^)]+)\s*\)\s*;?\s*\n?/g, (match, arg) => {
      const trimmed = arg.trim();
      if (/\bVuex\b/.test(trimmed)) {
        result.fixed = true;
        result.fixes.push("Commented out Vue.use(Vuex) - use Pinia instead");
        return `// ${match.trim()} // Vuex removed - use Pinia\n`;
      }
      if (/\bVueRouter\b|\bRouter\b/.test(trimmed) && !/createRouter/.test(trimmed)) {
        result.fixed = true;
        result.fixes.push("Commented out Vue.use(VueRouter) - not needed in Vue 3");
        return `// ${match.trim()} // Vue 3 router does not need Vue.use()\n`;
      }
      result.fixed = true;
      result.fixes.push(`Converted Vue.use(${trimmed}) to app.use()`);
      return match.replace(/Vue\.use\s*\(/, "app.use(");
    });

    // Replace app.mixin({ setup() { return useXxx(); } }) with app.provide (wrapper from previous migration)
    const appMixinWrapperPattern =
      /app\.mixin\s*\(\s*\{\s*setup\s*\(\s*\)\s*\{[\s\S]*?return\s+(\w+)\s*\(\s*\)\s*;[\s\S]*?\},?\s*\}\s*\)\s*;?\s*\n?/g;
    let wrapperTargetComposable: string | null = null; // Track for import update
    fixed = fixed.replace(appMixinWrapperPattern, (_, composableName) => {
      const provideKey = composableNameToProvideKey(composableName);
      // Prefer useUser over useUserMixin when both exist (new composable naming)
      let targetComposable = composableName;
      if (projectRoot && composableName.endsWith("Mixin")) {
        const newName = composableName.replace(/Mixin$/, "");
        const newPath = path.join(projectRoot, "src", "composables", `${newName}.ts`);
        if (fsSync.existsSync(newPath)) {
          targetComposable = newName;
          wrapperTargetComposable = newName; // Update import from old to new
        }
      }
      result.fixed = true;
      result.fixes.push(`Replaced app.mixin wrapper with app.provide('${provideKey}')`);
      return `app.provide('${provideKey}', ${targetComposable}());\n`;
    });
    // When we switched to useUser, update the import too
    if (wrapperTargetComposable) {
      const oldComposable = wrapperTargetComposable + "Mixin";
      const importPattern = new RegExp(
        `import\\s+\\{\\s*${oldComposable}\\s*\\}\\s+from\\s+['"]([^'"]*composables/${oldComposable})['"]\\s*;?`,
        "g"
      );
      fixed = fixed.replace(importPattern, () => {
        result.fixed = true;
        result.fixes.push(`Updated import to ${wrapperTargetComposable}`);
        return `import { ${wrapperTargetComposable} } from "@/composables/${wrapperTargetComposable}";`;
      });
    }

    // Replace app.mixin(mixinName) with app.provide when mixin was transformed to composable
    const appMixinPattern = /app\.mixin\((\w+)\)\s*;?\s*\n?/g;
    const appMixinMatches: Array<{ match: string; mixinName: string; index: number }> = [];
    let appMixinMatch;
    while ((appMixinMatch = appMixinPattern.exec(fixed)) !== null) {
      appMixinMatches.push({ match: appMixinMatch[0], mixinName: appMixinMatch[1], index: appMixinMatch.index });
    }
    for (const { match, mixinName } of appMixinMatches.reverse()) {
      // If mixin is not imported (no uncommented import), remove the line to avoid ReferenceError
      const lines = fixed.split("\n");
      let hasActiveImport = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        if (trimmed.includes("import") && new RegExp(`\\b${mixinName}\\b`).test(line)) {
          hasActiveImport = true;
          break;
        }
      }
      if (!hasActiveImport) {
        fixed = fixed.replace(match, "");
        result.fixed = true;
        result.fixes.push(`Removed app.mixin(${mixinName}) - mixin not imported`);
        continue;
      }
      const composableName = mixinNameToComposable(mixinName);
      let composableExists = false;
      let willBeTransformed = false;
      if (projectRoot) {
        try {
          const composableFilePath = path.join(projectRoot, "src", "composables", `${composableName}.ts`);
          composableExists = fsSync.existsSync(composableFilePath);
          if (!composableExists) {
            const mixinPathTs = path.join(projectRoot, "src", "mixins", `${mixinName}.ts`);
            const mixinPathJs = path.join(projectRoot, "src", "mixins", `${mixinName}.js`);
            if (fsSync.existsSync(mixinPathTs) || fsSync.existsSync(mixinPathJs)) {
              const mixinContent = fsSync.existsSync(mixinPathTs)
                ? fsSync.readFileSync(mixinPathTs, "utf-8")
                : fsSync.readFileSync(mixinPathJs, "utf-8");
              willBeTransformed =
                mixinContent.includes("data()") &&
                (mixinContent.includes(`export const ${mixinName}`) || mixinContent.includes(`export default`));
            }
          }
        } catch {
          // ignore
        }
      }
      // Only replace when composable file exists - otherwise we'd reference a non-existent module
      if (composableExists) {
        const idx = fixed.indexOf(match);
        if (idx >= 0) {
          // Replace with app.provide() - coherent naming: useUserMixin -> 'user' (not 'userMixin')
          const provideKey = composableNameToProvideKey(composableName);
          fixed =
            fixed.slice(0, idx) +
            `app.provide('${provideKey}', ${composableName}());\n` +
            fixed.slice(idx + match.length);
          result.fixed = true;
          result.fixes.push(`Replaced app.mixin(${mixinName}) with app.provide('${provideKey}')`);
        }
      } else if (willBeTransformed) {
        // Composable wasn't created (e.g. mixin uses Vuex) - comment out to avoid ReferenceError
        const idx = fixed.indexOf(match);
        if (idx >= 0) {
          fixed =
            fixed.slice(0, idx) +
            `// ${match.trim()} // Mixin → composable ${composableName} - add ${composableName}() in components that need it` +
            fixed.slice(idx + match.length);
          result.fixed = true;
          result.fixes.push(`Commented out app.mixin(${mixinName}) - use composable ${composableName} in components`);
        }
      }
    }

    // Replace mixin import with composable import when mixin was transformed to composable
    const mixinImportPatterns = [
      /import\s+\{\s*(\w+)\s*\}\s+from\s+['"]([^'"]*mixins\/[^'"]+)['"]\s*;?\n?/g,
      /import\s+(\w+)\s+from\s+['"]([^'"]*mixins\/[^'"]+)['"]\s*;?\n?/g,
    ];
    const mixinImports: Array<{ match: string; mixinName: string; index: number }> = [];
    for (const pattern of mixinImportPatterns) {
      let importMatch;
      while ((importMatch = pattern.exec(fixed)) !== null) {
        mixinImports.push({ match: importMatch[0], mixinName: importMatch[1], index: importMatch.index });
      }
    }
    for (const { match, mixinName } of mixinImports.reverse()) {
      const composableName = mixinNameToComposable(mixinName);
      const composablePath = "@/composables/" + composableName;
      let composableExistsImport = false;
      let mixinQualifies = false;
      if (projectRoot) {
        try {
          const composableFilePath = path.join(projectRoot, "src", "composables", `${composableName}.ts`);
          composableExistsImport = fsSync.existsSync(composableFilePath);
          if (!composableExistsImport) {
            const mixinPathTs = path.join(projectRoot, "src", "mixins", `${mixinName}.ts`);
            const mixinPathJs = path.join(projectRoot, "src", "mixins", `${mixinName}.js`);
            if (fsSync.existsSync(mixinPathTs) || fsSync.existsSync(mixinPathJs)) {
              const mixinContent = fsSync.existsSync(mixinPathTs)
                ? fsSync.readFileSync(mixinPathTs, "utf-8")
                : fsSync.readFileSync(mixinPathJs, "utf-8");
              mixinQualifies =
                mixinContent.includes("data()") &&
                (mixinContent.includes(`export const ${mixinName}`) || mixinContent.includes(`export default`));
            }
          }
        } catch {
          // ignore
        }
      }
      if (composableExistsImport) {
        const idx = fixed.indexOf(match);
        if (idx >= 0) {
          fixed =
            fixed.slice(0, idx) +
            `import { ${composableName} } from '${composablePath}';\n` +
            fixed.slice(idx + match.length);
          result.fixed = true;
          result.fixes.push(`Replaced mixin import with composable ${composableName}`);
        }
      } else if (mixinQualifies) {
        // Composable not created (mixin uses Vuex etc.) - comment out to avoid ReferenceError
        const idx = fixed.indexOf(match);
        if (idx >= 0) {
          fixed =
            fixed.slice(0, idx) +
            `// ${match.trim()} // Use composable ${composableName} when available\n` +
            fixed.slice(idx + match.length);
          result.fixed = true;
          result.fixes.push(`Commented out mixin import - use composable ${composableName}`);
        }
      }
    }

    // Ensure app API calls are after createApp() - move any that appear before
    const createAppMatch = fixed.match(/const\s+app\s*=\s*createApp\([^)]+\)/);
    if (createAppMatch && createAppMatch.index !== undefined) {
      const createAppIndex = createAppMatch.index;
      const createAppEnd = createAppIndex + createAppMatch[0].length;

      const appApiPatterns = [
        // app.provide('key', value) - e.g. app.provide('userMixin', useUserMixin())
        /app\.provide\s*\([^;]+\)\s*;?/g,
        // app.mixin: support both simple (app.mixin(x)) and wrapper (app.mixin({ setup() { return useXxx(); } }))
        /app\.mixin\((?:\w+\)|[\s\S]*?\}\s*\))\s*;?/g,
        /app\.directive\([^)]+\)\s*;?/g,
        /app\.component\([^)]+\)\s*;?/g,
        /app\.config\.globalProperties\.\w+\s*=\s*\w+\s*;?/g,
      ];

      const callsToMove: Array<{ content: string; index: number }> = [];
      for (const pattern of appApiPatterns) {
        let match;
        while ((match = pattern.exec(fixed)) !== null) {
          if (match.index < createAppIndex) {
            callsToMove.push({ content: match[0], index: match.index });
          }
        }
      }
      // Sort by index descending so we remove from end first (preserves indices)
      callsToMove.sort((a, b) => b.index - a.index);
      let totalRemovedBeforeCreateApp = 0;
      for (const { content, index } of callsToMove) {
        fixed = fixed.substring(0, index) + fixed.substring(index + content.length);
        if (index < createAppEnd) totalRemovedBeforeCreateApp += content.length;
      }
      const insertPos = fixed.indexOf("\n", createAppEnd - totalRemovedBeforeCreateApp) + 1 ||
        createAppEnd - totalRemovedBeforeCreateApp;
      const toInsert = callsToMove.map((c) => c.content).join("\n") + "\n";
      fixed = fixed.substring(0, insertPos) + toInsert + fixed.substring(insertPos);
      if (callsToMove.length > 0) {
        result.fixed = true;
        result.fixes.push("Moved app API calls after createApp()");
      }
    }

    if (result.fixed) {
      result.content = fixed;
    }

    return result;
  }
};

/**
 * Fix: createWebHistory with process.env.BASE_URL
 */
export const createWebHistoryRule: FixRule = {
  id: "create-web-history",
  description: "Fix createWebHistory with process.env.BASE_URL that can be an object",
  priority: 94,
  dependencies: ["create-app-syntax"],
  shouldApply: (filePath, content) => {
    return (filePath.includes("router") || filePath.includes("main")) &&
           content.includes("createWebHistory") &&
           content.includes("process.env.BASE_URL");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Remove process.env.BASE_URL from createWebHistory
    // Pattern: createWebHistory(process.env.BASE_URL) → createWebHistory()
    fixed = fixed.replace(
      /createWebHistory\s*\(\s*process\.env\.BASE_URL\s*\)/g,
      "createWebHistory()"
    );

    // Pattern: createWebHistory({ base: process.env.BASE_URL }) → createWebHistory()
    fixed = fixed.replace(
      /createWebHistory\s*\(\s*\{\s*base:\s*process\.env\.BASE_URL\s*\}\s*\)/g,
      "createWebHistory()"
    );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Removed process.env.BASE_URL from createWebHistory (can cause [object Object] in URL)");
    }

    return result;
  }
};

/**
 * Fix: createRouter naming conflict - export function createRouter shadows import
 */
export const createRouterConflictRule: FixRule = {
  id: "create-router-conflict",
  description: "Fix createRouter naming conflict (alias import)",
  priority: 94,
  shouldApply: (filePath, content) => {
    return (
      filePath.includes("router") &&
      content.includes("from 'vue-router'") &&
      content.includes("export function createRouter") &&
      /return\s+createRouter\s*\(/.test(content) &&
      !content.includes("createRouter as createVueRouter")
    );
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    const fixed = content
      .replace(
        /import\s*\{\s*createRouter\s*,\s*createWebHistory\s*\}\s*from\s*['"]vue-router['"]/,
        "import { createRouter as createVueRouter, createWebHistory } from 'vue-router'"
      )
      .replace(
        /import\s*\{\s*createWebHistory\s*,\s*createRouter\s*\}\s*from\s*['"]vue-router['"]/,
        "import { createRouter as createVueRouter, createWebHistory } from 'vue-router'"
      )
      .replace(
        /return\s+createRouter\s*\(\s*\{/,
        "return createVueRouter({"
      );

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed createRouter naming conflict (aliased import)");
    }

    return result;
  }
};

/**
 * Fix: Replace router.app.$store in navigation guards with Pinia.
 * Generic: uses store analysis to detect which store has the auth getter (isAuthenticated, etc.).
 */
export const routerGuardPiniaRule: FixRule = {
  id: "router-guard-pinia",
  description: "Replace router.app.$store in beforeEach with Pinia store",
  priority: 93,
  shouldApply: (filePath, content) => {
    return (filePath.includes("router") || filePath.endsWith("router/index.ts") || filePath.endsWith("router/index.js")) &&
           (content.includes("router.app.$store") || content.includes("router.app?.$store"));
  },
  apply: async (filePath, content, context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    let fixed = content;
    const getterMatch = fixed.match(/router\.app\.\??\$store\.getters\.(\w+)/);
    const getterName = getterMatch ? getterMatch[1] : "isAuthenticated";
    let module = "index";
    if (context.projectRoot) {
      try {
        const storeMethodMap = await getStoreMethodMap(context.projectRoot);
        module = storeMethodMap[getterName] ?? "index";
      } catch {
        module = "index";
      }
    }
    const { storeVar, storeName, importPath } = getStoreConfigForModule(module, context.mainStoreInfo);
    if (!fixed.includes("getActivePinia")) {
      const insertAfterRouter = fixed.match(/(import\s+[^;]+from\s+['"]vue-router['"]\s*;?\s*\n)/);
      const insertIdx = insertAfterRouter ? (insertAfterRouter.index! + insertAfterRouter[0].length) : 0;
      fixed = fixed.slice(0, insertIdx) +
        `import { getActivePinia } from "pinia";\nimport { ${storeName} } from "${importPath}";\n` +
        fixed.slice(insertIdx);
      result.fixed = true;
    }
    fixed = fixed.replace(
      /if\s*\(\s*!?\s*router\.app\.\??\$store\.getters\.\w+\s*\)\s*\{[\s\S]*?next\s*\(\s*\{\s*name:\s*['"]([^'"]+)['"]\s*\}\s*\)[\s\S]*?\}\s*else\s*\{[\s\S]*?next\s*\(\s*\)[\s\S]*?\}/,
      (match) => {
        const redirectNameMatch = match.match(/name:\s*['"]([^'"]+)['"]/);
        const redirectName = redirectNameMatch ? redirectNameMatch[1] : "Home";
        return `const pinia = getActivePinia();\n    const ${storeVar} = pinia ? ${storeName}(pinia) : null;\n    if (!${storeVar}?.${getterName}) {\n      next({ name: '${redirectName}' });\n    } else {\n      next();\n    }`;
      }
    );
    if (fixed !== content) {
      result.fixed = true;
      result.fixes.push(`Replaced router.app.$store in guard with Pinia (${storeName})`);
    }
    result.content = fixed;
    return result;
  }
};

/**
 * Fix: Catch-all route path
 */
export const catchAllRouteRule: FixRule = {
  id: "catch-all-route",
  description: "Fix catch-all route path: '*' → '/:pathMatch(.*)*'",
  priority: 93,
  dependencies: ["create-web-history"],
  shouldApply: (filePath, content) => {
    return (filePath.includes("router") || filePath.includes("main")) &&
           content.includes("path: '*'");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };

    let fixed = content;

    // Fix catch-all route: path: '*' → path: '/:pathMatch(.*)*'
    fixed = fixed.replace(/path:\s*['"]\*['"]/g, "path: '/:pathMatch(.*)*'");

    if (fixed !== content) {
      result.content = fixed;
      result.fixed = true;
      result.fixes.push("Fixed catch-all route: path: '*' → path: '/:pathMatch(.*)*'");
    }

    return result;
  }
};

/**
 * Fix route.query.redirect to prevent [object Object] in URL (guard with typeof === 'string')
 */
export const routeQueryRedirectGuardRule: FixRule = {
  id: "route-query-redirect-guard",
  description: "Guard route.query.redirect with typeof check to prevent object in URL",
  priority: 92,
  dependencies: ["create-web-history"],
  shouldApply: (filePath, content) => content.includes("query.redirect"),
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let scriptContent = _context.scriptContent ?? content;
    if (filePath.endsWith(".vue")) {
      const m = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      scriptContent = m ? m[1] : content;
    }

    if (!/\.query\.redirect/.test(scriptContent)) return result;

    const fallbackDefault = "/dashboard";
    let fixed = scriptContent;

    // const x = route.query.redirect || "/foo" → typeof route.query.redirect === 'string' ? route.query.redirect : '/foo'
    fixed = fixed.replace(
      /(const\s+\w+\s*=\s*)(route|this\.\$route)\.query\.redirect(\s*\|\|\s*['"]([^'"]+)['"])?/g,
      (_match, prefix, routeVar, _fallbackPart, fallback) => {
        const fallbackVal = fallback || fallbackDefault;
        const r = routeVar === "this.$route" ? "route" : routeVar;
        return `${prefix}typeof ${r}.query.redirect === 'string' ? ${r}.query.redirect : '${fallbackVal}'`;
      }
    );
    // router.push(route.query.redirect) → router.push(typeof route.query.redirect === 'string' ? ... : '/dashboard')
    fixed = fixed.replace(
      /router\.push\((route|this\.\$route)\.query\.redirect\)/g,
      (_match, routeVar) => {
        const r = routeVar === "this.$route" ? "route" : routeVar;
        return `router.push(typeof ${r}.query.redirect === 'string' ? ${r}.query.redirect : '${fallbackDefault}')`;
      }
    );

    if (fixed !== scriptContent) {
      result.fixed = true;
      result.fixes.push("Fixed route.query.redirect to handle object type (prevent [object Object] in URL)");
      if (filePath.endsWith(".vue")) {
        const scriptMatch = content.match(/<script[^>]*>[\s\S]*?<\/script>/);
        if (scriptMatch) {
          const tag = scriptMatch[0].match(/<script[^>]*>/)?.[0] ?? "<script>";
          result.content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/, `${tag}${fixed}</script>`);
        }
      } else {
        result.content = fixed;
      }
    }
    return result;
  }
};

/**
 * Convert router.push({ name: 'X', params: { id: value } }) to path-based navigation (Vue Router 4)
 */
export const routerPushNameParamsToPathRule: FixRule = {
  id: "router-push-name-params-to-path",
  description: "Convert router.push name+params to path for Vue Router 4 compatibility",
  priority: 91,
  dependencies: ["route-query-redirect-guard"],
  shouldApply: (filePath, content) =>
    content.includes("router.push") && content.includes("params") && content.includes("name"),
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let scriptContent = _context.scriptContent ?? content;
    if (filePath.endsWith(".vue")) {
      const m = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      scriptContent = m ? m[1] : content;
    }

    const pattern = /router\.push\s*\(\s*\{\s*name\s*:\s*['"]([^'"]+)['"]\s*,\s*params\s*:\s*\{([^}]+)\}\s*\}\s*\)/g;
    const matches: Array<{ fullMatch: string; routeName: string; paramValue: string }> = [];
    let match;
    while ((match = pattern.exec(scriptContent)) !== null) {
      const [, routeName, paramsStr] = match;
      const paramMatch = paramsStr.match(/(\w+)\s*:\s*([^,}]+)/);
      const shorthandMatch = paramsStr.match(/(\w+)/);
      const paramValue = paramMatch ? paramMatch[2].trim() : (shorthandMatch ? shorthandMatch[1] : null);
      if (paramValue) {
        matches.push({ fullMatch: match[0], routeName, paramValue });
      }
    }

    if (matches.length === 0) return result;

    let fixed = scriptContent;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { fullMatch, routeName, paramValue } = matches[i];
      const pathSegment = routeName.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
      const inferredPath = `/${pathSegment}/\${${paramValue}}`;
      const replacement = `router.push({ path: \`${inferredPath}\` })`;
      fixed = fixed.replace(fullMatch, replacement);
      result.fixes.push(`Secured router.push with params for route '${routeName}' (Vue Router 4 - using path)`);
    }
    result.fixed = true;
    if (filePath.endsWith(".vue")) {
      const scriptMatch = content.match(/<script[^>]*>[\s\S]*?<\/script>/);
      if (scriptMatch) {
        const tag = scriptMatch[0].match(/<script[^>]*>/)?.[0] ?? "<script>";
        result.content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/, `${tag}${fixed}</script>`);
      }
    } else {
      result.content = fixed;
    }
    return result;
  }
};

/**
 * Fix: Unwrap defineAsyncComponent in router - Vue Router expects () => import() for lazy routes.
 * component: defineAsyncComponent(() => import('./X.vue')) → component: () => import('./X.vue')
 * Generic: applies to any router file (router/, router.js, router.ts).
 */
export const routerDefineAsyncComponentUnwrapRule: FixRule = {
  id: "router-define-async-component-unwrap",
  description: "Unwrap defineAsyncComponent in router for lazy route components",
  priority: 90,
  shouldApply: (filePath, content) => {
    const isRouter = filePath.includes("router/") || filePath.endsWith("router.js") || filePath.endsWith("router.ts");
    return isRouter && content.includes("defineAsyncComponent");
  },
  apply: async (filePath, content, _context: FixContext) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let fixed = content;
    fixed = fixed.replace(
      /component\s*:\s*defineAsyncComponent\s*\(\s*\(\s*\)\s*=>\s*import\s*\(([^)]+)\)\s*\)/g,
      "component: () => import($1)"
    );
    fixed = fixed.replace(
      /(\w+)\s*=\s*defineAsyncComponent\s*\(\s*\(\s*\)\s*=>\s*import\s*\(([^)]+)\)\s*\)/g,
      "$1 = () => import($2)"
    );
    if (fixed !== content) {
      result.fixed = true;
      result.fixes.push("Unwrapped defineAsyncComponent for router lazy components");
      const contentWithoutImports = fixed.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?\s*\n?/g, "");
      const stillUsesDefineAsync = contentWithoutImports.includes("defineAsyncComponent");
      if (!stillUsesDefineAsync) {
        fixed = fixed.replace(
          /import\s*\{([^}]*),\s*defineAsyncComponent\s*\}\s*from\s*['"]vue['"]/,
          (_, s) => `import { ${s.trim()} } from "vue"`
        ).replace(
          /import\s*\{\s*defineAsyncComponent\s*(?:,\s*)?([^}]*)\}\s*from\s*['"]vue['"]/,
          (_, s) => s.trim() ? `import { ${s.trim()} } from "vue"` : ""
        ).replace(
          /import\s*\{\s*defineAsyncComponent\s*\}\s*from\s*['"]vue['"]\s*;?\s*\n?/,
          ""
        );
      }
      result.content = fixed;
    }
    return result;
  },
};
