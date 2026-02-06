import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { detectProjectPatterns } from "../project-detectors";

describe("detectProjectPatterns", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vue-migrator-detectors-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects hasWebpackSSR when build/webpack.client.config.js exists", async () => {
    await fs.mkdir(path.join(tmpDir, "build"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "build", "webpack.client.config.js"),
      "module.exports = {}"
    );
    await fs.writeFile(
      path.join(tmpDir, "build", "webpack.server.config.js"),
      "module.exports = {}"
    );
    const result = await detectProjectPatterns(tmpDir);
    expect(result.hasWebpackSSR).toBe(true);
    expect(result.webpackConfigPaths.length).toBeGreaterThan(0);
  });

  it("detects hasSSREntries when entry-client and entry-server exist", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "entry-client.js"), "");
    await fs.writeFile(path.join(tmpDir, "src", "entry-server.js"), "");
    const result = await detectProjectPatterns(tmpDir);
    expect(result.hasSSREntries).toBe(true);
  });

  it("detects hasCreateApiPattern in api/index.js", async () => {
    await fs.mkdir(path.join(tmpDir, "src", "api"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "api", "index.js"),
      "import { createAPI } from 'create-api'"
    );
    const result = await detectProjectPatterns(tmpDir);
    expect(result.hasCreateApiPattern).toBe(true);
  });

  it("detects hasVueConfig", async () => {
    await fs.writeFile(path.join(tmpDir, "vue.config.js"), "module.exports = {}");
    const result = await detectProjectPatterns(tmpDir);
    expect(result.hasVueConfig).toBe(true);
  });

  it("returns false when no pattern is present", async () => {
    const result = await detectProjectPatterns(tmpDir);
    expect(result.hasWebpackSSR).toBe(false);
    expect(result.hasSSREntries).toBe(false);
    expect(result.hasCreateApiPattern).toBe(false);
    expect(result.hasVueConfig).toBe(false);
  });
});
