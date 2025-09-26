const express = require('express');
const router = express.Router();
const AnalyticsService = require('../../services/analytics.service');

const analyticsService = new AnalyticsService();

/**
 * GET /api/analytics/overview
 * Get analytics overview
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { period = '7d' } = req.query;
    const overview = await analyticsService.getOverview(period);
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/trends
 * Get call trends over time
 */
router.get('/trends', async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      groupBy = 'day'
    } = req.query;

    const trends = await analyticsService.getTrends({
      startDate,
      endDate,
      groupBy
    });

    res.json(trends);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/agents
 * Get agent performance analytics
 */
router.get('/agents', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const agentStats = await analyticsService.getAgentStats({
      startDate,
      endDate
    });
    res.json(agentStats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/customers
 * Get customer analytics
 */
router.get('/customers', async (req, res, next) => {
  try {
    const { startDate, endDate, limit = 10 } = req.query;
    const customerStats = await analyticsService.getCustomerStats({
      startDate,
      endDate,
      limit: parseInt(limit)
    });
    res.json(customerStats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/hourly
 * Get hourly call distribution
 */
router.get('/hourly', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const hourlyStats = await analyticsService.getHourlyDistribution({
      startDate,
      endDate
    });
    res.json(hourlyStats);
  } catch (error) {
    next(error);
  }
});

module.exports = router;