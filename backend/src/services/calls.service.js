const axios = require('axios');

class CallsService {
  constructor() {
    this.dialpadClient = this.initDialpadClient();
    this.airtableClient = this.initAirtableClient();
  }

  initDialpadClient() {
    if (!process.env.DIALPAD_API_KEY) {
      return null;
    }

    return axios.create({
      baseURL: process.env.DIALPAD_BASE_URL || 'https://dialpad.com',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${process.env.DIALPAD_API_KEY}`
      },
      timeout: 30000
    });
  }

  initAirtableClient() {
    if (!process.env.AIRTABLE_PAT || !process.env.AIRTABLE_BASE_ID) {
      return null;
    }

    return axios.create({
      baseURL: `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`,
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async getCalls(options = {}) {
    const {
      page = 1,
      limit = 50,
      search,
      direction,
      matched,
      startDate,
      endDate
    } = options;

    // First try to get from Airtable
    if (this.airtableClient) {
      try {
        return await this.getCallsFromAirtable(options);
      } catch (error) {
        console.error('Failed to get calls from Airtable:', error);
      }
    }

    // Fallback to Dialpad direct API
    if (this.dialpadClient && startDate && endDate) {
      return await this.getCallsFromDialpad(options);
    }

    throw new Error('No data source configured');
  }

  async getCallsFromDialpad(options) {
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      direction
    } = options;

    // Convert dates to timestamps
    const startedAfter = new Date(startDate).getTime();
    const startedBefore = new Date(endDate).getTime();

    const params = {
      started_after: startedAfter,
      started_before: startedBefore,
      limit
    };

    const response = await this.dialpadClient.get('/api/v2/call', { params });
    
    // Transform Dialpad response to our format
    const calls = (response.data.items || []).map(call => ({
      id: call.id || call.call_id || `${call.date_started}_${call.external_number}`,
      'Call ID': call.id || call.call_id,
      'Direction': call.direction === 'inbound' ? 'Inbound' : 'Outbound',
      'External Number': call.external_number,
      'Contact Name': call.contact?.name || 'Unknown',
      'Target': call.target?.name || 'N/A',
      'Start Time': new Date(parseInt(call.date_started)).toISOString(),
      'End Time': call.date_ended ? new Date(parseInt(call.date_ended)).toISOString() : null,
      'Duration (s)': Math.floor((call.duration || 0) / 1000),
      'Was Recorded': call.was_recorded || false,
      'Recording URL': call.recording_url?.[0] || call.admin_recording_urls?.[0] || null,
      'MOS Score': call.mos_score || null
    }));

    // Filter by direction if specified
    const filteredCalls = direction 
      ? calls.filter(c => c.Direction.toLowerCase() === direction.toLowerCase())
      : calls;

    return {
      data: filteredCalls,
      pagination: {
        page,
        limit,
        hasMore: response.data.cursor ? true : false
      }
    };
  }

  async getCallsFromAirtable(options) {
    const {
      page = 1,
      limit = 50,
      search,
      direction,
      matched,
      startDate,
      endDate
    } = options;

    // Build filter formula
    const filters = [];
    
    if (search) {
      filters.push(`OR(SEARCH("${search}", {External Number}), SEARCH("${search}", {Contact Name}))`);
    }
    
    if (direction) {
      filters.push(`Direction = "${direction}"`);
    }
    
    if (matched === true) {
      filters.push('NOT({Customer} = "")');
    } else if (matched === false) {
      filters.push('{Customer} = ""');
    }
    
    if (startDate) {
      filters.push(`{Start Time} >= "${startDate}"`);
    }
    
    if (endDate) {
      filters.push(`{Start Time} <= "${endDate}"`);
    }

    const filterFormula = filters.length > 0 ? `AND(${filters.join(', ')})` : '';

    // Make request to Airtable
    const params = {
      pageSize: limit,
      sort: [{ field: 'Start Time', direction: 'desc' }]
    };
    
    if (filterFormula) {
      params.filterByFormula = filterFormula;
    }

    // Calculate offset for pagination
    if (page > 1) {
      params.offset = (page - 1) * limit;
    }

    const response = await this.airtableClient.get(
      `/${encodeURIComponent(process.env.AIRTABLE_CALLS_TABLE || 'Calls')}`,
      { params }
    );

    return {
      data: response.data.records.map(record => ({
        id: record.id,
        ...record.fields
      })),
      pagination: {
        page,
        limit,
        hasMore: !!response.data.offset
      }
    };
  }

  async getCallById(id) {
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    try {
      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CALLS_TABLE || 'Calls')}/${id}`
      );

      return {
        id: response.data.id,
        ...response.data.fields
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error('Failed to fetch call');
    }
  }

  async getCallStats(options = {}) {
    const { startDate, endDate } = options;
    
    // Get calls for the period
    const response = await this.getCalls({
      startDate,
      endDate,
      limit: 1000 // Get more records for stats
    });

    const calls = response.data;
    
    // Calculate statistics
    const stats = {
      totalCalls: calls.length,
      totalDuration: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      matchedCalls: 0,
      unmatchedCalls: 0,
      averageDuration: 0,
      recordedCalls: 0
    };

    calls.forEach(call => {
      const duration = call['Duration (s)'] || 0;
      stats.totalDuration += duration;
      
      if (call.Direction === 'Inbound') {
        stats.inboundCalls++;
      } else if (call.Direction === 'Outbound') {
        stats.outboundCalls++;
      }
      
      if (call.Customer) {
        stats.matchedCalls++;
      } else {
        stats.unmatchedCalls++;
      }
      
      if (call['Was Recorded']) {
        stats.recordedCalls++;
      }
    });

    if (stats.totalCalls > 0) {
      stats.averageDuration = Math.round(stats.totalDuration / stats.totalCalls);
    }

    return stats;
  }

  async exportCalls(filters = {}) {
    const calls = await this.getCalls({ ...filters, limit: 1000 });
    
    // Convert to CSV
    const headers = [
      'Call ID',
      'Direction', 
      'Contact Name',
      'External Number',
      'Target',
      'Start Time',
      'Duration (s)',
      'Was Recorded',
      'Recording URL',
      'MOS Score',
      'Customer'
    ];
    
    const rows = calls.data.map(call => [
      call['Call ID'] || '',
      call.Direction || '',
      call['Contact Name'] || '',
      call['External Number'] || '',
      call.Target || '',
      call['Start Time'] || '',
      call['Duration (s)'] || '0',
      call['Was Recorded'] ? 'Yes' : 'No',
      call['Recording URL'] || '',
      call['MOS Score'] || '',
      call.Customer ? 'Matched' : 'Unmatched'
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csv;
  }
}

module.exports = CallsService;