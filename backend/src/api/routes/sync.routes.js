const express = require('express');
const router = express.Router();

/**
 * GET /api/sync/status
 * Get current sync status
 */
router.get('/status', async (req, res, next) => {
  try {
    const syncEngine = req.app.locals.syncEngine;
    const status = await syncEngine.getStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync/trigger
 * Manually trigger a sync
 */
router.post('/trigger', async (req, res, next) => {
  try {
    const syncEngine = req.app.locals.syncEngine;
    const logger = req.app.locals.logger;
    
    // Start sync asynchronously
    syncEngine.run()
      .then(result => {
        logger.info(result, 'Manual sync completed');
      })
      .catch(error => {
        logger.error(error, 'Manual sync failed');
      });
    
    // Return immediately
    res.json({
      message: 'Sync triggered',
      status: 'running'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync/reset
 * Reset sync state
 */
router.post('/reset', async (req, res, next) => {
  try {
    const syncEngine = req.app.locals.syncEngine;
    const result = await syncEngine.resetState();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sync/history
 * Get sync history
 */
router.get('/history', async (req, res, next) => {
  try {
    const syncEngine = req.app.locals.syncEngine;
    const status = await syncEngine.getStatus();
    res.json({
      history: status.history || []
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;