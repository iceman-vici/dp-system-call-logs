// Settings Page
class SettingsPage {
    constructor() {
        this.config = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Test Dialpad connection
        const testDialpadBtn = document.getElementById('testDialpadBtn');
        if (testDialpadBtn) {
            testDialpadBtn.addEventListener('click', async () => {
                await this.testConnection('dialpad');
            });
        }

        // Test Airtable connection
        const testAirtableBtn = document.getElementById('testAirtableBtn');
        if (testAirtableBtn) {
            testAirtableBtn.addEventListener('click', async () => {
                await this.testConnection('airtable');
            });
        }
    }

    async load() {
        try {
            utils.showLoading();
            
            this.config = await api.getConfig();
            this.updateConfigDisplay();
            
        } catch (error) {
            console.error('Failed to load configuration:', error);
            utils.showToast('Failed to load configuration', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    updateConfigDisplay() {
        // Update Dialpad status
        const dialpadStatus = document.getElementById('dialpadStatus');
        if (dialpadStatus) {
            dialpadStatus.innerHTML = `
                <span class="status-badge ${this.config.dialpad?.configured ? 'configured' : 'not-configured'}">
                    ${this.config.dialpad?.configured ? 'Configured' : 'Not Configured'}
                </span>
            `;
        }

        // Update Airtable status
        const airtableStatus = document.getElementById('airtableStatus');
        if (airtableStatus) {
            airtableStatus.innerHTML = `
                <span class="status-badge ${this.config.airtable?.configured ? 'configured' : 'not-configured'}">
                    ${this.config.airtable?.configured ? 'Configured' : 'Not Configured'}
                </span>
                ${this.config.airtable?.baseId ? `<br><small>Base ID: ${this.config.airtable.baseId}</small>` : ''}
            `;
        }

        // Update sync configuration
        const syncConfigInfo = document.getElementById('syncConfigInfo');
        if (syncConfigInfo && this.config.sync) {
            syncConfigInfo.innerHTML = `
                <div class="config-item">
                    <label>Sync Interval</label>
                    <span>${this.config.sync.interval}ms (${Math.floor(this.config.sync.interval / 60000)} minutes)</span>
                </div>
                <div class="config-item">
                    <label>Days Back</label>
                    <span>${this.config.sync.daysBack} days</span>
                </div>
                <div class="config-item">
                    <label>Backfill Grace</label>
                    <span>${this.config.sync.backfillGraceSeconds}s (${Math.floor(this.config.sync.backfillGraceSeconds / 3600)} hours)</span>
                </div>
                <div class="config-item">
                    <label>Default Region</label>
                    <span>${this.config.sync.defaultRegion}</span>
                </div>
                <div class="config-item">
                    <label>Customers Table</label>
                    <span>${this.config.airtable?.customersTable || 'Customers'}</span>
                </div>
                <div class="config-item">
                    <label>Calls Table</label>
                    <span>${this.config.airtable?.callsTable || 'Calls'}</span>
                </div>
                <div class="config-item">
                    <label>Customer Phone Field</label>
                    <span>${this.config.fields?.customerPhone || 'Phone'}</span>
                </div>
                <div class="config-item">
                    <label>Customer Link Field</label>
                    <span>${this.config.fields?.callsCustomerLink || 'Customer'}</span>
                </div>
            `;
        }
    }

    async testConnection(service) {
        const resultDiv = document.getElementById(`${service}TestResult`);
        const button = document.getElementById(`test${service.charAt(0).toUpperCase() + service.slice(1)}Btn`);
        
        try {
            button.disabled = true;
            resultDiv.className = 'test-result';
            resultDiv.textContent = 'Testing connection...';
            resultDiv.classList.add('show');
            
            const result = await api.testConnection(service);
            
            resultDiv.className = 'test-result show';
            if (result.success) {
                resultDiv.classList.add('success');
                resultDiv.innerHTML = `
                    <span class="material-icons" style="color: #4caf50;">check_circle</span>
                    ${result.message}
                    ${result.details ? `<br><small>${JSON.stringify(result.details)}</small>` : ''}
                `;
                utils.showToast(`${service} connection successful`, 'success');
            } else {
                resultDiv.classList.add('error');
                resultDiv.innerHTML = `
                    <span class="material-icons" style="color: #f44336;">error</span>
                    ${result.error || 'Connection failed'}
                `;
                utils.showToast(`${service} connection failed`, 'error');
            }
        } catch (error) {
            resultDiv.className = 'test-result show error';
            resultDiv.innerHTML = `
                <span class="material-icons" style="color: #f44336;">error</span>
                Connection test failed: ${error.message}
            `;
            utils.showToast('Connection test failed', 'error');
        } finally {
            button.disabled = false;
            
            // Hide result after 10 seconds
            setTimeout(() => {
                resultDiv.classList.remove('show');
            }, 10000);
        }
    }
}

// Initialize settings page
window.settingsPage = new SettingsPage();