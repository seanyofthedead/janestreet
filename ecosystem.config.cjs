module.exports = {
  apps: [
    {
      name: 'engine',
      interpreter: 'node',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'engine/src/main.ts',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'watchdog',
      interpreter: 'node',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'watchdog/src/main.ts',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'dashboard',
      interpreter: 'node',
      script: '../node_modules/next/dist/bin/next',
      args: 'dev',
      cwd: './dashboard',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
