const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Simple retry function with exponential backoff and jitter
 * @param {Function} fn - Function to retry
 * @param {string} operation - Operation name for logging
 * @param {Object} options - Retry options
 */
async function retry(fn, operation = 'Operation', options = {}) {
  const defaults = {
    retries: 5,
    minTimeout: 1000,
    maxTimeout: 30000,
    factor: 2
  };

  const config = { ...defaults, ...options };
  let lastError;
  
  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on the last attempt
      if (attempt === config.retries) {
        logger.error({ operation, error: error.message }, `${operation} failed after all retries`);
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        config.minTimeout * Math.pow(config.factor, attempt - 1),
        config.maxTimeout
      );
      const jitter = Math.random() * baseDelay * 0.1; // 10% jitter
      const delay = Math.floor(baseDelay + jitter);
      
      logger.warn({
        operation,
        attemptNumber: attempt,
        retriesLeft: config.retries - attempt,
        error: error.message,
        nextDelayMs: delay
      }, `${operation} failed, retrying...`);
      
      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

module.exports = retry;