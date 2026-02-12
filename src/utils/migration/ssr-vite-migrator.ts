import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { glob } from "glob";
import { analyzeMainStore } from "./post-migration-fixer/utils/store-analyzer";

export interface SSRViteMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

function buildViteSSRServer(options: {
  defaultTitle: string;
  faviconPath: string | null;
  entryServerModulePath?: string;
}): string {
  const ssrEntryPath = options.entryServerModulePath ?? "/src/entry-server.js";
  const faviconLine = options.faviconPath
    ? `  app.use(favicon(resolve('${options.faviconPath.replace(/\\/g, "/")}')))`
    : "  // No favicon found in public/ - add app.use(favicon(...)) if needed";
  return `import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import favicon from 'serve-favicon'
import compression from 'compression'
import microcache from 'route-cache'
import { createServer as createViteServer } from 'vite'
import { renderToString } from '@vue/server-renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const resolve = file => path.resolve(__dirname, file)

const isProd = process.env.NODE_ENV === 'production'
const useMicroCache = process.env.MICRO_CACHE !== 'false'
const defaultTitle = ${JSON.stringify(options.defaultTitle)}

const app = express()

let vite

async function createServer() {
  if (!isProd) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    })
    app.use(vite.middlewares)
  } else {
    app.use(express.static(resolve('dist/client'), { index: false }))
  }

  app.use(compression({ threshold: 0 }))
${faviconLine}
  app.use('/public', express.static(resolve('public')))
  app.use('/manifest.json', express.static(resolve('manifest.json')))

  app.use(microcache.cacheSeconds(1, req => useMicroCache && req.originalUrl))

  app.use('*', async (req, res, next) => {
    const url = req.originalUrl

    const handleError = err => {
      if (err.url) {
        res.redirect(err.url)
      } else if (err.code === 404) {
        res.status(404).send('404 | Page Not Found')
      } else {
        console.error(\`error during render: \${url}\`)
        console.error(err.stack)
        res.status(500).send('500 | Internal Server Error')
      }
    }

    try {
      let template
      if (isProd) {
        template = fs.readFileSync(resolve('dist/client/index.html'), 'utf-8')
      } else {
        template = fs.readFileSync(resolve('index.html'), 'utf-8')
        template = await vite.transformIndexHtml(url, template)
      }

      let createApp
      if (isProd) {
        const entry = await import('./dist/server/entry-server.js')
        createApp = entry.default
      } else {
        const entry = await vite.ssrLoadModule('${ssrEntryPath}')
        createApp = entry.default
      }

      const context = { url, title: defaultTitle }
      const appInstance = await createApp(context)
      const html = await renderToString(appInstance, context)

      const state = context.state || {}
      const stateJson = JSON.stringify(state)
        .replace(/</g, "\\\\u003c")
        .replace(/<\\/script>/gi, "\\\\u003c/script\\\\u003e")
      const stateScript = \`<script>window.__INITIAL_STATE__=\${stateJson}</script>\`

      const fullHtml = template
        .replace("{{ title }}", context.title)
        .replace(/<!--(?:ssr-outlet|vue-ssr-outlet)-->/i, html)
        .replace("<body>", "<body>\\n  " + stateScript)

      res.status(200).set({ 'Content-Type': 'text/html' }).send(fullHtml)
    } catch (err) {
      if (!isProd && vite) {
        vite.ssrFixStacktrace(err)
      }
      handleError(err)
    }
  })

  const port = process.env.PORT || 8080
  app.listen(port, () => {
    console.log(\`server started at localhost:\${port}\`)
  })
}

createServer()
`;
}

/**
 * Migrate SSR entry points and server for Vite
 */
export async function migrateSSRToVite(
  projectPath: string,
  dryRun: boolean,
  rollbackManager?: { backupFile: (p: string) => Promise<void> }
): Promise<SSRViteMigrationResult> {
  const result: SSRViteMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const srcDir = path.join(projectPath, "src");

  // Resolve SSR file paths (generic: support conventional and alternate locations)
  const entryClientPaths = await glob("**/entry*client*.{js,ts}", {
    cwd: projectPath,
    ignore: ["**/node_modules/**", "**/dist/**"],
    absolute: true,
  });
  const entryServerPaths = await glob("**/entry*server*.{js,ts}", {
    cwd: projectPath,
    ignore: ["**/node_modules/**", "**/dist/**"],
    absolute: true,
  });
  const appPaths = await glob("**/app.{js,ts}", {
    cwd: path.join(projectPath, "src"),
    ignore: ["**/node_modules/**"],
    absolute: true,
  });
  const entryClientPath = entryClientPaths[0] ?? path.join(srcDir, "entry-client.js");
  const entryServerPath = entryServerPaths[0] ?? path.join(srcDir, "entry-server.js");
  const appPathFromGlob = appPaths[0];

  // 1. Fix entry-client (any entry*client*.js/ts)
  if (fsSync.existsSync(entryClientPath)) {
    let content = await fs.readFile(entryClientPath, "utf-8");

    // Extract plugin var/prop names: const X = createApp(Component).mount(); Vue.prototype.$Y = X
    let pluginVar = "";
    let pluginProp = "";
    const protoMatch = content.match(/Vue\.prototype\.\$(\w+)\s*=\s*(\w+)/);
    if (protoMatch) {
      pluginProp = protoMatch[1];
      pluginVar = protoMatch[2];
    }
    const mountMatch = content.match(/const\s+(\w+)\s*=\s*createApp\s*\(\s*\w+\s*\)\s*\.mount\s*\(/);
    if (mountMatch && !pluginVar) pluginVar = mountMatch[1];
    if (pluginVar && !pluginProp) pluginProp = pluginVar; // convention: bar = $bar

    const fixes: Array<[RegExp | string, string]> = [
      [/import\s+Vue,\s*\{\s*createApp\s*\}\s*from\s+['"]vue['"]\s*;?\s*\n/, "import { createApp } from 'vue';\n"],
      [/import\s+\{\s*createApp\s*\}\s+from\s+['"]\.\/app['"]\s*;?\s*\n/, "import { createApp as createAppFactory } from './app';\n"],
      [/createApp\s*\(\s*(\w+)\s*\)\s*\.mount\s*\(\s*\)/, "createApp($1).mount(document.createElement('div'))"],
      ...(pluginProp
        ? ([[new RegExp(`\\s*Vue\\.prototype\\.\\$${pluginProp}\\s*=\\s*\\w+\\s*;?\\s*\\n?`), ""]] as Array<[RegExp, string]>)
        : []),
      [/const\s+\{\s*app,\s*router,\s*store[^}]*\}\s*=\s*(?:createAppFactory|createApp)\s*\(\s*\)\s*\n\s*\n\s*\/\/ prime/, "const { app, router, store, pinia } = createAppFactory(null, { initialState: window.__INITIAL_STATE__ })\n\n// prime"],
      [/const\s+\{\s*app,\s*router,\s*store[^}]*\}\s*=\s*(?:createAppFactory|createApp)\s*\(\s*\)/, "const { app, router, store, pinia } = createAppFactory(null, { initialState: window.__INITIAL_STATE__ })"],
      [/store\.replaceState\(window\.__INITIAL_STATE__\)\s*;?\s*\n?/, ""],
      [/pinia\.state\.value\s*=\s*window\.__INITIAL_STATE__\s*;?\s*\n?/, ""],
      [/router\.onReady\(/g, "router.isReady().then("],
      [/router\.getMatchedComponents\((\w+)\)/g, "router.resolve($1).matched.map(m => m.components?.default).filter(Boolean)"],
      [/router\.getMatchedComponents\(\)/, "router.currentRoute.value.matched.map(m => m.components?.default).filter(Boolean)"],
      [/\.map\(c\s*=>\s*c\.asyncData\)\.filter\(_\s*=>\s*_\)/, ".map(c => c?.asyncData).filter(Boolean)"],
      ...(pluginVar
        ? ([
            [new RegExp(`\\b${pluginVar}\\.start\\(\\)`, "g"), `${pluginVar}.start?.()`],
            [new RegExp(`\\b${pluginVar}\\.finish\\(\\)`, "g"), `${pluginVar}.finish?.()`],
          ] as Array<[RegExp, string]>)
        : []),
      [/app\.\$mount\(['"]#app['"]\)/, "app.mount('#app')"],
    ];

    let modified = false;
    for (const [from, to] of fixes) {
      const newContent = content.replace(from as RegExp, to as string);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    }

    // Ensure createAppFactory() + globalProperties.$xxx come BEFORE app.mixin/Vue.mixin (app must exist for app.mixin)
    // Pattern: plugin setup, then mixin, then createApp - wrong order. Fix: plugin, createAppFactory, $plugin, mixin.
    if (pluginVar && pluginProp) {
      const pluginThenMixin = new RegExp(
        `document\\.body\\.appendChild\\s*\\(\\s*${pluginVar}\\.\\$el\\s*\\)\\s*\\n\\s*\\n\\s*(\\/\\/[^\\n]*mixin[^\\n]*\\n\\s*)(Vue\\.mixin|app\\.mixin)`
      );
      if (pluginThenMixin.test(content)) {
        content = content.replace(
          pluginThenMixin,
          `document.body.appendChild(${pluginVar}.$el)\n\nconst { app, router, store, pinia } = createAppFactory()\napp.config.globalProperties.$${pluginProp} = ${pluginVar}\n\n$1$2`
        );
        // Remove duplicate createAppFactory before // prime
        content = content.replace(
          /\n\s*const\s+\{\s*app,\s*router,\s*store(?:,\s*pinia)?\s*\}\s*=\s*(?:createAppFactory|createApp)\s*\(\s*\)\s*\n\s*\n\s*(\/\/\s*prime[^\n]*)/,
          "\n\n$1"
        );
        modified = true;
      }
    }
    // Vue.mixin -> app.mixin (app exists from createAppFactory)
    if (content.includes("Vue.mixin") && content.includes("createAppFactory()")) {
      content = content.replace(/Vue\.mixin\s*\(/g, "app.mixin(");
      modified = true;
    }
    // Add app.config.globalProperties.$plugin = pluginVar when we have bar/plugin and createAppFactory but not yet set
    if (pluginVar && pluginProp && content.includes("createAppFactory") && !content.includes("globalProperties")) {
      const factoryLineRe = new RegExp(
        `(const\\s+\\{\\s*app[^}]*\\}\\s*=\\s*(?:createAppFactory|createApp)\\s*\\([^)]*\\))\\s*;?\\s*\\n`,
        "m"
      );
      if (factoryLineRe.test(content) && !content.includes(`globalProperties.$${pluginProp}`)) {
        content = content.replace(
          factoryLineRe,
          `$1\napp.config.globalProperties.$${pluginProp} = ${pluginVar}\n`
        );
        modified = true;
      }
    }
    if (content.includes("router.isReady().then") && !content.includes("store.setRoute") && content.includes("pinia")) {
      content = content.replace(
        /(router\.isReady\(\)\.then\(\(\) => \{\s*\n)/,
        "$1  store.setRoute(router.currentRoute.value)\n  "
      );
      modified = true;
    }

    if (modified && !dryRun) {
      await fs.writeFile(entryClientPath, content, "utf-8");
      result.changes.push("Fixed entry-client.js for Vue 3 + Pinia");
      result.modified = true;
    }
  }

  // 2. Fix entry-server (any entry*server*.js/ts)
  if (fsSync.existsSync(entryServerPath)) {
    let content = await fs.readFile(entryServerPath, "utf-8");

    const serializePiniaStateBlock = `
function serializePiniaState(state) {
  if (state == null) return state;
  const seen = new WeakSet();
  function traverse(val) {
    if (val == null || typeof val !== "object") return val;
    if (seen.has(val)) return undefined;
    if (val && typeof val === "object" && "__v_isRef" in val) return traverse(val.value);
    if (typeof val === "function") return undefined;
    seen.add(val);
    if (Array.isArray(val)) return val.map(traverse);
    const raw = toRaw(val);
    const result = {};
    for (const k of Object.keys(raw)) {
      if (typeof raw[k] === "function") continue;
      result[k] = traverse(raw[k]);
    }
    return result;
  }
  return traverse(state);
}
`;
    const fixes: Array<[RegExp | string, string]> = [
      [/^import\s+\{\s*createApp\s*\}\s+from\s+['"]\.\/app['"]\s*;?\s*\n/, "import { toRaw } from \"vue\";\nimport { createApp } from \"./app\";\n"],
      [/^import\s+\{\s*createApp\s*\}\s+from\s+['"]\.\/app['"]/, "import { toRaw } from \"vue\";\nimport { createApp } from \"./app\";"],
      [/const\s+\{\s*app,\s*router,\s*store\s*\}\s*=\s*createApp\(\)/, "const { app, router, store, pinia } = createApp(context)"],
      [/const\s+\{\s*app,\s*router,\s*store,\s*pinia\s*\}\s*=\s*createApp\(\w+\)/, "const { app, router, store, pinia } = createApp(context)"],
      [/router\.resolve\(url\)\.route/, "router.resolve(url)"],
      [/router\.onReady\(/g, "router.isReady().then("],
      [/router\.getMatchedComponents\(\)/, "router.currentRoute.value.matched.map(m => m.components?.default).filter(Boolean)"],
      [/context\.state\s*=\s*pinia\.state\.value/, "context.state = serializePiniaState(pinia.state.value)"],
      [/context\.state\s*=\s*store\.state/, "context.state = serializePiniaState(pinia.state.value)"],
    ];
    if (content.includes("router.isReady().then") && !content.includes("store.setRoute")) {
      content = content.replace(
        /(router\.isReady\(\)\.then\(\(\) => \{\s*\n)/,
        "$1      store.setRoute(router.currentRoute.value)\n"
      );
    }

    for (const [from, to] of fixes) {
      const newContent = content.replace(from, to);
      if (newContent !== content) {
        content = newContent;
      }
    }

    if (content.includes("serializePiniaState(") && !content.includes("function serializePiniaState")) {
      content = content.replace(
        /(const isDev = [^\n]+\n)\n/,
        `$1${serializePiniaStateBlock}\n`
      );
    }

    const needsPinia = content.includes("store") && !content.includes("pinia");
    if (needsPinia) {
      content = content.replace(
        /const\s+\{\s*app,\s*router,\s*store\s*\}\s*=\s*createApp\(\)/,
        "const { app, router, store, pinia } = createApp(context)"
      );
      content = content.replace(
        /context\.state\s*=\s*store\.state/,
        "context.state = serializePiniaState(pinia.state.value)"
      );
      if (content.includes("serializePiniaState(") && !content.includes("function serializePiniaState")) {
        content = content.replace(
          /(const isDev = [^\n]+\n)\n/,
          `$1${serializePiniaStateBlock}\n`
        );
        if (!content.includes("import { toRaw }")) {
          content = content.replace(
            /^import\s+\{\s*createApp\s*\}\s+from\s+['"]\.\/app['"]/,
            "import { toRaw } from \"vue\";\nimport { createApp } from \"./app\""
          );
        }
      }
    }
    if (
      (content.includes("router.isReady") || content.includes("pinia")) &&
      !dryRun
    ) {
      await fs.writeFile(entryServerPath, content, "utf-8");
      result.changes.push("Fixed entry-server.js for Vue 3");
      result.modified = true;
    }
  }

  // 3. Fix app.js/ts for Vue 3 + Pinia (and SSR context)
  const mainStoreInfo = await analyzeMainStore(projectPath);
  const storeIndexPaths = [
    path.join(projectPath, "src", "store", "index.ts"),
    path.join(projectPath, "src", "store", "index.js"),
    path.join(projectPath, "store", "index.ts"),
    path.join(projectPath, "store", "index.js"),
  ];
  let storeHasSetRoute = false;
  for (const p of storeIndexPaths) {
    try {
      const storeContent = await fs.readFile(p, "utf-8");
      storeHasSetRoute = /setRoute\s*\(|setRoute\s*:/.test(storeContent);
      break;
    } catch {
      continue;
    }
  }
  const appFilesToTry = appPathFromGlob
    ? [appPathFromGlob]
    : [path.join(srcDir, "app.js"), path.join(srcDir, "app.ts")];
  for (const appFile of appFilesToTry) {
    if (!fsSync.existsSync(appFile)) continue;
    let content = await fs.readFile(appFile, "utf-8");
    if (
      content.includes("createApp") &&
      (content.includes("createStore") || content.includes("vuex-router-sync"))
    ) {
      const appDir = path.dirname(appFile);
      const mixins: Array<{ name: string; importPath: string }> = [];
      const filtersImport: string[] = [];

      // Extract mixins from original content: app.mixin(X) or Vue.mixin(X)
      const mixinUseMatch = content.match(/(?:app|Vue)\.mixin\s*\(\s*(\w+)\s*\)/g);
      if (mixinUseMatch) {
        for (const m of mixinUseMatch) {
          const nameMatch = m.match(/\.mixin\s*\(\s*(\w+)\s*\)/);
          if (!nameMatch) continue;
          const mixinName = nameMatch[1];
          const importMatch = content.match(
            new RegExp(`import\\s+${mixinName}\\s+from\\s+['"]([^'"]+)['"]|import\\s+{\\s*[^}]*\\b${mixinName}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`)
          );
          if (importMatch) {
            const importPath = importMatch[1] || importMatch[2];
            if (importPath && !mixins.some((x) => x.name === mixinName)) {
              mixins.push({ name: mixinName, importPath });
            }
          }
        }
      }

      // Fallback: scan util/, utils/, mixins/ for mixin-like files (title, etc.)
      if (mixins.length === 0) {
        const dirsToScan = ["util", "utils", "mixins"];
        for (const d of dirsToScan) {
          const dirPath = path.join(appDir, d);
          if (!fsSync.existsSync(dirPath)) continue;
          try {
            const files = await fs.readdir(dirPath);
            for (const f of files) {
              if (!f.endsWith(".js") && !f.endsWith(".ts")) continue;
              const fullPath = path.join(dirPath, f);
              const fileContent = await fs.readFile(fullPath, "utf-8");
              if (/(?:created|mounted)\s*\(/.test(fileContent) && /export\s+(?:default|const|function)/.test(fileContent)) {
                const relPath = "./" + path.relative(appDir, fullPath).replace(/\\/g, "/").replace(/\.(js|ts)$/, "");
                const baseName = f.replace(/\.(js|ts)$/, "");
                const mixinName = baseName.charAt(0).toUpperCase() + baseName.slice(1) + "Mixin";
                mixins.push({ name: mixinName, importPath: relPath });
                break;
              }
            }
            if (mixins.length > 0) break;
          } catch {
            continue;
          }
        }
      }

      // Extract filters from original: import * as X from '...filter...'
      const filterImportMatch = content.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]*filter[^'"]*)['"]/i);
      if (filterImportMatch) {
        filtersImport.push(`\nimport * as ${filterImportMatch[1]} from '${filterImportMatch[2]}'`);
      } else {
        // Fallback: scan util/filters, utils/filters, filters/
        const filterPaths = [
          path.join(appDir, "util", "filters.js"),
          path.join(appDir, "utils", "filters.js"),
          path.join(appDir, "filters", "index.js"),
        ];
        for (const fp of filterPaths) {
          if (fsSync.existsSync(fp)) {
            const relPath = "./" + path.relative(appDir, fp).replace(/\\/g, "/").replace(/\.(js|ts)$/, "");
            filtersImport.push(`\nimport * as filters from '${relPath}'`);
            break;
          }
        }
      }

      const mixinBlock = mixins.map((m) => `\n  app.mixin(${m.name})`).join("");
      const mixinImport = mixins.map((m) => `\nimport ${m.name} from '${m.importPath}'`).join("");
      const filtersImportStr = filtersImport.join("");

      const newApp = `import { createApp as createVueApp, h } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { ${mainStoreInfo.storeName} } from './store'
import { createRouter } from './router'${mixinImport}${filtersImportStr}

// Vue 3: filters removed - use functions in templates (e.g. {{ timeAgo(item.time) }})

export function createApp(ssrContext, opts = {}) {
  const router = createRouter()
  const pinia = createPinia()
  if (opts.initialState) pinia.state.value = opts.initialState

  const app = createVueApp({
    render: () => h(App),
  })

  app.use(pinia)
  app.use(router)${mixinBlock}

  // Vue 3 SSR: provide context so title mixin can set document title
  if (ssrContext) {
    app.provide('ssrContext', ssrContext)
  }

  // Expose store via globalProperties for components using this.$store (Options API compat)
  const store = ${mainStoreInfo.storeName}(pinia)
  app.config.globalProperties.$store = store
${storeHasSetRoute ? `
  router.afterEach((to) => {
    store.setRoute(to)
  })` : ""}

  return { app, router, store, pinia }
}
`;
      if (!dryRun) {
        await fs.writeFile(appFile, newApp, "utf-8");
        result.changes.push(`Fixed ${path.basename(appFile)} for Vue 3 + Pinia + SSR`);
        result.modified = true;
      }
    } else if (
      content.includes("createApp") &&
      content.includes("pinia") &&
      !content.includes("createApp(ssrContext)") &&
      !content.includes("createApp(context)")
    ) {
      // App already migrated to Pinia but missing SSR context - patch it
      const origContent = content;
      content = content.replace(
        /export\s+function\s+createApp\s*\(\s*\)/,
        "export function createApp(ssrContext)"
      );
      // Add provide after app.mixin(...) or app.use(router)
      const provideBlock = "\n\n  // Vue 3 SSR: provide context so components can use inject('ssrContext')\n  if (ssrContext) {\n    app.provide('ssrContext', ssrContext)\n  }\n";
      if (/app\.mixin\(\w+\)/.test(content)) {
        content = content.replace(/(app\.mixin\(\w+\))\s*\n/, `$1${provideBlock}\n`);
      } else {
        content = content.replace(/(app\.use\(router\))\s*\n/, `$1${provideBlock}\n`);
      }
      if (content !== origContent) {
        if (!dryRun) {
          await fs.writeFile(appFile, content, "utf-8");
        }
        result.changes.push(`Added SSR context to ${path.basename(appFile)}`);
        result.modified = true;
      }
    }
  }

  // 4. Fix process.env.VUE_ENV and this.$ssrContext in util files (Vite uses import.meta.env.SSR)
  const utilDirs = [
    path.join(srcDir, "util"),
    path.join(srcDir, "utils"),
  ];
  for (const utilDir of utilDirs) {
    if (!fsSync.existsSync(utilDir)) continue;
    const utilFiles = await fs.readdir(utilDir).catch(() => []);
    for (const f of utilFiles) {
      if (!f.endsWith(".js") && !f.endsWith(".ts")) continue;
      const utilPath = path.join(utilDir, f);
      let content = await fs.readFile(utilPath, "utf-8");
      const original = content;

      // process.env.VUE_ENV → import.meta.env.SSR
      content = content
        .replace(/process\.env\.VUE_ENV\s*===\s*['"]server['"]/g, "import.meta.env.SSR")
        .replace(/process\.env\.VUE_ENV\s*!==\s*['"]server['"]/g, "!import.meta.env.SSR");

      // Vue 3 SSR: this.$ssrContext → inject(ssrContext) (app.provide in app.js)
      if (/this\.\$ssrContext\b/.test(content) && !content.includes("from: 'ssrContext'")) {
        content = content.replace(
          /(\{\s*)(created\s*\(\s*\)\s*\{[\s\S]*?)(this\.\$ssrContext)/,
          "$1inject: { ssrContext: { from: 'ssrContext', default: null } },\n  $2this.ssrContext"
        );
        content = content.replace(/this\.\$ssrContext\.(\w+)\s*=/g, "this.ssrContext.$1 =");
        content = content.replace(
          /if\s*\(\s*title\s*\)\s*\{(\s*\n\s*)this\.ssrContext\./g,
          "if (title && this.ssrContext) {$1this.ssrContext."
        );
        content = content.replace(
          /if\s*\(\s*title\s*&&\s*this\.\$ssrContext\s*\)/g,
          "if (title && this.ssrContext)"
        );
      }

      if (content !== original) {
        if (!dryRun) {
          await fs.writeFile(utilPath, content, "utf-8");
        }
        result.changes.push(`Fixed util/${path.basename(utilDir)}/${f} for Vue 3 SSR`);
        result.modified = true;
      }
    }
  }

  // 5. Add type guard for API functions with first param "type" (prevents undefined in URLs)
  const apiDir = path.join(srcDir, "api");
  if (fsSync.existsSync(apiDir)) {
    const apiFiles = await fs.readdir(apiDir).catch(() => []);
    for (const f of apiFiles) {
      if (!f.endsWith(".js") && !f.endsWith(".ts")) continue;
      const apiPath = path.join(apiDir, f);
      const apiContent = await fs.readFile(apiPath, "utf-8");
      if (apiContent.includes("if (!type || typeof type !== 'string')")) continue;

      const newContent = apiContent.replace(
        /(export\s+(?:async\s+)?function\s+(\w+)\s*\(\s*type\s*(?:,\s*[^)]*)?\)\s*\{\s*)/g,
        (m, fnName) => {
          const hasCallback = /\(\s*type\s*,\s*\w+/.test(m) || /watch|subscribe|listen/i.test(fnName);
          const defaultRet = hasCallback ? "() => {}" : "Promise.resolve([])";
          return m + `if (!type || typeof type !== 'string') return ${defaultRet}\n  `;
        }
      );
      if (newContent !== apiContent && !dryRun) {
        await fs.writeFile(apiPath, newContent, "utf-8");
        result.changes.push(`Added type guard in ${path.relative(projectPath, apiPath)}`);
        result.modified = true;
      }
    }
  }

  // 6. Add guard to filter functions that take url and use url.replace (prevents non-string in URL)
  const filtersDirs = [
    path.join(srcDir, "util"),
    path.join(srcDir, "utils"),
    path.join(srcDir, "filters"),
  ];
  for (const dir of filtersDirs) {
    if (!fsSync.existsSync(dir)) continue;
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".js") && !f.endsWith(".ts")) continue;
      const filtersPath = path.join(dir, f);
      const content = await fs.readFile(filtersPath, "utf-8");
      if (content.includes("typeof url !== 'string'")) continue;
      const newContent = content.replace(
        /(export function \w+\s*\(\s*url\s*\)\s*\{\s*)(const \w+ = url\.replace|return url\.replace)/,
        "$1if (!url || typeof url !== 'string') return '';\n  $2"
      );
      if (newContent !== content && !dryRun) {
        await fs.writeFile(filtersPath, newContent, "utf-8");
        result.changes.push(`Added url guard in ${path.relative(projectPath, filtersPath)}`);
        result.modified = true;
      }
    }
  }

  // 7. PostCSS config: ensure .cjs when package has "type": "module" (postcss.config.js + module.exports = ESM error)
  const packageJsonPath = path.join(projectPath, "package.json");
  const postcssJsPath = path.join(projectPath, "postcss.config.js");
  const postcssCjsPath = path.join(projectPath, "postcss.config.cjs");
  const hasPostcssJs = fsSync.existsSync(postcssJsPath);
  const hasPostcssCjs = fsSync.existsSync(postcssCjsPath);

  // 7a. Rename or remove postcss.config.js when ESM: PostCSS loads .js first, which fails with module.exports
  if (fsSync.existsSync(packageJsonPath) && hasPostcssJs) {
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    if (pkg.type === "module" && !dryRun) {
      if (rollbackManager) {
        await rollbackManager.backupFile(postcssJsPath);
      }
      if (hasPostcssCjs) {
        await fs.unlink(postcssJsPath);
        result.changes.push("Removed postcss.config.js (postcss.config.cjs used with type: module)");
      } else {
        const content = await fs.readFile(postcssJsPath, "utf-8");
        if (rollbackManager) {
          await rollbackManager.backupFile(postcssCjsPath); // empty = delete on rollback
        }
        await fs.writeFile(postcssCjsPath, content, "utf-8");
        await fs.unlink(postcssJsPath);
        result.changes.push("Renamed postcss.config.js → postcss.config.cjs (ESM compatibility)");
      }
      result.modified = true;
    }
  }

  // 7b. Add postcss.config when autoprefixer present (avoids @-o-keyframes "Règle at non reconnue")
  if (fsSync.existsSync(packageJsonPath) && !hasPostcssJs && !hasPostcssCjs) {
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    const hasAutoprefixer =
      pkg.devDependencies?.autoprefixer || pkg.dependencies?.autoprefixer;
    if (hasAutoprefixer && !dryRun) {
      // Vite SSR migration adds "type": "module" to package.json - always use .cjs for module.exports
      const postcssConfigPath = postcssCjsPath;
      const postcssConfig = `// Target modern browsers - avoids @-o-keyframes "Règle at non reconnue"
module.exports = {
  plugins: {
    autoprefixer: {
      overrideBrowserslist: ['Chrome >= 80', 'Firefox >= 80', 'Safari >= 13', 'Edge >= 80'],
    },
  },
};
`;
      await fs.writeFile(postcssConfigPath, postcssConfig, "utf-8");
      result.changes.push(`Added ${path.basename(postcssConfigPath)} for autoprefixer (modern browsers)`);
      result.modified = true;
    }
  }

  // 8. Replace server.js with Vite SSR server (generic: title from package.json, favicon from public/)
  const serverPath = path.join(projectPath, "server.js");
  if (fsSync.existsSync(serverPath)) {
    const content = await fs.readFile(serverPath, "utf-8");
    if (content.includes("createBundleRenderer") || content.includes("vue-server-renderer")) {
      if (!dryRun) {
        let defaultTitle = "App";
        const pkgPath = path.join(projectPath, "package.json");
        if (fsSync.existsSync(pkgPath)) {
          const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
          defaultTitle = pkg.name || pkg.title || defaultTitle;
        }
        const faviconCandidates = [
          "public/logo-48.png",
          "public/favicon.ico",
          "public/logo.png",
          "public/favicon.png",
        ];
        let faviconPath: string | null = null;
        for (const candidate of faviconCandidates) {
          if (fsSync.existsSync(path.join(projectPath, candidate))) {
            faviconPath = candidate;
            break;
          }
        }
        const entryServerModulePath =
          entryServerPaths[0] != null
            ? "/" + path.relative(projectPath, entryServerPaths[0]).replace(/\\/g, "/")
            : undefined;
        const serverContent = buildViteSSRServer({
          defaultTitle,
          faviconPath,
          entryServerModulePath,
        });
        await fs.writeFile(serverPath, serverContent, "utf-8");
        result.changes.push("Replaced server.js with Vite SSR server");
        result.modified = true;
      }
    }
  }

  return result;
}
