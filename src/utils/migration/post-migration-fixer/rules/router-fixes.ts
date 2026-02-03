/**
 * Rules for fixing Vue Router issues
 */

import * as fsSync from "fs";
import * as path from "path";
import type { FixRule, FixContext, FixRuleResult } from "../types";
import { getCachedRegex } from "../utils/regex-cache";

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
  apply: async (filePath, content, context) => {
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
            content.includes("app.mixin("));
  },
  apply: async (filePath, content, context) => {
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
    const projectRoot = context.projectRoot;

    // Vue.filter → comment out (filters removed in Vue 3 - use functions/computed instead)
    const filterPattern = /Vue\.filter\s*\([^)]+\)\s*;?/g;
    let filterMatch;
    while ((filterMatch = filterPattern.exec(fixed)) !== null) {
      const match = filterMatch[0];
      fixed = fixed.replace(match, `// ${match} // Filters removed in Vue 3 - use functions/computed instead`);
      result.fixed = true;
      result.fixes.push("Commented out Vue.filter() - filters removed in Vue 3");
    }

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

    // Remove or comment app.mixin(mixinName) when mixin was transformed to composable or not imported
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
      const baseName = mixinName.replace(/Mixin$/i, "");
      const composableName = `use${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`;
      let composableExists = false;
      let willBeTransformed = false;
      if (projectRoot) {
        try {
          const mixinPathTs = path.join(projectRoot, "src", "mixins", `${mixinName}.ts`);
          const mixinPathJs = path.join(projectRoot, "src", "mixins", `${mixinName}.js`);
          if (fsSync.existsSync(mixinPathTs) || fsSync.existsSync(mixinPathJs)) {
            const mixinContent = fsSync.existsSync(mixinPathTs)
              ? fsSync.readFileSync(mixinPathTs, "utf-8")
              : fsSync.readFileSync(mixinPathJs, "utf-8");
            composableExists =
              mixinContent.includes(`export const ${composableName}`) ||
              mixinContent.includes(`export function ${composableName}`);
            willBeTransformed =
              !composableExists &&
              mixinContent.includes("data()") &&
              mixinContent.includes(`export const ${mixinName}`);
          }
        } catch {
          // ignore
        }
      }
      if (composableExists || willBeTransformed) {
        const idx = fixed.indexOf(match);
        if (idx >= 0) {
          fixed =
            fixed.slice(0, idx) +
            `// ${match} // Mixin transformed to composable ${composableName} - use it in components instead` +
            fixed.slice(idx + match.length);
          result.fixed = true;
          result.fixes.push(`Commented out app.mixin(${mixinName}) - use composable ${composableName}`);
        }
      }
    }

    // Comment out mixin import when composable exists
    const mixinImportPattern = /import\s+\{\s*(\w+)\s*\}\s+from\s+['"]\.\/mixins\/(\w+)['"]\s*;?\n?/g;
    const mixinImports: Array<{ match: string; mixinName: string; index: number }> = [];
    let importMatch;
    while ((importMatch = mixinImportPattern.exec(fixed)) !== null) {
      mixinImports.push({ match: importMatch[0], mixinName: importMatch[1], index: importMatch.index });
    }
    for (const { match, mixinName } of mixinImports.reverse()) {
      const composableName = `use${mixinName.charAt(0).toUpperCase() + mixinName.slice(1)}`;
      let composableExists = false;
      let willBeTransformed = false;
      if (projectRoot) {
        try {
          const mixinPathTs = path.join(projectRoot, "src", "mixins", `${mixinName}.ts`);
          const mixinPathJs = path.join(projectRoot, "src", "mixins", `${mixinName}.js`);
          if (fsSync.existsSync(mixinPathTs) || fsSync.existsSync(mixinPathJs)) {
            const mixinContent = fsSync.existsSync(mixinPathTs)
              ? fsSync.readFileSync(mixinPathTs, "utf-8")
              : fsSync.readFileSync(mixinPathJs, "utf-8");
            composableExists =
              mixinContent.includes(`export const ${composableName}`) ||
              mixinContent.includes(`export function ${composableName}`);
            willBeTransformed =
              !composableExists &&
              mixinContent.includes("data()") &&
              mixinContent.includes(`export const ${mixinName}`);
          }
        } catch {
          // ignore
        }
      }
      if (composableExists || willBeTransformed) {
        const idx = fixed.indexOf(match);
        if (idx >= 0) {
          fixed =
            fixed.slice(0, idx) +
            `// ${match} // Use composable ${composableName} instead\n` +
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
        /app\.mixin\([^)]+\)\s*;?/g,
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
  apply: async (filePath, content, context) => {
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
 * Fix: Replace router.app.$store in navigation guards with Pinia (getActivePinia + useIndexStore)
 */
export const routerGuardPiniaRule: FixRule = {
  id: "router-guard-pinia",
  description: "Replace router.app.$store in beforeEach with Pinia store",
  priority: 93,
  shouldApply: (filePath, content) => {
    return (filePath.includes("router") || filePath.endsWith("router/index.ts") || filePath.endsWith("router/index.js")) &&
           (content.includes("router.app.$store") || content.includes("router.app?.$store"));
  },
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = {
      content,
      fixed: false,
      fixes: [],
      issues: []
    };
    let fixed = content;
    if (!fixed.includes("getActivePinia")) {
      const insertAfterRouter = fixed.match(/(import\s+[^;]+from\s+['\"]vue-router['\"]\s*;?\s*\n)/);
      const insertIdx = insertAfterRouter ? (insertAfterRouter.index! + insertAfterRouter[0].length) : 0;
      fixed = fixed.slice(0, insertIdx) +
        "import { getActivePinia } from \"pinia\";\nimport { useIndexStore } from \"@/store/index\";\n" +
        fixed.slice(insertIdx);
      result.fixed = true;
    }
    const getterMatch = fixed.match(/router\.app\.\??\$store\.getters\.(\w+)/);
    const getterName = getterMatch ? getterMatch[1] : "isAuthenticated";
    fixed = fixed.replace(
      /if\s*\(\s*!?\s*router\.app\.\??\$store\.getters\.\w+\s*\)\s*\{[\s\S]*?next\s*\(\s*\{\s*name:\s*['\"]([^'\"]+)['\"]\s*\}\s*\)[\s\S]*?\}\s*else\s*\{[\s\S]*?next\s*\(\s*\)[\s\S]*?\}/,
      (match) => {
        const redirectNameMatch = match.match(/name:\s*['\"]([^'\"]+)['\"]/);
        const redirectName = redirectNameMatch ? redirectNameMatch[1] : "Home";
        return `const pinia = getActivePinia();\n    const indexStore = pinia ? useIndexStore(pinia) : null;\n    if (!indexStore?.${getterName}) {\n      next({ name: "${redirectName}" });\n    } else {\n      next();\n    }`;
      }
    );
    if (fixed !== content) {
      result.fixed = true;
      result.fixes.push("Replaced router.app.$store in guard with Pinia (getActivePinia + useIndexStore)");
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
  apply: async (filePath, content, context) => {
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let scriptContent = context.scriptContent ?? content;
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
  apply: async (filePath, content, context) => {
    const result: FixRuleResult = { content, fixed: false, fixes: [], issues: [] };
    let scriptContent = context.scriptContent ?? content;
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
      const r = routeName.toLowerCase();
      let inferredPath: string;
      if (r.includes("post") || r.includes("detail")) {
        inferredPath = `/blog/\${${paramValue}}`;
      } else if (r.includes("user") || r.includes("profile")) {
        inferredPath = `/user/\${${paramValue}}`;
      } else {
        const pathSegment = routeName.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
        inferredPath = `/${pathSegment}/\${${paramValue}}`;
      }
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
