import { detectVueVersion, analyzeProject } from '../utils/analysis';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('detectVueVersion', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vue-migrator-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should detect Vue 2.x', async () => {
    const packageJson = {
      dependencies: {
        vue: '^2.6.14',
      },
    };

    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    const version = await detectVueVersion(tempDir);
    expect(version).not.toBeNull();
    expect(version?.major).toBe(2);
    expect(version?.minor).toBe(6);
    expect(version?.patch).toBe(14);
  });

  it('should detect Vue 3.x', async () => {
    const packageJson = {
      dependencies: {
        vue: '^3.2.0',
      },
    };

    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    const version = await detectVueVersion(tempDir);
    expect(version).not.toBeNull();
    expect(version?.major).toBe(3);
  });

  it('should detect Vue in devDependencies', async () => {
    const packageJson = {
      devDependencies: {
        vue: '^2.6.14',
      },
    };

    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    const version = await detectVueVersion(tempDir);
    expect(version).not.toBeNull();
    expect(version?.major).toBe(2);
  });

  it('should handle version prefixes (^, ~)', async () => {
    const packageJson = {
      dependencies: {
        vue: '~2.6.14',
      },
    };

    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    const version = await detectVueVersion(tempDir);
    expect(version).not.toBeNull();
    expect(version?.major).toBe(2);
  });

  it('should return null if Vue is not found', async () => {
    const packageJson = {
      dependencies: {},
    };

    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    const version = await detectVueVersion(tempDir);
    expect(version).toBeNull();
  });

  it('should return null if package.json does not exist', async () => {
    const version = await detectVueVersion('/nonexistent/path');
    expect(version).toBeNull();
  });

  it('should return null if package.json is invalid', async () => {
    await fs.writeFile(path.join(tempDir, 'package.json'), 'invalid json');

    const version = await detectVueVersion(tempDir);
    expect(version).toBeNull();
  });
});

describe('analyzeProject', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vue-migrator-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should analyze a Vue 2 project', async () => {
    // Create package.json
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          dependencies: { vue: '^2.6.14' },
        },
        null,
        2
      )
    );

    // Create a Vue component
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'src', 'Component.vue'),
      '<template><div>{{ message }}</div></template><script>export default { data() { return { message: "Hello" }; } }</script>'
    );

    const analysis = await analyzeProject(tempDir);
    expect(analysis.vueVersion).not.toBeUndefined();
    expect(analysis.vueVersion?.major).toBe(2);
    expect(analysis.vueFiles.length).toBeGreaterThan(0);
    expect(analysis.componentsFound).toBeGreaterThan(0);
  });

  it('should detect Vue 2 patterns', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { vue: '^2.6.14' } }, null, 2)
    );

    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });

    // Component with Vue 2 patterns
    await fs.writeFile(
      path.join(tempDir, 'src', 'Component.vue'),
      '<script>export default { filters: { capitalize: (v) => v.toUpperCase() }, data() { return {}; } }</script>'
    );

    const analysis = await analyzeProject(tempDir);
    expect(analysis.vue2Patterns.length).toBeGreaterThan(0);
    expect(analysis.vue2Patterns.some((p) => p.includes('filters'))).toBe(true);
  });

  it('should handle empty project', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: {} }, null, 2)
    );

    const analysis = await analyzeProject(tempDir);
    expect(analysis.vueFiles).toEqual([]);
    expect(analysis.componentsFound).toBe(0);
  });

  it('should ignore node_modules and dist', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { vue: '^2.6.14' } }, null, 2)
    );

    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'dist'), { recursive: true });

    await fs.writeFile(path.join(tempDir, 'src', 'Component.vue'), '<template></template>');
    await fs.writeFile(path.join(tempDir, 'node_modules', 'lib.vue'), '<template></template>');
    await fs.writeFile(path.join(tempDir, 'dist', 'built.vue'), '<template></template>');

    const analysis = await analyzeProject(tempDir);
    expect(analysis.vueFiles.every((f) => !f.includes('node_modules'))).toBe(true);
    expect(analysis.vueFiles.every((f) => !f.includes('dist'))).toBe(true);
  });
});
