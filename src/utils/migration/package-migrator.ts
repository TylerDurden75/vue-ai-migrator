import * as fs from "fs/promises";
import * as path from "path";

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
 */
export async function migratePackageJson(
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

    // Remove Vue 2 specific plugins
    const vue2Plugins = [
      "vue-template-compiler",
      "vue-class-component",
      "vue-property-decorator",
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
