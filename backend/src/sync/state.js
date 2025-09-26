const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

const STATE_DIR = process.env.STATE_DIR || './state';
const STATE_FILE = path.join(STATE_DIR, 'sync.state');

class StateManager {
  constructor() {
    this.ensureStateDir();
  }

  ensureStateDir() {
    try {
      fs.ensureDirSync(STATE_DIR);
    } catch (error) {
      logger.error(error, 'Failed to create state directory');
      throw error;
    }
  }

  async getLastSynced() {
    try {
      if (await fs.pathExists(STATE_FILE)) {
        const content = await fs.readFile(STATE_FILE, 'utf8');
        const state = JSON.parse(content);
        return state.lastSyncedEpochS || 0;
      }
      return 0;
    } catch (error) {
      logger.error(error, 'Failed to read state file');
      return 0;
    }
  }

  async setLastSynced(epochSeconds) {
    try {
      const state = {
        lastSyncedEpochS: epochSeconds,
        lastSyncedISO: new Date(epochSeconds * 1000).toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Write atomically
      const tmpFile = `${STATE_FILE}.tmp`;
      await fs.writeFile(tmpFile, JSON.stringify(state, null, 2));
      await fs.rename(tmpFile, STATE_FILE);
      
      logger.debug({ state }, 'State saved');
      return true;
    } catch (error) {
      logger.error(error, 'Failed to save state');
      throw error;
    }
  }

  async getFullState() {
    try {
      if (await fs.pathExists(STATE_FILE)) {
        const content = await fs.readFile(STATE_FILE, 'utf8');
        return JSON.parse(content);
      }
      return null;
    } catch (error) {
      logger.error(error, 'Failed to read full state');
      return null;
    }
  }

  async reset() {
    try {
      if (await fs.pathExists(STATE_FILE)) {
        await fs.remove(STATE_FILE);
        logger.info('State reset successfully');
      }
      return true;
    } catch (error) {
      logger.error(error, 'Failed to reset state');
      throw error;
    }
  }
}

module.exports = new StateManager();