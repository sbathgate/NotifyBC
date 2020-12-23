module.exports = {
  apps: [
    {
      name: 'NotifyBC',
      script: 'dist/index.js',
      instances: 4,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
