# Optimisations de Performance - Plan d'Action

## 🎯 Objectifs de Performance

- **Réduction des passes** : 3 → 1 (66% réduction)
- **Temps d'exécution** : -50% minimum
- **Mémoire** : Réduction de 30%+

## 📊 Analyse Actuelle

### Problèmes Identifiés

1. **Passes multiples** :
   - Pass 1 : Fixes initiaux
   - Pass 2 : Fixes après migration stores
   - Pass 3 : Nettoyage final
   - Chaque passe re-lit et re-traite les fichiers

2. **Regex non optimisées** :
   - Regex compilées à chaque appel
   - Pas de cache
   - Patterns complexes recompilés

3. **Re-parsing** :
   - Script content extrait plusieurs fois
   - Template content extrait plusieurs fois
   - Pas de cache AST

4. **Traitement séquentiel** :
   - Fichiers traités un par un
   - Pas de parallélisation

## 🚀 Solutions Implémentées

### ✅ 1. Système de Règles Modulaire

**Avant** : 3 passes avec toutes les règles mélangées
**Après** : 1 passe avec règles ordonnées par dépendances

**Gain** : 66% réduction du nombre de passes

### ✅ 2. Cache Regex

**Implémenté** : `regex-cache.ts`
- Compile regex une seule fois
- Réutilise pour tous les fichiers
- Clear cache si nécessaire

**Gain estimé** : 10-15% réduction temps

### 🔄 3. Cache AST (À implémenter)

**Plan** :
- Parser script/template une seule fois
- Stocker dans contexte
- Réutiliser pour toutes les règles

**Gain estimé** : 15-20% réduction temps

### ✅ 4. Traitement Parallèle (Implémenté)

**Implémenté** :
- `parallel-processor.ts` : Processeur parallèle avec batching
- Détection automatique du nombre optimal de workers (CPU count - 1)
- Limite de concurrency configurable (défaut: 5, max: 10)
- Traitement par batches pour éviter surcharge mémoire

**Gain estimé** : 30-40% réduction temps (sur projets avec beaucoup de fichiers)

## 📈 Métriques Cibles

### Temps d'Exécution (test-project)

| Métrique | Avant | Cible | Gain |
|----------|-------|-------|------|
| Passes | 3 | 1 | 66% |
| Temps total | ~15s | ~7s | 53% |
| Regex compilations | ~500 | ~50 | 90% |
| Re-parsing fichiers | 3x | 1x | 66% |

### Mémoire

| Métrique | Avant | Cible | Gain |
|----------|-------|-------|------|
| Peak memory | ~200MB | ~140MB | 30% |
| Regex cache | 0 | ~5MB | - |
| AST cache | 0 | ~10MB | - |

## 🔧 Implémentation

### Phase 1 : Architecture Modulaire ✅
- [x] Créer rule-engine
- [x] Créer types
- [x] Migrer premières règles
- [x] Cache regex

### Phase 2 : Optimisations Core ✅
- [x] Cache AST ✅
- [x] Modifier migrator.ts pour 1 passe ✅
- [ ] Early exit optimizations (optionnel)

### Phase 3 : Parallélisation ✅
- [x] Traitement parallèle fichiers ✅
- [x] Batch processing avec limite de concurrency ✅
- [x] Détection automatique CPU count ✅
- [ ] Worker threads (optionnel - pour très gros projets)

### Phase 4 : Benchmarks ⏳
- [ ] Créer suite de benchmarks
- [ ] Mesurer avant/après
- [ ] Documenter gains

## 📝 Notes Techniques

### Cache AST

```typescript
interface ASTCache {
  scriptAST?: any;
  templateAST?: any;
  lastModified: number;
}

const astCache = new Map<string, ASTCache>();
```

### Traitement Parallèle

```typescript
const BATCH_SIZE = 5;
const files = [...];

for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(file => processFile(file)));
}
```

## 🎯 Prochaines Étapes

1. **Immédiat** : Migrer règles critiques (router, stores)
2. **Court terme** : Implémenter cache AST
3. **Moyen terme** : Parallélisation
4. **Long terme** : Worker threads pour très gros projets
