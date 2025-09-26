const axios = require('axios');

class AnalyticsService {
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

  async getOverview(period = '7d') {
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    // Calculate date range based on period
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    try {
      // Fetch calls for the period
      const filterFormula = `AND({Start Time} >= "${startDate.toISOString()}", {Start Time} <= "${endDate.toISOString()}")`;
      
      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CALLS_TABLE || 'Calls')}`,
        {
          params: {
            filterByFormula: filterFormula,
            pageSize: 100
          }
        }
      );

      const calls = response.data.records;

      // Calculate metrics
      const overview = {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalCalls: calls.length,
        totalDuration: 0,
        avgCallDuration: 0,
        inboundCalls: 0,
        outboundCalls: 0,
        matchRate: 0,
        peakHour: null,
        topCustomers: []
      };

      // Process calls
      const hourDistribution = {};
      const customerCalls = {};
      let matchedCalls = 0;

      calls.forEach(call => {
        const fields = call.fields;
        
        // Duration
        overview.totalDuration += fields['Duration (s)'] || 0;
        
        // Direction
        if (fields.Direction === 'Inbound') {
          overview.inboundCalls++;
        } else if (fields.Direction === 'Outbound') {
          overview.outboundCalls++;
        }
        
        // Matched
        if (fields.Customer) {
          matchedCalls++;
          // Track customer calls
          const customerId = fields.Customer[0];
          customerCalls[customerId] = (customerCalls[customerId] || 0) + 1;
        }
        
        // Hour distribution
        if (fields['Start Time']) {
          const hour = new Date(fields['Start Time']).getHours();
          hourDistribution[hour] = (hourDistribution[hour] || 0) + 1;
        }
      });

      // Calculate averages and rates
      if (overview.totalCalls > 0) {
        overview.avgCallDuration = Math.round(overview.totalDuration / overview.totalCalls);
        overview.matchRate = Math.round((matchedCalls / overview.totalCalls) * 100);
      }

      // Find peak hour
      const peakHourEntry = Object.entries(hourDistribution)
        .sort((a, b) => b[1] - a[1])[0];
      if (peakHourEntry) {
        overview.peakHour = {
          hour: parseInt(peakHourEntry[0]),
          calls: peakHourEntry[1]
        };
      }

      // Top customers (simplified - would need customer names in production)
      overview.topCustomers = Object.entries(customerCalls)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([customerId, callCount]) => ({
          customerId,
          callCount
        }));

      return overview;
    } catch (error) {
      console.error('Error getting analytics overview:', error);
      throw new Error('Failed to get analytics overview');
    }
  }

  async getTrends(options = {}) {
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    const { startDate, endDate, groupBy = 'day' } = options;

    try {
      // Build filter
      const filters = [];
      if (startDate) filters.push(`{Start Time} >= "${startDate}"`);
      if (endDate) filters.push(`{Start Time} <= "${endDate}"`);
      const filterFormula = filters.length > 0 ? `AND(${filters.join(', ')})` : '';

      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CALLS_TABLE || 'Calls')}`,
        {
          params: {
            filterByFormula: filterFormula,
            pageSize: 100,
            fields: ['Start Time', 'Duration (s)', 'Direction']
          }
        }
      );

      const calls = response.data.records;
      const trendData = {};

      calls.forEach(call => {
        if (call.fields['Start Time']) {
          const date = new Date(call.fields['Start Time']);
          let key;

          switch (groupBy) {
            case 'hour':
              key = `${date.toISOString().slice(0, 13)}:00`;
              break;
            case 'day':
              key = date.toISOString().slice(0, 10);
              break;
            case 'week':
              const weekStart = new Date(date);
              weekStart.setDate(weekStart.getDate() - weekStart.getDay());
              key = weekStart.toISOString().slice(0, 10);
              break;
            case 'month':
              key = date.toISOString().slice(0, 7);
              break;
            default:
              key = date.toISOString().slice(0, 10);
          }

          if (!trendData[key]) {
            trendData[key] = {
              date: key,
              totalCalls: 0,
              inboundCalls: 0,
              outboundCalls: 0,
              totalDuration: 0
            };
          }

          trendData[key].totalCalls++;
          trendData[key].totalDuration += call.fields['Duration (s)'] || 0;
          
          if (call.fields.Direction === 'Inbound') {
            trendData[key].inboundCalls++;
          } else if (call.fields.Direction === 'Outbound') {
            trendData[key].outboundCalls++;
          }
        }
      });

      // Convert to array and sort
      const trends = Object.values(trendData).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
      );

      return {
        groupBy,
        data: trends
      };
    } catch (error) {
      console.error('Error getting trends:', error);
      throw new Error('Failed to get trends');
    }
  }

  async getAgentStats(options = {}) {
    // Simplified implementation - would need agent data from Dialpad
    return {
      agents: [
        {
          id: 'agent1',
          name: 'Agent 1',
          totalCalls: 45,
          avgDuration: 180,
          inboundCalls: 30,
          outboundCalls: 15
        }
      ]
    };
  }

  async getCustomerStats(options = {}) {
    // Simplified implementation
    return {
      topCallers: [],
      newCustomers: 0,
      returningCustomers: 0
    };
  }

  async getHourlyDistribution(options = {}) {
    // Simplified implementation
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      calls: Math.floor(Math.random() * 20)
    }));

    return { distribution: hours };
  }
}

module.exports = AnalyticsService;