A case to demonstrate weird behaviour with module resolution.

# Workspace setup

- `packages/tests` contains a unit test that imports `library/foo`
- `packages/tests/setup-jest.ts` without this file the situation does not replicate
- `packages/library` has the following setup:
  - `package.json` has `main`, `module`, and `types` that should not be used (and aren't used)
  - `package.json` has a `exports` with `./foo` that contain conditional exports for types, cjs and esm
    in an ideal world these should always be used (but sometimes they are not)
  - `foo/package.json` exists to demonstrate commonjs module resolution is sometimes used. It contains
    `main`, `module` and `types` but only `types` is sometimes used, never `main` or `module`.

# Intended behaviour

- `packages/tests/strict.test.ts` imports from `library/foo`
- with modern module resolution this should use the `./foo` `exports` in `packages/library/package.json` and
  resolve to `packages/library/dist/root-entrypoint-types.d.ts` for the types and `packages/library/dist/root-entrypoint-cjs.js` or 
  `packages/library/dist/root-entrypoint-esm.js` for the runtime code

# Observed behaviour

Start by creating the workspace:
```shell
git clone https://github.com/wvanderdeijl/ts-jest-repro.git
cd ts-jest-repro/packages/tests
# Includes a postinstall script to copy the library to `packages/tests/node_modules`
# I did not want to use something like `npm link` to prevent having symlinks which might interfere with the behaviour
npm i
```

Clean the jest cache and run the tests:
```shell
npx jest --clear-cache
npx jest
```

> ```
> npx jest
>   console.log
>     setup-jest.ts is running!
> 
>       at Object.<anonymous> (setup-jest.ts:5:9)
> 
>  FAIL  ./strict.test.ts
>   ● Test suite failed to run
> 
>     strict.test.ts:3:7 - error TS2322: Type '"nested-types"' is not assignable to type '"root-entrypoint-types"'.
> 
>     3 const local: 'root-entrypoint-types' = thing;
>             ~~~~~
> 
> Test Suites: 1 failed, 1 total
> Tests:       0 total
> Snapshots:   0 total
> Time:        0.626 s
> Ran all test suite
> ```

Now run the same tests again:
```shell
npx jest
```

The tests now succeed:

> ```
> npx jest
>   console.log
>     setup-jest.ts is running!
> 
>       at Object.<anonymous> (setup-jest.ts:5:9)
> 
>  PASS  ./strict.test.ts
>   ✓ thing
> 
> Test Suites: 1 passed, 1 total
> Tests:       1 passed, 1 total
> Snapshots:   0 total
> Time:        0.592 s
> Ran all test suites.
> ```

# Workarounds

- When not having `setupFilesAfterEnv`, the tests succeed the first and second time after a `--clear-cache`
- Removing the override of `moduleResolution` in `fixupCompilerOptionsForModuleKind` in 
  `packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js` also fixes the issue

# Analysis

After lots of debugging and looking at stack traces I think this is what is happening:

## First `npx jest` after `npx jest --clear-cache`

- jest reads the `setup-jest.ts` and asks ts-jest to transform it. This gets us to `TsCompiler.getCompiledOutput` which invokes
  `TsCompiler.fixupCompilerOptionsForModuleKind` that sets the `moduleResolution` for the typescript compiler to `node10`, whereas
  it was `bundler` until now (from the `tsconfig.json`)
- `setup-test.ts` executes
- jest now uses a different code path to get to the `strict.test.ts` module (because of `TsJestCompiler.getResolvedModules`). But the 
  typescript compiler has been setup for `node10` `moduleResolution` so it resolves the types through file system traversal to 
  `packages/library/foo/package.json` and then to the (wrong) types at `packages/library/dist/nested-types.d.ts`
    > ```
    > Error: _resolveModuleName library/foo stack
    >     at TsCompiler._resolveModuleName (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:401:25)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:386:45
    >     at Array.map (<anonymous>)
    >     at TsCompiler._getImportedModulePaths (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.    > js:385:28)
    >     at TsCompiler.getResolvedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:115:61)
    >     at TsJestCompiler.getResolvedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-jest-compiler.    > js:12:39)
    >     at TsJestTransformer.getCacheKey (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:304:54)
    >     at ScriptTransformer._getCacheKey (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:228:41)
    >     at ScriptTransformer._getFileCachePath (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.    > js:289:27)
    >     at ScriptTransformer.transformSource (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.    > js:525:32)
    >     at ScriptTransformer._transformAndBuildScript (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/    > ScriptTransformer.js:674:40)
    >     at ScriptTransformer.transform (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:726:19)
    >     at Runtime.transformFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1465:53)
    >     at Runtime._execModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1397:34)
    >     at Runtime._loadModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1022:12)
    >     at Runtime.requireModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:882:12)
    >     at jestAdapter (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:77:13)
    >     at processTicksAndRejections (node:internal/process/task_queues:105:5)
    >     at runTestInternal (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:367:16)
    >     at runTest (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:444:34)
    > ```
- a bit further along, jest wants to transpile `strict.test.ts` which again ends up in `TsCompiler.getCompiledOutput` which invokes
  `TsCompiler.fixupCompilerOptionsForModuleKind` again.
- we again end up in a callstack to resolve the `library/foo` module as part of the compilation:
    > ```
    > Error: _resolveModuleName library/foo stack
    >     at TsCompiler._resolveModuleName (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:401:25)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:360:103
    >     at Array.map (<anonymous>)
    >     at Object.resolveModuleNames (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:360:78)
    >     at actualResolveModuleNamesWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125584:142)
    >     at resolveModuleNamesWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126028:20)
    >     at resolveNamesReusingOldState (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126170:14)
    >     at resolveModuleNamesReusingOldState (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126126:12)
    >     at processImportedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127613:118)
    >     at findSourceFileWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127388:7)
    >     at findSourceFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127239:20)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127188:22
    >     at getSourceFileFromReferenceWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127159:26)
    >     at processSourceFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127186:5)
    >     at processRootFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127017:5)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125712:41
    >     at forEach (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:2298:22)
    >     at createProgram (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125712:5)
    >     at synchronizeHostDataWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151479:15)
    >     at synchronizeHostData (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151374:7)
    >     at Object.getEmitOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151943:5)
    >     at TsCompiler.getCompiledOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:186:50)
    >     at TsJestCompiler.getCompiledOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-jest-compiler.js:15:39)
    >     at TsJestTransformer.processWithTs (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:228:41)
    >     at TsJestTransformer.process (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:140:24)
    >     at ScriptTransformer.transformSource (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:545:31)
    >     at ScriptTransformer._transformAndBuildScript (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
    >     at ScriptTransformer.transform (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:726:19)
    >     at Runtime.transformFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1465:53)
    >     at Runtime._execModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1397:34)
    >     at Runtime._loadModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1022:12)
    >     at Runtime.requireModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:882:12)
    >     at jestAdapter (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:77:13)
    >     at processTicksAndRejections (node:internal/process/task_queues:105:5)
    >     at runTestInternal (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:367:16)
    >     at runTest (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:444:34)
    > ```
- the test fails with a typescript compilation error since we are using the wrong types

## Second `npx jest` run

- the `setup-jest.ts` file now comes from cache, so we don't end up in the steps to compile it using `TsCompiler.getCompiledOutput` which 
  would invoke `TsCompiler.fixupCompilerOptionsForModuleKind`. So this means our typescript compiler is still setup from `tsconfig.json`
  with `moduleResolution` set to `bundler`
- we get the same initial call stack that resolves the `library/foo` module **BEFORE** there is any compilation (because of 
  `TsJestCompiler.getResolvedModules`). So this, time `TsCompiler._resolveModuleName` still uses the initial typescript compiler with 
  `bundler` resolver and finds the correct types at `packages/library/dist/root-entrypoint-types.d.ts`
    > ```
    > Error: _resolveModuleName library/foo stack
    >     at TsCompiler._resolveModuleName (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:401:25)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:386:45
    >     at Array.map (<anonymous>)
    >     at TsCompiler._getImportedModulePaths (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:385:28)
    >     at TsCompiler.getResolvedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:115:61)
    >     at TsJestCompiler.getResolvedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-jest-compiler.js:12:39)
    >     at TsJestTransformer.getCacheKey (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:304:54)
    >     at ScriptTransformer._getCacheKey (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:228:41)
    >     at ScriptTransformer._getFileCachePath (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:289:27)
    >     at ScriptTransformer.transformSource (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:525:32)
    >     at ScriptTransformer._transformAndBuildScript (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
    >     at ScriptTransformer.transform (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:726:19)
    >     at Runtime.transformFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1465:53)
    >     at Runtime._execModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1397:34)
    >     at Runtime._loadModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1022:12)
    >     at Runtime.requireModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:882:12)
    >     at jestAdapter (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:77:13)
    >     at runTestInternal (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:367:16)
    >     at runTest (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:444:34)
    > ```
- this resolution is probably cached
- a bit further along, jest wants to transpile some typescript which again ends up in `TsCompiler.getCompiledOutput` which invokes
  `TsCompiler.fixupCompilerOptionsForModuleKind` but this is "too late".
    > ```
    > Error: fixupCompilerOptionsForModuleKind stack
    >     at TsCompiler.fixupCompilerOptionsForModuleKind (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:129:21)
    >     at TsCompiler.getCompiledOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:171:38)
    >     at TsJestCompiler.getCompiledOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-jest-compiler.js:15:39)
    >     at TsJestTransformer.processWithTs (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:228:41)
    >     at TsJestTransformer.process (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:140:24)
    >     at ScriptTransformer.transformSource (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:545:31)
    >     at ScriptTransformer._transformAndBuildScript (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
    >     at ScriptTransformer.transform (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:726:19)
    >     at Runtime.transformFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1465:53)
    >     at Runtime._execModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1397:34)
    >     at Runtime._loadModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1022:12)
    >     at Runtime.requireModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:882:12)
    >     at jestAdapter (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:77:13)
    >     at runTestInternal (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:367:16)
    >     at runTest (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:444:34)
    > ```
- we seen another attempt to resolve `library/foo` when the test executes. This returns the cached resolved module 
  `packages/library/dist/root-entrypoint-types.d.ts` which was determined **BEFORE** invoking `TsCompiler.fixupCompilerOptionsForModuleKind`
    > ```
    > Error: _resolveModuleName library/foo stack
    >     at TsCompiler._resolveModuleName (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:401:25)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:360:103
    >     at Array.map (<anonymous>)
    >     at Object.resolveModuleNames (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:360:78)
    >     at actualResolveModuleNamesWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125584:142)
    >     at resolveModuleNamesWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126028:20)
    >     at resolveNamesReusingOldState (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126170:14)
    >     at resolveModuleNamesReusingOldState (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126126:12)
    >     at processImportedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127613:118)
    >     at findSourceFileWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127388:7)
    >     at findSourceFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127239:20)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127188:22
    >     at getSourceFileFromReferenceWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127159:26)
    >     at processSourceFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127186:5)
    >     at processRootFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127017:5)
    >     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125712:41
    >     at forEach (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:2298:22)
    >     at createProgram (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125712:5)
    >     at synchronizeHostDataWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151479:15)
    >     at synchronizeHostData (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151374:7)
    >     at Object.getEmitOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151943:5)
    >     at TsCompiler.getCompiledOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:186:50)
    >     at TsJestCompiler.getCompiledOutput (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-jest-compiler.js:15:39)
    >     at TsJestTransformer.processWithTs (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:228:41)
    >     at TsJestTransformer.process (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:140:24)
    >     at ScriptTransformer.transformSource (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:545:31)
    >     at ScriptTransformer._transformAndBuildScript (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
    >     at ScriptTransformer.transform (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:726:19)
    >     at Runtime.transformFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1465:53)
    >     at Runtime._execModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1397:34)
    >     at Runtime._loadModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1022:12)
    >     at Runtime.requireModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:882:12)
    >     at jestAdapter (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:77:13)
    >     at runTestInternal (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:367:16)
    >     at runTest (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:444:34)  
    > ```

## having `import "library/foo";` in `setup-jest.ts`

When having  `import "library/foo";` in `setup-jest.ts` the very first run of `npx jest` after `npx jest --clear-cache` succeeds and
uses the `bundler` `moduleResolution`. We can see the callstack how it got to the point to resolve `library/foo` before 
`TsCompiler.fixupCompilerOptionsForModuleKind` was invoked:
> ```
> Error: _resolveModuleName library/foo stack
>     at TsCompiler._resolveModuleName (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:401:25)
>     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:360:103
>     at Array.map (<anonymous>)
>     at Object.resolveModuleNames (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:360:78)
>     at actualResolveModuleNamesWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125584:142)
>     at resolveModuleNamesWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126028:20)
>     at resolveNamesReusingOldState (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126170:14)
>     at resolveModuleNamesReusingOldState (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:126126:12)
>     at processImportedModules (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127613:118)
>     at findSourceFileWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127388:7)
>     at findSourceFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127239:20)
>     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127188:22
>     at getSourceFileFromReferenceWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127159:26)
>     at processSourceFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127186:5)
>     at processRootFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:127017:5)
>     at /Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125712:41
>     at forEach (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:2298:22)
>     at createProgram (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:125712:5)
>     at synchronizeHostDataWorker (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151479:15)
>     at synchronizeHostData (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151374:7)
>     at Object.getProgram (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/typescript/lib/typescript.js:151556:5)
>     at TsCompiler._createLanguageService (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:364:46)
>     at new TsCompiler (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-compiler.js:106:18)
>     at new TsJestCompiler (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/compiler/ts-jest-compiler.js:9:34)
>     at TsJestTransformer._createCompiler (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:130:26)
>     at TsJestTransformer._configsFor (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:112:22)
>     at TsJestTransformer.getCacheKey (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/ts-jest/dist/legacy/ts-jest-transformer.js:275:30)
>     at ScriptTransformer._getCacheKey (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:228:41)
>     at ScriptTransformer._getFileCachePath (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:289:27)
>     at ScriptTransformer.transformSource (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:525:32)
>     at ScriptTransformer._transformAndBuildScript (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
>     at ScriptTransformer.transform (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/@jest/transform/build/ScriptTransformer.js:726:19)
>     at Runtime.transformFile (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1465:53)
>     at Runtime._execModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1397:34)
>     at Runtime._loadModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:1022:12)
>     at Runtime.requireModule (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runtime/build/index.js:882:12)
>     at jestAdapter (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:70:15)
>     at processTicksAndRejections (node:internal/process/task_queues:105:5)
>     at runTestInternal (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:367:16)
>     at runTest (/Users/xxx/git/oss/ts-jest-repro/packages/tests/node_modules/jest-runner/build/runTest.js:444:34)
> ```

## Conclusion

There is one (or more) code paths the resolve modules before `TsCompiler.fixupCompilerOptionsForModuleKind` is invoked that alters the
`moduleResolution` (and `customConditions`). This leads to inconsistent behaviour if some typescript files are touched very early in the
typescript run.

# Thanks

- https://github.com/kulshekhar/ts-jest/issues/4639 and the related example at https://github.com/thomasballinger/ts-jest-repro which
  put me on the right track to diagnose this
