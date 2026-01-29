# Guide Simple - vue-ai-migrator

## 🤔 Qu'est-ce que c'est ?

**vue-ai-migrator** est un outil qui transforme automatiquement votre code Vue 2 en code Vue 3.

### Vue 2 vs Vue 3 - Explication simple

Imaginez que vous avez une voiture (Vue 2) et que vous voulez la transformer en voiture électrique moderne (Vue 3). Le problème, c'est que :

- Certaines pièces ne sont plus compatibles
- La façon de conduire a changé
- Il faut adapter beaucoup de choses manuellement

**vue-ai-migrator** fait ce travail automatiquement pour vous ! 🚗➡️🚗⚡

---

## 🎯 À quoi ça sert concrètement ?

### Exemple concret

**AVANT (Vue 2)** - Votre code actuel :

```vue
<script>
export default {
  data() {
    return {
      message: 'Bonjour',
    };
  },
  methods: {
    direBonjour() {
      alert(this.message);
    },
  },
};
</script>
```

**APRÈS (Vue 3)** - Ce que l'outil génère automatiquement :

```vue
<script setup>
import { ref } from 'vue';

const message = ref('Bonjour');

const direBonjour = () => {
  alert(message.value);
};
</script>
```

L'outil a transformé votre code pour qu'il fonctionne avec Vue 3, **sans que vous ayez à tout réécrire manuellement** !

> 💡 **Note** :
>
> - **Sans `--typescript`** : Génère `<script setup>` (syntaxe moderne Vue 3)
> - **Avec `--typescript`** : Génère `<script setup lang="ts">` avec types TypeScript (`ref<string>()`)

---

## 📦 Installation

### Étape 1 : Installer Node.js

Si vous n'avez pas Node.js installé :

1. Allez sur [nodejs.org](https://nodejs.org/)
2. Téléchargez la version "LTS" (recommandée)
3. Installez-le en suivant les instructions

### Étape 2 : Installer vue-ai-migrator

Ouvrez un terminal (ou invite de commande) et tapez :

```bash
npm install -g vue-ai-migrator
```

Cela installe l'outil sur votre ordinateur pour que vous puissiez l'utiliser partout.

---

## 🚀 Utilisation - Guide pas à pas

### Cas d'usage 1 : Migrer un projet complet

Vous avez un dossier avec tous vos fichiers Vue 2 et vous voulez tout migrer :

```bash
vue-ai-migrator migrate ./mon-projet
```

**Ce que ça fait :**

- ✅ Scanne tous les fichiers `.vue`, `.js`, `.ts` dans votre projet
- ✅ Transforme automatiquement le code Vue 2 en Vue 3
- ✅ Crée une sauvegarde de vos fichiers originaux (au cas où)
- ✅ Vous montre un rapport de ce qui a été changé

**Exemple :**

```bash
# Vous êtes dans le dossier de votre projet
cd /chemin/vers/mon-projet

# Lancez la migration
vue-ai-migrator migrate .

# Résultat :
# ✅ 15 fichiers transformés
# ✅ 3 fichiers nécessitent une vérification manuelle
# ✅ Sauvegarde créée dans ./backup/
```

---

### Cas d'usage 2 : Tester avant de migrer (Mode "dry-run")

Vous voulez voir ce qui va changer **sans modifier vos fichiers** :

```bash
vue-ai-migrator migrate ./mon-projet --dry-run
```

**Ce que ça fait :**

- ✅ Analyse votre code
- ✅ Vous montre ce qui serait changé
- ✅ **NE MODIFIE RIEN** (mode test)

C'est comme essayer des vêtements avant de les acheter ! 👔

---

### Cas d'usage 3 : Migrer seulement certains fichiers

Vous voulez migrer seulement un dossier spécifique :

```bash
vue-ai-migrator migrate ./src/components
```

**Ce que ça fait :**

- ✅ Migre uniquement les fichiers dans `./src/components`
- ✅ Laisse le reste de votre projet intact

---

### Cas d'usage 4 : Migrer avec l'aide de l'IA

Pour les cas complexes, l'outil peut utiliser l'IA pour mieux comprendre votre code :

```bash
vue-ai-migrator migrate ./mon-projet --ai-api-key VOTRE_CLE_API
```

**Ce que ça fait :**

- ✅ Utilise l'IA pour les transformations complexes
- ✅ Génère du code plus intelligent
- ✅ Explique pourquoi certains changements ont été faits

**Note :** Vous devez avoir une clé API (OpenAI, Mistral, Claude, etc.)

---

## 🎨 Exemples de transformations automatiques

### Transformation 1 : Les données (data)

**Vue 2 :**

```vue
<script>
export default {
  data() {
    return {
      count: 0,
      name: 'Jean',
    };
  },
};
</script>
```

**Vue 3 (automatique) :**

```vue
<script setup>
import { ref } from 'vue';

const count = ref(0);
const name = ref('Jean');
</script>
```

> 💡 **Avec `--typescript`** : `<script setup lang="ts">` avec `ref<number>(0)` et `ref<string>('Jean')`

---

### Transformation 2 : Les méthodes

**Vue 2 :**

```vue
<script>
export default {
  data() {
    return { count: 0 };
  },
  methods: {
    increment() {
      this.count++;
    },
  },
};
</script>
```

**Vue 3 (automatique) :**

```vue
<script setup>
import { ref } from 'vue';

const count = ref(0);

const increment = () => {
  count.value++;
};
</script>
```

> 💡 **Avec `--typescript`** : `<script setup lang="ts">` avec `ref<number>(0)` et types TypeScript

---

### Transformation 3 : Les templates (HTML)

**Vue 2 :**

```vue
<template>
  <template slot-scope="props">
    {{ props.data }}
  </template>
</template>
```

**Vue 3 (automatique) :**

```vue
<template>
  <template v-slot="props">
    {{ props.data }}
  </template>
</template>
```

---

## 📋 Options utiles

### Voir les différences en détail

```bash
vue-ai-migrator migrate ./mon-projet --show-diff
```

Affiche exactement ce qui a changé dans chaque fichier.

---

### Générer des tests automatiquement

```bash
vue-ai-migrator migrate ./mon-projet --generate-tests
```

Crée automatiquement des tests pour vérifier que tout fonctionne.

---

### Migrer sans utiliser l'IA

```bash
vue-ai-migrator migrate ./mon-projet --no-ai
```

Utilise uniquement les transformations automatiques (plus rapide, gratuit).

---

### Migrer avec TypeScript

```bash
vue-ai-migrator migrate ./mon-projet --typescript
```

Ajoute automatiquement les types TypeScript au code migré.

**Exemple de résultat :**

- **Sans `--typescript`** : `<script setup>` avec `const count = ref(0)`
- **Avec `--typescript`** : `<script setup lang="ts">` avec `const count = ref<number>(0)`

---

## ⚠️ Important : Sauvegarde automatique

**L'outil crée automatiquement une sauvegarde** de vos fichiers originaux avant de les modifier.

Si quelque chose ne va pas, vous pouvez toujours revenir en arrière !

---

## 🔄 Annuler une migration (Rollback)

Si vous voulez annuler les changements :

```bash
vue-ai-migrator rollback ./mon-projet
```

Cela restaure vos fichiers originaux depuis la sauvegarde.

---

## 📊 Comprendre le rapport de migration

Après la migration, vous verrez quelque chose comme :

```
✅ Migration terminée !

📊 Statistiques :
   - 25 fichiers analysés
   - 20 fichiers transformés automatiquement
   - 3 fichiers nécessitent une vérification manuelle
   - 2 fichiers non modifiés (déjà en Vue 3)

⚠️ Fichiers à vérifier :
   - src/components/ComplexComponent.vue (cas complexe)
   - src/store/oldStore.js (nécessite migration manuelle)

💾 Sauvegarde créée : ./backup/2024-01-29_14-30-00/
```

---

## 🆘 Problèmes courants et solutions

### Problème 1 : "Command not found"

**Solution :** L'outil n'est pas installé globalement. Réessayez :

```bash
npm install -g vue-ai-migrator
```

---

### Problème 2 : "Permission denied"

**Solution :** Sur Mac/Linux, utilisez `sudo` :

```bash
sudo npm install -g vue-ai-migrator
```

---

### Problème 3 : "No files found"

**Solution :** Vérifiez que vous êtes dans le bon dossier et qu'il contient des fichiers `.vue` ou `.js`.

---

### Problème 4 : Le code ne fonctionne pas après migration

**Solution :**

1. Vérifiez le rapport de migration
2. Regardez les fichiers marqués "nécessitent vérification"
3. Utilisez `--dry-run` pour voir ce qui va changer avant
4. Consultez la documentation Vue 3 pour les cas complexes

---

## 💡 Conseils pour bien utiliser l'outil

### ✅ À FAIRE

1. **Toujours tester d'abord** avec `--dry-run`
2. **Faire une sauvegarde manuelle** avant (même si l'outil en fait une)
3. **Migrer petit à petit** : commencez par un dossier, testez, puis continuez
4. **Lire le rapport** : il vous dit exactement ce qui a changé
5. **Tester votre application** après la migration

### ❌ À NE PAS FAIRE

1. **Ne pas migrer directement en production** : testez d'abord !
2. **Ne pas ignorer les warnings** : ils indiquent des choses importantes
3. **Ne pas supprimer les sauvegardes** trop vite
4. **Ne pas migrer sans comprendre** : lisez au moins le rapport

---

## 🎓 Ressources pour apprendre

Si vous voulez comprendre ce que fait l'outil :

- **Documentation Vue 3** : [v3.vuejs.org](https://v3.vuejs.org/)
- **Guide de migration officiel** : [v3-migration.vuejs.org](https://v3-migration.vuejs.org/)
- **Tutoriels Vue 3** : Recherchez "Vue 3 tutorial" sur YouTube

---

## 📞 Besoin d'aide ?

Si vous rencontrez un problème :

1. Vérifiez ce guide
2. Regardez les messages d'erreur (ils sont souvent explicites)
3. Consultez la documentation complète dans `README.md`
4. Ouvrez une issue sur GitHub si c'est un bug

---

## 🎉 Résumé en 3 étapes

1. **Installez** : `npm install -g vue-ai-migrator`
2. **Testez** : `vue-ai-migrator migrate ./mon-projet --dry-run`
3. **Migrez** : `vue-ai-migrator migrate ./mon-projet`

C'est aussi simple que ça ! 🚀

---

## 📝 Exemple complet de workflow

```bash
# 1. Aller dans votre projet
cd /chemin/vers/mon-projet-vue2

# 2. Voir ce qui va changer (sans modifier)
vue-ai-migrator migrate . --dry-run --show-diff

# 3. Si ça vous convient, migrer pour de vrai
vue-ai-migrator migrate . --typescript

# 4. Tester votre application
npm run dev

# 5. Si tout fonctionne, c'est bon ! Sinon, rollback
vue-ai-migrator rollback .
```

---

**Bon courage avec votre migration ! 💪**
