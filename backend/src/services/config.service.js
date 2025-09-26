const fs = require('fs-extra');
const path = require('path');
const Joi = require('joi');
const axios = require('axios');

class ConfigService {
  constructor() {
    this.configPath = path.join(process.env.STATE_DIR || './state', 'config.json');
    this.schema = Joi.object({
      dialpad: Joi.object({
        apiKey: Joi.string().required(),
        baseUrl: Joi.string().uri().default('https://dialpad.com')
      }),
      airtable: Joi.object({
        pat: Joi.string().required(),
        baseId: Joi.string().required(),
        customersTable: Joi.string().default('Customers'),
        callsTable: Joi.string().default('Calls')
      }),
      sync: Joi.object({
        interval: Joi.number().min(60000).default(300000),
        daysBack: Joi.number().min(1).max(365).default(14),
        backfillGraceSeconds: Joi.number().min(0).default(21600),
        defaultRegion: Joi.string().default('SG')
      })
    });
  }

  async getConfig() {
    // Return safe configuration (without sensitive data)
    return {
      dialpad: {
        baseUrl: process.env.DIALPAD_BASE_URL || 'https://dialpad.com',
        configured: !!process.env.DIALPAD_API_KEY
      },
      airtable: {
        baseId: process.env.AIRTABLE_BASE_ID,
        customersTable: process.env.AIRTABLE_CUSTOMERS_TABLE || 'Customers',
        callsTable: process.env.AIRTABLE_CALLS_TABLE || 'Calls',
        configured: !!process.env.AIRTABLE_PAT
      },
      sync: {
        interval: parseInt(process.env.SYNC_INTERVAL || '300000'),
        daysBack: parseInt(process.env.DAYS_BACK || '14'),
        backfillGraceSeconds: parseInt(process.env.BACKFILL_GRACE_SECONDS || '21600'),
        defaultRegion: process.env.DEFAULT_REGION || 'SG'
      },
      fields: {
        customerPhone: process.env.CUSTOMER_PHONE_FIELD || 'Phone',
        callsCustomerLink: process.env.CALLS_CUSTOMER_LINK_FIELD || 'Customer',
        callsUnmatchedPhone: process.env.CALLS_UNMATCHED_PHONE_FIELD
      }
    };
  }

  async updateConfig(newConfig) {
    // Validate configuration
    const validation = await this.validateConfig(newConfig);
    if (!validation.valid) {
      throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
    }

    // Save to file (in production, update environment variables)
    await fs.ensureDir(path.dirname(this.configPath));
    await fs.writeJson(this.configPath, newConfig, { spaces: 2 });

    return {
      success: true,
      message: 'Configuration updated successfully',
      config: await this.getConfig()
    };
  }

  async validateConfig(config) {
    try {
      const value = await this.schema.validateAsync(config, { abortEarly: false });
      return { valid: true, value };
    } catch (error) {
      return {
        valid: false,
        errors: error.details.map(detail => detail.message)
      };
    }
  }

  async testConnection(service) {
    try {
      if (service === 'dialpad') {
        return await this.testDialpadConnection();
      } else if (service === 'airtable') {
        return await this.testAirtableConnection();
      } else {
        throw new Error('Invalid service specified');
      }
    } catch (error) {
      return {
        success: false,
        service,
        error: error.message
      };
    }
  }

  async testDialpadConnection() {
    if (!process.env.DIALPAD_API_KEY) {
      throw new Error('Dialpad API key not configured');
    }

    const client = axios.create({
      baseURL: process.env.DIALPAD_BASE_URL || 'https://dialpad.com',
      headers: {
        'Authorization': `Bearer ${process.env.DIALPAD_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    try {
      const response = await client.get('/api/v2/company');
      return {
        success: true,
        service: 'dialpad',
        message: 'Connection successful',
        details: {
          companyName: response.data.name
        }
      };
    } catch (error) {
      throw new Error(`Dialpad connection failed: ${error.message}`);
    }
  }

  async testAirtableConnection() {
    if (!process.env.AIRTABLE_PAT || !process.env.AIRTABLE_BASE_ID) {
      throw new Error('Airtable configuration incomplete');
    }

    const client = axios.create({
      baseURL: `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`,
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    try {
      // Try to fetch first record from Customers table
      const response = await client.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CUSTOMERS_TABLE || 'Customers')}`,
        { params: { maxRecords: 1 } }
      );
      
      return {
        success: true,
        service: 'airtable',
        message: 'Connection successful',
        details: {
          baseId: process.env.AIRTABLE_BASE_ID,
          tablesAccessible: true
        }
      };
    } catch (error) {
      throw new Error(`Airtable connection failed: ${error.message}`);
    }
  }
}

module.exports = ConfigService;