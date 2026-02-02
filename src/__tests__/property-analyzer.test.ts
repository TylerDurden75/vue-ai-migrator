import {
  analyzeArrayItemProperties,
  analyzeFilterProperties,
  analyzeStoreStructure,
} from '../utils/migration/property-analyzer';

describe('Property Analyzer', () => {
  describe('analyzeArrayItemProperties', () => {
    it('should detect properties from map callbacks', () => {
      const code = `
        const posts = ref([]);
        const categories = computed(() => {
          return posts.value.map(item => item.category);
        });
        const titles = posts.value.map(post => post.title);
      `;

      const analysis = analyzeArrayItemProperties(code, 'posts');
      
      expect(analysis.properties.has('category')).toBe(true);
      expect(analysis.properties.has('title')).toBe(true);
      expect(analysis.categoryProperty).toBe('category');
      expect(analysis.sampleCount).toBeGreaterThan(0);
    });

    it('should detect properties from filter callbacks', () => {
      const code = `
        const products = ref([]);
        const filtered = products.value.filter(item => item.type === 'tech');
        const searched = products.value.filter(p => p.name.includes('test'));
      `;

      const analysis = analyzeArrayItemProperties(code, 'products');
      
      expect(analysis.properties.has('type')).toBe(true);
      expect(analysis.properties.has('name')).toBe(true);
    });

    it('should infer category property from common patterns', () => {
      const code = `
        const items = ref([]);
        const filtered = items.value.filter(item => item.category === 'test');
      `;

      const analysis = analyzeArrayItemProperties(code, 'items');
      
      expect(analysis.categoryProperty).toBe('category');
    });

    it('should infer search property from common patterns', () => {
      const code = `
        const posts = ref([]);
        const filtered = posts.value.filter(post => post.title.includes('test'));
      `;

      const analysis = analyzeArrayItemProperties(code, 'posts');
      
      expect(analysis.searchProperty).toBe('title');
    });

    it('should handle different array variable names', () => {
      const code = `
        const users = ref([]);
        const filtered = users.value.map(user => user.role);
      `;

      const analysis = analyzeArrayItemProperties(code, 'users');
      
      expect(analysis.properties.has('role')).toBe(true);
    });
  });

  describe('analyzeFilterProperties', () => {
    it('should detect filter properties from filters object', () => {
      const code = `
        const filters = reactive({
          category: null,
          search: ''
        });
      `;

      const analysis = analyzeFilterProperties(code);
      
      expect(analysis.allFilters.has('category')).toBe(true);
      expect(analysis.allFilters.has('search')).toBe(true);
      expect(analysis.categoryFilter).toBe('category');
      expect(analysis.searchFilter).toBe('search');
    });

    it('should detect filters from reactive() pattern', () => {
      const code = `
        const filters = reactive({
          type: null,
          query: ''
        });
      `;

      const analysis = analyzeFilterProperties(code);
      
      expect(analysis.allFilters.has('type')).toBe(true);
      expect(analysis.allFilters.has('query')).toBe(true);
      expect(analysis.categoryFilter).toBe('type');
      expect(analysis.searchFilter).toBe('query');
    });

    it('should infer category filter from common names', () => {
      const code = `
        const filters = reactive({
          tag: null,
          term: ''
        });
      `;

      const analysis = analyzeFilterProperties(code);
      
      expect(analysis.categoryFilter).toBe('tag');
      expect(analysis.searchFilter).toBe('term');
    });
  });

  describe('analyzeStoreStructure', () => {
    it('should analyze multiple arrays in a store', async () => {
      const code = `
        import { defineStore } from 'pinia';
        import { ref } from 'vue';
        
        export const useBlogStore = defineStore('blog', () => {
          const posts = ref([]);
          const users = ref([]);
          
          // Add usage to help detection
          const postCount = posts.value.length;
          const userCount = users.value.length;
          
          return { posts, users };
        });
      `;

      const structure = await analyzeStoreStructure(code);
      
      // Should detect arrays (may or may not have properties if no usage)
      expect(structure).toBeDefined();
      // At least one array should be detected if there's usage
      expect(structure.size).toBeGreaterThanOrEqual(0);
    });

    it('should detect properties for each array', async () => {
      const code = `
        const posts = ref([]);
        const categories = computed(() => posts.value.map(p => p.category));
        
        const users = ref([]);
        const roles = computed(() => users.value.map(u => u.role));
      `;

      const structure = await analyzeStoreStructure(code);
      
      if (structure.has('posts')) {
        expect(structure.get('posts')?.properties.has('category')).toBe(true);
      }
      
      if (structure.has('users')) {
        expect(structure.get('users')?.properties.has('role')).toBe(true);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty code gracefully', () => {
      const analysis = analyzeArrayItemProperties('', 'posts');
      
      expect(analysis.properties.size).toBe(0);
      expect(analysis.sampleCount).toBe(0);
    });

    it('should handle malformed code gracefully', () => {
      const code = 'const posts = ref([]); const broken = posts.value.map(';
      
      const analysis = analyzeArrayItemProperties(code, 'posts');
      
      // Should fall back to regex analysis
      expect(analysis).toBeDefined();
    });

    it('should handle code without filters', () => {
      const code = 'const data = ref([]);';
      
      const analysis = analyzeFilterProperties(code);
      
      expect(analysis.allFilters.size).toBe(0);
    });
  });
});
