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
    callsUnmatchedPhone: process.env.CALLS_UNMATCHED_PHONE_FIELD || 'Unmatched Phone'
  },
  sync: {
    daysBack: parseInt(process.env.DAYS_BACK || '0'), // Default to 0 for real-time
    backfillGraceSeconds: parseInt(process.env.BACKFILL_GRACE_SECONDS || '300'), // 5 minutes
    defaultRegion: process.env.DEFAULT_REGION || 'SG',
    pageSize: Math.min(parseInt(process.env.PAGE_SIZE || '50'), 50), // Enforce max 50
    displayTimezone: process.env.DISPLAY_TIMEZONE || 'America/New_York',
    realtimeOnly: process.env.REALTIME_ONLY === 'true', // New flag for real-time only mode
    specificDate: process.env.SPECIFIC_DATE && process.env.SPECIFIC_DATE.trim() ? process.env.SPECIFIC_DATE.trim() : null // Format: YYYY-MM-DD
  },
  timeRange: {
    start: process.env.TIME_RANGE_START, // Format: HH:MM (e.g., "04:00" for 4 AM)
    end: process.env.TIME_RANGE_END,     // Format: HH:MM (e.g., "06:00" for 6 AM)
    timezone: process.env.TIME_RANGE_TIMEZONE || 'America/New_York'
  }
};

// Check if time range is configured
function hasTimeRangeConfig() {
  return config.timeRange.start && config.timeRange.end;
}

// Parse time string (HH:MM) to hour and minute
function parseTime(timeStr) {
  if (!timeStr) return null;
  const [hour, minute] = timeStr.split(':').map(n => parseInt(n));
  return { hour, minute };
}

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
  
  // Validate specific date if provided
  if (config.sync.specificDate) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(config.sync.specificDate)) {
      throw new Error('SPECIFIC_DATE must be in YYYY-MM-DD format');
    }
    logger.info(`Using specific date: ${config.sync.specificDate}`);
  }
  
  // Validate time range if configured
  if (hasTimeRangeConfig()) {
    const start = parseTime(config.timeRange.start);
    const end = parseTime(config.timeRange.end);
    
    if (!start || !end) {
      throw new Error('TIME_RANGE_START and TIME_RANGE_END must be in HH:MM format');
    }
    
    if (start.hour < 0 || start.hour > 23 || end.hour < 0 || end.hour > 23) {
      throw new Error('Time range hours must be between 0 and 23');
    }
    
    if (start.minute < 0 || start.minute > 59 || end.minute < 0 || end.minute > 59) {
      throw new Error('Time range minutes must be between 0 and 59');
    }
    
    logger.info(`Time range configured: ${config.timeRange.start} - ${config.timeRange.end} ${config.timeRange.timezone}`);
  }
  
  logger.info('Configuration validated successfully');
  logger.debug({
    dialpadConfigured: !!config.dialpad.apiKey,
    airtableConfigured: !!config.airtable.pat,
    daysBack: config.sync.daysBack,
    pageSize: config.sync.pageSize,
    displayTimezone: config.sync.displayTimezone,
    realtimeOnly: config.sync.realtimeOnly,
    specificDate: config.sync.specificDate,
    hasTimeRange: hasTimeRangeConfig(),
    timeRange: config.timeRange
  }, 'Config details');
}

// Get start of current day in milliseconds
function getStartOfToday() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return startOfDay.getTime();
}

// Get UTC timestamp for a specific date/time in EDT/EST  
function getEDTTimestamp(year, month, day, hour, minute) {
  // Create a date string that can be parsed with timezone
  // Format: "YYYY-MM-DD HH:MM"
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  
  // We need to interpret this as EDT time and convert to UTC
  // EDT is UTC-4 hours (during daylight saving)
  // EST is UTC-5 hours (during standard time)
  
  // For dates in March-November, use EDT (UTC-4)
  // For dates in November-March, use EST (UTC-5)
  let offsetHours = 4; // Default to EDT for September
  if (month < 3 || month > 11) {
    offsetHours = 5; // EST for winter months
  }
  
  // Parse the date string as if it were UTC, then adjust
  const [datePart, timePart] = dateStr.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  
  // Create UTC date for the EDT/EST time
  // Since EDT is UTC-4, if it's 4 AM EDT, it's 8 AM UTC
  const utcDate = Date.UTC(y, m - 1, d, h + offsetHours, min, 0, 0);
  
  return utcDate;
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
    // Ensure timestamps are valid
    if (startedAfter >= startedBefore) {
      logger.warn({
        startedAfter: new Date(startedAfter).toISOString(),
        startedBefore: new Date(startedBefore).toISOString(),
        issue: 'Start time is after or equal to end time'
      }, 'Invalid time window, skipping');
      return { items: [], cursor: null };
    }
    
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
      startedAfterEDT: new Date(startedAfter).toLocaleString('en-US', { timeZone: 'America/New_York' }),
      startedBeforeEDT: new Date(startedBefore).toLocaleString('en-US', { timeZone: 'America/New_York' }),
      startedAfterEpoch: startedAfter,
      startedBeforeEpoch: startedBefore,
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
      
      // Log first call's time if available for debugging
      if (items.length > 0) {
        const firstCall = items[0];
        logger.debug({
          firstCallStart: new Date(parseInt(firstCall.date_started)).toISOString(),
          firstCallStartEDT: new Date(parseInt(firstCall.date_started)).toLocaleString('en-US', { timeZone: 'America/New_York' }),
          firstCallEpoch: firstCall.date_started
        }, 'First call in results');
      }
      
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
    
    // Add response interceptor for debugging
    this.axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          logger.error({
            status: error.response.status,
            data: error.response.data,
            url: error.config?.url,
            body: error.config?.data
          }, 'Airtable API error response');
        }
        return Promise.reject(error);
      }
    );
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
    
    // If time range is configured, use it
    if (hasTimeRangeConfig()) {
      const start = parseTime(config.timeRange.start);
      const end = parseTime(config.timeRange.end);
      
      // Determine the base date
      let year, month, day;
      
      if (config.sync.specificDate) {
        // Use specific date
        [year, month, day] = config.sync.specificDate.split('-').map(n => parseInt(n));
        logger.info(`Using specific date: ${config.sync.specificDate}`);
      } else {
        // Get current date in EDT timezone
        // This is the correct way to get "today" in EDT
        const nowInEDT = new Date().toLocaleString('en-US', { 
          timeZone: 'America/New_York',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric'
        });
        
        // Parse the date parts (format is M/D/YYYY)
        const [monthStr, dayStr, yearStr] = nowInEDT.split('/');
        year = parseInt(yearStr);
        month = parseInt(monthStr);
        day = parseInt(dayStr);
        
        logger.info(`Today in EDT timezone: ${year}-${month}-${day}`);
      }
      
      // Get UTC timestamps for the time range
      // For 4 AM EDT, we need 8 AM UTC (EDT is UTC-4)
      startedAfter = getEDTTimestamp(year, month, day, start.hour, start.minute);
      startedBefore = getEDTTimestamp(year, month, day, end.hour, end.minute);
      
      // Don't go into future
      startedBefore = Math.min(startedBefore, now);
      
      // Detailed debug logging
      logger.info({
        configuredTimeRange: `${config.timeRange.start} - ${config.timeRange.end}`,
        dateUsed: `${year}-${month}-${day}`,
        timezone: 'America/New_York (EDT/UTC-4)',
        calculation: {
          startTimeEDT: `${start.hour}:${String(start.minute).padStart(2, '0')} EDT`,
          startTimeUTC: `${start.hour + 4}:${String(start.minute).padStart(2, '0')} UTC`,
          endTimeEDT: `${end.hour}:${String(end.minute).padStart(2, '0')} EDT`,
          endTimeUTC: `${end.hour + 4}:${String(end.minute).padStart(2, '0')} UTC`
        },
        timestamps: {
          startEpoch: startedAfter,
          endEpoch: startedBefore,
          startUTC: new Date(startedAfter).toISOString(),
          endUTC: new Date(startedBefore).toISOString(),
          startEDT: new Date(startedAfter).toLocaleString('en-US', { timeZone: 'America/New_York' }),
          endEDT: new Date(startedBefore).toLocaleString('en-US', { timeZone: 'America/New_York' })
        },
        currentTime: {
          nowEpoch: now,
          nowUTC: new Date(now).toISOString(),
          nowEDT: new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York' })
        }
      }, 'Time range calculation complete');
      
    } else if (config.sync.specificDate) {
      // Specific date without time range - get whole day
      const [year, month, day] = config.sync.specificDate.split('-').map(n => parseInt(n));
      startedAfter = getEDTTimestamp(year, month, day, 0, 0);
      startedBefore = Math.min(
        getEDTTimestamp(year, month, day, 23, 59),
        now
      );
      
      logger.info({
        specificDate: config.sync.specificDate,
        windowStart: new Date(startedAfter).toISOString(),
        windowEnd: new Date(startedBefore).toISOString()
      }, 'Using specific date (whole day)');
      
    } else if (config.sync.daysBack > 0) {
      // Historical mode
      const daysBackMs = config.sync.daysBack * 24 * 60 * 60 * 1000;
      startedAfter = now - daysBackMs;
      startedBefore = now;
      
      logger.info(`Historical mode: Syncing from ${config.sync.daysBack} days back`);
      
    } else {
      // Default: real-time mode (from last sync or start of today)
      if (lastSyncedMs > 0) {
        startedAfter = lastSyncedMs - backfillGraceMs;
        logger.info('Real-time mode: Syncing from last sync time');
      } else {
        startedAfter = getStartOfToday();
        logger.info('Real-time mode: First sync - starting from today');
      }
    }
    
    // Final validation of time window
    if (startedAfter >= startedBefore) {
      logger.info({
        startedAfter: new Date(startedAfter).toISOString(),
        startedBefore: new Date(startedBefore).toISOString(),
        reason: 'Start time is after or equal to end time'
      }, 'No valid time window for sync');
      return {
        success: true,
        totalCalls: 0,
        matchedCalls: 0,
        unmatchedCalls: 0,
        pagesProcessed: 0,
        note: 'No valid time window'
      };
    }
    
    logger.info({
      mode: hasTimeRangeConfig() ? 'Time Range' : 
            (config.sync.specificDate ? 'Specific Date' : 
            (config.sync.daysBack > 0 ? 'Historical' : 'Real-time')),
      windowStart: new Date(startedAfter).toISOString(),
      windowEnd: new Date(startedBefore).toISOString(),
      windowMinutes: Math.round((startedBefore - startedAfter) / (1000 * 60))
    }, 'Sync window determined');

    // Fetch and process calls with pagination
    let cursor = null;
    let totalCalls = 0;
    let matchedCalls = 0;
    let connectedCalls = 0;
    let missedCalls = 0;
    let pageCount = 0;
    const maxPages = 200; // Safety limit

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
        if (pageCount > 1) {
          logger.info('Continuing with already fetched data...');
          break;
        }
        throw error;
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
        // Parse call data
        const callId = call.call_id || call.id || `${call.date_started}_${call.external_number}`;
        const startTime = parseInt(call.date_started);
        const connectedTime = call.date_connected ? parseInt(call.date_connected) : null;
        const endTime = call.date_ended ? parseInt(call.date_ended) : null;
        const duration = formatDuration(call.duration);
        const externalNumber = call.external_number;
        const direction = call.direction;
        const wasConnected = !!connectedTime; // True if call was answered
        
        // Count connected vs missed calls
        if (wasConnected) {
          connectedCalls++;
        } else {
          missedCalls++;
        }
        
        // Normalize phone number
        const normalizedPhone = normalizePhone(externalNumber);

        // Build call record for Airtable - ONLY USE FIELDS THAT EXIST
        const callRecord = {
          'Call ID': callId,
          'Direction': direction === 'inbound' ? 'Inbound' : 'Outbound',
          'Start Time': new Date(startTime).toISOString(),
          'Date Connected': connectedTime ? new Date(connectedTime).toISOString() : null, // NEW FIELD - ADD THIS TO AIRTABLE
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
        if (normalizedPhone && customerPhoneMap.has(normalizedPhone)) {
          callRecord[config.fields.callsCustomerLink] = [customerPhoneMap.get(normalizedPhone)];
          matchedCalls++;
        } else {
          callRecord[config.fields.callsUnmatchedPhone] = externalNumber || 'Unknown';
        }

        callsToUpsert.push(callRecord);
        totalCalls++;
        
        if (totalCalls === 1) {
          logger.debug({ 
            callRecord,
            originalData: {
              date_started: call.date_started,
              date_connected: call.date_connected,
              date_ended: call.date_ended,
              wasConnected: wasConnected
            }
          }, 'First call record to be upserted');
        }
      }

      // Upsert calls to Airtable
      if (callsToUpsert.length > 0) {
        logger.info(`Upserting ${callsToUpsert.length} calls to Airtable...`);
        try {
          await airtable.upsertCalls(callsToUpsert);
          logger.info(`Successfully upserted ${callsToUpsert.length} calls`);
        } catch (error) {
          logger.error('Failed to upsert calls to Airtable:', error.message);
        }
      }

      // Update state after each page
      await state.setLastSynced(Math.floor(now / 1000));
      
      // Update cursor for next iteration
      cursor = nextCursor;
      
      // Add delay to avoid rate limiting
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Safety check
      if (pageCount >= maxPages) {
        logger.warn(`Reached maximum page limit (${maxPages}), stopping sync`);
        break;
      }
      
    } while (cursor);

    // Final summary
    logger.info({
      totalCalls,
      connectedCalls,
      missedCalls,
      matchedCalls,
      unmatchedCalls: totalCalls - matchedCalls,
      matchRate: totalCalls > 0 ? `${(matchedCalls / totalCalls * 100).toFixed(2)}%` : 'N/A',
      connectionRate: totalCalls > 0 ? `${(connectedCalls / totalCalls * 100).toFixed(2)}%` : 'N/A',
      pagesProcessed: pageCount
    }, 'Sync completed');

    return {
      success: true,
      totalCalls,
      connectedCalls,
      missedCalls,
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