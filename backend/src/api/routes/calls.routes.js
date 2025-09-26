const express = require('express');
const router = express.Router();
const CallsService = require('../../services/calls.service');

const callsService = new CallsService();

/**
 * GET /api/calls
 * Get paginated call logs
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      direction,
      matched,
      startDate,
      endDate
    } = req.query;

    const result = await callsService.getCalls({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      direction,
      matched: matched === 'true' ? true : matched === 'false' ? false : undefined,
      startDate,
      endDate
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/calls/:id
 * Get specific call by ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    const call = await callsService.getCallById(req.params.id);
    
    if (!call) {
      return res.status(404).json({
        error: {
          message: 'Call not found',
          status: 404
        }
      });
    }

    res.json(call);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/calls/stats/summary
 * Get call statistics summary
 */
router.get('/stats/summary', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await callsService.getCallStats({ startDate, endDate });
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/calls/export
 * Export calls to CSV
 */
router.post('/export', async (req, res, next) => {
  try {
    const { filters } = req.body;
    const csv = await callsService.exportCalls(filters);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="calls-export.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;