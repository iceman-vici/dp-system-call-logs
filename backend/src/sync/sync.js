const axios = require('axios');
const { parsePhoneNumber } = require('libphonenumber-js');
const pino = require('pino');
const retry = require('./retry');
const state = require('./state');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty'
  }
});

// Configuration
const config = {
  dialpad: {
    apiKey: process.env.DIALPAD_API_KEY,
    baseUrl: process.env.DIALPAD_BASE_URL || 'https://dialpad.com'
  },
  airtable: {
    pat: process.env.AIRTABLE_PAT,
    baseId: process.env.AIRTABLE_BASE_ID,
    customersTable: process.env.AIRTABLE_CUSTOMERS_TABLE || 'Customers',
    callsTable: process.env.AIRTABLE_CALLS_TABLE || 'Calls'
  },
  fields: {
    customerPhone: process.env.CUSTOMER_PHONE_FIELD || 'Phone',
    callsCustomerLink: process.env.CALLS_CUSTOMER_LINK_FIELD || 'Customer',
    callsUnmatchedPhone: process.env.CALLS_UNMATCHED_PHONE_FIELD
  },
  sync: {
    daysBack: parseInt(process.env.DAYS_BACK || '14'),
    backfillGraceSeconds: parseInt(process.env.BACKFILL_GRACE_SECONDS || '21600'),
    defaultRegion: process.env.DEFAULT_REGION || 'SG'
  }
};

// Validate configuration
function validateConfig() {
  const required = [
    ['DIALPAD_API_KEY', config.dialpad.apiKey],
    ['AIRTABLE_PAT', config.airtable.pat],
    ['AIRTABLE_BASE_ID', config.airtable.baseId]
  ];

  const missing = required.filter(([name, value]) => !value).map(([name]) => name);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Dialpad API client
class DialpadClient {
  constructor() {
    this.axios = axios.create({
      baseURL: config.dialpad.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.dialpad.apiKey}`,
        'Accept': 'application/json'
      },
      timeout: 30000
    });
  }

  async getCompanyNumbers() {
    const response = await retry(
      () => this.axios.get('/api/v2/company/numbers'),
      'Dialpad getCompanyNumbers'
    );
    return response.data.items || [];
  }

  async getCalls(since, cursor = null) {
    const params = {
      order: 'desc',
      limit: 100,
      start_time: since
    };
    
    if (cursor) {
      params.cursor = cursor;
    }

    const response = await retry(
      () => this.axios.get('/api/v2/calls', { params }),
      'Dialpad getCalls'
    );
    
    return {
      items: response.data.items || [],
      cursor: response.data.cursor
    };
  }
}

// Airtable API client
class AirtableClient {
  constructor() {
    this.axios = axios.create({
      baseURL: `https://api.airtable.com/v0/${config.airtable.baseId}`,
      headers: {
        'Authorization': `Bearer ${config.airtable.pat}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async getCustomers() {
    const customers = [];
    let offset = null;

    do {
      const params = {
        pageSize: 100,
        fields: [config.fields.customerPhone]
      };
      
      if (offset) {
        params.offset = offset;
      }

      const response = await retry(
        () => this.axios.get(`/${encodeURIComponent(config.airtable.customersTable)}`, { params }),
        'Airtable getCustomers'
      );

      customers.push(...response.data.records);
      offset = response.data.offset;
    } while (offset);

    return customers;
  }

  async upsertCalls(calls) {
    const chunks = [];
    for (let i = 0; i < calls.length; i += 10) {
      chunks.push(calls.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      const records = chunk.map(call => ({
        fields: call
      }));

      await retry(
        () => this.axios.patch(`/${encodeURIComponent(config.airtable.callsTable)}`, {
          records,
          performUpsert: {
            fieldsToMergeOn: ['Call ID']
          }
        }),
        'Airtable upsertCalls'
      );

      // Rate limiting - Airtable allows 5 requests per second
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

// Phone number normalization
function normalizePhone(number, defaultRegion = config.sync.defaultRegion) {
  try {
    const parsed = parsePhoneNumber(number, defaultRegion);
    return parsed ? parsed.format('E.164') : null;
  } catch (error) {
    logger.debug({ number, error: error.message }, 'Failed to parse phone number');
    return null;
  }
}

// Main sync function
async function sync() {
  logger.info('Starting sync...');
  
  try {
    validateConfig();

    const dialpad = new DialpadClient();
    const airtable = new AirtableClient();

    // Get company numbers
    logger.info('Fetching company numbers...');
    const companyNumbers = await dialpad.getCompanyNumbers();
    const companyNumbersSet = new Set(
      companyNumbers.map(n => normalizePhone(n.phone_number)).filter(Boolean)
    );
    logger.info(`Found ${companyNumbersSet.size} company numbers`);

    // Determine sync window
    const lastSyncedEpochS = await state.getLastSynced();
    const now = Math.floor(Date.now() / 1000);
    const daysBackSeconds = config.sync.daysBack * 24 * 60 * 60;
    const since = Math.max(
      now - daysBackSeconds,
      lastSyncedEpochS - config.sync.backfillGraceSeconds
    );
    
    logger.info({
      lastSynced: new Date(lastSyncedEpochS * 1000).toISOString(),
      syncSince: new Date(since * 1000).toISOString()
    }, 'Sync window determined');

    // Get customers from Airtable
    logger.info('Loading customers from Airtable...');
    const customers = await airtable.getCustomers();
    const customerPhoneMap = new Map();
    
    for (const customer of customers) {
      const phone = customer.fields[config.fields.customerPhone];
      if (phone) {
        const normalized = normalizePhone(phone);
        if (normalized) {
          customerPhoneMap.set(normalized, customer.id);
        }
      }
    }
    logger.info(`Loaded ${customerPhoneMap.size} customers with phone numbers`);

    // Fetch and process calls
    let cursor = null;
    let totalCalls = 0;
    let matchedCalls = 0;
    let stopProcessing = false;

    do {
      logger.info('Fetching calls page...');
      const { items: calls, cursor: nextCursor } = await dialpad.getCalls(since, cursor);
      
      if (calls.length === 0) {
        logger.info('No more calls to process');
        break;
      }

      const callsToUpsert = [];

      for (const call of calls) {
        // Check if we've reached our cutoff
        if (call.start_time < since) {
          stopProcessing = true;
          break;
        }

        // Normalize phone numbers
        const fromNormalized = normalizePhone(call.from_number);
        const toNormalized = normalizePhone(call.to_number);

        // Determine customer phone (other party)
        let customerPhone = null;
        let direction = null;
        
        if (fromNormalized && companyNumbersSet.has(fromNormalized)) {
          customerPhone = toNormalized;
          direction = 'Outbound';
        } else if (toNormalized && companyNumbersSet.has(toNormalized)) {
          customerPhone = fromNormalized;
          direction = 'Inbound';
        } else {
          // Neither number is ours, skip
          logger.debug({ call }, 'Skipping call - no company number involved');
          continue;
        }

        // Build call record
        const callRecord = {
          'Call ID': call.id,
          'From': call.from_number,
          'To': call.to_number,
          'Start Time': new Date(call.start_time * 1000).toISOString(),
          'End Time': call.end_time ? new Date(call.end_time * 1000).toISOString() : null,
          'Duration (s)': call.duration || 0,
          'Direction': direction
        };

        // Match to customer
        if (customerPhone && customerPhoneMap.has(customerPhone)) {
          callRecord[config.fields.callsCustomerLink] = [customerPhoneMap.get(customerPhone)];
          matchedCalls++;
        } else if (config.fields.callsUnmatchedPhone) {
          callRecord[config.fields.callsUnmatchedPhone] = customerPhone || 'Unknown';
        }

        callsToUpsert.push(callRecord);
        totalCalls++;
      }

      // Upsert calls to Airtable
      if (callsToUpsert.length > 0) {
        logger.info(`Upserting ${callsToUpsert.length} calls to Airtable...`);
        await airtable.upsertCalls(callsToUpsert);
      }

      // Update state after each page
      await state.setLastSynced(now);
      
      cursor = nextCursor;
    } while (cursor && !stopProcessing);

    logger.info({
      totalCalls,
      matchedCalls,
      unmatchedCalls: totalCalls - matchedCalls,
      matchRate: totalCalls > 0 ? (matchedCalls / totalCalls * 100).toFixed(2) + '%' : 'N/A'
    }, 'Sync completed successfully');

    return {
      success: true,
      totalCalls,
      matchedCalls,
      unmatchedCalls: totalCalls - matchedCalls
    };

  } catch (error) {
    logger.error(error, 'Sync failed');
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sync()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.fatal(error, 'Fatal error during sync');
      process.exit(1);
    });
}

module.exports = sync;