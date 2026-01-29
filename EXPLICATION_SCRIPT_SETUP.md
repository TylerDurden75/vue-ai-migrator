# Explication : Génération de `<script setup lang="ts">`

## 🎯 Réponse courte

**OUI**, mais cela dépend de la transformation appliquée :

1. **Si vous utilisez `--typescript`** : Le code migré génère automatiquement `<script setup lang="ts">` dans certains cas
2. **Si vous utilisez explicitement `--transformations "script-setup"`** : Génère toujours `<script setup>` (avec `lang="ts"` si `--typescript` est activé)

---

## 📋 Comportement détaillé

### Cas 1 : Migration par défaut (sans spécifier de transformations)

```bash
vue-ai-migrator migrate ./mon-projet --typescript
```

**Ce qui se passe :**

- Toutes les transformations sont appliquées par défaut (incluant `composition-api`)
- Si `composition-api` transforme le code en Composition API (avec `import { ... } from 'vue'` et sans `export default`)
- **Alors** le code est automatiquement converti en `<script setup lang="ts">`

**Code source :**

```vue
<script>
export default {
  data() {
    return { count: 0 };
  },
};
</script>
```

**Résultat avec `--typescript` :**

```vue
<script setup lang="ts">
import { ref } from 'vue';

const count = ref<number>(0);
</script>
```

---

### Cas 2 : Transformation `script-setup` explicite

```bash
vue-ai-migrator migrate ./mon-projet --transformations "script-setup" --typescript
```

**Ce qui se passe :**

- La transformation `script-setup` est appliquée explicitement
- Génère toujours `<script setup>` (avec `lang="ts"` si `--typescript` est activé)

**Résultat :**

```vue
<script setup lang="ts">
import { ref } from 'vue';

const count = ref<number>(0);
</script>
```

---

### Cas 3 : Transformation `composition-api` seule (sans `script-setup`)

```bash
vue-ai-migrator migrate ./mon-projet --transformations "composition-api" --typescript
```

**Ce qui se passe :**

- `composition-api` transforme le code en Composition API
- Si le code transformé contient des imports de 'vue' et n'a pas d'export default
- **Alors** conversion automatique en `<script setup lang="ts">`

**Code source :**

```vue
<script>
export default {
  setup() {
    const count = ref(0);
    return { count };
  },
};
</script>
```

**Résultat :**

```vue
<script setup lang="ts">
import { ref } from 'vue';

const count = ref<number>(0);
</script>
```

---

## 🔍 Code responsable de cette logique

Le code qui gère cette conversion automatique se trouve dans `src/codemods/runner.ts` (lignes 227-245) :

```typescript
// If composition-api transform was applied (without script-setup), check if we should convert to script setup
if (
  !transformationsToApply.includes('script-setup') &&
  transformationsToApply.includes('composition-api')
) {
  // If composition-api transform was applied, check if we should convert to script setup
  // Check if the transformed script is Composition API code (has imports from 'vue')
  if (
    transformedScript.includes('import {') &&
    transformedScript.includes("from 'vue'") &&
    !transformedScript.includes('export default')
  ) {
    // Convert to <script setup lang="ts">
    vueParts.script.setup = true;
    if (options.enableTypeScript) {
      vueParts.script.lang = 'ts';
    }
  }
}
```

Et aussi pour la transformation `script-setup` explicite (lignes 209-213) :

```typescript
if (transformationsToApply.includes('script-setup')) {
  vueParts.script.setup = true;
  if (options.enableTypeScript) {
    vueParts.script.lang = 'ts';
  }
  // ...
}
```

---

## ✅ Résumé

| Commande                                                          | Transformation appliquée | Résultat                                               |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| `migrate --typescript`                                            | Toutes (par défaut)      | `<script setup lang="ts">` si Composition API détectée |
| `migrate --transformations "script-setup" --typescript`           | `script-setup`           | `<script setup lang="ts">` toujours                    |
| `migrate --transformations "composition-api" --typescript`        | `composition-api`        | `<script setup lang="ts">` si Composition API détectée |
| `migrate --transformations "composition-api"` (sans --typescript) | `composition-api`        | `<script setup>` (sans `lang="ts"`)                    |

---

## 💡 Recommandation

Pour être **explicite** et garantir le résultat souhaité :

```bash
# Pour générer <script setup lang="ts">
vue-ai-migrator migrate ./mon-projet --transformations "script-setup" --typescript
```

Ou simplement :

```bash
# Génère automatiquement <script setup lang="ts"> si Composition API détectée
vue-ai-migrator migrate ./mon-projet --typescript
```

---

## 🐛 Si ça ne fonctionne pas comme attendu

1. **Vérifiez que le code source est bien transformé en Composition API**
   - Le code doit contenir `import { ... } from 'vue'`
   - Le code ne doit pas contenir `export default`

2. **Vérifiez que `--typescript` est bien activé**
   - Utilisez `--typescript` dans la commande
   - Ou vérifiez dans le rapport de migration

3. **Vérifiez les transformations appliquées**
   - Le rapport de migration indique quelles transformations ont été appliquées
   - Si `script-setup` n'est pas dans la liste, la conversion automatique peut ne pas se faire
