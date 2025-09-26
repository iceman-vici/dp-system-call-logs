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
    realtimeOnly: process.env.REALTIME_ONLY === 'true' // New flag for real-time only mode
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
    hasTimeRange: hasTimeRangeConfig(),
    timeRange: config.timeRange,
    businessHours: config.businessHours
  }, 'Config details');
}

// Get specific time range window for today in UTC milliseconds
function getTimeRangeWindow() {
  const start = parseTime(config.timeRange.start);
  const end = parseTime(config.timeRange.end);
  
  const now = new Date();
  
  // Create date strings in the target timezone
  // We need to create dates that represent "today at X time in timezone Y"
  const options = { timeZone: config.timeRange.timezone };
  const tzNow = new Date(now.toLocaleString('en-US', options));
  
  // Create today's date at the specified times in the target timezone
  const year = tzNow.getFullYear();
  const month = tzNow.getMonth();
  const day = tzNow.getDate();
  
  // Create local date objects for start and end times
  const startLocal = new Date(year, month, day, start.hour, start.minute, 0, 0);
  const endLocal = new Date(year, month, day, end.hour, end.minute, 0, 0);
  
  // Now we need to figure out what these times are in UTC
  // We'll use a different approach: format the dates in the target timezone and parse them
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeRange.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Get current date in the timezone to ensure we're on the right day
  const tzParts = formatter.formatToParts(now);
  const tzYear = tzParts.find(p => p.type === 'year').value;
  const tzMonth = tzParts.find(p => p.type === 'month').value;
  const tzDay = tzParts.find(p => p.type === 'day').value;
  
  // Build ISO strings for the start and end times in the target timezone
  const startDateStr = `${tzYear}-${tzMonth}-${tzDay}T${start.hour.toString().padStart(2, '0')}:${start.minute.toString().padStart(2, '0')}:00`;
  const endDateStr = `${tzYear}-${tzMonth}-${tzDay}T${end.hour.toString().padStart(2, '0')}:${end.minute.toString().padStart(2, '0')}:00`;
  
  // These dates are in the local timezone, but represent the target timezone times
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  
  // Get the timezone offset for New York (EDT is UTC-4, EST is UTC-5)
  const isDST = isDaylightSavingTime(now, config.timeRange.timezone);
  const offsetHours = config.timeRange.timezone.includes('New_York') ? (isDST ? 4 : 5) : 0;
  const offsetMs = offsetHours * 60 * 60 * 1000;
  
  // Add the offset to get UTC time
  const startTimestamp = startDate.getTime() + offsetMs;
  const endTimestamp = endDate.getTime() + offsetMs;
  
  // Don't go into the future
  const finalEnd = Math.min(endTimestamp, Date.now());
  
  logger.debug({
    localStart: startDateStr,
    localEnd: endDateStr,
    isDST,
    offsetHours,
    startTimestamp,
    endTimestamp,
    startUTC: new Date(startTimestamp).toISOString(),
    endUTC: new Date(finalEnd).toISOString()
  }, 'Time range calculation details');
  
  return {
    start: startTimestamp,
    end: finalEnd,
    configured: `${config.timeRange.start} - ${config.timeRange.end} ${config.timeRange.timezone}`
  };
}

// Check if currently in DST for a timezone
function isDaylightSavingTime(date, timezone) {
  // For US timezones, DST runs from second Sunday in March to first Sunday in November
  const month = date.getMonth() + 1; // JavaScript months are 0-indexed
  
  // Definitely in DST (April-October)
  if (month >= 4 && month <= 10) return true;
  
  // Definitely not in DST (December-February)
  if (month === 12 || month === 1 || month === 2) return false;
  
  // March and November need more careful checking
  // For now, we'll use a simple approximation
  // In 2024-2025, DST starts March 10 and ends November 3
  if (month === 3) return date.getDate() >= 10;
  if (month === 11) return date.getDate() < 3;
  
  return false;
}

// Get start of current day in milliseconds
function getStartOfToday() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return startOfDay.getTime();
}

// Extract recording ID from URL
function extractRecordingId(url) {
  if (!url) return null;
  
  // URL format: https://dialpad.com/blob/adminrecording/5572425564274688.mp3
  // Or: https://dialpad.com/recording/5572425564274688
  const match = url.match(/\/(\d+)(?:\.mp3)?(?:\?.*)?$/);
  return match ? match[1] : null;
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

  async getRecordingShareLink(recordingId, recordingType = 'admincallrecording') {
    if (!recordingId) return null;
    
    try {
      logger.debug(`Getting share link for recording ${recordingId}`);
      
      const response = await this.axios.post('/api/v2/recordingsharelink', {
        recording_id: recordingId,
        recording_type: recordingType,
        privacy: 'public'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      // The response should contain an access_link
      if (response.data && response.data.access_link) {
        logger.debug(`Got share link for recording ${recordingId}: ${response.data.access_link}`);
        return response.data.access_link;
      }
      
      logger.warn(`No access_link in response for recording ${recordingId}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get share link for recording ${recordingId}:`, error.message);
      // Return null instead of throwing to continue processing other calls
      return null;
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
        windowStart: new Date(timeWindow.start).toISOString(),
        windowEnd: new Date(timeWindow.end).toISOString(),
        note: 'Using specific time range configuration'
      }, 'Time range window set');
      
    } else if (config.sync.realtimeOnly || config.sync.daysBack === 0) {
      // Real-time mode
      if (lastSyncedMs > 0) {
        startedAfter = lastSyncedMs - backfillGraceMs;
        logger.info('Real-time mode: Syncing from last sync time');
      } else {
        startedAfter = getStartOfToday();
        logger.info('Real-time mode: First sync - starting from today');
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
      mode: hasTimeRangeConfig() ? 'Specific Time Range' : (config.sync.realtimeOnly ? 'Real-time' : 'Historical'),
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

        // Handle recording URL - get shareable link
        let recordingUrl = null;
        if (call.recording_url && call.recording_url.length > 0) {
          recordingUrl = call.recording_url[0];
        } else if (call.admin_recording_urls && call.admin_recording_urls.length > 0) {
          recordingUrl = call.admin_recording_urls[0];
        }
        
        if (recordingUrl) {
          const recordingId = extractRecordingId(recordingUrl);
          if (recordingId) {
            logger.debug(`Getting share link for recording ${recordingId}`);
            const shareLink = await dialpad.getRecordingShareLink(recordingId);
            if (shareLink) {
              callRecord['Recording URL'] = shareLink;
            } else {
              // Fall back to original URL if share link fails
              callRecord['Recording URL'] = recordingUrl;
            }
          } else {
            // Use original URL if we can't extract ID
            callRecord['Recording URL'] = recordingUrl;
          }
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