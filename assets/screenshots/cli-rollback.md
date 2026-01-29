# CLI Screenshot - Rollback Command

## Command: `vue-ai-migrator rollback`

```
$ vue-ai-migrator rollback ./test-project

✔ Loading backups...
✔ Found 2 backup(s)
✔ Rolling back all files...

✓ Rollback results:
  - Files restored: 2
  - Failed: 0

✔ Rollback completed!
```

## Command: `vue-ai-migrator rollback --file`

```
$ vue-ai-migrator rollback ./test-project --file src/components/HelloWorld.vue

✔ Loading backups...
✔ Found 2 backup(s)
✔ Rolling back src/components/HelloWorld.vue...

✔ Successfully rolled back src/components/HelloWorld.vue
```
