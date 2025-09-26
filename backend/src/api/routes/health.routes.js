const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs-extra');
const path = require('path');

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    const stateDir = process.env.STATE_DIR || './state';
    const stateFileExists = await fs.pathExists(path.join(stateDir, 'sync.state'));
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: '1.0.0',
      state: {
        directory: stateDir,
        fileExists: stateFileExists
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * GET /api/health/detailed
 * Detailed health check with system info
 */
router.get('/detailed', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      process: {
        uptime: process.uptime(),
        pid: process.pid,
        version: process.version,
        memory: {
          rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
        }
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        loadAverage: os.loadavg(),
        uptime: os.uptime()
      },
      application: {
        name: 'dp-system-call-logs-backend',
        version: '1.0.0',
        environment: process.env.NODE_ENV
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * GET /api/health/ready
 * Readiness probe
 */
router.get('/ready', async (req, res) => {
  try {
    // Check if essential services are configured
    const isReady = !!(process.env.DIALPAD_API_KEY && process.env.AIRTABLE_PAT);
    
    if (isReady) {
      res.json({ ready: true });
    } else {
      res.status(503).json({ ready: false, message: 'Missing required configuration' });
    }
  } catch (error) {
    res.status(503).json({ ready: false, error: error.message });
  }
});

/**
 * GET /api/health/live
 * Liveness probe
 */
router.get('/live', (req, res) => {
  res.json({ alive: true });
});

module.exports = router;