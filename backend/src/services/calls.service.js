const axios = require('axios');
const { parsePhoneNumber } = require('libphonenumber-js');

class CallsService {
  constructor() {
    this.airtableClient = this.initAirtableClient();
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
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    const {
      page = 1,
      limit = 50,
      search,
      direction,
      matched,
      startDate,
      endDate
    } = options;

    try {
      // Build filter formula
      const filters = [];
      
      if (search) {
        filters.push(`OR(SEARCH("${search}", From), SEARCH("${search}", To))`);
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
        // Note: Airtable uses offset-based pagination
        // This is a simplified approach
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
    } catch (error) {
      console.error('Error fetching calls:', error);
      throw new Error('Failed to fetch calls');
    }
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
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    const { startDate, endDate } = options;

    try {
      // Build filter
      const filters = [];
      if (startDate) filters.push(`{Start Time} >= "${startDate}"`);
      if (endDate) filters.push(`{Start Time} <= "${endDate}"`);
      const filterFormula = filters.length > 0 ? `AND(${filters.join(', ')})` : '';

      // Fetch all calls for the period (simplified - in production, handle pagination)
      const params = {
        pageSize: 100,
        fields: ['Duration (s)', 'Direction', 'Customer']
      };
      
      if (filterFormula) {
        params.filterByFormula = filterFormula;
      }

      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CALLS_TABLE || 'Calls')}`,
        { params }
      );

      const calls = response.data.records;
      
      // Calculate statistics
      const stats = {
        totalCalls: calls.length,
        totalDuration: 0,
        inboundCalls: 0,
        outboundCalls: 0,
        matchedCalls: 0,
        unmatchedCalls: 0,
        averageDuration: 0
      };

      calls.forEach(call => {
        const duration = call.fields['Duration (s)'] || 0;
        stats.totalDuration += duration;
        
        if (call.fields.Direction === 'Inbound') {
          stats.inboundCalls++;
        } else if (call.fields.Direction === 'Outbound') {
          stats.outboundCalls++;
        }
        
        if (call.fields.Customer) {
          stats.matchedCalls++;
        } else {
          stats.unmatchedCalls++;
        }
      });

      if (stats.totalCalls > 0) {
        stats.averageDuration = Math.round(stats.totalDuration / stats.totalCalls);
      }

      return stats;
    } catch (error) {
      console.error('Error fetching call stats:', error);
      throw new Error('Failed to fetch call statistics');
    }
  }

  async exportCalls(filters = {}) {
    const calls = await this.getCalls({ ...filters, limit: 1000 });
    
    // Convert to CSV
    const headers = ['Call ID', 'From', 'To', 'Start Time', 'Duration (s)', 'Direction', 'Customer'];
    const rows = calls.data.map(call => [
      call['Call ID'] || '',
      call.From || '',
      call.To || '',
      call['Start Time'] || '',
      call['Duration (s)'] || '0',
      call.Direction || '',
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