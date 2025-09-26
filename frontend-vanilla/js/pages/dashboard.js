// Dashboard Page
class DashboardPage {
    constructor() {
        this.charts = {};
        this.setupEventListeners();
    }

    setupEventListeners() {
        // No specific event listeners for dashboard
    }

    async load() {
        try {
            utils.showLoading();
            
            // Fetch overview data
            const overview = await api.getAnalyticsOverview('7d');
            this.updateStats(overview);
            
            // Fetch trends data
            const trends = await api.getAnalyticsTrends({ groupBy: 'day' });
            this.updateTrendsChart(trends);
            
            // Update direction chart
            this.updateDirectionChart(overview);
            
        } catch (error) {
            console.error('Failed to load dashboard:', error);
            utils.showToast('Failed to load dashboard data', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    updateStats(data) {
        document.getElementById('totalCalls').textContent = utils.formatNumber(data.totalCalls || 0);
        document.getElementById('avgDuration').textContent = `${data.avgCallDuration || 0}s`;
        document.getElementById('matchRate').textContent = utils.formatPercentage(data.matchRate);
        
        if (data.peakHour) {
            document.getElementById('peakHour').textContent = `${data.peakHour.hour}:00`;
            document.getElementById('peakHourCalls').textContent = `${data.peakHour.calls} calls`;
        } else {
            document.getElementById('peakHour').textContent = 'N/A';
            document.getElementById('peakHourCalls').textContent = '';
        }
    }

    updateTrendsChart(data) {
        const canvas = document.getElementById('trendsChart');
        const ctx = canvas.getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts.trends) {
            this.charts.trends.destroy();
        }
        
        this.charts.trends = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.data.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [
                    {
                        label: 'Total Calls',
                        data: data.data.map(d => d.totalCalls),
                        borderColor: '#1976d2',
                        backgroundColor: 'rgba(25, 118, 210, 0.1)',
                        tension: 0.3
                    },
                    {
                        label: 'Inbound',
                        data: data.data.map(d => d.inboundCalls),
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        tension: 0.3
                    },
                    {
                        label: 'Outbound',
                        data: data.data.map(d => d.outboundCalls),
                        borderColor: '#ff9800',
                        backgroundColor: 'rgba(255, 152, 0, 0.1)',
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    updateDirectionChart(data) {
        const canvas = document.getElementById('directionChart');
        const ctx = canvas.getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts.direction) {
            this.charts.direction.destroy();
        }
        
        this.charts.direction = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Inbound', 'Outbound'],
                datasets: [{
                    data: [data.inboundCalls || 0, data.outboundCalls || 0],
                    backgroundColor: ['#4caf50', '#ff9800'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

// Initialize dashboard page
window.dashboardPage = new DashboardPage();