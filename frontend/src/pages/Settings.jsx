import React, { useState } from 'react';
import { useQuery, useMutation } from 'react-query';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  Alert,
  Card,
  CardContent,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  IconButton,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  Save as SaveIcon,
  TestTube as TestIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import api from '../services/api';
import { useSnackbar } from 'notistack';

function Settings() {
  const { enqueueSnackbar } = useSnackbar();
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [testResults, setTestResults] = useState({});

  const { data: config, isLoading, refetch } = useQuery('config', api.getConfig);

  const { register, handleSubmit, formState: { errors }, reset } = useForm();

  const updateConfigMutation = useMutation(api.updateConfig, {
    onSuccess: () => {
      enqueueSnackbar('Configuration updated successfully', { variant: 'success' });
      refetch();
    },
    onError: () => {
      enqueueSnackbar('Failed to update configuration', { variant: 'error' });
    },
  });

  const testConnectionMutation = useMutation(api.testConnection, {
    onSuccess: (data) => {
      setTestResults(prev => ({ ...prev, [data.service]: data }));
      enqueueSnackbar(`${data.service} connection ${data.success ? 'successful' : 'failed'}`, {
        variant: data.success ? 'success' : 'error',
      });
    },
    onError: (error, service) => {
      setTestResults(prev => ({ ...prev, [service]: { success: false, error: error.message } }));
      enqueueSnackbar(`Connection test failed`, { variant: 'error' });
    },
  });

  const handleTestConnection = (service) => {
    testConnectionMutation.mutate(service);
  };

  if (isLoading) {
    return <CircularProgress />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      <Grid container spacing={3}>
        {/* API Configuration */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Dialpad Configuration
              </Typography>
              
              <Box display="flex" alignItems="center" mb={2}>
                <Chip
                  label={config?.dialpad?.configured ? 'Configured' : 'Not Configured'}
                  color={config?.dialpad?.configured ? 'success' : 'default'}
                  size="small"
                  icon={config?.dialpad?.configured ? <CheckCircleIcon /> : <ErrorIcon />}
                />
                <Box ml="auto">
                  <Button
                    size="small"
                    startIcon={<TestIcon />}
                    onClick={() => handleTestConnection('dialpad')}
                    disabled={!config?.dialpad?.configured || testConnectionMutation.isLoading}
                  >
                    Test Connection
                  </Button>
                </Box>
              </Box>

              {testResults.dialpad && (
                <Alert 
                  severity={testResults.dialpad.success ? 'success' : 'error'} 
                  sx={{ mb: 2 }}
                >
                  {testResults.dialpad.message || testResults.dialpad.error}
                  {testResults.dialpad.details?.companyName && (
                    <Typography variant="caption" display="block">
                      Company: {testResults.dialpad.details.companyName}
                    </Typography>
                  )}
                </Alert>
              )}

              <TextField
                fullWidth
                label="API Key"
                type={showApiKeys ? 'text' : 'password'}
                placeholder="dp_your_api_key_here"
                margin="normal"
                disabled
                value={config?.dialpad?.configured ? '••••••••••••••••' : ''}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowApiKeys(!showApiKeys)}
                        edge="end"
                      >
                        {showApiKeys ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                helperText="Configure via environment variables"
              />
              
              <TextField
                fullWidth
                label="Base URL"
                value={config?.dialpad?.baseUrl || ''}
                margin="normal"
                disabled
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Airtable Configuration
              </Typography>
              
              <Box display="flex" alignItems="center" mb={2}>
                <Chip
                  label={config?.airtable?.configured ? 'Configured' : 'Not Configured'}
                  color={config?.airtable?.configured ? 'success' : 'default'}
                  size="small"
                  icon={config?.airtable?.configured ? <CheckCircleIcon /> : <ErrorIcon />}
                />
                <Box ml="auto">
                  <Button
                    size="small"
                    startIcon={<TestIcon />}
                    onClick={() => handleTestConnection('airtable')}
                    disabled={!config?.airtable?.configured || testConnectionMutation.isLoading}
                  >
                    Test Connection
                  </Button>
                </Box>
              </Box>

              {testResults.airtable && (
                <Alert 
                  severity={testResults.airtable.success ? 'success' : 'error'} 
                  sx={{ mb: 2 }}
                >
                  {testResults.airtable.message || testResults.airtable.error}
                  {testResults.airtable.details?.baseId && (
                    <Typography variant="caption" display="block">
                      Base ID: {testResults.airtable.details.baseId}
                    </Typography>
                  )}
                </Alert>
              )}

              <TextField
                fullWidth
                label="Personal Access Token"
                type={showApiKeys ? 'text' : 'password'}
                placeholder="pat_your_token_here"
                margin="normal"
                disabled
                value={config?.airtable?.configured ? '••••••••••••••••' : ''}
                helperText="Configure via environment variables"
              />
              
              <TextField
                fullWidth
                label="Base ID"
                value={config?.airtable?.baseId || ''}
                margin="normal"
                disabled
              />

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Customers Table"
                    value={config?.airtable?.customersTable || ''}
                    margin="normal"
                    disabled
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Calls Table"
                    value={config?.airtable?.callsTable || ''}
                    margin="normal"
                    disabled
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Sync Configuration */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sync Configuration
              </Typography>
              
              <Grid container spacing={3}>
                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    label="Sync Interval (ms)"
                    type="number"
                    value={config?.sync?.interval || 300000}
                    disabled
                    helperText="Auto-sync frequency"
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    label="Days Back"
                    type="number"
                    value={config?.sync?.daysBack || 14}
                    disabled
                    helperText="Initial sync window"
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    label="Backfill Grace (s)"
                    type="number"
                    value={config?.sync?.backfillGraceSeconds || 21600}
                    disabled
                    helperText="Overlap on resume"
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth disabled>
                    <InputLabel>Default Region</InputLabel>
                    <Select
                      value={config?.sync?.defaultRegion || 'SG'}
                      label="Default Region"
                    >
                      <MenuItem value="SG">Singapore</MenuItem>
                      <MenuItem value="US">United States</MenuItem>
                      <MenuItem value="GB">United Kingdom</MenuItem>
                      <MenuItem value="AU">Australia</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <Divider sx={{ my: 3 }} />

              <Typography variant="h6" gutterBottom>
                Field Mappings
              </Typography>
              
              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Customer Phone Field"
                    value={config?.fields?.customerPhone || ''}
                    disabled
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Calls Customer Link Field"
                    value={config?.fields?.callsCustomerLink || ''}
                    disabled
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Calls Unmatched Phone Field"
                    value={config?.fields?.callsUnmatchedPhone || 'Not configured'}
                    disabled
                  />
                </Grid>
              </Grid>

              <Alert severity="info" sx={{ mt: 3 }}>
                Configuration values are managed through environment variables. To modify these settings, update the backend .env file and restart the service.
              </Alert>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Settings;