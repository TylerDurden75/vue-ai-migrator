import * as jscodeshift from "jscodeshift";
import { Transform, API } from "jscodeshift";
import { compositionApiTransform } from "./transforms/composition-api";
import { scriptSetupTransform } from "./transforms/script-setup";
import { routerTransform } from "./transforms/router";
import { vuexPiniaSetupTransform } from "./transforms/vuex-pinia-setup";
import { vuexPiniaComponentsTransform } from "./transforms/vuex-pinia-components";
import { mixinsTransform } from "./transforms/mixins";
import { pluginsTransform } from "./transforms/plugins";
import { directivesTransform } from "./transforms/directives";
import { provideInjectTransform } from "./transforms/provide-inject";
import { asyncComponentsTransform } from "./transforms/async-components";
import { renderFunctionsTransform } from "./transforms/render-functions";
import {
  parseVueFile,
  reconstructVueFile,
  isVueFile,
  transformVueFileParts,
} from "../utils/codegen";

// Available transformations registry
const AVAILABLE_TRANSFORMS: Record<string, Transform> = {
  "composition-api": compositionApiTransform,
  "script-setup": scriptSetupTransform,
  router: routerTransform,
  "vuex-pinia": vuexPiniaSetupTransform,
  "vuex-pinia-components": vuexPiniaComponentsTransform,
  mixins: mixinsTransform,
  plugins: pluginsTransform,
  directives: directivesTransform,
  "provide-inject": provideInjectTransform,
  "async-components": asyncComponentsTransform,
  "render-functions": renderFunctionsTransform,
};

export interface TransformOptions {
  transformations?: string[];
  enableTypeScript?: boolean;
}

export interface TransformResult {
  code: string;
  modified: boolean;
  transformationsApplied: number;
  needsAI: boolean;
  issues: string[];
}

export class CodemodRunner {
  static readonly AVAILABLE_TRANSFORMS = AVAILABLE_TRANSFORMS;
  private jscodeshift = jscodeshift.withParser("tsx");

  async transform(
    filePath: string,
    source: string,
    options: TransformOptions = {},
  ): Promise<TransformResult> {
    const result: TransformResult = {
      code: source,
      modified: false,
      transformationsApplied: 0,
      needsAI: false,
      issues: [],
    };

    // Check if this is a Vue SFC file
    const isVue = isVueFile(source);
    let vueParts = isVue ? parseVueFile(source) : null;

    // Determine which transformations to apply
    let transformationsToApply =
      options.transformations || Object.keys(AVAILABLE_TRANSFORMS);

    // Ensure router transform runs early (before plugins transform that might modify imports)
    // Router transform should run before plugins to avoid conflicts with Vue.use() removal
    if (
      transformationsToApply.includes("router") &&
      transformationsToApply.includes("plugins")
    ) {
      const routerIndex = transformationsToApply.indexOf("router");
      const pluginsIndex = transformationsToApply.indexOf("plugins");
      if (routerIndex > pluginsIndex) {
        // Move router before plugins
        transformationsToApply.splice(routerIndex, 1);
        transformationsToApply.splice(pluginsIndex, 0, "router");
      }
    }

    // If vuex-pinia is used, automatically add vuex-pinia-components
    if (
      transformationsToApply.includes("vuex-pinia") &&
      !transformationsToApply.includes("vuex-pinia-components")
    ) {
      transformationsToApply = [
        ...transformationsToApply,
        "vuex-pinia-components",
      ];
    }

    // Ensure vuex-pinia-components runs after vuex-pinia
    if (
      transformationsToApply.includes("vuex-pinia") &&
      transformationsToApply.includes("vuex-pinia-components")
    ) {
      const vuexIndex = transformationsToApply.indexOf("vuex-pinia");
      const componentsIndex = transformationsToApply.indexOf(
        "vuex-pinia-components",
      );
      if (componentsIndex < vuexIndex) {
        // Move vuex-pinia-components after vuex-pinia
        transformationsToApply.splice(componentsIndex, 1);
        transformationsToApply.splice(
          vuexIndex + 1,
          0,
          "vuex-pinia-components",
        );
      }
    }

    try {
      let currentCode = source;
      let hasModifications = false;

      // For Vue files, process script and template sections separately
      if (vueParts && vueParts.script) {
        const scriptCode = vueParts.script.content;
        let transformedScript = scriptCode;

        // Transform script section
        for (const transformName of transformationsToApply) {
          const transform = AVAILABLE_TRANSFORMS[transformName];

          if (!transform) {
            result.issues.push(`Unknown transformation: ${transformName}`);
            continue;
          }

          try {
            // Create a complete API object
            const api: API = {
              jscodeshift: this.jscodeshift,
              j: this.jscodeshift,
              stats: () => {},
              report: () => {},
            };

            const transformResult = transform(
              { path: filePath, source: transformedScript },
              api,
              {
                enableTypeScript: options.enableTypeScript || false,
              },
            );

            // Handle both sync and async results
            const resultCode =
              typeof transformResult === "string"
                ? transformResult
                : await transformResult;

            // Always use the result if it's different, or if it's script-setup transform
            // script-setup may return the same code but with extracted statements structure
            if (resultCode) {
              const isScriptSetup = transformName === "script-setup";

              // For script-setup, always update transformedScript to use the result
              // script-setup extracts statements and may return the same code but properly formatted
              // CRITICAL: Always update for script-setup to ensure we get the complete transformed code
              if (isScriptSetup) {
                // Always update for script-setup - it returns the complete transformed code
                // IMPORTANT: Even if resultCode === transformedScript, we still update to ensure
                // we have the latest version (formatting or internal structure might differ)
                transformedScript = resultCode;
                hasModifications = true;
                result.transformationsApplied++;
              } else if (resultCode !== transformedScript) {
                transformedScript = resultCode;
                hasModifications = true;
                result.transformationsApplied++;
              }
            }

            if (
              !hasModifications &&
              (transformName === "composition-api" ||
                transformName === "script-setup")
            ) {
              // If transformation didn't modify but component was detected, mark for AI
              // But exclude empty data() functions and components with only lifecycle hooks

              // Check for empty data() function - detect pattern where data() returns empty object
              // Pattern: data() { return {}; } or data() { return {} } (with flexible whitespace)
              const hasEmptyDataPattern =
                /data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{\s*\}\s*;?[\s\S]*?\}/;
              const hasNonEmptyDataPattern =
                /data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{[^}]+[\s\S]*?\}/;
              const hasEmptyData =
                hasEmptyDataPattern.test(transformedScript) &&
                !hasNonEmptyDataPattern.test(transformedScript);

              // Check if component has only lifecycle hooks (no data, computed, methods, etc.)
              const hasOnlyLifecycleHooks =
                transformedScript.includes("export default") &&
                !transformedScript.match(/data\s*\(/) &&
                !transformedScript.includes("computed") &&
                !transformedScript.includes("methods") &&
                !transformedScript.includes("props") &&
                !transformedScript.includes("emits") &&
                !transformedScript.includes("watch") &&
                (transformedScript.includes("mounted") ||
                  transformedScript.includes("created") ||
                  transformedScript.includes("beforeDestroy") ||
                  transformedScript.includes("destroyed") ||
                  transformedScript.includes("beforeMount") ||
                  transformedScript.includes("updated") ||
                  transformedScript.includes("beforeUpdate") ||
                  transformedScript.includes("beforeCreate"));

              // Don't mark empty data() or lifecycle-only components for AI
              if (
                transformedScript.includes("export default") &&
                (transformedScript.includes("data()") ||
                  transformedScript.includes("computed") ||
                  transformedScript.includes("methods") ||
                  transformedScript.includes("props") ||
                  transformedScript.includes("emits") ||
                  transformedScript.includes("watch")) &&
                !hasEmptyData &&
                !hasOnlyLifecycleHooks
              ) {
                result.needsAI = true;
                result.issues.push(
                  "Component detected but transformation incomplete - may need AI processing",
                );
              } else if (hasOnlyLifecycleHooks && !hasModifications) {
                // Mark lifecycle-only components for AI if not transformed
                result.needsAI = true;
                result.issues.push(
                  "Component with lifecycle hooks detected - may need AI processing for complete transformation",
                );
              }
            }
          } catch (error) {
            result.issues.push(
              `Error during transformation ${transformName}: ${error instanceof Error ? error.message : String(error)}`,
            );
            result.needsAI = true;
          }
        }

        // Update script content
        // CRITICAL: Always update vueParts.script.content with transformedScript
        // even if hasModifications is false, because script-setup may return the same code
        // but we still need to ensure it's properly assigned
        if (
          hasModifications ||
          transformationsToApply.includes("script-setup")
        ) {
          // If script-setup transform was applied, convert to <script setup lang="ts">
          if (transformationsToApply.includes("script-setup")) {
            vueParts.script.setup = true;
            if (options.enableTypeScript) {
              vueParts.script.lang = "ts";
            }
            // script-setup transform already returns clean code without export default
            // Use the transformed script as-is - it contains all the extracted statements
            // CRITICAL: transformedScript should contain the full Composition API code here
            vueParts.script.content = transformedScript.trim();
          } else {
            // For other transformations, use transformedScript as-is
            vueParts.script.content = transformedScript;
          }
        } else {
          // Even if no modifications detected, ensure script content is updated
          vueParts.script.content = transformedScript;
        }

        // If composition-api transform was applied (without script-setup), check if we should convert to script setup
        if (
          !transformationsToApply.includes("script-setup") &&
          transformationsToApply.includes("composition-api")
        ) {
          // If composition-api transform was applied, check if we should convert to script setup
          // Check if the transformed script is Composition API code (has imports from 'vue')
          if (
            transformedScript.includes("import {") &&
            transformedScript.includes("from 'vue'") &&
            !transformedScript.includes("export default")
          ) {
            // Convert to <script setup lang="ts">
            vueParts.script.setup = true;
            if (options.enableTypeScript) {
              vueParts.script.lang = "ts";
            }
          }
        }

        // Transform template section
        const templateResult = transformVueFileParts(vueParts);
        if (templateResult.modified) {
          vueParts = templateResult.parts;
          hasModifications = true;
          result.transformationsApplied++;
          result.issues.push(...templateResult.issues);
        }

        // Reconstruct Vue file
        // Always reconstruct if script-setup was applied, even if hasModifications is false
        // because script-setup may return the same code but we still need to update the structure
        if (
          hasModifications ||
          transformationsToApply.includes("script-setup")
        ) {
          currentCode = reconstructVueFile(vueParts);
        }
      } else {
        // Process regular JS/TS files
        for (const transformName of transformationsToApply) {
          const transform = AVAILABLE_TRANSFORMS[transformName];

          if (!transform) {
            result.issues.push(`Unknown transformation: ${transformName}`);
            continue;
          }

          try {
            // Create a complete API object
            const api: API = {
              jscodeshift: this.jscodeshift,
              j: this.jscodeshift,
              stats: () => {},
              report: () => {},
            };

            const transformResult = transform(
              { path: filePath, source: currentCode },
              api,
              {
                enableTypeScript: options.enableTypeScript || false,
              },
            );

            // Handle both sync and async results
            const resultCode =
              typeof transformResult === "string"
                ? transformResult
                : await transformResult;

            // Always update currentCode if resultCode is different, even if empty string
            // Some transformers may return the same code but we still want to track it
            if (
              resultCode !== undefined &&
              resultCode !== null &&
              resultCode !== currentCode
            ) {
              currentCode = resultCode;
              hasModifications = true;
              result.transformationsApplied++;
            } else if (
              (transformName === "composition-api" ||
                transformName === "script-setup") &&
              !hasModifications
            ) {
              // If transformation didn't modify but component was detected, mark for AI
              // But exclude empty data() functions and components with only lifecycle hooks

              // Check for empty data() function - detect pattern where data() returns empty object
              const hasEmptyDataPattern =
                /data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{\s*\}\s*;?[\s\S]*?\}/;
              const hasNonEmptyDataPattern =
                /data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{[^}]+[\s\S]*?\}/;
              const hasEmptyData =
                hasEmptyDataPattern.test(currentCode) &&
                !hasNonEmptyDataPattern.test(currentCode);

              // Check if component has only lifecycle hooks (no data, computed, methods, etc.)
              const hasOnlyLifecycleHooks =
                currentCode.includes("export default") &&
                !currentCode.match(/data\s*\(/) &&
                !currentCode.includes("computed") &&
                !currentCode.includes("methods") &&
                !currentCode.includes("props") &&
                !currentCode.includes("emits") &&
                !currentCode.includes("watch") &&
                (currentCode.includes("mounted") ||
                  currentCode.includes("created") ||
                  currentCode.includes("beforeDestroy") ||
                  currentCode.includes("destroyed") ||
                  currentCode.includes("beforeMount") ||
                  currentCode.includes("updated") ||
                  currentCode.includes("beforeUpdate") ||
                  currentCode.includes("beforeCreate"));

              // Don't mark empty data() or lifecycle-only components for AI
              if (
                currentCode.includes("export default") &&
                (currentCode.includes("data()") ||
                  currentCode.includes("computed") ||
                  currentCode.includes("methods") ||
                  currentCode.includes("props") ||
                  currentCode.includes("emits") ||
                  currentCode.includes("watch")) &&
                !hasEmptyData &&
                !hasOnlyLifecycleHooks
              ) {
                result.needsAI = true;
                result.issues.push(
                  "Component detected but transformation incomplete - may need AI processing",
                );
              } else if (hasOnlyLifecycleHooks && !hasModifications) {
                // Mark lifecycle-only components for AI if not transformed
                result.needsAI = true;
                result.issues.push(
                  "Component with lifecycle hooks detected - may need AI processing for complete transformation",
                );
              }
            }
          } catch (error) {
            result.issues.push(
              `Error during transformation ${transformName}: ${error instanceof Error ? error.message : String(error)}`,
            );
            result.needsAI = true;
          }
        }
      }

      result.code = currentCode;
      result.modified = hasModifications;

      // If issues persist, suggest AI
      if (result.issues.length > 0) {
        result.needsAI = true;
      }

      return result;
    } catch (error) {
      result.issues.push(
        `Error during analysis: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.needsAI = true;
      return result;
    }
  }
}
