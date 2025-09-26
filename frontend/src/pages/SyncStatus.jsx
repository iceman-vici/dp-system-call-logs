import React, { useState } from 'react';
import { useQuery, useMutation } from 'react-query';
import {
  Box,
  Paper,
  Typography,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Grid,
  Divider,
} from '@mui/material';
import {
  PlayArrow as PlayArrowIcon,
  Stop as StopIcon,
  RestartAlt as RestartIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../services/api';
import { useSnackbar } from 'notistack';
import { useWebSocket } from '../hooks/useWebSocket';

dayjs.extend(relativeTime);

function SyncStatus() {
  const { enqueueSnackbar } = useSnackbar();
  const { syncStatus, connected } = useWebSocket();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery(
    'syncStatus',
    api.getSyncStatus,
    { refetchInterval: 5000 } // Refresh every 5 seconds
  );

  const { data: syncHistory } = useQuery(
    'syncHistory',
    api.getSyncHistory,
    { refetchInterval: 30000 } // Refresh every 30 seconds
  );

  const triggerSyncMutation = useMutation(api.triggerSync, {
    onSuccess: () => {
      enqueueSnackbar('Sync triggered successfully', { variant: 'success' });
      refetch();
    },
    onError: () => {
      enqueueSnackbar('Failed to trigger sync', { variant: 'error' });
    },
  });

  const resetStateMutation = useMutation(api.resetSyncState, {
    onSuccess: () => {
      enqueueSnackbar('State reset successfully', { variant: 'success' });
      setResetDialogOpen(false);
      refetch();
    },
    onError: () => {
      enqueueSnackbar('Failed to reset state', { variant: 'error' });
    },
  });

  if (isLoading) {
    return <LinearProgress />;
  }

  const isSyncing = syncStatus?.isSyncing || data?.isSyncing;
  const lastSync = syncStatus?.lastSync || data?.lastSync;
  const state = data?.state;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Sync Status
      </Typography>

      {/* WebSocket Connection Status */}
      <Alert 
        severity={connected ? 'success' : 'warning'} 
        sx={{ mb: 3 }}
        icon={connected ? <CheckCircleIcon /> : <ErrorIcon />}
      >
        WebSocket {connected ? 'connected' : 'disconnected'} - Real-time updates {connected ? 'enabled' : 'disabled'}
      </Alert>

      {/* Current Status */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Typography variant="h6">Current Status</Typography>
                {isSyncing && <CircularProgress size={24} />}
              </Box>
              
              <Box display="flex" alignItems="center" mb={2}>
                <Chip
                  label={isSyncing ? 'Syncing' : 'Idle'}
                  color={isSyncing ? 'primary' : 'default'}
                  icon={isSyncing ? <CircularProgress size={16} /> : <CheckCircleIcon />}
                />
              </Box>

              {lastSync && (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Last sync: {dayjs(lastSync.timestamp).fromNow()}
                  </Typography>
                  {lastSync.success ? (
                    <Alert severity="success" sx={{ mt: 1 }}>
                      Processed {lastSync.totalCalls} calls ({lastSync.matchedCalls} matched, {lastSync.unmatchedCalls} unmatched)
                    </Alert>
                  ) : (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {lastSync.error || 'Sync failed'}
                    </Alert>
                  )}
                </Box>
              )}

              <Box display="flex" gap={2} mt={3}>
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => triggerSyncMutation.mutate()}
                  disabled={isSyncing || triggerSyncMutation.isLoading}
                >
                  Trigger Sync
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<RestartIcon />}
                  onClick={() => setResetDialogOpen(true)}
                  disabled={isSyncing}
                >
                  Reset State
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <StorageIcon sx={{ mr: 1 }} />
                <Typography variant="h6">State Information</Typography>
              </Box>
              
              {state ? (
                <List dense>
                  <ListItem>
                    <ListItemText
                      primary="Last Synced"
                      secondary={state.lastSyncedISO ? dayjs(state.lastSyncedISO).format('MMM D, YYYY h:mm A') : 'Never'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText
                      primary="State Updated"
                      secondary={state.updatedAt ? dayjs(state.updatedAt).fromNow() : 'N/A'}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText
                      primary="Sync Window"
                      secondary={`Looking back ${process.env.REACT_APP_DAYS_BACK || '14'} days`}
                    />
                  </ListItem>
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No state information available
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Sync History */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Sync History
        </Typography>
        
        {syncHistory?.history?.length > 0 ? (
          <List>
            {syncHistory.history.map((sync, index) => (
              <React.Fragment key={index}>
                <ListItem>
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        {sync.success ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : (
                          <ErrorIcon color="error" fontSize="small" />
                        )}
                        <Typography variant="body1">
                          {dayjs(sync.timestamp).format('MMM D, h:mm A')}
                        </Typography>
                        <Chip
                          label={sync.success ? 'Success' : 'Failed'}
                          size="small"
                          color={sync.success ? 'success' : 'error'}
                        />
                      </Box>
                    }
                    secondary={
                      <Box>
                        {sync.success ? (
                          <Typography variant="caption">
                            {sync.totalCalls} calls • {sync.matchedCalls} matched • {sync.duration}ms
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="error">
                            {sync.error}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                </ListItem>
                {index < syncHistory.history.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary" align="center" py={3}>
            No sync history available
          </Typography>
        )}
      </Paper>

      {/* Reset State Dialog */}
      <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)}>
        <DialogTitle>Reset Sync State?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will clear all sync history and state. The next sync will reprocess all calls within the configured time window.
          </Alert>
          <Typography variant="body2">
            Are you sure you want to reset the sync state?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialogOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => resetStateMutation.mutate()}
            disabled={resetStateMutation.isLoading}
          >
            Reset State
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SyncStatus;