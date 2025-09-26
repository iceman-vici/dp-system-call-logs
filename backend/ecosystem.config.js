module.exports = {
  apps: [
    {
      name: 'dialpad-sync-cron',
      script: './src/sync/sync.js',
      cwd: '/path/to/your/dp-system-call-logs/backend', // UPDATE THIS PATH
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      cron_restart: '0 7 * * *', // Runs daily at 7 AM local time
      // Alternative cron patterns:
      // '*/15 * * * *' - Every 15 minutes
      // '0 */2 * * *' - Every 2 hours
      // '0 7,15 * * *' - At 7 AM and 3 PM daily
      // '0 7 * * 1-5' - At 7 AM Monday-Friday
      time: true, // Enables time-based logs
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'dialpad-sync-manual',
      script: './src/sync/sync.js',
      cwd: '/path/to/your/dp-system-call-logs/backend', // UPDATE THIS PATH
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      // No cron for manual runs
      time: true,
      error_file: './logs/pm2-manual-error.log',
      out_file: './logs/pm2-manual-out.log',
      log_file: './logs/pm2-manual-combined.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
