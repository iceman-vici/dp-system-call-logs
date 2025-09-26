require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { createServer } = require('http');
const { Server } = require('socket.io');
const pino = require('pino');
const cron = require('node-cron');

// Import routes
const syncRoutes = require('./api/routes/sync.routes');
const callsRoutes = require('./api/routes/calls.routes');
const analyticsRoutes = require('./api/routes/analytics.routes');
const customersRoutes = require('./api/routes/customers.routes');
const configRoutes = require('./api/routes/config.routes');
const healthRoutes = require('./api/routes/health.routes');

// Import sync engine
const SyncEngine = require('./sync/engine');

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

// Initialize Express
const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Global middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Request received');
  next();
});

// API Routes
app.use('/api/sync', syncRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/config', configRoutes);
app.use('/api/health', healthRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Dialpad Call Logs System API',
    version: '1.0.0',
    status: 'running'
  });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info('Client connected via WebSocket');
  
  socket.on('subscribe:sync', () => {
    socket.join('sync-updates');
  });
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected');
  });
});

// Initialize sync engine
const syncEngine = new SyncEngine(logger, io);

// Schedule automatic sync
if (process.env.SYNC_INTERVAL && process.env.NODE_ENV !== 'test') {
  const interval = parseInt(process.env.SYNC_INTERVAL);
  const cronExpression = `*/${Math.floor(interval / 60000)} * * * *`; // Convert ms to minutes
  
  cron.schedule(cronExpression, async () => {
    logger.info('Running scheduled sync...');
    try {
      await syncEngine.run();
    } catch (error) {
      logger.error(error, 'Scheduled sync failed');
    }
  });
  
  logger.info(`Automatic sync scheduled every ${interval}ms`);
}

// Make sync engine available to routes
app.locals.syncEngine = syncEngine;
app.locals.logger = logger;
app.locals.io = io;

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Resource not found',
      status: 404
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled rejection');
  process.exit(1);
});

module.exports = app;