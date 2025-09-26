// Configuration
const CONFIG = {
    API_URL: 'http://localhost:3001',
    WS_URL: 'ws://localhost:3001',
    ENABLE_WEBSOCKET: true,
    REFRESH_INTERVAL: 30000, // 30 seconds
    PAGE_SIZE: 50,
    TOAST_DURATION: 5000,
    DATE_FORMAT: 'MMM D, YYYY h:mm A'
};

// API Endpoints
const API_ENDPOINTS = {
    // Sync
    SYNC_STATUS: '/api/sync/status',
    SYNC_TRIGGER: '/api/sync/trigger',
    SYNC_HISTORY: '/api/sync/history',
    SYNC_RESET: '/api/sync/reset',
    
    // Calls
    CALLS: '/api/calls',
    CALL_STATS: '/api/calls/stats/summary',
    CALL_EXPORT: '/api/calls/export',
    
    // Analytics
    ANALYTICS_OVERVIEW: '/api/analytics/overview',
    ANALYTICS_TRENDS: '/api/analytics/trends',
    ANALYTICS_HOURLY: '/api/analytics/hourly',
    ANALYTICS_AGENTS: '/api/analytics/agents',
    ANALYTICS_CUSTOMERS: '/api/analytics/customers',
    
    // Customers
    CUSTOMERS: '/api/customers',
    CUSTOMERS_SYNC: '/api/customers/sync',
    
    // Config
    CONFIG: '/api/config',
    CONFIG_TEST: '/api/config/test-connection',
    
    // Health
    HEALTH: '/api/health',
    HEALTH_DETAILED: '/api/health/detailed'
};