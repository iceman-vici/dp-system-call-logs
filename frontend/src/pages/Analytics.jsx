import React, { useState } from 'react';
import { useQuery } from 'react-query';
import {
  Box,
  Paper,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Divider,
} from '@mui/material';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon,
  People as PeopleIcon,
  Phone as PhoneIcon,
} from '@mui/icons-material';
import api from '../services/api';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

function Analytics() {
  const [period, setPeriod] = useState('7d');
  const [trendGroupBy, setTrendGroupBy] = useState('day');

  // Fetch analytics data
  const { data: overview, isLoading: overviewLoading } = useQuery(
    ['analytics-overview', period],
    () => api.getAnalyticsOverview(period)
  );

  const { data: trends, isLoading: trendsLoading } = useQuery(
    ['analytics-trends', trendGroupBy],
    () => api.getAnalyticsTrends({ groupBy: trendGroupBy })
  );

  const { data: hourlyData } = useQuery(
    'analytics-hourly',
    api.getHourlyDistribution
  );

  const { data: agentStats } = useQuery(
    'analytics-agents',
    api.getAgentStats
  );

  if (overviewLoading) {
    return <LinearProgress />;
  }

  // Prepare pie chart data
  const directionData = [
    { name: 'Inbound', value: overview?.inboundCalls || 0 },
    { name: 'Outbound', value: overview?.outboundCalls || 0 },
  ];

  const matchingData = [
    { name: 'Matched', value: Math.round((overview?.matchRate || 0) * (overview?.totalCalls || 0) / 100) },
    { name: 'Unmatched', value: Math.round((100 - (overview?.matchRate || 0)) * (overview?.totalCalls || 0) / 100) },
  ];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Analytics</Typography>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Period</InputLabel>
          <Select
            value={period}
            label="Period"
            onChange={(e) => setPeriod(e.target.value)}
          >
            <MenuItem value="24h">Last 24 Hours</MenuItem>
            <MenuItem value="7d">Last 7 Days</MenuItem>
            <MenuItem value="30d">Last 30 Days</MenuItem>
            <MenuItem value="90d">Last 90 Days</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <PhoneIcon color="primary" sx={{ mr: 1 }} />
                <Typography color="textSecondary" variant="body2">
                  Total Calls
                </Typography>
              </Box>
              <Typography variant="h4">{overview?.totalCalls || 0}</Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                {period === '24h' ? 'Today' : `Last ${period}`}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <ScheduleIcon color="primary" sx={{ mr: 1 }} />
                <Typography color="textSecondary" variant="body2">
                  Total Duration
                </Typography>
              </Box>
              <Typography variant="h4">
                {Math.round((overview?.totalDuration || 0) / 3600)}h
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                {Math.round((overview?.totalDuration || 0) / 60)} minutes
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <TrendingUpIcon color="primary" sx={{ mr: 1 }} />
                <Typography color="textSecondary" variant="body2">
                  Average Duration
                </Typography>
              </Box>
              <Typography variant="h4">{overview?.avgCallDuration || 0}s</Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                Per call
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <PeopleIcon color="primary" sx={{ mr: 1 }} />
                <Typography color="textSecondary" variant="body2">
                  Match Rate
                </Typography>
              </Box>
              <Typography variant="h4">{overview?.matchRate || 0}%</Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                Customer matching
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts Row 1 */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Call Trends</Typography>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                  value={trendGroupBy}
                  onChange={(e) => setTrendGroupBy(e.target.value)}
                >
                  <MenuItem value="hour">Hourly</MenuItem>
                  <MenuItem value="day">Daily</MenuItem>
                  <MenuItem value="week">Weekly</MenuItem>
                  <MenuItem value="month">Monthly</MenuItem>
                </Select>
              </FormControl>
            </Box>
            {trendsLoading ? (
              <LinearProgress />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trends?.data || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="totalCalls"
                    stroke="#8884d8"
                    name="Total Calls"
                  />
                  <Line
                    type="monotone"
                    dataKey="totalDuration"
                    stroke="#82ca9d"
                    name="Duration (s)"
                    yAxisId="right"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Call Direction
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={directionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {directionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Charts Row 2 */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Hourly Distribution
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourlyData?.distribution || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="calls" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Customer Matching
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={matchingData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {matchingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>
      </Grid>

      {/* Top Customers */}
      {overview?.topCustomers?.length > 0 && (
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Top Customers
          </Typography>
          <List>
            {overview.topCustomers.map((customer, index) => (
              <React.Fragment key={customer.customerId}>
                <ListItem>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: COLORS[index % COLORS.length] }}>
                      {index + 1}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={`Customer ${customer.customerId}`}
                    secondary={`${customer.callCount} calls`}
                  />
                </ListItem>
                {index < overview.topCustomers.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}

export default Analytics;