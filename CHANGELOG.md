# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-03-04

### Features

- Add typed HumanDuration and Delay types for delay
  parameters([753ada8](https://github.com/eyolas/conveyor/commit/753ada86b392c0f66e3a28096d908c7e5d8342a0))

### Bug Fixes

- Harden store implementations against race conditions and edge cases
  (#11)([1635a5b](https://github.com/eyolas/conveyor/commit/1635a5b0f493938b91472cb4ad668e8e197bfbac))
- **ci**: Format generated changelog with deno fmt before
  commit([cc01af5](https://github.com/eyolas/conveyor/commit/cc01af58dcb10ff4f01f6c02bf5e510fb165ce18))

### Refactoring

- Replace inline type imports with proper import in
  utils.ts([1f733ca](https://github.com/eyolas/conveyor/commit/1f733ca91212cfb3696b12579344a37908d1a218))

### Documentation

- Translate PRD to English and mark all phases 1-3 as
  complete([618592a](https://github.com/eyolas/conveyor/commit/618592a3ba9c34dacddd260b41002492c959ed83))
- Rewrite CHANGELOG.md for v0.1.0 initial
  release([7ff447d](https://github.com/eyolas/conveyor/commit/7ff447d6d85a615f79beb99009a50430cd4c5e8c))
- Update CHANGELOG.md for
  v0.1.0([258fcf4](https://github.com/eyolas/conveyor/commit/258fcf46f6001cb5bb01d906af4bee9ce1baf0a4))

### Testing

- Add job data round-trip conformance
  tests([f37936d](https://github.com/eyolas/conveyor/commit/f37936d6d164b78a17c85cc8dc304463e4667411))

## [0.1.0] - 2026-03-03

### Bug Fixes

- **ci**: Add --allow-dirty to deno publish for lock file changes
  (#9)([18d5af1](https://github.com/eyolas/conveyor/commit/18d5af1e8e7670a2ebf61e3a247fec056a769496))

### Refactoring

- Rename @conveyor/store-sqlite to @conveyor/store-sqlite-node
  (#10)([e926714](https://github.com/eyolas/conveyor/commit/e92671440bc3719000fb9c3756d6ab5d5f0e479c))
