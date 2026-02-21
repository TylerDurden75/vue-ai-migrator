import * as fs from "fs/promises";
import * as path from "path";
import * as fsSync from "fs";

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: any;
}

export interface PackageMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Migrate package.json dependencies from Vue 2 to Vue 3
 * @param addTestDeps - When true, adds Vitest and @vue/test-utils if generating tests
 */
export async function migratePackageJson(
  projectPath: string,
  dryRun: boolean = false,
  enableTypeScript: boolean = false,
  addTestDeps: boolean = false,
): Promise<PackageMigrationResult> {
  const result: PackageMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const packageJsonPath = path.join(projectPath, "package.json");

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson: PackageJson = JSON.parse(content);

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    // Migrate Vue 2 → Vue 3
    if (allDeps.vue && allDeps.vue.startsWith("^2.")) {
      const vueVersion = allDeps.vue;

      // Update in dependencies
      if (packageJson.dependencies?.vue) {
        packageJson.dependencies.vue = "^3.4.0";
        result.changes.push(`Vue: ${vueVersion} → ^3.4.0`);
        result.modified = true;
      }

      // Update in devDependencies
      if (packageJson.devDependencies?.vue) {
        packageJson.devDependencies.vue = "^3.4.0";
        result.changes.push(`Vue (dev): ${vueVersion} → ^3.4.0`);
        result.modified = true;
      }

      // Vue 3 + Vite recommend Node 18+. Set engines.node for npm/CI/README.
      const recommendedNode = ">=18.0.0";
      if (!packageJson.engines) packageJson.engines = {};
      packageJson.engines.node = recommendedNode;
      result.changes.push(`engines.node: ${recommendedNode} (Vue 3 + Vite)`);
      result.modified = true;
    }

    // Migrate Vue Router 3 → 4
    if (allDeps["vue-router"] && allDeps["vue-router"].startsWith("^3.")) {
      const routerVersion = allDeps["vue-router"];

      if (packageJson.dependencies?.["vue-router"]) {
        packageJson.dependencies["vue-router"] = "^4.2.0";
        result.changes.push(`Vue Router: ${routerVersion} → ^4.2.0`);
        result.modified = true;
      }

      if (packageJson.devDependencies?.["vue-router"]) {
        packageJson.devDependencies["vue-router"] = "^4.2.0";
        result.changes.push(`Vue Router (dev): ${routerVersion} → ^4.2.0`);
        result.modified = true;
      }
    }

    // Migrate Vue CLI 4 → 5 (for better ESM support with Vue Router 4)
    if (allDeps["@vue/cli-service"] && allDeps["@vue/cli-service"].startsWith("^4.")) {
      const cliVersion = allDeps["@vue/cli-service"];

      if (packageJson.devDependencies?.["@vue/cli-service"]) {
        packageJson.devDependencies["@vue/cli-service"] = "^5.0.8";
        result.changes.push(`Vue CLI: ${cliVersion} → ^5.0.8 (for better ESM support)`);
        result.modified = true;
      }
    }

    // Remove vuex-router-sync (Pinia does not need it)
    if (allDeps["vuex-router-sync"]) {
      if (packageJson.dependencies?.["vuex-router-sync"]) {
        delete packageJson.dependencies["vuex-router-sync"];
        result.changes.push("Removed vuex-router-sync (not needed with Pinia)");
        result.modified = true;
      }
    }

    // Migrate Vuex → Pinia
    if (allDeps.vuex) {
      const vuexVersion = allDeps.vuex;

      // Remove Vuex
      if (packageJson.dependencies?.vuex) {
        delete packageJson.dependencies.vuex;
        result.changes.push(`Removed Vuex: ${vuexVersion}`);
        result.modified = true;
      }

      if (packageJson.devDependencies?.vuex) {
        delete packageJson.devDependencies.vuex;
        result.changes.push(`Removed Vuex (dev): ${vuexVersion}`);
        result.modified = true;
      }

      // Add Pinia
      if (
        !packageJson.dependencies?.pinia &&
        !packageJson.devDependencies?.pinia
      ) {
        if (!packageJson.dependencies) {
          packageJson.dependencies = {};
        }
        packageJson.dependencies.pinia = "^2.1.0";
        result.changes.push("Added Pinia: ^2.1.0");
        result.modified = true;
      }
    }

    // Update Vue Test Utils 1 → 2
    if (
      allDeps["@vue/test-utils"] &&
      allDeps["@vue/test-utils"].startsWith("^1.")
    ) {
      const testUtilsVersion = allDeps["@vue/test-utils"];

      if (packageJson.dependencies?.["@vue/test-utils"]) {
        packageJson.dependencies["@vue/test-utils"] = "^2.4.0";
        result.changes.push(`Vue Test Utils: ${testUtilsVersion} → ^2.4.0`);
        result.modified = true;
      }

      if (packageJson.devDependencies?.["@vue/test-utils"]) {
        packageJson.devDependencies["@vue/test-utils"] = "^2.4.0";
        result.changes.push(
          `Vue Test Utils (dev): ${testUtilsVersion} → ^2.4.0`,
        );
        result.modified = true;
      }
    }

    // Update vue-loader 15 → 17 (Vue 3 compatible)
    if (allDeps["vue-loader"]) {
      const loaderVersion = allDeps["vue-loader"];
      if (loaderVersion.startsWith("^15.") || loaderVersion.startsWith("15.")) {
        if (packageJson.devDependencies?.["vue-loader"]) {
          packageJson.devDependencies["vue-loader"] = "^17.4.2";
          result.changes.push(`vue-loader: ${loaderVersion} → ^17.4.2`);
          result.modified = true;
        }
      }
    }

    // Add @vue/compiler-sfc if vue-loader is updated to v17
    if (
      packageJson.devDependencies?.["vue-loader"] &&
      packageJson.devDependencies["vue-loader"].startsWith("^17")
    ) {
      if (!allDeps["@vue/compiler-sfc"]) {
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies["@vue/compiler-sfc"] = "^3.4.21";
        result.changes.push(
          "Added @vue/compiler-sfc: ^3.4.21 (required for vue-loader v17)",
        );
        result.modified = true;
      }
    }

    // Replace vue-server-renderer with @vue/server-renderer (Vue 3 SSR)
    if (allDeps["vue-server-renderer"]) {
      if (packageJson.dependencies?.["vue-server-renderer"]) {
        delete packageJson.dependencies["vue-server-renderer"];
        packageJson.dependencies["@vue/server-renderer"] = "^3.4.0";
        result.changes.push(
          "Replaced vue-server-renderer with @vue/server-renderer (Vue 3 SSR)",
        );
        result.modified = true;
      }
    }

    // Remove Vue 2 specific plugins and obsolete Vue CLI plugins
    const vue2Plugins = [
      "vue-template-compiler",
      "vue-class-component",
      "vue-property-decorator",
      "@vue/cli-plugin-router", // Obsolete - Router is now standalone in Vue 3
      "@vue/cli-plugin-vuex",   // Obsolete - Vuex replaced by Pinia
    ];

    for (const plugin of vue2Plugins) {
      if (allDeps[plugin]) {
        const pluginVersion = allDeps[plugin];

        // Remove from dependencies
        if (packageJson.dependencies?.[plugin]) {
          delete packageJson.dependencies[plugin];
          result.changes.push(
            `Removed ${plugin}: ${pluginVersion} (Vue 2 specific)`,
          );
          result.modified = true;
        }

        // Remove from devDependencies
        if (packageJson.devDependencies?.[plugin]) {
          delete packageJson.devDependencies[plugin];
          result.changes.push(
            `Removed ${plugin} (dev): ${pluginVersion} (Vue 2 specific)`,
          );
          result.modified = true;
        }

        // Add warning for vue-class-component and vue-property-decorator as they might need manual migration
        if (
          plugin === "vue-class-component" ||
          plugin === "vue-property-decorator"
        ) {
          result.warnings.push(
            `${plugin} was removed. If you're using class-based components, consider migrating to Composition API or using vue-facing-decorator for Vue 3`,
          );
        }
      }
    }

    // Add Vitest and @vue/test-utils when generating tests
    if (addTestDeps) {
      if (!allDeps.vitest) {
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies.vitest = "^2.0.0";
        result.changes.push("Added vitest: ^2.0.0 (for generated tests)");
        result.modified = true;
      }
      if (!allDeps["@vue/test-utils"]) {
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies["@vue/test-utils"] = "^2.4.0";
        result.changes.push("Added @vue/test-utils: ^2.4.0 (for generated tests)");
        result.modified = true;
      }
      if (!allDeps["jsdom"] && !allDeps["happy-dom"]) {
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies["jsdom"] = "^24.0.0";
        result.changes.push("Added jsdom: ^24.0.0 (DOM environment for tests)");
        result.modified = true;
      }
      // Add test scripts only when missing (never overwrite existing)
      const scripts = packageJson.scripts || {};
      if (!packageJson.scripts) {
        packageJson.scripts = {};
      }
      const toAdd: string[] = [];
      if (!scripts.test) {
        packageJson.scripts!.test = "vitest run";
        toAdd.push("test");
      }
      if (!scripts["test:unit"]) {
        packageJson.scripts!["test:unit"] = "vitest run";
        toAdd.push("test:unit");
      }
      if (toAdd.length > 0) {
        result.changes.push(`Added "${toAdd.join('", "')}": "vitest run" script(s)`);
        result.modified = true;
      }
    }

    // Add TypeScript dependencies if TypeScript is enabled
    if (enableTypeScript) {
      if (!allDeps.typescript) {
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies.typescript = "^5.3.3";
        result.changes.push("Added TypeScript: ^5.3.3");
        result.modified = true;
      }
      // Add ts-loader for webpack TypeScript support
      if (!allDeps['ts-loader']) {
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }
        packageJson.devDependencies['ts-loader'] = "^9.5.1";
        result.changes.push("Added ts-loader: ^9.5.1 (required for TypeScript compilation)");
        result.modified = true;
      }
    }

    // Save if modified and not dry run
    if (result.modified && !dryRun) {
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2) + "\n",
      );
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      result.warnings.push("package.json not found");
    } else {
      result.warnings.push(
        `Error migrating package.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return result;
  }
}

/**
 * Create .nvmrc with Node 18 if it doesn't exist (Vue 3 + Vite recommend Node 18+).
 * Enables `nvm use` to pick the correct version automatically.
 */
export async function ensureNvmrc(
  projectPath: string,
  dryRun: boolean = false,
  nodeVersion: string = "18"
): Promise<{ created: boolean }> {
  const nvmrcPath = path.join(projectPath, ".nvmrc");
  try {
    await fs.access(nvmrcPath);
    return { created: false }; // Already exists, don't overwrite
  } catch {
    if (!dryRun) {
      await fs.writeFile(nvmrcPath, `${nodeVersion}\n`, "utf-8");
    }
    return { created: true };
  }
}

const EVENT_BUS_JS = `/**
 * Event bus (replaces Vue 2 $on/$off/$once)
 * Vue 3 removed instance event API - use for cross-component communication
 */
import mitt from 'mitt';

const emitter = mitt();

export const eventBus = {
  on: emitter.on.bind(emitter),
  off: emitter.off.bind(emitter),
  emit: emitter.emit.bind(emitter),
  once(type, handler) {
    const wrapper = (...args) => {
      emitter.off(type, wrapper);
      handler(...args);
    };
    emitter.on(type, wrapper);
  },
};

export default eventBus;
`;

/** Generate event-bus.ts with typed Events (event names from mitt usage) */
function getEventBusTsContent(eventNames: string[]): string {
  const entries =
    eventNames.length > 0
      ? eventNames.map((e) => `  '${e}': void;`).join("\n")
      : "  [key: string]: unknown;";
  return `/**
 * Event bus (replaces Vue 2 $on/$off/$once)
 * Vue 3 removed instance event API - use for cross-component communication
 */
import mitt, { type Emitter } from 'mitt';

type Events = {
${entries}
};

const emitter: Emitter<Events> = mitt<Events>();

export const eventBus = {
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
    emitter.on(event, handler as any);
  },
  off<K extends keyof Events>(event: K, handler?: (payload: Events[K]) => void) {
    emitter.off(event, handler as any);
  },
  emit<K extends keyof Events>(event: K, payload?: Events[K]) {
    emitter.emit(event, payload as any);
  },
  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
    const wrapper = (payload: Events[K]) => {
      emitter.off(event, wrapper as any);
      handler(payload);
    };
    emitter.on(event, wrapper as any);
  },
};

export default eventBus;
`;
}

const EVENT_BUS_PLUGIN_JS = `/**
 * Vue 3 plugin: exposes eventBus as this.$bus on all components
 */
import eventBus from '@/event-bus';

export default {
  install(app) {
    app.config.globalProperties.$bus = eventBus;
  },
};
`;

const EVENT_BUS_PLUGIN_TS = `/**
 * Vue 3 plugin: exposes eventBus as this.$bus on all components
 */
import type { App } from 'vue';
import eventBus from '@/event-bus';

export default {
  install(app: App) {
    app.config.globalProperties.$bus = eventBus;
  },
};
`;

const VUE_BUS_TYPES = `declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $bus: typeof import('@/event-bus').default;
  }
}
`;

/**
 * Create event-bus.js/ts and add mitt when project uses $on/$off/$once
 */
export async function ensureEventBus(
  projectPath: string,
  dryRun: boolean = false,
  rollbackManager?: { addCreatedFile: (path: string) => void },
  options?: { enableTypeScript?: boolean; eventNames?: string[] }
): Promise<{ created: boolean }> {
  const busPaths = [
    path.join(projectPath, "src", "event-bus.js"),
    path.join(projectPath, "src", "event-bus.ts"),
    path.join(projectPath, "event-bus.js"),
  ];
  for (const busPath of busPaths) {
    try {
      await fs.access(busPath);
      return { created: false };
    } catch {
      continue;
    }
  }

  const enableTypeScript = options?.enableTypeScript ?? false;
  const eventNames = options?.eventNames ?? [];
  const ext = enableTypeScript ? ".ts" : ".js";
  const busPath = path.join(projectPath, "src", `event-bus${ext}`);
  const content =
    enableTypeScript && eventNames.length > 0
      ? getEventBusTsContent(eventNames)
      : enableTypeScript
        ? getEventBusTsContent([])
        : EVENT_BUS_JS;

  if (!dryRun) {
    await fs.mkdir(path.dirname(busPath), { recursive: true });
    await fs.writeFile(busPath, content, "utf-8");
    rollbackManager?.addCreatedFile(busPath);
    const pkgPath = path.join(projectPath, "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
    if (!pkg.dependencies) pkg.dependencies = {};
    if (!pkg.dependencies.mitt) {
      pkg.dependencies.mitt = "^3.0.1";
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
    }
  }
  return { created: true };
}

/**
 * Create plugin to expose eventBus as this.$bus (app.config.globalProperties.$bus)
 */
export async function ensureEventBusPlugin(
  projectPath: string,
  dryRun: boolean = false,
  rollbackManager?: { addCreatedFile: (path: string) => void },
  enableTypeScript: boolean = false
): Promise<{ created: boolean }> {
  const pluginPaths = [
    path.join(projectPath, "src", "plugins", "event-bus.js"),
    path.join(projectPath, "src", "plugins", "event-bus.ts"),
  ];
  for (const p of pluginPaths) {
    try {
      await fs.access(p);
      return { created: false };
    } catch {
      continue;
    }
  }

  const ext = enableTypeScript ? ".ts" : ".js";
  const pluginPath = path.join(projectPath, "src", "plugins", `event-bus${ext}`);
  const content = enableTypeScript ? EVENT_BUS_PLUGIN_TS : EVENT_BUS_PLUGIN_JS;

  if (!dryRun) {
    await fs.mkdir(path.dirname(pluginPath), { recursive: true });
    await fs.writeFile(pluginPath, content, "utf-8");
    rollbackManager?.addCreatedFile(pluginPath);
    if (enableTypeScript) {
      const typesPath = path.join(projectPath, "src", "types", "vue-bus.d.ts");
      const typesDir = path.dirname(typesPath);
      try {
        await fs.access(typesPath);
      } catch {
        await fs.mkdir(typesDir, { recursive: true });
        await fs.writeFile(typesPath, VUE_BUS_TYPES, "utf-8");
        rollbackManager?.addCreatedFile(typesPath);
      }
    }
  }
  return { created: true };
}

/**
 * Inject app.use(EventBusPlugin) into main.ts/main.js
 */
export async function injectEventBusPluginInMain(
  projectPath: string,
  dryRun: boolean = false
): Promise<boolean> {
  const mainPaths = [
    path.join(projectPath, "src", "main.ts"),
    path.join(projectPath, "src", "main.js"),
    path.join(projectPath, "main.ts"),
    path.join(projectPath, "main.js"),
  ];
  let mainPath: string | null = null;
  for (const p of mainPaths) {
    if (fsSync.existsSync(p)) {
      mainPath = p;
      break;
    }
  }
  if (!mainPath) return false;

  let content = await fs.readFile(mainPath, "utf-8");
  if (content.includes("EventBusPlugin") || content.includes("event-bus")) {
    return false;
  }

  const _isTs = mainPath.endsWith(".ts");
  const importLine = `import EventBusPlugin from '@/plugins/event-bus';\n`;
  const useLine = `app.use(EventBusPlugin);\n`;

  if (!content.includes("createApp")) return false;

  if (!content.includes("from '@/plugins/event-bus'") && !content.includes('from "@/plugins/event-bus"')) {
    const firstImport = content.match(/^\s*import\s/m);
    const insertPos = firstImport ? (firstImport.index ?? 0) : 0;
    content = content.slice(0, insertPos) + importLine + content.slice(insertPos);
  }

  if (!content.includes("app.use(EventBusPlugin)")) {
    const mountMatch = content.match(/\n?\s*app\.mount\s*\(/);
    if (mountMatch) {
      content =
        content.slice(0, mountMatch.index!) +
        useLine +
        content.slice(mountMatch.index!);
    }
  }

  if (!dryRun) {
    await fs.writeFile(mainPath, content, "utf-8");
  }
  return true;
}

const TEST_SETUP_CONTENT = `/**
 * Vitest setup: stub directives + global Pinia.
 * Avoids "Failed to resolve directive" and "getActivePinia()" errors in tests.
 * For components using router-link/view: pass createPinia() + createRouter() per mount.
 */
import { config } from '@vue/test-utils';
import { createPinia } from 'pinia';

const stubDirective = { mounted() {}, updated() {} };
const stubFocus = { mounted() {} };

config.global.directives = {
  tooltip: stubDirective,
  focus: stubFocus,
};

config.global.plugins = [createPinia()];
`;

/**
 * Add Vitest test config to vite.config.js/ts if it exists.
 * Creates src/test-setup.ts (stub directives) and adds setupFiles to the test block.
 * Call after Vite config is created (e.g. after migrateToViteConfig).
 */
export async function addVitestConfigToVite(
  projectPath: string,
  rollbackManager?: { addCreatedFile: (path: string) => void }
): Promise<boolean> {
  const viteConfigPaths = [
    path.join(projectPath, "vite.config.js"),
    path.join(projectPath, "vite.config.ts"),
  ];
  for (const configPath of viteConfigPaths) {
    if (!fsSync.existsSync(configPath)) continue;
    try {
      const content = await fs.readFile(configPath, "utf-8");
      // Skip if Vitest test block already exists (avoid duplicating config)
      if (/\btest\s*:\s*\{/.test(content) || /environment\s*:\s*['"]?\w+['"]?/.test(content)) {
        return false;
      }
      if (content.includes("setupFiles")) {
        return false; // Project already has setup files configured
      }
      // Inject test block with setupFiles (stub directives for v-tooltip, v-focus)
      const testBlock =
        "\n  test: {\n    environment: 'jsdom',\n    globals: true,\n    setupFiles: ['./src/test-setup.ts'],\n  }";
      const newContent = content.replace(/\}\s*\)\s*;?\s*$/s, (match) => {
        const beforeMatch = content.slice(0, content.length - match.length);
        const needsComma = !/,\s*$/.test(beforeMatch);
        return `${needsComma ? "," : ""}${testBlock}\n});`;
      });
      if (newContent !== content) {
        await fs.writeFile(configPath, newContent, "utf-8");
        const testSetupPath = path.resolve(projectPath, "src", "test-setup.ts");
        const existed = fsSync.existsSync(testSetupPath);
        if (!existed) {
          await fs.mkdir(path.dirname(testSetupPath), { recursive: true });
          await fs.writeFile(testSetupPath, TEST_SETUP_CONTENT, "utf-8");
          rollbackManager?.addCreatedFile(testSetupPath);
        }
        return true;
      }
    } catch {
      // Ignore errors
    }
  }
  return false;
}

/** Webpack-related deps to remove when migrating to Vite */
const WEBPACK_DEPS = [
  "webpack",
  "vue-loader",
  "webpack-dev-middleware",
  "webpack-hot-middleware",
  "webpack-merge",
  "webpack-node-externals",
  "extract-text-webpack-plugin",
  "sw-precache-webpack-plugin",
  "babel-loader",
  "css-loader",
  "file-loader",
  "url-loader",
  "stylus-loader",
  "friendly-errors-webpack-plugin",
];

/**
 * Clean up package.json when migrating from Webpack to Vite SSR
 * Removes webpack deps, adds type: module, clears postinstall
 */
export async function migratePackageJsonForViteSSR(
  projectPath: string,
  dryRun: boolean = false,
): Promise<PackageMigrationResult> {
  const result: PackageMigrationResult = {
    modified: false,
    changes: [],
    warnings: [],
  };

  const packageJsonPath = path.join(projectPath, "package.json");

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson: PackageJson = JSON.parse(content);

    for (const dep of WEBPACK_DEPS) {
      if (packageJson.devDependencies?.[dep]) {
        delete packageJson.devDependencies[dep];
        result.changes.push(`Removed ${dep} (Vite replaces Webpack)`);
        result.modified = true;
      }
      if (packageJson.dependencies?.[dep]) {
        delete packageJson.dependencies[dep];
        result.changes.push(`Removed ${dep} (Vite replaces Webpack)`);
        result.modified = true;
      }
    }

    if (!packageJson.type || packageJson.type !== "module") {
      packageJson.type = "module";
      result.changes.push('Added "type": "module" for ESM server.js');
      result.modified = true;
    }

    if (
      packageJson.scripts?.postinstall === "npm run build" ||
      packageJson.scripts?.postinstall?.includes("build")
    ) {
      packageJson.scripts.postinstall = "";
      result.changes.push("Cleared postinstall (run npm run build manually after install)");
      result.modified = true;
    }

    if (result.modified && !dryRun) {
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2) + "\n",
      );
    }

    return result;
  } catch (error) {
    result.warnings.push(
      `Vite package cleanup error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }
}
