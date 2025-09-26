// Customers Page
class CustomersPage {
    constructor() {
        this.currentPage = 1;
        this.searchTerm = '';
        this.selectedCustomer = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Customer search
        const customerSearch = document.getElementById('customerSearch');
        if (customerSearch) {
            customerSearch.addEventListener('input', utils.debounce(() => {
                this.searchTerm = customerSearch.value;
                this.currentPage = 1;
                this.loadCustomers();
            }, 500));
        }

        // Sync customers button
        const syncCustomersBtn = document.getElementById('syncCustomersBtn');
        if (syncCustomersBtn) {
            syncCustomersBtn.addEventListener('click', async () => {
                try {
                    utils.showLoading();
                    await api.syncCustomers();
                    utils.showToast('Customer sync initiated', 'info');
                    await this.loadCustomers();
                } catch (error) {
                    utils.showToast('Failed to sync customers', 'error');
                } finally {
                    utils.hideLoading();
                }
            });
        }
    }

    async load() {
        await this.loadCustomers();
    }

    async loadCustomers() {
        try {
            utils.showLoading();
            
            const params = {
                page: this.currentPage,
                limit: CONFIG.PAGE_SIZE,
                search: this.searchTerm,
                hasPhone: true
            };
            
            const response = await api.getCustomers(params);
            this.renderCustomersTable(response.data);
            this.renderPagination(response.pagination);
            
        } catch (error) {
            console.error('Failed to load customers:', error);
            utils.showToast('Failed to load customers', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    renderCustomersTable(customers) {
        const tbody = document.getElementById('customersTableBody');
        
        if (!customers || customers.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px;">
                        ${utils.createEmptyState('No customers found', 'people_outline')}
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = customers.map(customer => `
            <tr>
                <td><strong>${customer.Name || 'N/A'}</strong></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <span class="material-icons" style="font-size: 16px; color: #999;">phone</span>
                        ${customer.Phone || 'No phone'}
                    </div>
                </td>
                <td>${customer.Email || 'No email'}</td>
                <td>${customer.Company || '-'}</td>
                <td>
                    <span class="badge badge-${customer.Status === 'Active' ? 'success' : 'secondary'}">
                        ${customer.Status || 'Active'}
                    </span>
                </td>
                <td>
                    <button class="btn-icon" onclick="customersPage.viewCustomerCalls('${customer.id}', '${(customer.Name || '').replace(/'/g, "\\'")}')"
                            title="View Calls">
                        <span class="material-icons">visibility</span>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    renderPagination(pagination) {
        const container = document.getElementById('customersPagination');
        if (!pagination) return;
        
        const totalPages = pagination.hasMore ? null : Math.ceil(this.currentPage);
        
        utils.createPagination(
            container,
            this.currentPage,
            totalPages,
            (page) => {
                this.currentPage = page;
                this.loadCustomers();
            }
        );
    }

    async viewCustomerCalls(customerId, customerName) {
        try {
            utils.showLoading();
            const calls = await api.getCustomerCalls(customerId);
            
            let modalBody = '';
            
            if (!calls.data || calls.data.length === 0) {
                modalBody = utils.createEmptyState('No calls found for this customer', 'phone_disabled');
            } else {
                modalBody = `
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Direction</th>
                                    <th>Number</th>
                                    <th>Start Time</th>
                                    <th>Duration</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${calls.data.map(call => `
                                    <tr>
                                        <td>
                                            <span class="badge badge-${call.Direction === 'Inbound' ? 'primary' : 'secondary'}">
                                                ${call.Direction}
                                            </span>
                                        </td>
                                        <td>${call.Direction === 'Inbound' ? call.From : call.To}</td>
                                        <td>${utils.formatDate(call['Start Time'])}</td>
                                        <td>${utils.formatDuration(call['Duration (s)'])}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            
            utils.showModal(
                `Call History - ${customerName}`,
                modalBody,
                null,
                null
            );
            
        } catch (error) {
            utils.showToast('Failed to load customer calls', 'error');
        } finally {
            utils.hideLoading();
        }
    }
}

// Initialize customers page
window.customersPage = new CustomersPage();