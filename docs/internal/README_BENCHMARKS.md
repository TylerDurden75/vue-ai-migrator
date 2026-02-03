# Benchmarks and Validation Tests

This document describes how to run performance benchmarks and validation tests for the post-migration fixer (rule engine, single-pass). For the list of rules and their status, see [STABILIZATION_STATUS.md](./STABILIZATION_STATUS.md) and [POST_MIGRATION_FIXER.md](./POST_MIGRATION_FIXER.md).

## Unit Tests

### Run tests

```bash
npm test
```

### Watch mode

```bash
npm run test:watch
```

### Available tests

- **rule-engine.test.ts** : Rule engine tests
  - Rule registration
  - Dependency resolution
  - Execution order by priority
  - Filtering by `shouldApply`

- **parallel-processor.test.ts** : Parallel processor tests
  - Batch processing
  - Error handling
  - Concurrency limit

## Performance Benchmarks

### Run benchmarks

```bash
npm run benchmark
```

### What is measured

Benchmarks compare:
- **Execution time** : Total and average time per file
- **Memory usage** : Heap used, RSS, etc.
- **Number of fixes applied** : To verify both systems produce the same results

### Expected results

With the optimized system, you should see:
- **Time reduction** : 30-50% reduction
- **Memory reduction** : 20-30% reduction
- **Same number of fixes** : Both systems should apply the same corrections

## Validation Tests

### Run validation tests

```bash
npm run validate [path-to-test-project]
```

By default, uses `test-project` at the repo root.

### What is validated

Validation tests verify that:
1. The new system produces valid code (no syntax errors)
2. All fixes are applied correctly
3. No regressions are introduced

### Sample output

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

## Interpreting Results

### Benchmarks

- **Time reduction > 30%** : Excellent, the new system is significantly faster
- **Time reduction 10-30%** : Good, notable improvement
- **Time reduction < 10%** : Worth investigating; the project may be too small to see gains

### Validation

- **100% passed** : The new system is production-ready
- **< 100% passed** : Investigate differences and fix the affected rules

## Next Steps

1. Run benchmarks on projects of various sizes
2. Compare results with the old system
3. Document performance gains
4. Fix any regressions detected by validation tests
