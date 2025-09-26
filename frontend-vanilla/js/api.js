// API Client
class ApiClient {
    constructor() {
        this.baseURL = CONFIG.API_URL;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            
            return await response.text();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Sync endpoints
    getSyncStatus() {
        return this.request(API_ENDPOINTS.SYNC_STATUS);
    }

    triggerSync() {
        return this.request(API_ENDPOINTS.SYNC_TRIGGER, { method: 'POST' });
    }

    getSyncHistory() {
        return this.request(API_ENDPOINTS.SYNC_HISTORY);
    }

    resetSyncState() {
        return this.request(API_ENDPOINTS.SYNC_RESET, { method: 'POST' });
    }

    // Call endpoints
    getCalls(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`${API_ENDPOINTS.CALLS}?${queryString}`);
    }

    getCallStats(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`${API_ENDPOINTS.CALL_STATS}?${queryString}`);
    }

    async exportCalls(filters = {}) {
        const response = await fetch(`${this.baseURL}${API_ENDPOINTS.CALL_EXPORT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filters })
        });
        
        if (!response.ok) {
            throw new Error('Export failed');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `calls-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    // Analytics endpoints
    getAnalyticsOverview(period = '7d') {
        return this.request(`${API_ENDPOINTS.ANALYTICS_OVERVIEW}?period=${period}`);
    }

    getAnalyticsTrends(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`${API_ENDPOINTS.ANALYTICS_TRENDS}?${queryString}`);
    }

    getHourlyDistribution(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`${API_ENDPOINTS.ANALYTICS_HOURLY}?${queryString}`);
    }

    // Customer endpoints
    getCustomers(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`${API_ENDPOINTS.CUSTOMERS}?${queryString}`);
    }

    getCustomerCalls(customerId) {
        return this.request(`${API_ENDPOINTS.CUSTOMERS}/${customerId}/calls`);
    }

    syncCustomers() {
        return this.request(API_ENDPOINTS.CUSTOMERS_SYNC, { method: 'POST' });
    }

    // Config endpoints
    getConfig() {
        return this.request(API_ENDPOINTS.CONFIG);
    }

    testConnection(service) {
        return this.request(API_ENDPOINTS.CONFIG_TEST, {
            method: 'POST',
            body: JSON.stringify({ service })
        });
    }

    // Health endpoints
    getHealth() {
        return this.request(API_ENDPOINTS.HEALTH);
    }

    getDetailedHealth() {
        return this.request(API_ENDPOINTS.HEALTH_DETAILED);
    }
}

// Create global API instance
const api = new ApiClient();