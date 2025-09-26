const express = require('express');
const router = express.Router();
const CustomersService = require('../../services/customers.service');

const customersService = new CustomersService();

/**
 * GET /api/customers
 * Get all customers
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      hasPhone
    } = req.query;

    const result = await customersService.getCustomers({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      hasPhone: hasPhone === 'true'
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/customers/:id
 * Get customer by ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await customersService.getCustomerById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({
        error: {
          message: 'Customer not found',
          status: 404
        }
      });
    }

    res.json(customer);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/customers/:id/calls
 * Get calls for a specific customer
 */
router.get('/:id/calls', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const calls = await customersService.getCustomerCalls(
      req.params.id,
      {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json(calls);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/customers/sync
 * Sync customers from Airtable
 */
router.post('/sync', async (req, res, next) => {
  try {
    const result = await customersService.syncCustomers();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;