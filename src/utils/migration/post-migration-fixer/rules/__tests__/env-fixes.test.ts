/**
 * Tests for env-fixes rules (process.env → import.meta.env)
 */

import { processEnvToImportMetaRule } from "../env-fixes";

describe("processEnvToImportMetaRule", () => {
  it("replaces process.env.NODE_ENV === 'production' with import.meta.env.PROD", async () => {
    const content = `const isProd = process.env.NODE_ENV === 'production';`;
    const result = await processEnvToImportMetaRule.apply("src/util/foo.js", content, {
      enableTypeScript: false,
      isVueFile: false,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import.meta.env.PROD");
    expect(result.content).not.toContain("process.env");
  });

  it("replaces process.env.VUE_ENV === 'server' with import.meta.env.SSR", async () => {
    const content = `export default process.env.VUE_ENV === 'server' ? serverMixin : clientMixin;`;
    const result = await processEnvToImportMetaRule.apply("src/util/title.js", content, {
      enableTypeScript: false,
      isVueFile: false,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import.meta.env.SSR");
  });

  it("replaces process.env.DEBUG_API with import.meta.env.VITE_DEBUG_API", async () => {
    const content = `const log = !!process.env.DEBUG_API;`;
    const result = await processEnvToImportMetaRule.apply("src/api/index.js", content, {
      enableTypeScript: false,
      isVueFile: false,
    });
    expect(result.fixed).toBe(true);
    expect(result.content).toContain("import.meta.env.VITE_DEBUG_API");
  });

  it("does not apply to server-only files", async () => {
    const content = `if (process.__API__) return process.__API__;`;
    expect(processEnvToImportMetaRule.shouldApply("src/api/create-api-server.js", content)).toBe(false);
  });

  it("does not apply when no process.env", () => {
    expect(processEnvToImportMetaRule.shouldApply("src/util/foo.js", "const x = 1;")).toBe(false);
  });
});
