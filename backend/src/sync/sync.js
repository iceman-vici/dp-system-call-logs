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
    start: process.env.TIME_RANGE_START, // Format: HH:MM (e.g., "16:00" for 4 PM)
    end: process.env.TIME_RANGE_END,     // Format: HH:MM (e.g., "18:00" for 6 PM)
    timezone: process.env.TIME_RANGE_TIMEZONE || 'America/New_York'
  },
  businessHours: {
    enabled: process.env.BUSINESS_HOURS_ENABLED === 'true',
    startHour: parseInt(process.env.BUSINESS_HOURS_START || '9'), // 9 AM
    endHour: parseInt(process.env.BUSINESS_HOURS_END || '18'), // 6 PM (18:00)
    timezone: process.env.BUSINESS_HOURS_TIMEZONE || 'America/New_York'
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
  
  // Validate business hours if enabled and no time range
  if (!hasTimeRangeConfig() && config.businessHours.enabled) {
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
    specificDate: config.sync.specificDate,
    hasTimeRange: hasTimeRangeConfig(),
    timeRange: config.timeRange,
    businessHours: config.businessHours
  }, 'Config details');
}

// Get specific time range window for a given date in UTC milliseconds
function getTimeRangeWindow() {
  const start = parseTime(config.timeRange.start);
  const end = parseTime(config.timeRange.end);
  
  let baseDate;
  
  // Determine which date to use
  if (config.sync.specificDate) {
    // Parse YYYY-MM-DD format
    const [year, month, day] = config.sync.specificDate.split('-').map(n => parseInt(n));
    baseDate = new Date(year, month - 1, day); // month is 0-indexed in JS
    logger.info(`Using specific date: ${config.sync.specificDate}`);
  } else {
    // Default to today when SPECIFIC_DATE is empty/not set
    baseDate = new Date();
    logger.info('Using today for time range');
  }
  
  // Get year, month, day for the target date in the timezone
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeRange.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  
  const parts = tzFormatter.formatToParts(baseDate);
  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1; // JS months are 0-indexed
  const day = parseInt(parts.find(p => p.type === 'day').value);
  
  // Create date objects for start and end times in the local timezone
  // Then we'll convert them to UTC
  const startDateTime = new Date(
    Date.UTC(year, month, day, start.hour, start.minute, 0, 0)
  );
  const endDateTime = new Date(
    Date.UTC(year, month, day, end.hour, end.minute, 0, 0)
  );
  
  // Adjust for timezone offset
  // For EDT (UTC-4), we need to add 4 hours to the UTC time to get the local time
  const now = new Date();
  const tzOffset = getTimezoneOffsetHours(config.timeRange.timezone);
  
  const startTimestamp = startDateTime.getTime() + (tzOffset * 60 * 60 * 1000);
  const endTimestamp = endDateTime.getTime() + (tzOffset * 60 * 60 * 1000);
  
  // Don't go into the future
  const finalEnd = Math.min(endTimestamp, Date.now());
  
  logger.debug({
    baseDate: baseDate.toDateString(),
    targetDate: `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    timeRange: `${config.timeRange.start} - ${config.timeRange.end}`,
    timezone: config.timeRange.timezone,
    tzOffsetHours: tzOffset,
    startUTC: new Date(startTimestamp).toISOString(),
    endUTC: new Date(finalEnd).toISOString(),
    startLocal: new Date(startTimestamp).toLocaleString('en-US', { timeZone: config.timeRange.timezone }),
    endLocal: new Date(finalEnd).toLocaleString('en-US', { timeZone: config.timeRange.timezone })
  }, 'Time range calculation details');
  
  return {
    start: startTimestamp,
    end: finalEnd,
    configured: `${config.timeRange.start} - ${config.timeRange.end} ${config.timeRange.timezone}`,
    date: `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  };
}

// Get timezone offset in hours (EDT = -4, EST = -5, etc.)
function getTimezoneOffsetHours(timezone) {
  const now = new Date();
  
  // Check if we're in DST
  const month = now.getMonth() + 1;
  let isDST = false;
  
  // Simple DST check for US Eastern time
  if (timezone.includes('New_York')) {
    // DST is roughly March-November
    if (month >= 3 && month <= 11) {
      if (month > 3 && month < 11) {
        isDST = true;
      } else if (month === 3) {
        // DST starts second Sunday in March
        isDST = now.getDate() >= 10;
      } else if (month === 11) {
        // DST ends first Sunday in November  
        isDST = now.getDate() < 3;
      }
    }
    return isDST ? -4 : -5; // EDT = UTC-4, EST = UTC-5
  }
  
  return 0; // Default to no offset if not Eastern time
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
    
    // Use specific time range if configured
    if (hasTimeRangeConfig()) {
      const timeWindow = getTimeRangeWindow();
      startedAfter = timeWindow.start;
      startedBefore = timeWindow.end;
      
      logger.info({
        timeRange: timeWindow.configured,
        date: timeWindow.date,
        windowStart: new Date(timeWindow.start).toISOString(),
        windowEnd: new Date(timeWindow.end).toISOString(),
        note: config.sync.specificDate ? `Using specific date: ${config.sync.specificDate}` : 'Using today'
      }, 'Time range window set');
      
    } else if (config.sync.specificDate) {
      // Use specific date without time range - fetch whole day
      const [year, month, day] = config.sync.specificDate.split('-').map(n => parseInt(n));
      const specificDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
      
      // Adjust for timezone
      const tzOffset = getTimezoneOffsetHours(config.sync.displayTimezone || 'America/New_York');
      startedAfter = specificDate.getTime() + (tzOffset * 60 * 60 * 1000);
      startedBefore = Math.min(nextDay.getTime() + (tzOffset * 60 * 60 * 1000), now);
      
      logger.info({
        specificDate: config.sync.specificDate,
        windowStart: new Date(startedAfter).toISOString(),
        windowEnd: new Date(startedBefore).toISOString(),
        note: 'Using specific date configuration (whole day)'
      }, 'Date window set');
      
    } else if (config.sync.daysBack > 0) {
      // Historical mode: sync from X days back
      const daysBackMs = config.sync.daysBack * 24 * 60 * 60 * 1000;
      startedAfter = now - daysBackMs;
      startedBefore = now;
      
      logger.info({
        daysBack: config.sync.daysBack,
        windowStart: new Date(startedAfter).toISOString(),
        windowEnd: new Date(startedBefore).toISOString()
      }, `Historical mode: Syncing from ${config.sync.daysBack} days back`);
      
    } else {
      // Real-time mode (today)
      if (lastSyncedMs > 0) {
        startedAfter = lastSyncedMs - backfillGraceMs;
        logger.info('Real-time mode: Syncing from last sync time');
      } else {
        startedAfter = getStartOfToday();
        logger.info('Real-time mode: First sync - starting from today');
      }
      startedBefore = now;
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
        note: 'No valid time window - check your time range configuration'
      };
    }
    
    logger.info({
      mode: hasTimeRangeConfig() ? 'Specific Time Range' : 
            (config.sync.specificDate ? 'Specific Date' : 
            (config.sync.daysBack > 0 ? 'Historical' : 'Real-time')),
      lastSynced: lastSyncedMs > 0 ? new Date(lastSyncedMs).toISOString() : 'Never',
      startedAfter: new Date(startedAfter).toISOString(),
      startedBefore: new Date(startedBefore).toISOString(),
      timeWindow: `${Math.round((startedBefore - startedAfter) / (1000 * 60))} minutes`
    }, 'Sync window determined');

    // Fetch and process calls with pagination
    let cursor = null;
    let totalCalls = 0;
    let matchedCalls = 0;
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
        const endTime = call.date_ended ? parseInt(call.date_ended) : null;
        const duration = formatDuration(call.duration); // Convert to seconds
        const externalNumber = call.external_number;
        const direction = call.direction; // 'inbound' or 'outbound'
        
        // Normalize phone number
        const normalizedPhone = normalizePhone(externalNumber);

        // Build call record for Airtable - only use fields that exist and are writable
        const callRecord = {
          'Call ID': callId,
          'Direction': direction === 'inbound' ? 'Inbound' : 'Outbound',
          'Start Time': new Date(startTime).toISOString(),
          'End Time': endTime ? new Date(endTime).toISOString() : null,
          'Duration (s)': duration,
          'Contact Name': call.contact?.name || 'Unknown',
          'Target': call.target?.name || 'N/A',
          'Was Recorded': call.was_recorded || false,
          'MOS Score': call.mos_score || null
        };
        
        // Note: Call Date is a computed field in Airtable, so we don't set it
        // It will be automatically calculated from Start Time

        // Add recording URL if available (direct URL without share link conversion)
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
          // Store unmatched phone number
          callRecord[config.fields.callsUnmatchedPhone] = externalNumber || 'Unknown';
        }

        callsToUpsert.push(callRecord);
        totalCalls++;
        
        // Log the first call to debug field mapping
        if (totalCalls === 1) {
          logger.debug({ callRecord }, 'First call record to be upserted');
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
          matchedSoFar: matchedCalls,
          hasMore: !!cursor
        }
      }, 'Page processing complete');
      
    } while (cursor);

    // Final summary
    if (totalCalls === 0) {
      logger.info('No new calls to sync for the specified time period');
    } else {
      logger.info({
        totalCalls,
        matchedCalls,
        unmatchedCalls: totalCalls - matchedCalls,
        matchRate: totalCalls > 0 ? (matchedCalls / totalCalls * 100).toFixed(2) + '%' : 'N/A',
        pagesProcessed: pageCount
      }, 'Sync completed successfully');
    }

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