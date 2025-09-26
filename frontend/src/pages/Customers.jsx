import React, { useState } from 'react';
import { useQuery } from 'react-query';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Phone as PhoneIcon,
  Sync as SyncIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import api from '../services/api';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';

function Customers() {
  const { enqueueSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [callsDialogOpen, setCallsDialogOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery(
    ['customers', page, pageSize, search],
    () => api.getCustomers({
      page: page + 1,
      limit: pageSize,
      search,
      hasPhone: true,
    }),
    { keepPreviousData: true }
  );

  const { data: customerCalls, isLoading: callsLoading } = useQuery(
    ['customer-calls', selectedCustomer?.id],
    () => selectedCustomer ? api.getCustomerCalls(selectedCustomer.id) : null,
    { enabled: !!selectedCustomer }
  );

  const handleSyncCustomers = async () => {
    try {
      await api.syncCustomers();
      enqueueSnackbar('Customer sync initiated', { variant: 'info' });
      refetch();
    } catch (error) {
      enqueueSnackbar('Failed to sync customers', { variant: 'error' });
    }
  };

  const handleViewCalls = (customer) => {
    setSelectedCustomer(customer);
    setCallsDialogOpen(true);
  };

  const columns = [
    {
      field: 'Name',
      headerName: 'Name',
      width: 200,
      renderCell: (params) => (
        <Typography variant="body2" fontWeight={500}>
          {params.value || 'N/A'}
        </Typography>
      ),
    },
    {
      field: 'Phone',
      headerName: 'Phone',
      width: 180,
      renderCell: (params) => (
        <Box display="flex" alignItems="center">
          <PhoneIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
          {params.value || 'No phone'}
        </Box>
      ),
    },
    {
      field: 'Email',
      headerName: 'Email',
      width: 250,
      renderCell: (params) => (
        <Typography variant="body2" color="text.secondary">
          {params.value || 'No email'}
        </Typography>
      ),
    },
    {
      field: 'Company',
      headerName: 'Company',
      width: 200,
      renderCell: (params) => params.value || '-',
    },
    {
      field: 'Status',
      headerName: 'Status',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value || 'Active'}
          color={params.value === 'Inactive' ? 'default' : 'success'}
          size="small"
        />
      ),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <Tooltip title="View Calls">
          <IconButton
            size="small"
            onClick={() => handleViewCalls(params.row)}
          >
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Customers</Typography>
        <Box>
          <Tooltip title="Refresh">
            <IconButton onClick={() => refetch()} sx={{ mr: 1 }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<SyncIcon />}
            onClick={handleSyncCustomers}
          >
            Sync from Airtable
          </Button>
        </Box>
      </Box>

      {/* Search */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          placeholder="Search customers by name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
          }}
        />
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
          getRowId={(row) => row.id}
          sx={{
            '& .MuiDataGrid-cell': {
              borderBottom: '1px solid rgba(224, 224, 224, 0.5)',
            },
          }}
        />
      </Paper>

      {/* Customer Calls Dialog */}
      <Dialog
        open={callsDialogOpen}
        onClose={() => setCallsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Call History - {selectedCustomer?.Name || 'Customer'}
        </DialogTitle>
        <DialogContent>
          {callsLoading ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : (
            <List>
              {customerCalls?.data?.length > 0 ? (
                customerCalls.data.map((call) => (
                  <ListItem key={call.id} divider>
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip
                            label={call.Direction}
                            size="small"
                            color={call.Direction === 'Inbound' ? 'primary' : 'secondary'}
                          />
                          <Typography variant="body2">
                            {call.Direction === 'Inbound' ? call.From : call.To}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="caption" display="block">
                            {dayjs(call['Start Time']).format('MMM D, YYYY h:mm A')}
                          </Typography>
                          <Typography variant="caption">
                            Duration: {Math.floor(call['Duration (s)'] / 60)}:{(call['Duration (s)'] % 60).toString().padStart(2, '0')}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary" align="center" py={3}>
                  No calls found for this customer
                </Typography>
              )}
            </List>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default Customers;