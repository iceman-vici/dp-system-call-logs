const express = require('express');
const router = express.Router();
const ConfigService = require('../../services/config.service');

const configService = new ConfigService();

/**
 * GET /api/config
 * Get current configuration (safe values only)
 */
router.get('/', async (req, res, next) => {
  try {
    const config = await configService.getConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/config
 * Update configuration
 */
router.put('/', async (req, res, next) => {
  try {
    const updatedConfig = await configService.updateConfig(req.body);
    res.json(updatedConfig);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/config/validate
 * Validate configuration
 */
router.post('/validate', async (req, res, next) => {
  try {
    const validation = await configService.validateConfig(req.body);
    res.json(validation);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/config/test-connection
 * Test API connections
 */
router.post('/test-connection', async (req, res, next) => {
  try {
    const { service } = req.body; // 'dialpad' or 'airtable'
    const result = await configService.testConnection(service);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;