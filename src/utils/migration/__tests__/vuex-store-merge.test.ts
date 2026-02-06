import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { mergeVuexStore } from "../vuex-store-merge";

describe("vuex-store-merge", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vuex-merge-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function setupSplitStore() {
    const storeDir = path.join(tempDir, "src", "store");
    await fs.mkdir(storeDir, { recursive: true });

    await fs.writeFile(
      path.join(storeDir, "index.js"),
      `import Vue from 'vue'
import Vuex from 'vuex'
import actions from './actions'
import mutations from './mutations'
import getters from './getters'

Vue.use(Vuex)

export function createStore () {
  return new Vuex.Store({
    state: { count: 0 },
    actions,
    mutations,
    getters
  })
}
`,
    );

    await fs.writeFile(
      path.join(storeDir, "actions.js"),
      `import { fetchData } from '../api'

export default {
  FETCH: ({ commit }) => fetchData().then((data) => commit('SET', data))
}
`,
    );

    await fs.writeFile(
      path.join(storeDir, "mutations.js"),
      `import Vue from 'vue'

export default {
  SET: (state, val) => { Vue.set(state, 'data', val) }
}
`,
    );

    await fs.writeFile(
      path.join(storeDir, "getters.js"),
      `export default {
  count: (state) => state.count
}
`,
    );
  }

  it("should merge split store into single file", async () => {
    await setupSplitStore();
    const result = await mergeVuexStore(tempDir, false);

    expect(result.success).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.mergedFiles).toContain("actions.js");
    expect(result.mergedFiles).toContain("mutations.js");
    expect(result.mergedFiles).toContain("getters.js");

    const mergedContent = await fs.readFile(
      path.join(tempDir, "src", "store", "index.js"),
      "utf-8",
    );

    expect(mergedContent).toContain("import { fetchData } from '../api'");
    expect(mergedContent).toContain("FETCH:");
    expect(mergedContent).toContain("SET:");
    expect(mergedContent).toContain("count:");
    expect(mergedContent).not.toContain("import actions from");
    expect(mergedContent).not.toContain("import mutations from");
    expect(mergedContent).not.toContain("import getters from");

    // Merged files should be removed
    await expect(
      fs.access(path.join(tempDir, "src", "store", "actions.js")),
    ).rejects.toThrow();
  });

  it("should not modify files in dry-run", async () => {
    await setupSplitStore();
    const result = await mergeVuexStore(tempDir, true);

    expect(result.success).toBe(true);
    expect(result.merged).toBe(false);

    // Original files should still exist
    const actionsContent = await fs.readFile(
      path.join(tempDir, "src", "store", "actions.js"),
      "utf-8",
    );
    expect(actionsContent).toContain("export default");
  });

  it("should skip when store is not split", async () => {
    const storeDir = path.join(tempDir, "src", "store");
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(
      path.join(storeDir, "index.js"),
      `import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)

export default new Vuex.Store({
  state: { count: 0 },
  actions: { inc: ({ commit }) => commit('INC') },
  mutations: { INC: (s) => s.count++ }
})
`,
    );

    const result = await mergeVuexStore(tempDir, false);

    expect(result.success).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
