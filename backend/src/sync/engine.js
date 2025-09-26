const state = require('./state');

class SyncEngine {
  constructor(logger, io) {
    this.logger = logger;
    this.io = io;
    this.isSyncing = false;
    this.lastSyncResult = null;
    this.syncHistory = [];
  }

  async run() {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping...');
      return { error: 'Sync already in progress' };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    // Emit sync started event
    if (this.io) {
      this.io.to('sync-updates').emit('sync:started', {
        timestamp: new Date().toISOString()
      });
    }

    try {
      this.logger.info('Starting sync engine...');
      
      // Dynamically require sync to avoid circular dependencies
      const sync = require('./sync');
      
      // Run the sync
      const result = await sync();
      
      const duration = Date.now() - startTime;
      
      // Store result
      this.lastSyncResult = {
        ...result,
        duration,
        timestamp: new Date().toISOString()
      };
      
      // Add to history (keep last 100)
      this.syncHistory.unshift(this.lastSyncResult);
      if (this.syncHistory.length > 100) {
        this.syncHistory = this.syncHistory.slice(0, 100);
      }

      // Emit sync completed event
      if (this.io) {
        this.io.to('sync-updates').emit('sync:completed', this.lastSyncResult);
      }
      
      this.logger.info({ result, duration }, 'Sync completed');
      return this.lastSyncResult;
      
    } catch (error) {
      this.logger.error(error, 'Sync failed');
      
      const errorResult = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      this.lastSyncResult = errorResult;
      this.syncHistory.unshift(errorResult);
      
      // Emit sync failed event
      if (this.io) {
        this.io.to('sync-updates').emit('sync:failed', errorResult);
      }
      
      throw error;
      
    } finally {
      this.isSyncing = false;
    }
  }

  async getStatus() {
    const fullState = await state.getFullState();
    
    return {
      isSyncing: this.isSyncing,
      lastSync: this.lastSyncResult,
      state: fullState,
      history: this.syncHistory.slice(0, 10) // Last 10 syncs
    };
  }

  async resetState() {
    if (this.isSyncing) {
      throw new Error('Cannot reset state while sync is in progress');
    }
    
    await state.reset();
    this.lastSyncResult = null;
    this.syncHistory = [];
    
    return { success: true, message: 'State reset successfully' };
  }
}

module.exports = SyncEngine;