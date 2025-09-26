require('dotenv').config(); // Load .env file

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
    daysBack: parseInt(process.env.DAYS_BACK || '0'), // Default to 0 for real-time
    backfillGraceSeconds: parseInt(process.env.BACKFILL_GRACE_SECONDS || '300'), // 5 minutes
    defaultRegion: process.env.DEFAULT_REGION || 'SG',
    pageSize: Math.min(parseInt(process.env.PAGE_SIZE || '50'), 50), // Enforce max 50
    displayTimezone: process.env.DISPLAY_TIMEZONE || 'America/New_York',
    realtimeOnly: process.env.REALTIME_ONLY === 'true' // New flag for real-time only mode
  },
  businessHours: {
    enabled: process.env.BUSINESS_HOURS_ENABLED === 'true',
    startHour: parseInt(process.env.BUSINESS_HOURS_START || '9'), // 9 AM
    endHour: parseInt(process.env.BUSINESS_HOURS_END || '18'), // 6 PM (18:00)
    timezone: process.env.BUSINESS_HOURS_TIMEZONE || 'America/New_York'
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
  
  // Ensure page size doesn't exceed 50
  if (config.sync.pageSize > 50) {
    logger.warn('PAGE_SIZE exceeds Dialpad API limit of 50, setting to 50');
    config.sync.pageSize = 50;
  }
  
  // Validate business hours
  if (config.businessHours.enabled) {
    if (config.businessHours.startHour < 0 || config.businessHours.startHour > 23) {
      throw new Error('BUSINESS_HOURS_START must be between 0 and 23');
    }
    if (config.businessHours.endHour < 1 || config.businessHours.endHour > 24) {
      throw new Error('BUSINESS_HOURS_END must be between 1 and 24');
    }
    if (config.businessHours.startHour >= config.businessHours.endHour) {
      throw new Error('BUSINESS_HOURS_END must be after BUSINESS_HOURS_START');
    }
  }
  
  logger.info('Configuration validated successfully');
  logger.debug({
    dialpadConfigured: !!config.dialpad.apiKey,
    airtableConfigured: !!config.airtable.pat,
    daysBack: config.sync.daysBack,
    pageSize: config.sync.pageSize,
    displayTimezone: config.sync.displayTimezone,
    realtimeOnly: config.sync.realtimeOnly,
    businessHours: config.businessHours
  }, 'Config details');
}

// Get start of business hours for today in milliseconds
function getBusinessHoursWindow() {
  const now = new Date();
  
  // Create date in business hours timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.businessHours.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const currentHour = parseInt(parts.find(p => p.type === 'hour').value);
  
  // Create start and end times for business hours in the specified timezone
  const startDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${config.businessHours.startHour.toString().padStart(2, '0')}:00:00`);
  const endDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${config.businessHours.endHour.toString().padStart(2, '0')}:00:00`);
  
  // Convert to UTC timestamps
  // Note: This is a simplified conversion. For production, consider using a library like date-fns-tz
  const tzOffset = now.getTimezoneOffset() * 60 * 1000;
  const startTimestamp = startDate.getTime() - tzOffset;
  const endTimestamp = Math.min(endDate.getTime() - tzOffset, Date.now()); // Don't go into the future
  
  return {
    start: startTimestamp,
    end: endTimestamp,
    currentHour,
    isWithinBusinessHours: currentHour >= config.businessHours.startHour && currentHour < config.businessHours.endHour
  };
}

// Get start of current day in milliseconds
function getStartOfToday() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return startOfDay.getTime();
}

// Dialpad API client
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
    
    // Add response interceptor for debugging
    this.axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          logger.error({
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers
          }, 'Dialpad API error response');
        }
        return Promise.reject(error);
      }
    );
  }

  async testConnection() {
    try {
      // Try a simple API call to test the connection
      const response = await this.axios.get('/api/v2/call', {
        params: {
          started_after: Date.now() - (60 * 60 * 1000), // Last hour
          started_before: Date.now(),
          limit: 1
        }
      });
      logger.info('Dialpad API connection successful');
      return true;
    } catch (error) {
      logger.error('Dialpad API connection failed:', error.message);
      if (error.response?.status === 401) {
        throw new Error('Invalid Dialpad API key. Please check your credentials.');
      } else if (error.response?.status === 400) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        throw new Error(`Dialpad API error: ${errorMessage}`);
      }
      throw error;
    }
  }

  async getCalls(startedAfter, startedBefore, cursor = null) {
    const params = {
      started_after: Math.floor(startedAfter),
      started_before: Math.floor(startedBefore),
      limit: config.sync.pageSize // Already capped at 50
    };
    
    if (cursor) {
      params.cursor = cursor;
    }

    logger.info({
      startedAfter: new Date(startedAfter).toISOString(),
      startedBefore: new Date(startedBefore).toISOString(),
      limit: params.limit,
      cursor: cursor ? 'present' : 'none'
    }, 'Fetching calls from Dialpad');

    try {
      const response = await this.axios.get('/api/v2/call', { params });
      
      const items = response.data.items || [];
      const nextCursor = response.data.cursor || null;
      
      logger.info({
        retrieved: items.length,
        hasMore: !!nextCursor
      }, 'Retrieved calls from Dialpad');
      
      return {
        items,
        cursor: nextCursor
      };
    } catch (error) {
      if (error.response?.status === 400) {
        const errorMessage = error.response?.data?.error?.message || 'Bad request';
        logger.error(`Dialpad API 400 error: ${errorMessage}`);
        
        // Log the actual request for debugging
        logger.error({
          url: error.config?.url,
          params: error.config?.params
        }, 'Failed request details');
        
        throw new Error(`Dialpad API error: ${errorMessage}`);
      }
      throw error;
    }
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

  async testConnection() {
    try {
      const response = await this.axios.get(
        `/${encodeURIComponent(config.airtable.customersTable)}`,
        { params: { maxRecords: 1 } }
      );
      logger.info('Airtable connection successful');
      return true;
    } catch (error) {
      logger.error('Airtable connection failed:', error.message);
      if (error.response?.status === 401) {
        throw new Error('Invalid Airtable PAT. Please check your credentials.');
      } else if (error.response?.status === 404) {
        throw new Error('Airtable base or table not found. Check your base ID and table names.');
      }
      throw error;
    }
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

// Check if a call is within business hours
function isWithinBusinessHours(callTimestamp) {
  if (!config.businessHours.enabled) {
    return true; // If business hours filtering is disabled, include all calls
  }
  
  const callDate = new Date(callTimestamp);
  const callHour = callDate.getHours(); // This is in local timezone
  
  // Convert to business timezone hour
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.businessHours.timezone,
    hour: 'numeric',
    hour12: false
  });
  
  const businessHour = parseInt(formatter.format(callDate));
  
  return businessHour >= config.businessHours.startHour && businessHour < config.businessHours.endHour;
}

// Main sync function
async function sync() {
  logger.info('Starting sync...');
  
  try {
    validateConfig();

    const dialpad = new DialpadClient();
    const airtable = new AirtableClient();

    // Test connections first
    logger.info('Testing API connections...');
    await dialpad.testConnection();
    await airtable.testConnection();
    logger.info('API connections verified');

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

    // Determine sync window
    const now = Date.now();
    const lastSyncedMs = (await state.getLastSynced()) * 1000; // Convert to ms
    const backfillGraceMs = config.sync.backfillGraceSeconds * 1000;
    
    let startedAfter;
    let startedBefore = now;
    
    if (config.sync.realtimeOnly || config.sync.daysBack === 0) {
      // Real-time mode with business hours
      if (config.businessHours.enabled) {
        const businessWindow = getBusinessHoursWindow();
        
        if (lastSyncedMs > 0) {
          // If we've synced before, start from last sync or business hours start, whichever is later
          startedAfter = Math.max(businessWindow.start, lastSyncedMs - backfillGraceMs);
        } else {
          // First sync: start from beginning of business hours today
          startedAfter = businessWindow.start;
        }
        
        // Don't sync beyond business hours
        startedBefore = Math.min(businessWindow.end, now);
        
        logger.info({
          businessHours: `${config.businessHours.startHour}:00 - ${config.businessHours.endHour}:00 ${config.businessHours.timezone}`,
          isWithinBusinessHours: businessWindow.isWithinBusinessHours,
          currentHour: businessWindow.currentHour
        }, 'Business hours configuration');
        
        // Check if we're outside business hours
        if (!businessWindow.isWithinBusinessHours) {
          logger.info('Currently outside business hours, will only sync calls from business hours');
        }
      } else {
        // No business hours restriction
        if (lastSyncedMs > 0) {
          startedAfter = lastSyncedMs - backfillGraceMs;
          logger.info('Real-time mode: Syncing from last sync time');
        } else {
          startedAfter = getStartOfToday();
          logger.info('Real-time mode: First sync - starting from today');
        }
      }
    } else {
      // Historical mode: sync from X days back
      const daysBackMs = config.sync.daysBack * 24 * 60 * 60 * 1000;
      startedAfter = Math.max(
        now - daysBackMs,
        lastSyncedMs > 0 ? lastSyncedMs - backfillGraceMs : now - daysBackMs
      );
      logger.info(`Historical mode: Syncing from ${config.sync.daysBack} days back`);
    }
    
    logger.info({
      mode: config.sync.realtimeOnly ? 'Real-time' : 'Historical',
      businessHoursEnabled: config.businessHours.enabled,
      lastSynced: lastSyncedMs > 0 ? new Date(lastSyncedMs).toISOString() : 'Never',
      startedAfter: new Date(startedAfter).toISOString(),
      startedBefore: new Date(startedBefore).toISOString(),
      timeWindow: `${Math.round((startedBefore - startedAfter) / (1000 * 60))} minutes`
    }, 'Sync window determined');

    // Fetch and process calls with pagination
    let cursor = null;
    let totalCalls = 0;
    let matchedCalls = 0;
    let filteredOutCalls = 0;
    let pageCount = 0;
    const maxPages = 200; // Safety limit (200 pages * 50 records = 10,000 calls max)

    do {
      pageCount++;
      logger.info(`Fetching calls page ${pageCount}...`);
      
      let calls, nextCursor;
      try {
        const result = await dialpad.getCalls(startedAfter, startedBefore, cursor);
        calls = result.items;
        nextCursor = result.cursor;
      } catch (error) {
        logger.error(`Failed to fetch page ${pageCount}: ${error.message}`);
        // If we've already processed some pages, continue with what we have
        if (pageCount > 1) {
          logger.info('Continuing with already fetched data...');
          break;
        }
        throw error; // If first page fails, throw the error
      }
      
      if (!calls || calls.length === 0) {
        if (pageCount === 1) {
          logger.info('No calls found in the specified time window');
        } else {
          logger.info('No more calls to process');
        }
        break;
      }

      logger.info(`Processing ${calls.length} calls from page ${pageCount}`);
      const callsToUpsert = [];

      for (const call of calls) {
        // Parse call data based on actual Dialpad API structure
        const callId = call.id || call.call_id || `${call.date_started}_${call.external_number}`;
        const startTime = parseInt(call.date_started); // Already in milliseconds
        
        // Filter by business hours if enabled
        if (config.businessHours.enabled && !isWithinBusinessHours(startTime)) {
          filteredOutCalls++;
          logger.debug(`Call ${callId} filtered out - outside business hours`);
          continue;
        }
        
        const endTime = call.date_ended ? parseInt(call.date_ended) : null;
        const duration = formatDuration(call.duration); // Convert to seconds
        const externalNumber = call.external_number;
        const direction = call.direction; // 'inbound' or 'outbound'
        
        // Normalize phone number
        const normalizedPhone = normalizePhone(externalNumber);

        // Build call record for Airtable
        const callRecord = {
          'Call ID': callId,
          'External Number': externalNumber || '',
          'Direction': direction === 'inbound' ? 'Inbound' : 'Outbound',
          // Use ISO format - Airtable will handle timezone display based on field settings
          'Start Time': new Date(startTime).toISOString(),
          'End Time': endTime ? new Date(endTime).toISOString() : null,
          // Optional: Add separate field for EDT display (you can add this field in Airtable)
          'Start Time (EDT)': new Date(startTime).toLocaleString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          }),
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
        if (normalizedPhone && customerPhoneMap.has(normalizedPhone)) {
          callRecord[config.fields.callsCustomerLink] = [customerPhoneMap.get(normalizedPhone)];
          matchedCalls++;
        } else if (config.fields.callsUnmatchedPhone) {
          callRecord[config.fields.callsUnmatchedPhone] = externalNumber || 'Unknown';
        }

        callsToUpsert.push(callRecord);
        totalCalls++;
      }

      // Upsert calls to Airtable
      if (callsToUpsert.length > 0) {
        logger.info(`Upserting ${callsToUpsert.length} calls to Airtable...`);
        try {
          await airtable.upsertCalls(callsToUpsert);
          logger.info(`Successfully upserted ${callsToUpsert.length} calls`);
        } catch (error) {
          logger.error('Failed to upsert calls to Airtable:', error.message);
          // Continue processing even if Airtable update fails
        }
      }

      // Update state after each page
      await state.setLastSynced(Math.floor(now / 1000)); // Save as seconds
      
      // Update cursor for next iteration
      cursor = nextCursor;
      
      // Add small delay to avoid rate limiting
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between pages
      }
      
      // Safety check
      if (pageCount >= maxPages) {
        logger.warn(`Reached maximum page limit (${maxPages}), stopping sync`);
        break;
      }
      
      // Log progress
      logger.info({
        progress: {
          pagesProcessed: pageCount,
          totalCallsProcessed: totalCalls,
          filteredOut: filteredOutCalls,
          matchedSoFar: matchedCalls,
          hasMore: !!cursor
        }
      }, 'Page processing complete');
      
    } while (cursor);

    // Final summary
    if (totalCalls === 0 && filteredOutCalls === 0) {
      logger.info('No new calls to sync for the specified time period');
    } else {
      logger.info({
        totalCalls,
        matchedCalls,
        unmatchedCalls: totalCalls - matchedCalls,
        filteredOutByBusinessHours: filteredOutCalls,
        matchRate: totalCalls > 0 ? (matchedCalls / totalCalls * 100).toFixed(2) + '%' : 'N/A',
        pagesProcessed: pageCount
      }, 'Sync completed successfully');
    }

    return {
      success: true,
      totalCalls,
      matchedCalls,
      unmatchedCalls: totalCalls - matchedCalls,
      filteredOutCalls,
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
    .then((result) => {
      logger.info(result, 'Sync completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.fatal(error, 'Fatal error during sync');
      process.exit(1);
    });
}

module.exports = sync;