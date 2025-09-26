const axios = require('axios');

class CustomersService {
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

  async getCustomers(options = {}) {
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    const {
      page = 1,
      limit = 50,
      search,
      hasPhone
    } = options;

    try {
      const params = {
        pageSize: limit
      };

      // Build filter
      const filters = [];
      if (search) {
        filters.push(`SEARCH("${search}", {Name})`);
      }
      if (hasPhone) {
        filters.push('NOT({Phone} = "")');
      }

      if (filters.length > 0) {
        params.filterByFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
      }

      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CUSTOMERS_TABLE || 'Customers')}`,
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
      console.error('Error fetching customers:', error);
      throw new Error('Failed to fetch customers');
    }
  }

  async getCustomerById(id) {
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    try {
      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CUSTOMERS_TABLE || 'Customers')}/${id}`
      );

      return {
        id: response.data.id,
        ...response.data.fields
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error('Failed to fetch customer');
    }
  }

  async getCustomerCalls(customerId, options = {}) {
    if (!this.airtableClient) {
      throw new Error('Airtable not configured');
    }

    const { page = 1, limit = 20 } = options;

    try {
      const filterFormula = `SEARCH("${customerId}", {Customer})`;
      
      const response = await this.airtableClient.get(
        `/${encodeURIComponent(process.env.AIRTABLE_CALLS_TABLE || 'Calls')}`,
        {
          params: {
            filterByFormula,
            pageSize: limit,
            sort: [{ field: 'Start Time', direction: 'desc' }]
          }
        }
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
      console.error('Error fetching customer calls:', error);
      throw new Error('Failed to fetch customer calls');
    }
  }

  async syncCustomers() {
    // This would trigger a fresh sync from Airtable
    // In production, this might update a local cache
    return {
      success: true,
      message: 'Customer sync initiated',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = CustomersService;