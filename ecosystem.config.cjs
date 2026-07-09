module.exports = {
  apps: [
    {
      name: 'kriptoquant-bot',
      cwd: '/home/aslan_erdm/kriptoquant',
      script: './src/cli.ts',
      args: 'dashboard --port 3008',
      node_args: '--import tsx --max-old-space-size=450',
      env: {
        NODE_ENV: 'production',
        PORT: 3008
      },
      restart_delay: 5000, // Wait 5s before restart on failure
      max_restarts: 10,
      autorestart: true,
      watch: false,
      out_file: './logs/pm2_out.log',
      error_file: './logs/pm2_err.log',
      merge_logs: true,
      time: true
    }
  ]
};
