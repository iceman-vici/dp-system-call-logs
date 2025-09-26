const pRetry = require('p-retry');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

/**
 * Retry function with exponential backoff and jitter
 * @param {Function} fn - Function to retry
 * @param {string} operation - Operation name for logging
 * @param {Object} options - Retry options
 */
async function retry(fn, operation = 'Operation', options = {}) {
  const defaults = {
    retries: 5,
    minTimeout: 1000,
    maxTimeout: 30000,
    randomize: true,
    onFailedAttempt: (error) => {
      logger.warn({
        operation,
        attemptNumber: error.attemptNumber,
        retriesLeft: error.retriesLeft,
        error: error.message
      }, `${operation} failed, retrying...`);
    }
  };

  const retryOptions = { ...defaults, ...options };

  try {
    return await pRetry(fn, retryOptions);
  } catch (error) {
    logger.error({ operation, error: error.message }, `${operation} failed after all retries`);
    throw error;
  }
}

module.exports = retry;