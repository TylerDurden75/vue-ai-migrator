import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

export interface VueVersion {
  version: string;
  major: number;
  minor: number;
  patch: number;
}

export interface ProjectAnalysis {
  vueVersion?: VueVersion;
  vueFiles: string[];
  componentsFound: number;
  vue2Patterns: string[];
}

export async function detectVueVersion(projectPath: string): Promise<VueVersion | null> {
  try {
    // Read package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    // Look for Vue in dependencies or devDependencies
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    const vueVersion = allDeps.vue;

    if (!vueVersion) {
      return null;
    }

    // Extract version (handle prefixes like ^, ~, etc.)
    const versionMatch = vueVersion.match(/(\d+)\.(\d+)\.(\d+)/);
    
    if (!versionMatch) {
      return null;
    }

    return {
      version: vueVersion,
      major: parseInt(versionMatch[1], 10),
      minor: parseInt(versionMatch[2], 10),
      patch: parseInt(versionMatch[3], 10),
    };
  } catch (error) {
    return null;
  }
}

export async function analyzeProject(projectPath: string): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    vueFiles: [],
    componentsFound: 0,
    vue2Patterns: [],
  };

  try {
    // Detect Vue version
    analysis.vueVersion = await detectVueVersion(projectPath) || undefined;

    // Find all Vue files
    const vueFiles = await glob('**/*.vue', {
      cwd: projectPath,
      ignore: ['node_modules/**', 'dist/**', 'build/**'],
      absolute: true,
    });

    analysis.vueFiles = vueFiles;

    // Analyze Vue 2 patterns (sample first 20 files for performance)
    const sampleSize = Math.min(20, vueFiles.length);
    for (const filePath of vueFiles.slice(0, sampleSize)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const patterns = detectVue2Patterns(content);
        analysis.vue2Patterns.push(...patterns);
      } catch (error) {
        // Ignore read errors
      }
    }

    // Count components
    analysis.componentsFound = vueFiles.length;

    // Deduplicate patterns
    analysis.vue2Patterns = [...new Set(analysis.vue2Patterns)];

    return analysis;
  } catch (error) {
    throw new Error(
      `Error analyzing project: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function detectVue2Patterns(content: string): string[] {
  const patterns: string[] = [];

  // Detect common Vue 2 patterns
  if (content.includes('new Vue(')) {
    patterns.push('Usage of new Vue() (global API)');
  }

  if (content.includes('Vue.component(')) {
    patterns.push('Usage of Vue.component()');
  }

  if (content.includes('Vue.use(')) {
    patterns.push('Usage of Vue.use()');
  }

  if (content.includes('filters:')) {
    patterns.push('Usage of filters (not supported in Vue 3)');
  }

  if (content.includes('$on(') || content.includes('$off(') || content.includes('$once(')) {
    patterns.push('Usage of $on/$off/$once (not supported in Vue 3)');
  }

  if (content.includes('$listeners')) {
    patterns.push('Usage of $listeners (replaced by $attrs in Vue 3)');
  }

  if (content.includes('beforeDestroy') || content.includes('destroyed')) {
    patterns.push('Vue 2 lifecycle hooks (beforeDestroy/destroyed)');
  }

  if (content.includes('export default') && content.includes('data()')) {
    patterns.push('Options API with data()');
  }

  if (content.includes('v-model') && content.includes('value') && content.includes('@input')) {
    patterns.push('Vue 2 v-model (value + input)');
  }

  return patterns;
}

