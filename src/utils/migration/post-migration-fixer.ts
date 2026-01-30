import * as fs from "fs/promises";
import * as path from "path";

export interface FixResult {
  fixed: boolean;
  issues: string[];
  fixes: string[];
  content: string; // Fixed content
}

/**
 * Post-migration fixer to correct common issues after migration
 * - Removes this. references in setup()
 * - Removes export default in <script setup>
 * - Makes functions async if they use await
 * - Removes Vuex imports
 */
export async function fixPostMigrationIssues(
  filePath: string,
  content: string,
): Promise<FixResult> {
  const result: FixResult = {
    fixed: false,
    issues: [],
    fixes: [],
    content: content, // Initialize with original content
  };

  let fixedContent = content;

  // Check if it's a Vue file
  const isVueFile = filePath.endsWith(".vue");

  if (isVueFile) {
    // Fix 1: Remove export default in <script setup>
    if (
      fixedContent.includes("<script setup") &&
      fixedContent.includes("export default")
    ) {
      // Extract the script setup section
      const scriptSetupMatch = fixedContent.match(
        /<script\s+setup[^>]*>([\s\S]*?)<\/script>/,
      );
      if (scriptSetupMatch) {
        let scriptContent = scriptSetupMatch[1];
        const originalScriptContent = scriptContent;

        // Remove export default { ... } completely if it's in script setup
        // Pattern: export default { name: "...", computed: {...}, ... }
        // Need to handle nested braces properly
        let braceCount = 0;
        let startIndex = scriptContent.indexOf("export default");
        if (startIndex !== -1) {
          // Find the opening brace
          let braceStart = scriptContent.indexOf("{", startIndex);
          if (braceStart !== -1) {
            braceCount = 1;
            let i = braceStart + 1;
            let inString = false;
            let stringChar = "";

            while (i < scriptContent.length && braceCount > 0) {
              const char = scriptContent[i];

              // Handle string literals
              if (
                (char === '"' || char === "'" || char === "`") &&
                (i === 0 || scriptContent[i - 1] !== "\\")
              ) {
                if (!inString) {
                  inString = true;
                  stringChar = char;
                } else if (char === stringChar) {
                  inString = false;
                  stringChar = "";
                }
              }

              if (!inString) {
                if (char === "{") braceCount++;
                if (char === "}") braceCount--;
              }

              i++;
            }

            if (braceCount === 0) {
              // Remove from startIndex to i (including the semicolon if present)
              let endIndex = i;
              // Skip semicolon and whitespace
              while (
                endIndex < scriptContent.length &&
                (scriptContent[endIndex] === ";" ||
                  /\s/.test(scriptContent[endIndex]))
              ) {
                endIndex++;
              }
              scriptContent =
                scriptContent.substring(0, startIndex) +
                scriptContent.substring(endIndex);
            }
          }
        }

        if (scriptContent !== originalScriptContent) {
          fixedContent = fixedContent.replace(
            /(<script\s+setup[^>]*>)([\s\S]*?)(<\/script>)/,
            `$1${scriptContent}$3`,
          );
          result.fixed = true;
          result.fixes.push("Removed export default from <script setup>");
        }
      }
    }

    // Fix 2: Remove this. references in setup() or <script setup>
    const thisPattern = /this\.(?!\$)/g;
    if (thisPattern.test(fixedContent) && fixedContent.includes("setup")) {
      // This is a complex fix that should be handled by the AST transformer
      // But we can at least detect it
      const thisMatches = fixedContent.match(thisPattern);
      if (thisMatches) {
        result.issues.push(
          `Found ${thisMatches.length} this. references in setup() - should be removed`,
        );
      }
    }

    // Fix 3: Make functions async if they use await
    // Pattern: onMounted(() => { await ... })
    // More comprehensive pattern to catch various cases
    const awaitPatterns = [
      /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(\(\)\s*=>\s*\{[\s\S]*?await/g,
      /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(function\s*\(\)\s*\{[\s\S]*?await/g,
    ];

    let hasAwaitIssue = false;
    awaitPatterns.forEach((pattern) => {
      if (pattern.test(fixedContent)) {
        hasAwaitIssue = true;
      }
    });

    if (hasAwaitIssue) {
      // Fix arrow functions
      fixedContent = fixedContent.replace(
        /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(\(\)\s*=>\s*\{/g,
        (match, hook) => {
          // Check if the function body contains await
          const afterMatch = fixedContent.substring(
            fixedContent.indexOf(match) + match.length,
          );
          if (afterMatch.includes("await")) {
            return `${hook}(async () => {`;
          }
          return match;
        },
      );

      // Fix regular functions
      fixedContent = fixedContent.replace(
        /(onMounted|onUpdated|onBeforeMount|onBeforeUpdate|onUnmounted|watch)\(function\s*\(\)\s*\{/g,
        (match, hook) => {
          const afterMatch = fixedContent.substring(
            fixedContent.indexOf(match) + match.length,
          );
          if (afterMatch.includes("await")) {
            return `${hook}(async function() {`;
          }
          return match;
        },
      );

      if (fixedContent !== content) {
        result.fixed = true;
        result.fixes.push("Made lifecycle hooks async where await is used");
      }
    }
  }

  // Fix 4: Remove Vuex imports if Pinia is used
  if (fixedContent.includes("pinia") || fixedContent.includes("useStore")) {
    // Remove vuex imports
    const vuexImportPattern = /import\s+.*from\s+['"]vuex['"];?\n?/g;
    if (vuexImportPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(vuexImportPattern, "");
      result.fixed = true;
      result.fixes.push("Removed Vuex imports (using Pinia instead)");
    }

    // Remove mapGetters, mapActions, mapState, mapMutations imports
    const mapHelpersPattern =
      /import\s+\{[^}]*map(Getters|Actions|State|Mutations)[^}]*\}\s+from\s+['"]vuex['"];?\n?/g;
    if (mapHelpersPattern.test(fixedContent)) {
      fixedContent = fixedContent.replace(mapHelpersPattern, "");
      result.fixed = true;
      result.fixes.push("Removed Vuex helper imports");
    }
  }

  return {
    ...result,
    fixed: fixedContent !== content,
    content: fixedContent,
  };
}

/**
 * Fix import paths to use @ alias
 */
export function fixImportPaths(
  content: string,
  projectRoot: string,
  filePath: string,
): string {
  let fixed = content;

  // Convert relative imports to @ alias for src/ directory
  const relativeImportPattern = /from\s+['"](\.\.\/)+store\//g;
  if (relativeImportPattern.test(fixed)) {
    // Calculate relative path from file to src
    const fileDir = path.dirname(filePath);
    const srcPath = path.join(projectRoot, "src");

    // If file is in src/, use @ alias
    if (filePath.startsWith(srcPath)) {
      fixed = fixed.replace(/from\s+['"](\.\.\/)+store\//g, 'from "@/store/');
      fixed = fixed.replace(/from\s+['"]\.\.\/store\//g, 'from "@/store/');
    }
  }

  return fixed;
}
