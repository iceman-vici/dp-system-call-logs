// Additional UI Components and Helpers

// WebSocket connection status component
class WebSocketStatus {
    constructor() {
        this.status = 'disconnected';
        this.retryCount = 0;
        this.maxRetries = 5;
    }

    setStatus(status) {
        this.status = status;
        const indicator = document.getElementById('syncIndicator');
        if (indicator) {
            const icon = indicator.querySelector('.material-icons');
            const text = indicator.querySelector('.sync-status');
            
            switch (status) {
                case 'connected':
                    icon.style.color = '#4caf50';
                    text.textContent = 'Connected';
                    this.retryCount = 0;
                    break;
                case 'disconnected':
                    icon.style.color = '#f44336';
                    text.textContent = 'Disconnected';
                    break;
                case 'connecting':
                    icon.style.color = '#ff9800';
                    text.textContent = 'Connecting...';
                    break;
                case 'syncing':
                    icon.style.color = '#1976d2';
                    text.textContent = 'Syncing...';
                    icon.style.animation = 'spin 2s linear infinite';
                    break;
                default:
                    icon.style.animation = 'none';
            }
        }
    }
}

// Data table component
class DataTable {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            columns: [],
            data: [],
            pageSize: 50,
            ...options
        };
        this.currentPage = 1;
        this.sortColumn = null;
        this.sortOrder = 'asc';
    }

    render() {
        if (!this.container) return;
        
        const table = document.createElement('table');
        table.className = 'data-table';
        
        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        this.options.columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            
            if (col.sortable) {
                th.style.cursor = 'pointer';
                th.onclick = () => this.sort(col.field);
                
                if (this.sortColumn === col.field) {
                    const icon = document.createElement('span');
                    icon.className = 'material-icons';
                    icon.style.fontSize = '16px';
                    icon.style.verticalAlign = 'middle';
                    icon.textContent = this.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward';
                    th.appendChild(icon);
                }
            }
            
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body
        const tbody = document.createElement('tbody');
        const startIndex = (this.currentPage - 1) * this.options.pageSize;
        const endIndex = startIndex + this.options.pageSize;
        const pageData = this.getSortedData().slice(startIndex, endIndex);
        
        if (pageData.length === 0) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = this.options.columns.length;
            emptyCell.innerHTML = utils.createEmptyState('No data available');
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
        } else {
            pageData.forEach(row => {
                const tr = document.createElement('tr');
                
                this.options.columns.forEach(col => {
                    const td = document.createElement('td');
                    
                    if (col.render) {
                        td.innerHTML = col.render(row[col.field], row);
                    } else {
                        td.textContent = row[col.field] || '';
                    }
                    
                    tr.appendChild(td);
                });
                
                tbody.appendChild(tr);
            });
        }
        
        table.appendChild(tbody);
        
        // Clear container and add table
        this.container.innerHTML = '';
        this.container.appendChild(table);
        
        // Add pagination
        if (this.options.data.length > this.options.pageSize) {
            this.renderPagination();
        }
    }

    getSortedData() {
        if (!this.sortColumn) return this.options.data;
        
        return [...this.options.data].sort((a, b) => {
            const aVal = a[this.sortColumn];
            const bVal = b[this.sortColumn];
            
            if (aVal === bVal) return 0;
            
            const comparison = aVal < bVal ? -1 : 1;
            return this.sortOrder === 'asc' ? comparison : -comparison;
        });
    }

    sort(column) {
        if (this.sortColumn === column) {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortOrder = 'asc';
        }
        this.render();
    }

    renderPagination() {
        const totalPages = Math.ceil(this.options.data.length / this.options.pageSize);
        const pagination = document.createElement('div');
        pagination.className = 'pagination';
        
        utils.createPagination(
            pagination,
            this.currentPage,
            totalPages,
            (page) => {
                this.currentPage = page;
                this.render();
            }
        );
        
        this.container.appendChild(pagination);
    }

    setData(data) {
        this.options.data = data;
        this.currentPage = 1;
        this.render();
    }

    refresh() {
        this.render();
    }
}

// Export components
window.WebSocketStatus = WebSocketStatus;
window.DataTable = DataTable;