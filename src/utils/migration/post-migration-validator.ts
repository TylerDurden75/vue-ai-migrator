import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Validate migrated code for common issues
 */
export async function validateMigration(
  projectPath: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  try {
    // Check if Vue 3 is installed
    const packageJsonPath = path.join(projectPath, 'package.json');
    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      
      if (allDeps.vue && !allDeps.vue.startsWith('^3.')) {
        result.errors.push(`Vue version is not 3.x: ${allDeps.vue}`);
        result.valid = false;
      }
      
      // Check for Vue 2 specific packages
      if (allDeps['vue-template-compiler']) {
        result.warnings.push('vue-template-compiler is Vue 2 specific and should be removed');
      }
      
      if (allDeps.vuex && !allDeps.pinia) {
        result.warnings.push('Vuex detected but Pinia not found - consider migrating to Pinia');
      }
    } catch (error) {
      result.warnings.push('Could not read package.json');
    }

    // Check for common Vue 2 patterns that might have been missed
    const vueFiles = await glob('**/*.{vue,js,ts}', {
      cwd: projectPath,
      ignore: ['node_modules/**', 'dist/**', 'build/**'],
      absolute: true,
    });

    let filesWithIssues = 0;
    
    for (const filePath of vueFiles.slice(0, 50)) { // Sample first 50 files
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Check for Vue 2 patterns
        if (content.includes('new Vue(')) {
          result.warnings.push(`File still uses 'new Vue()': ${path.relative(projectPath, filePath)}`);
          filesWithIssues++;
        }
        
        if (content.includes('beforeDestroy') || content.includes('destroyed')) {
          result.warnings.push(`File still uses Vue 2 lifecycle hooks: ${path.relative(projectPath, filePath)}`);
          filesWithIssues++;
        }
        
        if (content.includes('$listeners')) {
          result.warnings.push(`File still uses '$listeners': ${path.relative(projectPath, filePath)}`);
          filesWithIssues++;
        }
        
        if (content.includes('slot-scope=')) {
          result.warnings.push(`File still uses 'slot-scope': ${path.relative(projectPath, filePath)}`);
          filesWithIssues++;
        }
        
        // Check for Vue 3 opportunities
        if (content.includes('export default') && content.includes('data()') && !content.includes('<script setup>')) {
          result.suggestions.push(
            `Consider converting to Composition API: ${path.relative(projectPath, filePath)}`
          );
        }
        
        if (content.includes('v-model') && !content.includes('modelValue')) {
          result.suggestions.push(
            `Check v-model usage for Vue 3 compatibility: ${path.relative(projectPath, filePath)}`
          );
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    if (filesWithIssues > 0) {
      result.warnings.push(`${filesWithIssues} file(s) may still contain Vue 2 patterns`);
    }

    // Suggest Vue 3 features
    result.suggestions.push('Consider using <script setup> for better performance');
    result.suggestions.push('Consider using Teleport for modals and overlays');
    result.suggestions.push('Consider using Suspense for async components');

  } catch (error) {
    result.errors.push(
      `Validation error: ${error instanceof Error ? error.message : String(error)}`
    );
    result.valid = false;
  }

  return result;
}

