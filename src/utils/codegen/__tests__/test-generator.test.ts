/**
 * Unit tests for TestGenerator - vérifie que la génération est générique
 * (Pinia, Router détectés et injectés automatiquement)
 */
import { TestGenerator } from '../test-generator';

describe('TestGenerator', () => {
  const gen = new TestGenerator();

  it('génère createPinia + router pour un composant qui utilise les deux', async () => {
    const componentCode = `
<template>
  <div><router-link to="/">Home</router-link></div>
</template>
<script setup>
import { useIndexStore } from "@/store/index";
const store = useIndexStore();
</script>`;
    const result = await gen.generateTest('src/App.vue', componentCode, {
      componentName: 'App',
    });
    expect(result.content).toContain("import { createPinia } from 'pinia'");
    expect(result.content).toContain(
      "import { createRouter, createMemoryHistory } from 'vue-router'"
    );
    expect(result.content).toContain(
      'global: { plugins: [createPinia(), router] }'
    );
    expect(result.content).toContain('await router.isReady()');
  });

  it('génère uniquement createPinia pour un composant sans Router', async () => {
    const componentCode = `
<template><div>Hello</div></template>
<script setup>
import { useAppStore } from "@/store/modules/app";
const store = useAppStore();
</script>`;
    const result = await gen.generateTest('src/views/Home.vue', componentCode, {
      componentName: 'Home',
    });
    expect(result.content).toContain("import { createPinia } from 'pinia'");
    expect(result.content).not.toContain('createRouter');
    expect(result.content).toContain('global: { plugins: [createPinia()] }');
  });

  it('génère router pour un composant avec router-link dans le template', async () => {
    const componentCode = `
<template>
  <router-view />
</template>
<script setup>
// pas de Pinia
</script>`;
    const result = await gen.generateTest('src/App.vue', componentCode, {
      componentName: 'App',
    });
    expect(result.content).toContain('createRouter');
    expect(result.content).toContain('plugins: [router]');
  });

  it('détecte Pinia via import from @/store', async () => {
    const componentCode = `
<template><div></div></template>
<script setup>
import { useUserStore } from "@/store/modules/user";
const store = useUserStore();
</script>`;
    const result = await gen.generateTest('src/views/Users.vue', componentCode, {
      componentName: 'Users',
    });
    expect(result.content).toContain('createPinia()');
  });

  it('ne génère pas de plugins pour un composant sans Pinia ni Router', async () => {
    const componentCode = `
<template><button>Click</button></template>
<script setup>
const emit = defineEmits(['click']);
</script>`;
    const result = await gen.generateTest(
      'src/components/Button.vue',
      componentCode,
      { componentName: 'Button' }
    );
    expect(result.content).not.toContain('createPinia');
    expect(result.content).not.toContain('createRouter');
    expect(result.content).toContain('mount(Button)');
  });
});
