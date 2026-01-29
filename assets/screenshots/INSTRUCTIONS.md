# Instructions pour Créer les Screenshots Réels

## 🎯 Objectif

Créer des screenshots visuels professionnels du CLI en action pour le README.

## 📋 Checklist

### Screenshots à Créer

- [ ] **cli-help.png** - `vue-ai-migrator --help`
- [ ] **cli-analyze.png** - `vue-ai-migrator analyze --classify`
- [ ] **cli-migrate-dry-run.png** - `vue-ai-migrator migrate --dry-run`
- [ ] **cli-diff.png** - `vue-ai-migrator migrate --dry-run --show-diff`
- [ ] **cli-report.png** - `vue-ai-migrator report migration-report.json`
- [ ] **cli-rollback.png** - `vue-ai-migrator rollback`
- [ ] **demo.gif** - Workflow complet animé

## 🛠️ Commandes Exactes

### 1. Help
```bash
cd vue-ai-migrator
node dist/cli.js --help
```

### 2. Analyze
```bash
cd vue-ai-migrator
node dist/cli.js analyze test-project --classify
```

### 3. Migrate Dry-run
```bash
cd vue-ai-migrator
node dist/cli.js migrate test-project --dry-run --no-ai
```

### 4. Migrate with Diff
```bash
cd vue-ai-migrator
node dist/cli.js migrate test-project --dry-run --show-diff --no-ai
```

### 5. Report
```bash
cd vue-ai-migrator
node dist/cli.js report migration-report.json
```

### 6. Rollback
```bash
cd vue-ai-migrator
node dist/cli.js rollback test-project
```

## 📸 Conseils pour les Screenshots

1. **Terminal**: Utiliser un terminal avec thème sombre
2. **Police**: Monospace, taille 14-16px
3. **Dimensions**: 800x600px minimum
4. **Format**: PNG pour statique, GIF pour animé
5. **Qualité**: Haute résolution (2x pour Retina)

## 🎬 Pour le GIF

1. Utiliser Kap (macOS), Peek (Linux), ou LICEcap (Windows)
2. Enregistrer le workflow complet:
   - Analyze
   - Migrate dry-run
   - View report
3. Durée: 10-15 secondes max
4. Taille: < 5MB

## ✅ Après Création

1. Sauvegarder dans `assets/screenshots/`
2. Mettre à jour README.md avec les images
3. Vérifier que les images s'affichent correctement
