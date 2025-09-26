// Sync Status Page
class SyncPage {
    constructor() {
        this.refreshInterval = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Trigger sync button
        const triggerSyncBtn = document.getElementById('triggerSyncBtn');
        if (triggerSyncBtn) {
            triggerSyncBtn.addEventListener('click', async () => {
                try {
                    triggerSyncBtn.disabled = true;
                    await api.triggerSync();
                    utils.showToast('Sync triggered successfully', 'success');
                    await this.load();
                } catch (error) {
                    utils.showToast('Failed to trigger sync', 'error');
                } finally {
                    triggerSyncBtn.disabled = false;
                }
            });
        }

        // Reset state button
        const resetStateBtn = document.getElementById('resetStateBtn');
        if (resetStateBtn) {
            resetStateBtn.addEventListener('click', () => {
                utils.showModal(
                    'Reset Sync State?',
                    `
                        <div class="alert alert-warning">
                            <span class="material-icons">warning</span>
                            This will clear all sync history and state. The next sync will reprocess all calls within the configured time window.
                        </div>
                        <p>Are you sure you want to reset the sync state?</p>
                    `,
                    async () => {
                        try {
                            await api.resetSyncState();
                            utils.showToast('State reset successfully', 'success');
                            await this.load();
                        } catch (error) {
                            utils.showToast('Failed to reset state', 'error');
                        }
                    }
                );
            });
        }
    }

    async load() {
        // Start auto-refresh
        this.startAutoRefresh();
        
        try {
            const [status, history] = await Promise.all([
                api.getSyncStatus(),
                api.getSyncHistory()
            ]);
            
            this.updateSyncStatus(status);
            this.updateSyncHistory(history);
            
        } catch (error) {
            console.error('Failed to load sync status:', error);
            utils.showToast('Failed to load sync status', 'error');
        }
    }

    updateSyncStatus(data) {
        const statusIndicator = document.getElementById('syncStatusIndicator');
        const statusDot = statusIndicator.querySelector('.status-dot');
        const statusText = statusIndicator.querySelector('.status-text');
        const syncInfo = document.getElementById('syncInfo');
        const triggerBtn = document.getElementById('triggerSyncBtn');
        
        // Update status indicator
        statusDot.className = 'status-dot';
        if (data.isSyncing) {
            statusDot.classList.add('syncing');
            statusText.textContent = 'Syncing...';
            triggerBtn.disabled = true;
        } else {
            statusDot.classList.add('idle');
            statusText.textContent = 'Idle';
            triggerBtn.disabled = false;
        }
        
        // Update sync info
        if (data.lastSync) {
            const lastSync = data.lastSync;
            syncInfo.innerHTML = `
                <div class="alert alert-${lastSync.success ? 'success' : 'error'}">
                    <strong>Last Sync:</strong> ${utils.formatDate(lastSync.timestamp)}<br>
                    ${lastSync.success ? 
                        `Processed ${lastSync.totalCalls} calls (${lastSync.matchedCalls} matched, ${lastSync.unmatchedCalls} unmatched)` :
                        `Error: ${lastSync.error}`
                    }
                </div>
            `;
        } else {
            syncInfo.innerHTML = '<p>No sync has been performed yet.</p>';
        }
        
        // Update state info
        if (data.state) {
            syncInfo.innerHTML += `
                <div class="config-info">
                    <div class="config-item">
                        <label>Last Synced</label>
                        <span>${data.state.lastSyncedISO ? utils.formatDate(data.state.lastSyncedISO) : 'Never'}</span>
                    </div>
                    <div class="config-item">
                        <label>State Updated</label>
                        <span>${data.state.updatedAt ? utils.formatDate(data.state.updatedAt) : 'N/A'}</span>
                    </div>
                </div>
            `;
        }
    }

    updateSyncHistory(data) {
        const historyList = document.getElementById('syncHistoryList');
        
        if (!data.history || data.history.length === 0) {
            historyList.innerHTML = utils.createEmptyState('No sync history available', 'history');
            return;
        }
        
        historyList.innerHTML = data.history.map(sync => `
            <div class="history-item">
                <div class="history-icon ${sync.success ? 'success' : 'error'}">
                    <span class="material-icons">
                        ${sync.success ? 'check_circle' : 'error'}
                    </span>
                </div>
                <div class="history-content">
                    <div class="history-time">
                        ${utils.formatDate(sync.timestamp)}
                    </div>
                    <div class="history-details">
                        ${sync.success ? 
                            `${sync.totalCalls} calls • ${sync.matchedCalls} matched • ${sync.duration}ms` :
                            `Error: ${sync.error}`
                        }
                    </div>
                </div>
            </div>
        `).join('');
    }

    startAutoRefresh() {
        // Clear existing interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        // Set up new interval
        this.refreshInterval = setInterval(async () => {
            // Only refresh if we're still on the sync page
            if (window.app && window.app.currentPage === 'sync') {
                const status = await api.getSyncStatus();
                this.updateSyncStatus(status);
            } else {
                // Stop refreshing if we've navigated away
                clearInterval(this.refreshInterval);
            }
        }, 5000); // Refresh every 5 seconds
    }
}

// Initialize sync page
window.syncPage = new SyncPage();