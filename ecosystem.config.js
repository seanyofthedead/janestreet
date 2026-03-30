module.exports = {
  apps: [
    {
      name: 'engine',
      script: 'npx',
      args: 'tsx engine/src/main.ts',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'watchdog',
      script: 'npx',
      args: 'tsx watchdog/src/main.ts',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'dashboard',
      script: 'npx',
      args: 'next dev',
      cwd: './dashboard',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
