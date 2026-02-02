import * as path from "path";
import * as fsSync from "fs";
import { execSync } from "child_process";

// Try to import Prettier programmatically if available
let prettierModule: any = null;
try {
  // Try to load from project's node_modules first
  const projectPrettierPath = path.join(process.cwd(), "node_modules", "prettier");
  if (fsSync.existsSync(projectPrettierPath)) {
    prettierModule = require(projectPrettierPath);
  } else {
    // Try to load from vue-ai-migrator's node_modules
    prettierModule = require("prettier");
  }
} catch {
  // Prettier not available, will use fallback formatting
}

/**
 * Formats Vue files using Prettier if available
 * Falls back to basic formatting if Prettier is not available
 */
export async function formatWithPrettier(
  filePath: string,
  content: string,
  projectRoot?: string
): Promise<string> {
  // Try to use Prettier programmatically if available
  if (prettierModule) {
    try {
      const prettierOptions: any = {
        semi: true,
        singleQuote: false,
        tabWidth: 2,
        useTabs: false,
        trailingComma: "es5",
        printWidth: 100,
        arrowParens: "avoid",
        endOfLine: "lf",
        vueIndentScriptAndStyle: false,
      };

      // Try to load Prettier config from project if available
      if (projectRoot) {
        try {
          const configPath = path.join(projectRoot, ".prettierrc.json");
          if (fsSync.existsSync(configPath)) {
            const configContent = fsSync.readFileSync(configPath, "utf-8");
            const config = JSON.parse(configContent);
            prettierOptions.semi = config.semi ?? prettierOptions.semi;
            prettierOptions.singleQuote = config.singleQuote ?? prettierOptions.singleQuote;
            prettierOptions.tabWidth = config.tabWidth ?? prettierOptions.tabWidth;
            prettierOptions.printWidth = config.printWidth ?? prettierOptions.printWidth;
          }
        } catch {
          // Use default options
        }
      }

      // Format the content
      const formatted = await prettierModule.format(content, {
        ...prettierOptions,
        filepath: filePath,
        parser: filePath.endsWith(".vue") ? "vue" : filePath.endsWith(".ts") ? "typescript" : "babel",
      });
      
      return formatted;
    } catch {
      // Fall through to CLI or basic formatting
    }
  }

  // Try to use Prettier CLI from the project if available
  if (projectRoot) {
    try {
      const prettierPath = path.join(projectRoot, "node_modules", ".bin", "prettier");
      if (fsSync.existsSync(prettierPath)) {
        // Write content to temp file, format it, then read it back
        const tempFile = path.join(projectRoot, ".temp-format-file");
        fsSync.writeFileSync(tempFile, content, "utf-8");
        
        try {
          execSync(`${prettierPath} --write "${tempFile}"`, {
            cwd: projectRoot,
            stdio: "pipe",
          });
          const formatted = fsSync.readFileSync(tempFile, "utf-8");
          fsSync.unlinkSync(tempFile);
          return formatted;
        } catch {
          // If Prettier fails, clean up and return original
          if (fsSync.existsSync(tempFile)) {
            fsSync.unlinkSync(tempFile);
          }
        }
      }
    } catch {
      // Ignore errors, fall back to basic formatting
    }
  }

  // Try to use Prettier from vue-ai-migrator's node_modules if available
  try {
    const prettierPath = path.join(__dirname, "..", "..", "..", "node_modules", ".bin", "prettier");
    if (fsSync.existsSync(prettierPath)) {
      const tempFile = path.join(path.dirname(filePath), ".temp-format-file");
      fsSync.writeFileSync(tempFile, content, "utf-8");
      
      try {
        execSync(`${prettierPath} --write "${tempFile}"`, {
          stdio: "pipe",
        });
        const formatted = fsSync.readFileSync(tempFile, "utf-8");
        fsSync.unlinkSync(tempFile);
        return formatted;
      } catch {
        if (fsSync.existsSync(tempFile)) {
          fsSync.unlinkSync(tempFile);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Fallback: Basic formatting for Vue files
  return formatBasicVue(content);
}

/**
 * Basic formatting for Vue files when Prettier is not available
 * Handles common formatting issues
 */
function formatBasicVue(content: string): string {
  let formatted = content;

  // Ensure <script setup> tag is on its own line
  formatted = formatted.replace(/<script\s+setup[^>]*>import/g, (match) => {
    const scriptTagMatch = match.match(/<script\s+setup[^>]*>/);
    if (scriptTagMatch) {
      return scriptTagMatch[0] + "\nimport";
    }
    return match;
  });

  // Ensure </script> is on its own line
  formatted = formatted.replace(/([^;\n}]);\s*<\/script>/g, "$1;\n</script>");
  formatted = formatted.replace(/([^\n}])\s*<\/script>/g, (match, beforeTag) => {
    if (!beforeTag.includes("\n") && beforeTag.trim().length > 0) {
      if (beforeTag.trim().endsWith("}") || beforeTag.trim().endsWith(")")) {
        return beforeTag + "\n</script>";
      }
    }
    return match;
  });

  // Ensure proper spacing around imports
  formatted = formatted.replace(/(import[^;]+;)(import)/g, "$1\n$2");

  // Ensure blank line between imports and code
  formatted = formatted.replace(/(import[^;]+;\n)(const|let|var|function|export)/g, "$1\n$2");

  return formatted;
}

/**
 * Creates recommended Prettier and ESLint config files for Vue 3
 */
export async function createVue3ConfigFiles(projectRoot: string): Promise<void> {
  const prettierConfig = `{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "avoid",
  "endOfLine": "lf",
  "vueIndentScriptAndStyle": false
}
`;

  const eslintConfig = `{
  "root": true,
  "env": {
    "browser": true,
    "es2021": true,
    "node": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:vue/vue3-essential",
    "plugin:vue/vue3-strongly-recommended",
    "plugin:vue/vue3-recommended",
    "@vue/typescript/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2021,
    "sourceType": "module"
  },
  "plugins": ["vue"],
  "rules": {
    "vue/multi-word-component-names": "off",
    "vue/no-v-html": "warn"
  }
}
`;

  const prettierIgnore = `node_modules
dist
build
.temp-format-file
*.min.js
*.min.css
`;

  try {
    // Write .prettierrc.json
    const prettierPath = path.join(projectRoot, ".prettierrc.json");
    if (!fsSync.existsSync(prettierPath)) {
      fsSync.writeFileSync(prettierPath, prettierConfig, "utf-8");
    }

    // Write .prettierignore
    const prettierIgnorePath = path.join(projectRoot, ".prettierignore");
    if (!fsSync.existsSync(prettierIgnorePath)) {
      fsSync.writeFileSync(prettierIgnorePath, prettierIgnore, "utf-8");
    }

    // Write .eslintrc.json (only if it doesn't exist or is basic)
    const eslintPath = path.join(projectRoot, ".eslintrc.json");
    const existingEslint = fsSync.existsSync(eslintPath)
      ? fsSync.readFileSync(eslintPath, "utf-8")
      : null;
    
    // Only create if it doesn't exist or is very basic
    if (!existingEslint || existingEslint.includes('"parser": "@typescript-eslint/parser"')) {
      fsSync.writeFileSync(eslintPath, eslintConfig, "utf-8");
    }
  } catch (error) {
    // Ignore errors when creating config files
  }
}
