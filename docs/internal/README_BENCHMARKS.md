# Benchmarks et Tests de Validation

Ce document décrit comment exécuter les benchmarks de performance et les tests de validation du post-migration fixer (moteur de règles, single-pass).

## Tests Unitaires

### Exécuter les tests

```bash
npm test
```

### Tests en mode watch

```bash
npm run test:watch
```

### Tests disponibles

- **rule-engine.test.ts** : Tests pour le moteur de règles
  - Enregistrement de règles
  - Résolution de dépendances
  - Ordre d'exécution par priorité
  - Filtrage par `shouldApply`

- **parallel-processor.test.ts** : Tests pour le processeur parallèle
  - Traitement par batches
  - Gestion des erreurs
  - Respect de la limite de concurrency

## Benchmarks de Performance

### Exécuter les benchmarks

```bash
npm run benchmark
```

### Ce qui est mesuré

Les benchmarks comparent :
- **Temps d'exécution** : Temps total et moyen par fichier
- **Utilisation mémoire** : Heap utilisé, RSS, etc.
- **Nombre de fixes appliqués** : Pour vérifier que les deux systèmes produisent les mêmes résultats

### Résultats attendus

Avec le nouveau système optimisé, vous devriez voir :
- **Réduction du temps** : 30-50% de réduction
- **Réduction de la mémoire** : 20-30% de réduction
- **Même nombre de fixes** : Les deux systèmes doivent appliquer les mêmes corrections

## Tests de Validation

### Exécuter les tests de validation

```bash
npm run validate [path-to-test-project]
```

Par défaut, utilise `test-project` à la racine.

### Ce qui est validé

Les tests de validation vérifient que :
1. Le nouveau système produit un code valide (pas d'erreurs de syntaxe)
2. Tous les fixes sont appliqués correctement
3. Aucune régression n'est introduite

### Exemple de sortie

```
🔍 Running Validation Tests...

Test project: /path/to/test-project

✅ Passed: 15
❌ Failed: 0
📊 Total: 15

📊 Validation Summary:
============================================================
Total files tested: 15
Passed: 15 (100.0%)
Failed: 0 (0.0%)

✅ All validation tests passed!
```

## Interprétation des Résultats

### Benchmarks

- **Time reduction > 30%** : Excellent, le nouveau système est significativement plus rapide
- **Time reduction 10-30%** : Bon, amélioration notable
- **Time reduction < 10%** : À investiguer, peut-être que le projet est trop petit pour voir les gains

### Validation

- **100% passed** : Le nouveau système est prêt pour la production
- **< 100% passed** : Investiguer les différences et corriger les règles concernées

## Prochaines Étapes

1. Exécuter les benchmarks sur différents projets de tailles variées
2. Comparer les résultats avec l'ancien système
3. Documenter les gains de performance
4. Corriger les éventuelles régressions détectées par les tests de validation
