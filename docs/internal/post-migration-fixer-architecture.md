# Post-Migration Fixer - Architecture Modulaire

## Statut actuel

- **Fixer unique** : `post-migration-fixer/index.ts` (moteur de règles, une passe, traitement parallèle). Plus de mode legacy.

## Objectif
Réduire les passes multiples et simplifier `post-migration-fixer.ts` (12k+ lignes) en modules séparés.

## Structure proposée

```
post-migration-fixer/
├── index.ts                    # Point d'entrée principal
├── types.ts                    # Types et interfaces
├── rule-engine.ts              # Moteur de règles optimisé
├── rules/
│   ├── vue-script-setup.ts     # Fixes pour <script setup>
│   ├── store-fixes.ts          # Fixes pour stores Pinia
│   ├── router-fixes.ts         # Fixes pour Vue Router
│   ├── template-fixes.ts       # Fixes pour templates
│   ├── import-fixes.ts         # Fixes pour imports
│   ├── type-fixes.ts           # Fixes TypeScript
│   └── formatting-fixes.ts     # Formatage et nettoyage
└── utils/
    ├── store-analyzer.ts       # Analyse des stores
    ├── property-analyzer.ts    # Analyse des propriétés
    └── regex-cache.ts          # Cache pour regex
```

## Principe : Une seule passe optimisée

Au lieu de 3 passes séparées, utiliser un système de règles avec dépendances :
- Règle A → Règle B → Règle C (dans l'ordre)
- Chaque règle vérifie si elle doit s'appliquer
- Pas de re-parsing du fichier entre règles

## Performance

- Cache des regex compilées
- Analyse AST une seule fois
- Traitement parallèle des fichiers indépendants
- Early exit si aucune règle ne s'applique

## Généricité et conventions

Les règles sont conçues pour **fonctionner sur n'importe quel projet Vue 2 migré vers Vue 3**, sans configuration :

- **scriptSetupTagSpaceRule**, **storeDefineStoreClosingRule**, **destructuringKeyValueParamRule**, **splitImportsOnSameLineRule**, **replaceThisRouterRouteRule**, **vueStoreVuexToPiniaRule** : 100 % génériques (syntaxe, pas de chemin ni de nom de store imposé).
- **storeIndexNamedExportRule** : s'applique uniquement aux fichiers `store/index.ts` ou `store/index.js` qui utilisent `defineStore("index", ...)`. Aucun effet si le projet n'a pas de store index.
- **templateFilterFunctionImportsRule** : le chemin d'import des filtres est **détecté** à partir du projet (`src/filters`, `src/utils/filters`, etc.) via `projectRoot`. Si aucun dossier de filtres n'existe, fallback `@/filters`.
- **routerGuardPiniaRule** : suppose que l'état d'auth (ex. `isAuthenticated`) est exposé par le **store racine** (`@/store/index`, `useIndexStore`). C'est le cas le plus courant (Vue 2 avec un seul store ou store racine). Si le projet utilise un store dédié (ex. `useAuthStore` dans `@/store/modules/auth`), un remplacement manuel après passage du fixer suffit.
- **app.mixin** (dans vue2GlobalApiRule) : suppression ou commentaire de `app.mixin(xxx)` lorsque le mixin n'est pas importé (détection par analyse des lignes non commentées).

En résumé : **ça fonctionne tel quel sur tout projet Vue** qui suit les structures habituelles (store index, filtres dans `src/filters` ou `src/utils/filters`, auth dans le store racine). Les cas atypiques restent corrigeables en un remplacement manuel ciblé.
