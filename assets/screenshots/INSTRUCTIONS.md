# Instructions for Creating Real Screenshots

## 🎯 Objective

Create professional visual screenshots of the CLI in action for the README.

## 📋 Checklist

### Screenshots to Create

- [ ] **cli-help.png** - `vue-ai-migrator --help`
- [ ] **cli-analyze.png** - `vue-ai-migrator analyze --classify`
- [ ] **cli-migrate-dry-run.png** - `vue-ai-migrator migrate --dry-run`
- [ ] **cli-diff.png** - `vue-ai-migrator migrate --dry-run --show-diff`
- [ ] **cli-report.png** - `vue-ai-migrator report migration-report.json`
- [ ] **cli-rollback.png** - `vue-ai-migrator rollback`
- [ ] **demo.gif** - Complete animated workflow

## 🛠️ Exact Commands

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

## 📸 Tips for Screenshots

1. **Terminal**: Use a terminal with dark theme
2. **Font**: Monospace, size 14-16px
3. **Dimensions**: 800x600px minimum
4. **Format**: PNG for static, GIF for animated
5. **Quality**: High resolution (2x for Retina)

## 🎬 For the GIF

1. Use Kap (macOS), Peek (Linux), or LICEcap (Windows)
2. Record the complete workflow:
   - Analyze
   - Migrate dry-run
   - View report
3. Duration: 10-15 seconds max
4. Size: < 5MB

## ✅ After Creation

1. Save in `assets/screenshots/`
2. Update README.md with the images
3. Verify that images display correctly
