// Analytics Page
class AnalyticsPage {
    constructor() {
        this.charts = {};
        this.period = '7d';
        this.setupEventListeners();
    }

    setupEventListeners() {
        const periodSelect = document.getElementById('periodSelect');
        if (periodSelect) {
            periodSelect.addEventListener('change', () => {
                this.period = periodSelect.value;
                this.load();
            });
        }
    }

    async load() {
        try {
            utils.showLoading();
            
            // Fetch all analytics data
            const [overview, trends, hourly] = await Promise.all([
                api.getAnalyticsOverview(this.period),
                api.getAnalyticsTrends({ groupBy: 'day' }),
                api.getHourlyDistribution()
            ]);
            
            this.updateVolumeChart(trends);
            this.updateHourlyChart(hourly);
            this.updateMatchingChart(overview);
            
        } catch (error) {
            console.error('Failed to load analytics:', error);
            utils.showToast('Failed to load analytics data', 'error');
        } finally {
            utils.hideLoading();
        }
    }

    updateVolumeChart(data) {
        const canvas = document.getElementById('volumeChart');
        const ctx = canvas.getContext('2d');
        
        if (this.charts.volume) {
            this.charts.volume.destroy();
        }
        
        this.charts.volume = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.data.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [
                    {
                        label: 'Total Calls',
                        data: data.data.map(d => d.totalCalls),
                        backgroundColor: '#1976d2',
                    },
                    {
                        label: 'Total Duration (min)',
                        data: data.data.map(d => Math.round(d.totalDuration / 60)),
                        backgroundColor: '#9c27b0',
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Calls'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Duration (minutes)'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
    }

    updateHourlyChart(data) {
        const canvas = document.getElementById('hourlyChart');
        const ctx = canvas.getContext('2d');
        
        if (this.charts.hourly) {
            this.charts.hourly.destroy();
        }
        
        const distribution = data.distribution || [];
        
        this.charts.hourly = new Chart(ctx, {
            type: 'line',
            data: {
                labels: distribution.map(d => `${d.hour}:00`),
                datasets: [{
                    label: 'Calls per Hour',
                    data: distribution.map(d => d.calls),
                    borderColor: '#ff9800',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
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

    updateMatchingChart(data) {
        const canvas = document.getElementById('matchingChart');
        const ctx = canvas.getContext('2d');
        
        if (this.charts.matching) {
            this.charts.matching.destroy();
        }
        
        const matched = Math.round((data.matchRate || 0) * (data.totalCalls || 0) / 100);
        const unmatched = (data.totalCalls || 0) - matched;
        
        this.charts.matching = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Matched', 'Unmatched'],
                datasets: [{
                    data: [matched, unmatched],
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
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

// Initialize analytics page
window.analyticsPage = new AnalyticsPage();