# PM2 Deployment Guide

## Quick Setup

1. **Make the setup script executable:**
```bash
cd backend
chmod +x pm2-setup.sh
```

2. **Run the setup script:**
```bash
./pm2-setup.sh
```

This will:
- Install PM2 if not already installed
- Set up PM2 to start on system boot
- Create logs directory
- Start both the server and cron job
- Save the PM2 process list

## Manual Setup

If you prefer to set up manually:

### 1. Install PM2
```bash
npm install -g pm2
```

### 2. Start the applications
```bash
cd backend
pm2 start ecosystem.config.js
```

### 3. Save PM2 process list
```bash
pm2 save
```

### 4. Set up startup script
```bash
pm2 startup
# Follow the instructions provided by PM2
```

## Managing the Applications

### View Status
```bash
pm2 status
```

### View Logs
```bash
# All logs
pm2 logs

# Specific app logs
pm2 logs dialpad-sync
pm2 logs dialpad-cron

# Last 100 lines
pm2 logs --lines 100

# Real-time logs
pm2 logs --raw
```

### Restart Applications
```bash
# Restart all
pm2 restart all

# Restart specific app
pm2 restart dialpad-sync
pm2 restart dialpad-cron

# Reload with zero-downtime
pm2 reload all
```

### Stop Applications
```bash
# Stop all
pm2 stop all

# Stop specific app
pm2 stop dialpad-sync
pm2 stop dialpad-cron
```

### Delete from PM2
```bash
# Delete all
pm2 delete all

# Delete specific app
pm2 delete dialpad-sync
pm2 delete dialpad-cron
```

### Monitor Resources
```bash
# Interactive monitoring
pm2 monit

# Show detailed info
pm2 info dialpad-sync
pm2 info dialpad-cron

# Show process list with memory/cpu
pm2 list
```

## Ecosystem Configuration

The `ecosystem.config.js` file contains:

- **dialpad-sync**: The Express server (port 3001)
- **dialpad-cron**: The cron job that runs every 5 minutes

Both applications:
- Auto-restart on failure
- Log to separate files in `./logs/`
- Restart if memory exceeds limits
- Include timestamps in logs

## Log Files

Logs are stored in the `backend/logs/` directory:

- `pm2-out.log` - Server stdout logs
- `pm2-error.log` - Server error logs
- `pm2-combined.log` - Server combined logs
- `cron-out.log` - Cron stdout logs
- `cron-error.log` - Cron error logs
- `cron-combined.log` - Cron combined logs

## Troubleshooting

### Check if PM2 is running
```bash
pm2 ping
```

### Reset PM2
```bash
pm2 kill
pm2 resurrect
```

### Update PM2
```bash
npm install -g pm2@latest
pm2 update
```

### View Error Logs
```bash
# Check recent errors
pm2 logs --err --lines 50

# Check specific app errors
tail -f logs/pm2-error.log
tail -f logs/cron-error.log
```

### Memory Issues
If apps are restarting due to memory:
```bash
# Check memory usage
pm2 info dialpad-sync | grep memory
pm2 info dialpad-cron | grep memory

# Increase memory limit in ecosystem.config.js
# max_memory_restart: '1G'
```

## Environment Variables

Make sure your `.env` file is properly configured in the backend directory.
PM2 will load these automatically.

## Production Tips

1. **Enable cluster mode for server** (if high traffic):
   ```javascript
   // In ecosystem.config.js
   instances: 'max',
   exec_mode: 'cluster',
   ```

2. **Set up log rotation**:
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

3. **Monitor with PM2 Plus** (optional):
   ```bash
   pm2 monitor
   ```

4. **Backup PM2 configuration**:
   ```bash
   pm2 save
   cp ~/.pm2/dump.pm2 ~/pm2-backup.json
   ```