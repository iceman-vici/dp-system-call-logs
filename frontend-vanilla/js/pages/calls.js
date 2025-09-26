// Call Logs Page
class CallsPage {
    constructor() {
        this.currentPage = 1;
        this.filters = {
            search: '',
            direction: '',
            matched: ''
        };
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', utils.debounce(() => {
                this.filters.search = searchInput.value;
                this.currentPage = 1;
                this.loadCalls();
            }, 500));
        }

        // Direction filter
        const directionFilter = document.getElementById('directionFilter');
        if (directionFilter) {
            directionFilter.addEventListener('change', () => {
                this.filters.direction = directionFilter.value;
                this.currentPage = 1;
                this.loadCalls();
            });
        }

        // Matched filter
        const matchedFilter = document.getElementById('matchedFilter');
        if (matchedFilter) {
            matchedFilter.addEventListener('change', () => {
                this.filters.matched = matchedFilter.value;
                this.currentPage = 1;
                this.loadCalls();
            });
        }

        // Clear filters button
        const clearFilters = document.getElementById('clearFilters');
        if (clearFilters) {
            clearFilters.addEventListener('click', () => {
                this.clearFilters();
            });
        }

        // Export button
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                try {
                    await api.exportCalls(this.filters);
                    utils.showToast('Export successful', 'success');
                } catch (error) {
                    utils.showToast('Export failed', 'error');
                }
            });
        }
    }

    async load() {
        await this.loadCalls();
    }

    async loadCalls() {
        try {
            utils.showLoading();
            
            const params = {
                page: this.currentPage,
                limit: CONFIG.PAGE_SIZE,
                ...this.filters
            };
            
            const response = await api.getCalls(params);
            this.renderCallsTable(response.data);
            this.renderPagination(response.pagination);
            
        } catch (error) {
            console.error('Failed to load calls:', error);
            utils.showToast('Failed to load call logs', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    renderCallsTable(calls) {
        const tbody = document.getElementById('callsTableBody');
        
        if (!calls || calls.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px;">
                        ${utils.createEmptyState('No call logs found', 'phone_disabled')}
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = calls.map(call => `
            <tr>
                <td>${call['Call ID'] || call.id}</td>
                <td>
                    <span class="badge badge-${call.Direction === 'Inbound' ? 'primary' : 'secondary'}">
                        ${call.Direction || 'Unknown'}
                    </span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <span class="material-icons" style="font-size: 16px; color: #999;">phone</span>
                        ${call.From || 'N/A'}
                    </div>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <span class="material-icons" style="font-size: 16px; color: #999;">phone</span>
                        ${call.To || 'N/A'}
                    </div>
                </td>
                <td>${utils.formatDate(call['Start Time'])}</td>
                <td>${utils.formatDuration(call['Duration (s)'])}</td>
                <td>
                    <span class="badge badge-${call.Customer ? 'success' : 'warning'}">
                        ${call.Customer ? 'Matched' : 'Unmatched'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    renderPagination(pagination) {
        const container = document.getElementById('callsPagination');
        if (!pagination) return;
        
        const totalPages = pagination.hasMore ? null : Math.ceil(this.currentPage);
        
        utils.createPagination(
            container,
            this.currentPage,
            totalPages,
            (page) => {
                this.currentPage = page;
                this.loadCalls();
            }
        );
    }

    clearFilters() {
        this.filters = {
            search: '',
            direction: '',
            matched: ''
        };
        
        document.getElementById('searchInput').value = '';
        document.getElementById('directionFilter').value = '';
        document.getElementById('matchedFilter').value = '';
        
        this.currentPage = 1;
        this.loadCalls();
    }
}

// Initialize calls page
window.callsPage = new CallsPage();