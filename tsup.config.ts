import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],

  format: ['cjs', 'esm'],   // support both require + import
  dts: true,                // generate .d.ts
  sourcemap: true,

  clean: true,              // clear dist before build

  splitting: false,         // safer for libraries
  treeshake: true,

  minify: false             // keep readable (library debugging)
});