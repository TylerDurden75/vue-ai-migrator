# Performance Optimization - Action Plan

## 🎯 Performance Goals

- **Pass reduction** : 3 → 1 (66% reduction)
- **Execution time** : -50% minimum
- **Memory** : 30%+ reduction

## 📊 Current Analysis

### Identified Issues

1. **Multiple passes** :
   - Pass 1 : Initial fixes
   - Pass 2 : Fixes after store migration
   - Pass 3 : Final cleanup
   - Each pass re-reads and re-processes files

2. **Unoptimized regex** :
   - Regex compiled on every call
   - No cache
   - Complex patterns recompiled

3. **Re-parsing** :
   - Script content extracted multiple times
   - Template content extracted multiple times
   - No AST cache

4. **Sequential processing** :
   - Files processed one by one
   - No parallelization

## 🚀 Implemented Solutions

### ✅ 1. Modular Rule System

**Before** : 3 passes with all rules mixed together  
**After** : 1 pass with rules ordered by dependencies (see [POST_MIGRATION_FIXER.md](./POST_MIGRATION_FIXER.md) and [STABILIZATION_STATUS.md](./STABILIZATION_STATUS.md) for the current list).

**Gain** : 66% reduction in number of passes

### ✅ 2. Regex Cache

**Implemented** : `regex-cache.ts`
- Compiles regex once
- Reuses for all files
- Clear cache when needed

**Estimated gain** : 10-15% time reduction

### 🔄 3. AST Cache (To implement)

**Plan** :
- Parse script/template once
- Store in context
- Reuse for all rules

**Estimated gain** : 15-20% time reduction

### ✅ 4. Parallel Processing (Implemented)

**Implemented** :
- `parallel-processor.ts` : Parallel processor with batching
- Automatic optimal worker count (CPU count - 1)
- Configurable concurrency limit (default: 5, max: 10)
- Batch processing to avoid memory overload

**Estimated gain** : 30-40% time reduction (on projects with many files)

## 📈 Target Metrics

### Execution Time (test-project)

| Metric | Before | Target | Gain |
|--------|--------|--------|------|
| Passes | 3 | 1 | 66% |
| Total time | ~15s | ~7s | 53% |
| Regex compilations | ~500 | ~50 | 90% |
| File re-parsing | 3x | 1x | 66% |

### Memory

| Metric | Before | Target | Gain |
|--------|--------|--------|------|
| Peak memory | ~200MB | ~140MB | 30% |
| Regex cache | 0 | ~5MB | - |
| AST cache | 0 | ~10MB | - |

## 🔧 Implementation

### Phase 1 : Modular Architecture ✅
- [x] Create rule engine
- [x] Create types
- [x] Migrate first rules
- [x] Regex cache

### Phase 2 : Core Optimizations ✅
- [x] AST cache ✅
- [x] Update migrator.ts for 1 pass ✅
- [ ] Early exit optimizations (optional)

### Phase 3 : Parallelization ✅
- [x] Parallel file processing ✅
- [x] Batch processing with concurrency limit ✅
- [x] Automatic CPU count detection ✅
- [ ] Worker threads (optional - for very large projects)

### Phase 4 : Benchmarks ⏳
- [ ] Create benchmark suite
- [ ] Measure before/after
- [ ] Document gains

## 📝 Technical Notes

### AST Cache

```typescript
interface ASTCache {
  scriptAST?: any;
  templateAST?: any;
  lastModified: number;
}

const astCache = new Map<string, ASTCache>();
```

### Parallel Processing

```typescript
const BATCH_SIZE = 5;
const files = [...];

for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(file => processFile(file)));
}
```

## 🎯 Next Steps

1. **Immediate** : Migrate critical rules (router, stores)
2. **Short term** : Implement AST cache
3. **Medium term** : Parallelization
4. **Long term** : Worker threads for very large projects
