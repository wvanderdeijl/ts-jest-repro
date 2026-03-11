// This makes the first run after a `jest --clear-cache` succeed since `library/foo` is than parsed with a TS compiler BEFORE 
// `fixupCompilerOptionsForModuleKind` is invoked
// import "library/foo";

console.log('setup-jest.ts is running!');
