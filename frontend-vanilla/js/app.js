// Main Application
class App {
    constructor() {
        this.currentPage = 'dashboard';
        this.socket = null;
        this.refreshInterval = null;
        this.init();
    }

    init() {
        this.setupNavigation();
        this.setupWebSocket();
        this.setupRefreshButton();
        this.loadInitialPage();
        this.startAutoRefresh();
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');

        // Navigation clicks
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                this.navigateToPage(page);
            });
        });

        // Sidebar toggle
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });

        // Mobile sidebar handling
        if (window.innerWidth <= 768) {
            sidebar.classList.add('collapsed');
        }
    }

    navigateToPage(page) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            calls: 'Call Logs',
            analytics: 'Analytics',
            customers: 'Customers',
            sync: 'Sync Status',
            settings: 'Settings'
        };
        document.getElementById('pageTitle').textContent = titles[page];

        // Hide all pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });

        // Show selected page
        const pageElement = document.getElementById(`${page}Page`);
        if (pageElement) {
            pageElement.classList.add('active');
        }

        // Load page data
        this.currentPage = page;
        this.loadPageData(page);
    }

    loadPageData(page) {
        switch (page) {
            case 'dashboard':
                if (window.dashboardPage) dashboardPage.load();
                break;
            case 'calls':
                if (window.callsPage) callsPage.load();
                break;
            case 'analytics':
                if (window.analyticsPage) analyticsPage.load();
                break;
            case 'customers':
                if (window.customersPage) customersPage.load();
                break;
            case 'sync':
                if (window.syncPage) syncPage.load();
                break;
            case 'settings':
                if (window.settingsPage) settingsPage.load();
                break;
        }
    }

    setupWebSocket() {
        if (!CONFIG.ENABLE_WEBSOCKET) return;

        try {
            // Create WebSocket connection (Socket.IO would be loaded separately)
            // For now, we'll use a simple WebSocket connection
            this.socket = new WebSocket(CONFIG.WS_URL);

            this.socket.onopen = () => {
                console.log('WebSocket connected');
                this.updateSyncIndicator('connected');
            };

            this.socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };

            this.socket.onclose = () => {
                console.log('WebSocket disconnected');
                this.updateSyncIndicator('disconnected');
                // Attempt reconnection after 5 seconds
                setTimeout(() => this.setupWebSocket(), 5000);
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to setup WebSocket:', error);
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'sync:started':
                this.updateSyncIndicator('syncing');
                utils.showToast('Sync started', 'info');
                break;
            case 'sync:completed':
                this.updateSyncIndicator('idle');
                utils.showToast(`Sync completed: ${data.totalCalls} calls processed`, 'success');
                // Refresh current page data
                this.loadPageData(this.currentPage);
                break;
            case 'sync:failed':
                this.updateSyncIndicator('error');
                utils.showToast(`Sync failed: ${data.error}`, 'error');
                break;
        }
    }

    updateSyncIndicator(status) {
        const indicator = document.getElementById('syncIndicator');
        const statusText = indicator.querySelector('.sync-status');
        
        indicator.className = 'sync-indicator';
        
        switch (status) {
            case 'syncing':
                indicator.classList.add('syncing');
                statusText.textContent = 'Syncing...';
                break;
            case 'idle':
                indicator.classList.add('idle');
                statusText.textContent = 'Idle';
                break;
            case 'error':
                indicator.classList.add('error');
                statusText.textContent = 'Error';
                break;
            case 'connected':
                statusText.textContent = 'Connected';
                break;
            case 'disconnected':
                statusText.textContent = 'Disconnected';
                break;
        }
    }

    setupRefreshButton() {
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.addEventListener('click', () => {
            refreshBtn.classList.add('spinning');
            this.loadPageData(this.currentPage);
            setTimeout(() => {
                refreshBtn.classList.remove('spinning');
            }, 1000);
        });
    }

    loadInitialPage() {
        const params = utils.getQueryParams();
        const page = params.page || 'dashboard';
        this.navigateToPage(page);
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            if (this.currentPage === 'dashboard' || this.currentPage === 'sync') {
                this.loadPageData(this.currentPage);
            }
        }, CONFIG.REFRESH_INTERVAL);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

// Add spinning animation for refresh button
const style = document.createElement('style');
style.textContent = `
    .btn-icon.spinning .material-icons {
        animation: spin 1s linear infinite;
    }
`;
document.head.appendChild(style);