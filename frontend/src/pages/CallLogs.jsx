import React, { useState } from 'react';
import { useQuery } from 'react-query';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers';
import {
  Search as SearchIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Phone as PhoneIcon,
  CallReceived,
  CallMade,
} from '@mui/icons-material';
import dayjs from 'dayjs';
import api from '../services/api';
import { useSnackbar } from 'notistack';

function CallLogs() {
  const { enqueueSnackbar } = useSnackbar();
  const [filters, setFilters] = useState({
    search: '',
    direction: '',
    matched: '',
    startDate: null,
    endDate: null,
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const { data, isLoading, refetch } = useQuery(
    ['calls', page, pageSize, filters],
    () => api.getCalls({
      page: page + 1,
      limit: pageSize,
      ...filters,
      startDate: filters.startDate ? dayjs(filters.startDate).format('YYYY-MM-DD') : undefined,
      endDate: filters.endDate ? dayjs(filters.endDate).format('YYYY-MM-DD') : undefined,
    }),
    { keepPreviousData: true }
  );

  const columns = [
    {
      field: 'Call ID',
      headerName: 'Call ID',
      width: 150,
      renderCell: (params) => (
        <Tooltip title={params.value}>
          <Typography variant="body2" noWrap>
            {params.value}
          </Typography>
        </Tooltip>
      ),
    },
    {
      field: 'Direction',
      headerName: 'Direction',
      width: 120,
      renderCell: (params) => (
        <Chip
          icon={params.value === 'Inbound' ? <CallReceived /> : <CallMade />}
          label={params.value}
          size="small"
          color={params.value === 'Inbound' ? 'primary' : 'secondary'}
        />
      ),
    },
    {
      field: 'From',
      headerName: 'From',
      width: 150,
      renderCell: (params) => (
        <Box display="flex" alignItems="center">
          <PhoneIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
          {params.value}
        </Box>
      ),
    },
    {
      field: 'To',
      headerName: 'To',
      width: 150,
      renderCell: (params) => (
        <Box display="flex" alignItems="center">
          <PhoneIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
          {params.value}
        </Box>
      ),
    },
    {
      field: 'Start Time',
      headerName: 'Start Time',
      width: 180,
      renderCell: (params) => 
        params.value ? dayjs(params.value).format('MMM D, YYYY h:mm A') : 'N/A',
    },
    {
      field: 'Duration (s)',
      headerName: 'Duration',
      width: 100,
      renderCell: (params) => {
        const minutes = Math.floor(params.value / 60);
        const seconds = params.value % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      },
    },
    {
      field: 'Customer',
      headerName: 'Customer',
      width: 150,
      renderCell: (params) => (
        params.value ? (
          <Chip label="Matched" color="success" size="small" />
        ) : (
          <Chip label="Unmatched" color="default" size="small" />
        )
      ),
    },
  ];

  const handleExport = async () => {
    try {
      const response = await api.exportCalls(filters);
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `calls-export-${dayjs().format('YYYY-MM-DD')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      enqueueSnackbar('Export successful', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Export failed', { variant: 'error' });
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    setPage(0); // Reset to first page on filter change
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      direction: '',
      matched: '',
      startDate: null,
      endDate: null,
    });
    setPage(0);
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Call Logs</Typography>
        <Box>
          <Tooltip title="Refresh">
            <IconButton onClick={() => refetch()} sx={{ mr: 1 }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          {process.env.REACT_APP_ENABLE_EXPORT !== 'false' && (
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
            >
              Export CSV
            </Button>
          )}
        </Box>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            placeholder="Search phone numbers..."
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
            }}
            sx={{ minWidth: 250 }}
          />
          
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Direction</InputLabel>
            <Select
              value={filters.direction}
              label="Direction"
              onChange={(e) => handleFilterChange('direction', e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="Inbound">Inbound</MenuItem>
              <MenuItem value="Outbound">Outbound</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={filters.matched}
              label="Status"
              onChange={(e) => handleFilterChange('matched', e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="true">Matched</MenuItem>
              <MenuItem value="false">Unmatched</MenuItem>
            </Select>
          </FormControl>

          <DatePicker
            label="Start Date"
            value={filters.startDate}
            onChange={(value) => handleFilterChange('startDate', value)}
            slotProps={{ textField: { size: 'small' } }}
          />

          <DatePicker
            label="End Date"
            value={filters.endDate}
            onChange={(value) => handleFilterChange('endDate', value)}
            slotProps={{ textField: { size: 'small' } }}
          />

          <Button variant="outlined" onClick={clearFilters}>
            Clear Filters
          </Button>
        </Box>
      </Paper>

      {/* Data Grid */}
      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          loading={isLoading}
          paginationMode="server"
          rowCount={data?.pagination?.hasMore ? -1 : (page + 1) * pageSize}
          pageSizeOptions={[25, 50, 100]}
          page={page}
          pageSize={pageSize}
          onPageChange={(newPage) => setPage(newPage)}
          onPageSizeChange={(newPageSize) => setPageSize(newPageSize)}
          disableRowSelectionOnClick
          getRowId={(row) => row.id || row['Call ID']}
          sx={{
            '& .MuiDataGrid-cell': {
              borderBottom: '1px solid rgba(224, 224, 224, 0.5)',
            },
          }}
        />
      </Paper>
    </Box>
  );
}

export default CallLogs;