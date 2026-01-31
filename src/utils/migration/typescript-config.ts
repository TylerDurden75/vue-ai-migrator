import * as fs from "fs/promises";
import * as path from "path";

export interface TypeScriptConfigResult {
  created: boolean;
  modified: boolean;
  changes: string[];
  warnings: string[];
}

/**
 * Create or update tsconfig.json for Vue 3 + TypeScript project
 */
export async function createOrUpdateTsConfig(
  projectPath: string,
  dryRun: boolean = false,
): Promise<TypeScriptConfigResult> {
  const result: TypeScriptConfigResult = {
    created: false,
    modified: false,
    changes: [],
    warnings: [],
  };

  const tsconfigPath = path.join(projectPath, "tsconfig.json");

  try {
    // Check if tsconfig.json already exists
    let existingConfig: any = null;
    try {
      const existingContent = await fs.readFile(tsconfigPath, "utf-8");
      existingConfig = JSON.parse(existingContent);
    } catch {
      // File doesn't exist, we'll create it
    }

    // Default Vue 3 + TypeScript configuration
    const defaultConfig = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        moduleResolution: "node",
        strict: false, // Start with false for easier migration
        jsx: "preserve",
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
        types: ["node"],
      },
      include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
      exclude: ["node_modules", "dist"],
    };

    if (!existingConfig) {
      // Create new tsconfig.json
      if (!dryRun) {
        await fs.writeFile(
          tsconfigPath,
          JSON.stringify(defaultConfig, null, 2) + "\n",
          "utf-8",
        );
        result.created = true;
        result.changes.push("Created tsconfig.json for Vue 3 + TypeScript");
      } else {
        result.changes.push("[DRY RUN] Would create tsconfig.json");
      }
    } else {
      // Update existing tsconfig.json
      let modified = false;
      const updatedConfig = { ...existingConfig };

      // Ensure compilerOptions exists
      if (!updatedConfig.compilerOptions) {
        updatedConfig.compilerOptions = {};
        modified = true;
      }

      // Update or add important options
      const requiredOptions = {
        target: "ES2020",
        module: "ESNext",
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        moduleResolution: "node",
        jsx: "preserve",
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
      };

      for (const [key, value] of Object.entries(requiredOptions)) {
        if (
          !updatedConfig.compilerOptions[key] ||
          JSON.stringify(updatedConfig.compilerOptions[key]) !==
            JSON.stringify(value)
        ) {
          updatedConfig.compilerOptions[key] = value;
          modified = true;
        }
      }

      // Ensure baseUrl and paths for @ alias
      if (!updatedConfig.compilerOptions.baseUrl) {
        updatedConfig.compilerOptions.baseUrl = ".";
        modified = true;
      }
      if (!updatedConfig.compilerOptions.paths) {
        updatedConfig.compilerOptions.paths = { "@/*": ["src/*"] };
        modified = true;
      }

      // Ensure include has Vue files
      if (!updatedConfig.include) {
        updatedConfig.include = [];
      }
      const vueInclude = "src/**/*.vue";
      if (!updatedConfig.include.includes(vueInclude)) {
        updatedConfig.include.push(vueInclude);
        modified = true;
      }

      // Ensure exclude has node_modules and dist
      if (!updatedConfig.exclude) {
        updatedConfig.exclude = [];
      }
      if (!updatedConfig.exclude.includes("node_modules")) {
        updatedConfig.exclude.push("node_modules");
        modified = true;
      }
      if (!updatedConfig.exclude.includes("dist")) {
        updatedConfig.exclude.push("dist");
        modified = true;
      }

      if (modified && !dryRun) {
        await fs.writeFile(
          tsconfigPath,
          JSON.stringify(updatedConfig, null, 2) + "\n",
          "utf-8",
        );
        result.modified = true;
        result.changes.push("Updated tsconfig.json for Vue 3 + TypeScript");
      } else if (modified) {
        result.changes.push("[DRY RUN] Would update tsconfig.json");
      }
    }

    return result;
  } catch (error) {
    result.warnings.push(
      `Error creating/updating tsconfig.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }
}

/**
 * Delete tsconfig.json if it was created by migration
 */
export async function deleteTsConfig(
  projectPath: string,
  dryRun: boolean = false,
): Promise<boolean> {
  const tsconfigPath = path.join(projectPath, "tsconfig.json");

  try {
    await fs.access(tsconfigPath);
    if (!dryRun) {
      await fs.unlink(tsconfigPath);
      return true;
    }
    return true; // File exists, would be deleted in non-dry-run
  } catch {
    return false; // File doesn't exist
  }
}
