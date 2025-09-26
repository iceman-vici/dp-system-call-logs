// Utility functions
const utils = {
    // Format date
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // Format duration
    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    },

    // Format number
    formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return new Intl.NumberFormat().format(num);
    },

    // Format percentage
    formatPercentage(value) {
        if (!value) return '0%';
        return `${Math.round(value)}%`;
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Show loading
    showLoading() {
        document.getElementById('loadingOverlay').classList.add('show');
    },

    // Hide loading
    hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('show');
    },

    // Show toast
    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: 'check_circle',
            error: 'error',
            warning: 'warning',
            info: 'info'
        };
        
        toast.innerHTML = `
            <span class="material-icons toast-icon">${icons[type]}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;
        
        toastContainer.appendChild(toast);
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.onclick = () => toast.remove();
        
        setTimeout(() => {
            toast.remove();
        }, CONFIG.TOAST_DURATION);
    },

    // Show modal
    showModal(title, body, onConfirm, onCancel) {
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        const modalConfirm = document.getElementById('modalConfirm');
        const modalCancel = document.getElementById('modalCancel');
        const modalClose = document.getElementById('modalClose');
        
        modalTitle.textContent = title;
        modalBody.innerHTML = body;
        
        modal.classList.add('show');
        
        const closeModal = () => {
            modal.classList.remove('show');
        };
        
        modalConfirm.onclick = () => {
            if (onConfirm) onConfirm();
            closeModal();
        };
        
        modalCancel.onclick = () => {
            if (onCancel) onCancel();
            closeModal();
        };
        
        modalClose.onclick = closeModal;
    },

    // Create pagination
    createPagination(container, currentPage, totalPages, onPageChange) {
        container.innerHTML = '';
        
        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.innerHTML = '<span class="material-icons">chevron_left</span>';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => onPageChange(currentPage - 1);
        container.appendChild(prevBtn);
        
        // Page info
        const pageInfo = document.createElement('span');
        pageInfo.className = 'pagination-info';
        pageInfo.textContent = `Page ${currentPage} of ${totalPages || '?'}`;
        container.appendChild(pageInfo);
        
        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.innerHTML = '<span class="material-icons">chevron_right</span>';
        nextBtn.disabled = currentPage === totalPages && totalPages !== null;
        nextBtn.onclick = () => onPageChange(currentPage + 1);
        container.appendChild(nextBtn);
    },

    // Create empty state
    createEmptyState(message, icon = 'inbox') {
        return `
            <div class="empty-state">
                <span class="material-icons">${icon}</span>
                <h3>No Data Available</h3>
                <p>${message}</p>
            </div>
        `;
    },

    // Get query params
    getQueryParams() {
        const params = {};
        const queryString = window.location.search.substring(1);
        const pairs = queryString.split('&');
        
        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key) {
                params[decodeURIComponent(key)] = decodeURIComponent(value || '');
            }
        }
        
        return params;
    },

    // Set query params
    setQueryParams(params) {
        const queryString = new URLSearchParams(params).toString();
        const newUrl = `${window.location.pathname}${queryString ? '?' + queryString : ''}`;
        window.history.replaceState(null, '', newUrl);
    }
};