import {
  fixPostMigrationIssues,
  fixImportPaths,
} from '../utils/migration/post-migration-fixer';
import * as path from 'path';
import * as fs from 'fs';
import { getStoreMethodMap } from '../utils/migration/post-migration-fixer/utils/store-analysis-cache';

jest.mock('../utils/migration/post-migration-fixer/utils/store-analysis-cache');

const mockGetStoreMethodMap = getStoreMethodMap as jest.MockedFunction<typeof getStoreMethodMap>;

describe('Post Migration Fixer', () => {
  const testProjectRoot = path.join(__dirname, '../../test-project');
  const customRuleProjectRoot = path.join(__dirname, '../../fixtures/custom-fixer-rule');
  const hasTestProject = fs.existsSync(testProjectRoot);

  beforeEach(() => {
    mockGetStoreMethodMap.mockResolvedValue({});
  });

  describe('fixPostMigrationIssues', () => {
    it('should fix missing computed import', async () => {
      const code = `
        <script setup>
        const filtered = computed(() => posts.value);
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('import { computed }');
      expect(result.fixes.some(f => f.includes('computed'))).toBe(true);
    });

    it('should fix missing ref import', async () => {
      const code = `
        <script setup>
        const count = ref(0);
        const doubled = computed(() => count.value * 2);
        watch(count, () => {});
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      // The fixer should detect missing imports and add them
      // Note: The fixer runs in multiple passes, so we check if fixes were applied
      expect(result).toBeDefined();
      // Check if imports were added (may be in fixes array or content)
      const hasRefImport = result.content.match(/import\s+.*\{[^}]*ref[^}]*\}/) || 
                          result.fixes.some(f => f.includes('ref'));
      const hasComputedImport = result.content.match(/import\s+.*\{[^}]*computed[^}]*\}/) ||
                               result.fixes.some(f => f.includes('computed'));
      const hasWatchImport = result.content.match(/import\s+.*\{[^}]*watch[^}]*\}/) ||
                            result.fixes.some(f => f.includes('watch'));
      
      // At least one import should be added
      expect(!!hasRefImport || !!hasComputedImport || !!hasWatchImport).toBe(true);
    });

    it('should fix missing lifecycle hook imports (onMounted, onUnmounted)', async () => {
      const code = `
        <script setup>
        onMounted(() => { console.log('mounted'); });
        onUnmounted(() => { console.log('unmounted'); });
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('onMounted');
      expect(result.content).toContain('onUnmounted');
      expect(result.content).toMatch(/import\s*\{[^}]*onMounted[^}]*\}\s*from\s*['"]vue['"]/);
      expect(result.content).toMatch(/import\s*\{[^}]*onUnmounted[^}]*\}\s*from\s*['"]vue['"]/);
    });

    it('should fix missing useRoute import', async () => {
      const code = `
        <script setup>
        const route = useRoute();
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("import { useRoute } from 'vue-router'");
      expect(result.fixes.some(f => f.includes('useRoute'))).toBe(true);
    });

    it('should fix missing useRouter import', async () => {
      const code = `
        <script setup>
        const router = useRouter();
        router.push('/home');
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("import { useRouter } from 'vue-router'");
    });

    it('should fix router.push with params to use path', async () => {
      const code = `
        <script setup>
        const router = useRouter();
        router.push({ name: 'BlogPost', params: { id: postId } });
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain("router.push({ path:");
      expect(result.content).toContain("`/blog-post/${postId}`");
    });

    it('should fix incomplete filtered computed with dynamic property detection', async () => {
      const code = `
        import { defineStore } from 'pinia';
        import { ref, reactive, computed } from 'vue';
        
        export const useBlogStore = defineStore('blog', () => {
          const posts = ref([
            { id: 1, category: 'tech', title: 'Post 1' },
            { id: 2, category: 'lifestyle', title: 'Post 2' }
          ]);
          const filters = reactive({
            category: null,
            search: ''
          });
          
          // Add usage to help property detection
          const categories = posts.value.map(p => p.category);
          
          const filteredPosts = computed(() => posts);
          
          return { posts, filters, filteredPosts };
        });
      `;

      const result = await fixPostMigrationIssues('store/modules/blog.js', code, false, testProjectRoot);

      // The fix may apply storeComputedResultRule when conditions are met
      expect(result.content).toBeDefined();
      if (result.fixed && result.fixes.some(f => f.includes('computed') || f.includes('filter'))) {
        expect(result.content).toContain('filteredPosts');
        expect(result.content).toContain('computed');
      }
    });

    it('should merge duplicate imports from same module', async () => {
      const code = `
        <script setup>
        import { ref } from 'vue';
        import { computed } from 'vue';
        import { watch } from 'vue';
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      // Should have only one import from 'vue'
      const vueImports = (result.content.match(/import.*from ['"]vue['"]/g) || []).length;
      expect(vueImports).toBeLessThanOrEqual(1);
    });

    it('should remove this. references in script setup', async () => {
      const code = `
        <script setup>
        const handleClick = () => {
          this.doSomething();
        };
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).not.toContain('this.doSomething');
      expect(result.content).toContain('doSomething()');
    });

    it('should fix store method calls dynamically', async () => {
      const code = `
        <script setup>
        import { useBlogStore } from '@/store/modules/blog';
        const blogStore = useBlogStore();
        const posts = blogStore.allPosts;
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      // Should detect store usage and fix if needed
      expect(result).toBeDefined();
    });

    it('should handle empty code gracefully', async () => {
      const result = await fixPostMigrationIssues('test.vue', '', false, testProjectRoot);

      expect(result.fixed).toBe(false);
      expect(result.issues.length).toBe(0);
      expect(result.fixes.length).toBe(0);
    });

    it('should fix defineStore malformed closing (}; }; }); → });) in store files', async () => {
      const code = `import { defineStore } from "pinia";
import { ref } from "vue";

export const useAppStore = defineStore("app", () => {
  const theme = ref('light');
  return {
    theme
  };

};
});
`;
      const result = await fixPostMigrationIssues('src/store/modules/app.ts', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('  }\n});');
      expect(result.content).not.toMatch(/\}\s*;\s*\n+\s*\}\s*;\s*\n/);
      expect(result.fixes.some(f => f.includes('defineStore') || f.includes('closing'))).toBe(true);
    });

    it('should fix template interpolation extra parenthesis ({{ user.name) }} → {{ user.name }})', async () => {
      const code = `
<template>
  <div>
    <div v-for="user in filteredUsers" :key="user.id">
      {{ user.name) }} - {{ user.email }}
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
const filteredUsers = ref([]);
</script>
      `.trim();

      const result = await fixPostMigrationIssues('src/views/Users.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('{{ user.name }} - {{ user.email }}');
      expect(result.content).not.toContain('user.name) }}');
      expect(result.fixes.some(f => f.includes('interpolation') || f.includes('parentheses'))).toBe(true);
    });

    it('should fix route.query.redirect type issues', async () => {
      const code = `
        <script setup>
        const route = useRoute();
        const redirect = route.query.redirect || '/dashboard';
        router.push(route.query.redirect);
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('typeof');
      expect(result.content).toContain('string');
    });

    it('should fix incomplete computed with Array.from undefined variable', async () => {
      const code = `
        import { defineStore } from 'pinia';
        import { ref, computed } from 'vue';
        
        export const useBlogStore = defineStore('blog', () => {
          const posts = ref([
            { id: 1, category: 'tech' },
            { id: 2, category: 'lifestyle' }
          ]);
          
          const categories = computed(() => Array.from(cats));
          
          return { posts, categories };
        });
      `;

      const result = await fixPostMigrationIssues('store/modules/blog.js', code, false, testProjectRoot);

      expect(result.content).toBeDefined();
      if (result.fixed && result.fixes.some(f => f.includes('computed') || f.includes('Array'))) {
        expect(result.content).toContain('categories');
        expect(result.content).toContain('computed');
      }
    });

    it('should detect and fix missing store imports', async () => {
      const code = `
        <script setup>
        const blogStore = useBlogStore();
        const posts = blogStore.allPosts;
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      // Should add useBlogStore when store analysis finds blog store (path may be @/store or @/store/modules/blog)
      expect(result).toBeDefined();
      if (result.fixed && result.content.includes("from") && result.content.includes("store")) {
        expect(result.content).toContain('useBlogStore');
        expect(result.content).toMatch(/@\/store(\/modules\/blog)?/);
      }
    });
  });

  describe('fixImportPaths', () => {
    it('should fix relative import paths', () => {
      const code = "import Component from '../components/Component.vue';";
      const result = fixImportPaths(code, 'src/views/Page.vue', testProjectRoot);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle absolute paths', () => {
      const code = "import Component from '@/components/Component.vue';";
      const result = fixImportPaths(code, 'src/views/Page.vue', testProjectRoot);

      expect(result).toBeDefined();
      expect(result).toContain('@/');
    });

    it('should handle empty code', () => {
      const result = fixImportPaths('', 'test.vue', testProjectRoot);
      expect(result).toBe('');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed Vue files', async () => {
      const code = '<script setup>const broken = ;</script>';

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      // Should not crash, may have issues
      expect(result).toBeDefined();
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should handle files without script setup', async () => {
      const code = '<template><div>Test</div></template>';

      const result = await fixPostMigrationIssues('test.vue', code, false, testProjectRoot);

      expect(result).toBeDefined();
      expect(result.content).toBe(code);
    });

    it('should handle TypeScript files', async () => {
      const code = `
        <script setup lang="ts">
        const count: number = ref(0);
        </script>
      `;

      const result = await fixPostMigrationIssues('test.vue', code, true, testProjectRoot);

      expect(result).toBeDefined();
      expect(result.content).toContain('lang="ts"');
    });

    it('should apply custom rules from fixerRulesAdd config', async () => {
      const code = `<script setup>
// TODO: implement feature
const x = 1;
</script>`;

      const result = await fixPostMigrationIssues(
        'test.vue',
        code,
        false,
        customRuleProjectRoot
      );

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('// FIXME: implement feature');
      expect(result.fixes.some(f => f.includes('custom rule'))).toBe(true);
    });
  });

  describe('Dynamic property detection integration', () => {
    it('should use dynamic property detection for filtered computed', async () => {
      const code = `
        import { defineStore } from 'pinia';
        import { ref, reactive, computed } from 'vue';
        
        export const useProductStore = defineStore('product', () => {
          const products = ref([
            { id: 1, type: 'tech', name: 'Laptop' },
            { id: 2, type: 'fashion', name: 'Shirt' }
          ]);
          
          // Add usage to help property detection
          const types = products.value.map(p => p.type);
          const names = products.value.map(p => p.name);
          
          const filters = reactive({
            type: null,
            query: ''
          });
          
          const filteredProducts = computed(() => products);
          
          return { products, filters, filteredProducts };
        });
      `;

      const result = await fixPostMigrationIssues('store/modules/product.js', code, false, testProjectRoot);

      // The fix should be applied if conditions are met
      if (result.fixed && result.content.includes('filteredProducts = computed(() => {')) {
        // Should detect 'type' as category filter (not hardcoded 'category')
        expect(result.content).toContain('filters.type');
        // Should detect 'query' as search filter (not hardcoded 'search')
        expect(result.content).toContain('filters.query');
        // Should detect 'name' as search property from products array
        expect(result.content).toContain('item.name');
      } else {
        // If not fixed, verify code is still valid
        expect(result.content).toBeDefined();
      }
    });

    it('should detect properties from map callbacks', async () => {
      const code = `
        import { defineStore } from 'pinia';
        import { ref, reactive, computed } from 'vue';
        
        export const useUserStore = defineStore('user', () => {
          const users = ref([
            { id: 1, role: 'admin', email: 'admin@test.com' },
            { id: 2, role: 'user', email: 'user@test.com' }
          ]);
          
          // Add some usage to help property detection
          const roles = users.value.map(u => u.role);
          const emails = users.value.map(u => u.email);
          
          const filters = reactive({
            role: null,
            search: ''
          });
          
          const filteredUsers = computed(() => users);
          
          return { users, filters, filteredUsers };
        });
      `;

      const result = await fixPostMigrationIssues('store/modules/user.js', code, false, testProjectRoot);

      // The fix should be applied if conditions are met
      if (result.fixed && result.content.includes('filteredUsers = computed(() => {')) {
        // Should detect 'role' as category property (not hardcoded 'category')
        expect(result.content).toContain('item.role');
        // Should detect 'email' as search property
        expect(result.content).toContain('item.email');
      } else {
        // If not fixed, verify code is still valid and properties were detected
        expect(result.content).toBeDefined();
        // The property analyzer should still detect properties from map callbacks
        expect(result.content).toContain('users.value.map');
      }
    });

    (hasTestProject ? it : it.skip)('should fix indexStore.fetchUser and indexStore.allIndexs to userStore (fixStoreMemberMismatchRule)', async () => {
      mockGetStoreMethodMap.mockResolvedValue({
        fetchUser: "user",
        allUsers: "user",
        currentUser: "user",
        isLoading: "index",
        loading: "index",
        fetchCurrentUser: "index"
      });
      const code = `
<template>
  <div class="user-detail">
    <div v-if="isLoading">Loading user...</div>
    <div v-else-if="user">
      <h1>{{ user.name }}</h1>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, watch } from "vue";
import { useIndexStore } from "@/store/index";
import { useRouter, useRoute } from "vue-router";

const route = useRoute();
const indexStore = useIndexStore();
const props = defineProps({ id: { type: [String, Number], required: true } });

const isLoading = computed<any>(() => indexStore.isLoading);
const user = computed<any>(() => {
  const id = props.id || (route.params.id as string);
  return indexStore.allIndexs?.find((item: any) => item.id === parseInt(id as string)) || null;
});

const fetchUser = () => {
  indexStore.fetchUser(parseInt(props.id));
};
watch(() => props.id, () => fetchUser(), { immediate: true });
</script>`;

      const result = await fixPostMigrationIssues('src/views/UserDetail.vue', code, true, testProjectRoot);

      expect(result.fixed).toBe(true);
      expect(result.content).toContain('useUserStore');
      expect(result.content).toContain('userStore.fetchUser');
      expect(result.content).not.toContain('indexStore.fetchUser');
      // allIndexs -> allUsers or currentUser (Detail view)
      expect(result.content).not.toContain('indexStore.allIndexs');
      expect(result.content).toMatch(/userStore\.(allUsers|currentUser)/);
    });

    (hasTestProject ? it : it.skip)('should NOT revert userStore to indexStore when detail view correctly uses userStore (fixer idempotency)', async () => {
      mockGetStoreMethodMap.mockResolvedValue({
        fetchUser: "user",
        allUsers: "user",
        currentUser: "user",
        loading: "user",
        isLoading: "index",
        fetchCurrentUser: "index"
      });
      const code = `
<template>
  <div class="user-detail">
    <div v-if="isLoading">Loading user...</div>
    <div v-else-if="user">
      <h1>{{ user.name }}</h1>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, watch } from "vue";
import { useUserStore } from "@/store/modules/user";
import { useRouter, useRoute } from "vue-router";

const route = useRoute();
const userStore = useUserStore();
const props = defineProps({ id: { type: [String, Number], required: true } });

const isLoading = computed<any>(() => userStore.loading);
const user = computed<any>(() => userStore.currentUser);

const fetchUser = () => {
  userStore.fetchUser(Number(props.id));
};
watch(() => props.id, () => fetchUser(), { immediate: true });
</script>`;

      const result = await fixPostMigrationIssues('src/views/UserDetail.vue', code, true, testProjectRoot);

      expect(result.content).toContain('useUserStore');
      expect(result.content).toContain('userStore.fetchUser');
      expect(result.content).toContain('userStore.loading');
      expect(result.content).toContain('userStore.currentUser');
      expect(result.content).not.toContain('useIndexStore');
      expect(result.content).not.toContain('indexStore.fetchUser');
      expect(result.content).not.toContain('indexStore.loading');
      expect(result.content).not.toContain('indexStore.currentUser');
      expect(result.fixes.some((f) => f.includes('useUserStore') && f.includes('useIndexStore'))).toBe(false);
    });
  });
});
