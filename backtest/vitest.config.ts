import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'melange': path.resolve(__dirname, '../trading-core-js/node_modules/melange'),
      'melange.js': path.resolve(__dirname, '../trading-core-js/node_modules/melange.js'),
      'melange.__private__.melange_mini_stdlib': path.resolve(__dirname, '../trading-core-js/node_modules/melange.__private__.melange_mini_stdlib'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
