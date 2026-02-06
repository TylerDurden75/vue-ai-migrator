import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";

export interface SSRViteMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

function buildViteSSRServer(options: { defaultTitle: string; faviconPath: string | null }): string {
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
        const entry = await vite.ssrLoadModule('/src/entry-server.js')
        createApp = entry.default
      }

      const context = { url, title: defaultTitle }
      const appInstance = await createApp(context)
      const html = await renderToString(appInstance, context)

      const state = context.state || {}
      const stateScript = \`<script>window.__INITIAL_STATE__=\${JSON.stringify(state).replace(/</g, '\\\\u003c')}</script>\`

      const fullHtml = template
        .replace('{{ title }}', context.title)
        .replace(/<!--(?:ssr-outlet|vue-ssr-outlet)-->/i, html + '\\n    ' + stateScript)

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

  // 1. Fix entry-client.js
  const entryClientPath = path.join(srcDir, "entry-client.js");
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
      [/const\s+\{\s*app,\s*router,\s*store\s*\}\s*=\s*createApp\(\)\s*\n\s*\n\s*\/\/ prime/, "const { app, router, store, pinia } = createAppFactory()\n\n// prime"],
      [/const\s+\{\s*app,\s*router,\s*store\s*\}\s*=\s*createApp\(\)/, "const { app, router, store, pinia } = createAppFactory()"],
      [/store\.replaceState\(window\.__INITIAL_STATE__\)/, "pinia.state.value = window.__INITIAL_STATE__"],
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

  // 2. Fix entry-server.js
  const entryServerPath = path.join(srcDir, "entry-server.js");
  if (fsSync.existsSync(entryServerPath)) {
    let content = await fs.readFile(entryServerPath, "utf-8");

    const fixes: Array<[RegExp | string, string]> = [
      [/const\s+\{\s*app,\s*router,\s*store\s*\}\s*=\s*createApp\(\)/, "const { app, router, store, pinia } = createApp(context)"],
      [/const\s+\{\s*app,\s*router,\s*store,\s*pinia\s*\}\s*=\s*createApp\(\)/, "const { app, router, store, pinia } = createApp(context)"],
      [/router\.resolve\(url\)\.route/, "router.resolve(url)"],
      [/router\.onReady\(/g, "router.isReady().then("],
      [/router\.getMatchedComponents\(\)/, "router.currentRoute.value.matched.map(m => m.components?.default).filter(Boolean)"],
      [/context\.state\s*=\s*store\.state/, "context.state = pinia.state.value"],
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

    const needsPinia = content.includes("store") && !content.includes("pinia");
    if (needsPinia) {
      content = content.replace(
        /const\s+\{\s*app,\s*router,\s*store\s*\}\s*=\s*createApp\(\)/,
        "const { app, router, store, pinia } = createApp(context)"
      );
      content = content.replace(
        /context\.state\s*=\s*store\.state/,
        "context.state = pinia.state.value"
      );
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

  // 3. Fix app.js for Vue 3 + Pinia (and SSR context)
  const appPath = path.join(srcDir, "app.js");
  const appPathTs = path.join(srcDir, "app.ts");
  for (const appFile of [appPath, appPathTs]) {
    if (!fsSync.existsSync(appFile)) continue;
    let content = await fs.readFile(appFile, "utf-8");
    if (
      content.includes("createApp") &&
      (content.includes("createStore") || content.includes("vuex-router-sync"))
    ) {
      const newApp = `import { createApp as createVueApp, h } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useIndexStore } from './store'
import { createRouter } from './router'
import titleMixin from './util/title'
import * as filters from './util/filters'

// Vue 3: filters removed - use functions in templates (e.g. {{ timeAgo(item.time) }})

export function createApp(ssrContext) {
  const router = createRouter()
  const pinia = createPinia()

  const app = createVueApp({
    render: () => h(App),
  })

  app.use(pinia)
  app.use(router)
  app.mixin(titleMixin)

  // Vue 3 SSR: provide context so title mixin can set document title
  if (ssrContext) {
    app.provide('ssrContext', ssrContext)
  }

  // Expose store via globalProperties for components using this.$store (Options API compat)
  const store = useIndexStore(pinia)
  app.config.globalProperties.$store = store

  router.afterEach((to) => {
    store.setRoute(to)
  })

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
      // Add provide after app.mixin(titleMixin) or app.use(router)
      const provideBlock = "\n\n  // Vue 3 SSR: provide context so components can use inject('ssrContext')\n  if (ssrContext) {\n    app.provide('ssrContext', ssrContext)\n  }\n";
      if (content.includes("titleMixin")) {
        content = content.replace(/(app\.mixin\(titleMixin\))\s*\n/, `$1${provideBlock}\n`);
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

  // 5. Add guard for undefined type in API (generic: fetchIdsByType/watchList are common in HN-like APIs)
  const apiPaths = [
    path.join(srcDir, "api", "index.client.js"),
    path.join(srcDir, "api", "index.server.js"),
  ];
  for (const apiPath of apiPaths) {
    if (fsSync.existsSync(apiPath)) {
      let apiContent = await fs.readFile(apiPath, "utf-8");
      let modified = false;
      if (/export function fetchIdsByType\s*\([^)]*\)\s*\{/.test(apiContent) && !apiContent.includes("if (!type || typeof type !== 'string')")) {
        apiContent = apiContent.replace(
          /(export function fetchIdsByType\s*\([^)]*\)\s*\{\s*)(return api\.cachedIds)/,
          "$1if (!type || typeof type !== 'string') return Promise.resolve([])\n  $2"
        );
        modified = true;
      }
      if (/export function watchList\s*\([^)]*\)\s*\{/.test(apiContent) && !apiContent.includes("if (!type || typeof type !== 'string') return () => {}")) {
        apiContent = apiContent.replace(
          /(export function watchList\s*\([^)]*\)\s*\{\s*)(let first = true)/,
          "$1if (!type || typeof type !== 'string') return () => {}\n  $2"
        );
        modified = true;
      }
      if (modified && !dryRun) {
        await fs.writeFile(apiPath, apiContent, "utf-8");
        result.changes.push(`Added type guard in ${path.relative(projectPath, apiPath)}`);
        result.modified = true;
      }
    }
  }

  // 6. Add guard to host() in util/filters when url may be non-string
  const filtersPaths = [
    path.join(srcDir, "util", "filters.js"),
    path.join(srcDir, "util", "filters.ts"),
    path.join(srcDir, "utils", "filters.js"),
    path.join(srcDir, "filters", "index.js"),
  ];
  for (const filtersPath of filtersPaths) {
    if (fsSync.existsSync(filtersPath)) {
      let filtersContent = await fs.readFile(filtersPath, "utf-8");
      if (filtersContent.includes("export function host") && !filtersContent.includes("typeof url !== 'string'")) {
        filtersContent = filtersContent.replace(
          /(export function host\s*\(\s*url\s*\)\s*\{\s*)(const host = url\.replace)/,
          "$1if (!url || typeof url !== 'string') return '';\n  $2"
        );
        if (!dryRun) {
          await fs.writeFile(filtersPath, filtersContent, "utf-8");
        }
        result.changes.push(`Added url guard to host() in ${path.relative(projectPath, filtersPath)}`);
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
        const serverContent = buildViteSSRServer({ defaultTitle, faviconPath });
        await fs.writeFile(serverPath, serverContent, "utf-8");
        result.changes.push("Replaced server.js with Vite SSR server");
        result.modified = true;
      }
    }
  }

  return result;
}
