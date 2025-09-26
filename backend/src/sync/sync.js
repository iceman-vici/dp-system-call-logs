const axios = require('axios');
const { parsePhoneNumber } = require('libphonenumber-js');
const pino = require('pino');
const retry = require('./retry');
const state = require('./state');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
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
    defaultRegion: process.env.DEFAULT_REGION || 'SG',
    pageSize: parseInt(process.env.PAGE_SIZE || '100')
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

// Dialpad API client - Updated to match actual API
class DialpadClient {
  constructor() {
    this.axios = axios.create({
      baseURL: config.dialpad.baseUrl,
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${config.dialpad.apiKey}`
      },
      timeout: 30000
    });
  }

  async getCompanyNumbers() {
    // This endpoint might be different, keeping for compatibility
    try {
      const response = await retry(
        () => this.axios.get('/api/v2/company/numbers'),
        'Dialpad getCompanyNumbers'
      );
      return response.data.items || [];
    } catch (error) {
      logger.warn('Could not fetch company numbers, will process all calls');
      return [];
    }
  }

  async getCalls(startedAfter, startedBefore, cursor = null) {
    const params = {
      started_after: startedAfter, // Milliseconds timestamp
      started_before: startedBefore, // Milliseconds timestamp
      limit: config.sync.pageSize
    };
    
    if (cursor) {
      params.cursor = cursor;
    }

    logger.debug({ params }, 'Fetching calls with params');

    const response = await retry(
      () => this.axios.get('/api/v2/call', { params }),
      'Dialpad getCalls'
    );
    
    return {
      items: response.data.items || [],
      cursor: response.data.cursor || null
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
    if (!number) return null;
    const parsed = parsePhoneNumber(number, defaultRegion);
    return parsed ? parsed.format('E.164') : null;
  } catch (error) {
    logger.debug({ number, error: error.message }, 'Failed to parse phone number');
    return null;
  }
}

// Format duration from milliseconds to seconds
function formatDuration(ms) {
  return Math.floor((ms || 0) / 1000);
}

// Main sync function - Updated to match Dialpad API v2
async function sync() {
  logger.info('Starting sync...');
  
  try {
    validateConfig();

    const dialpad = new DialpadClient();
    const airtable = new AirtableClient();

    // Get company numbers if available
    logger.info('Fetching company numbers...');
    const companyNumbers = await dialpad.getCompanyNumbers();
    const companyNumbersSet = new Set(
      companyNumbers.map(n => normalizePhone(n.phone_number || n.number)).filter(Boolean)
    );
    logger.info(`Found ${companyNumbersSet.size} company numbers`);

    // Determine sync window
    const lastSyncedMs = (await state.getLastSynced()) * 1000; // Convert to ms
    const now = Date.now();
    const daysBackMs = config.sync.daysBack * 24 * 60 * 60 * 1000;
    const backfillGraceMs = config.sync.backfillGraceSeconds * 1000;
    
    // Use milliseconds for Dialpad API
    const startedAfter = Math.max(
      now - daysBackMs,
      lastSyncedMs - backfillGraceMs
    );
    const startedBefore = now;
    
    logger.info({
      lastSynced: new Date(lastSyncedMs).toISOString(),
      startedAfter: new Date(startedAfter).toISOString(),
      startedBefore: new Date(startedBefore).toISOString()
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
    let pageCount = 0;
    const maxPages = 100; // Safety limit

    do {
      pageCount++;
      logger.info(`Fetching calls page ${pageCount}...`);
      
      const { items: calls, cursor: nextCursor } = await dialpad.getCalls(
        startedAfter,
        startedBefore,
        cursor
      );
      
      if (calls.length === 0) {
        logger.info('No more calls to process');
        break;
      }

      logger.info(`Processing ${calls.length} calls from page ${pageCount}`);
      const callsToUpsert = [];

      for (const call of calls) {
        // Parse call data based on actual Dialpad API structure
        const callId = call.id || call.call_id || `${call.date_started}_${call.external_number}`;
        const startTime = parseInt(call.date_started); // Already in milliseconds
        const endTime = call.date_ended ? parseInt(call.date_ended) : null;
        const duration = formatDuration(call.duration); // Convert to seconds
        const externalNumber = call.external_number;
        const direction = call.direction; // 'inbound' or 'outbound'
        
        // Normalize phone number
        const normalizedPhone = normalizePhone(externalNumber);
        
        // Determine if this is a company number
        let customerPhone = normalizedPhone;
        let isInternalCall = false;
        
        if (companyNumbersSet.size > 0 && normalizedPhone) {
          isInternalCall = companyNumbersSet.has(normalizedPhone);
          if (isInternalCall) {
            // Skip internal calls
            logger.debug({ call: callId }, 'Skipping internal call');
            continue;
          }
        }

        // Build call record for Airtable
        const callRecord = {
          'Call ID': callId,
          'External Number': externalNumber,
          'Direction': direction === 'inbound' ? 'Inbound' : 'Outbound',
          'Start Time': new Date(startTime).toISOString(),
          'End Time': endTime ? new Date(endTime).toISOString() : null,
          'Duration (s)': duration,
          'Contact Name': call.contact?.name || 'Unknown',
          'Target': call.target?.name || 'N/A',
          'Was Recorded': call.was_recorded || false,
          'MOS Score': call.mos_score || null
        };

        // Add recording URL if available
        if (call.recording_url && call.recording_url.length > 0) {
          callRecord['Recording URL'] = call.recording_url[0];
        } else if (call.admin_recording_urls && call.admin_recording_urls.length > 0) {
          callRecord['Recording URL'] = call.admin_recording_urls[0];
        }

        // Match to customer
        if (customerPhone && customerPhoneMap.has(customerPhone)) {
          callRecord[config.fields.callsCustomerLink] = [customerPhoneMap.get(customerPhone)];
          matchedCalls++;
        } else if (config.fields.callsUnmatchedPhone) {
          callRecord[config.fields.callsUnmatchedPhone] = customerPhone || externalNumber || 'Unknown';
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
      await state.setLastSynced(Math.floor(now / 1000)); // Save as seconds
      
      cursor = nextCursor;
      
      // Safety check
      if (pageCount >= maxPages) {
        logger.warn(`Reached maximum page limit (${maxPages}), stopping sync`);
        break;
      }
    } while (cursor);

    logger.info({
      totalCalls,
      matchedCalls,
      unmatchedCalls: totalCalls - matchedCalls,
      matchRate: totalCalls > 0 ? (matchedCalls / totalCalls * 100).toFixed(2) + '%' : 'N/A',
      pagesProcessed: pageCount
    }, 'Sync completed successfully');

    return {
      success: true,
      totalCalls,
      matchedCalls,
      unmatchedCalls: totalCalls - matchedCalls,
      pagesProcessed: pageCount
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