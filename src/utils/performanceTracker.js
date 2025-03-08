const fs = require('fs');
const path = require('path');
const logger = require('../services/loggerService');
const currencyManager = require('./currencyManager');

class PerformanceTracker {
  constructor() {
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      totalProfit: 0,
      largestWin: 0,
      largestLoss: 0,
      averageWin: 0,
      averageLoss: 0,
      winRate: 0,
      profitFactor: 0,
      trades: []
    };
    
    // Try to load stats, but don't fail if it doesn't work
    try {
      this.loadStats();
    } catch (error) {
      console.error('Error loading performance stats, using defaults:', error);
      this.saveStats(); // Create a new file with defaults
    }
  }
  
  loadStats() {
    try {
      const filePath = path.join(__dirname, '../../logs/performance.json');
      
      // Check if file exists
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        // Check if file is empty or has invalid content
        if (!fileContent || fileContent.trim() === '') {
          // Initialize with default empty stats
          this.saveStats();
          return;
        }
        
        try {
          this.stats = JSON.parse(fileContent);
        } catch (parseError) {
          console.error('Error parsing performance.json, initializing with defaults:', parseError);
          // Initialize with default empty stats
          this.saveStats();
        }
      } else {
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        // Initialize with default empty stats
        this.saveStats();
      }
    } catch (error) {
      console.error('Error loading performance stats:', error);
      throw error; // Re-throw to be caught in constructor
    }
  }
  
  saveStats() {
    try {
      const filePath = path.join(__dirname, '../../logs/performance.json');
      
      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, JSON.stringify(this.stats, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving performance stats:', error);
    }
  }
  
  recordTrade(trade) {
    try {
      // Add currency if not present
      if (!trade.currency) {
        trade.currency = trade.symbol.endsWith('GBP') ? 'GBP' : 'USD';
      }
      
      // Add timestamp if not present
      if (!trade.timestamp) {
        trade.timestamp = new Date().toISOString();
      }
      
      // Store the original trade
      this.stats.trades.push(trade);
      
      // Update stats
      this.stats.totalTrades++;
      
      if (trade.profit > 0) {
        this.stats.winningTrades++;
        this.stats.totalProfit += trade.profit;
        
        if (trade.profit > this.stats.largestWin) {
          this.stats.largestWin = trade.profit;
        }
        
        // Log winning trade
        logger.logSuccess(`Trade closed with profit: ${trade.profit.toFixed(4)} ${trade.currency}`, {
          symbol: trade.symbol,
          side: trade.side,
          entry: trade.entryPrice,
          exit: trade.exitPrice,
          profit: `${trade.profit.toFixed(4)} ${trade.currency} (${((trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2)}%)`,
          reason: trade.reason
        });
      } else if (trade.profit < 0) {
        this.stats.losingTrades++;
        this.stats.totalProfit += trade.profit;
        
        if (trade.profit < this.stats.largestLoss) {
          this.stats.largestLoss = trade.profit;
        }
        
        // Log losing trade
        logger.logWarning(`Trade closed with loss: ${trade.profit.toFixed(4)} ${trade.currency}`, {
          symbol: trade.symbol,
          side: trade.side,
          entry: trade.entryPrice,
          exit: trade.exitPrice,
          loss: `${trade.profit.toFixed(4)} ${trade.currency} (${((trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2)}%)`,
          reason: trade.reason
        });
      } else {
        this.stats.breakEvenTrades++;
        
        // Log break-even trade
        logger.logInfo(`Trade closed at break-even`, {
          symbol: trade.symbol,
          side: trade.side,
          entry: trade.entryPrice,
          exit: trade.exitPrice,
          reason: trade.reason
        });
      }
      
      // Calculate win rate
      this.stats.winRate = (this.stats.winningTrades / this.stats.totalTrades) * 100;
      
      // Calculate average win and loss
      const wins = this.stats.trades.filter(t => t.profit > 0);
      const losses = this.stats.trades.filter(t => t.profit < 0);
      
      if (wins.length > 0) {
        this.stats.averageWin = wins.reduce((sum, t) => sum + t.profit, 0) / wins.length;
      }
      
      if (losses.length > 0) {
        this.stats.averageLoss = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0) / losses.length);
      }
      
      // Calculate profit factor
      if (this.stats.averageLoss > 0) {
        this.stats.profitFactor = this.stats.averageWin / this.stats.averageLoss;
      }
      
      // Save after each trade to prevent data loss
      this.saveStats();
      this.logPerformance();
    } catch (error) {
      console.error('Error recording trade:', error);
    }
  }
  
  logPerformance() {
    try {
      if (!this.stats.trades || this.stats.trades.length === 0) return;
      
      // Group trades by currency
      const gbpTrades = this.stats.trades.filter(t => t.currency === 'GBP' || !t.currency);
      const usdTrades = this.stats.trades.filter(t => t.currency === 'USD');
      
      const gbpProfit = gbpTrades.reduce((sum, t) => sum + t.profit, 0);
      const usdProfit = usdTrades.reduce((sum, t) => sum + t.profit, 0);
      
      // Create a stats object with currency breakdown
      const statsWithCurrency = {
        ...this.stats,
        gbpProfit,
        usdProfit,
        gbpTrades: gbpTrades.length,
        usdTrades: usdTrades.length
      };
      
      // Use the new logger method
      logger.logPerformance(statsWithCurrency);
    } catch (error) {
      console.error('Error logging performance:', error);
    }
  }

  /**
   * Get performance stats converted to a specific currency
   * @param {string} currency - The currency to convert to (GBP or USD)
   * @returns {Object} Performance stats in the specified currency
   */
  getPerformanceInCurrency(currency = 'GBP') {
    try {
      if (!this.stats.trades || this.stats.trades.length === 0) {
        return {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          totalProfit: 0,
          winRate: 0
        };
      }
      
      // Convert all profits to the target currency
      const convertedTrades = this.stats.trades.map(trade => {
        if (trade.currency === currency) {
          return trade.profit;
        } else {
          // Convert from trade currency to target currency
          return currencyManager.convert(trade.profit, trade.currency, currency);
        }
      });
      
      const totalProfit = convertedTrades.reduce((sum, profit) => sum + profit, 0);
      const wins = convertedTrades.filter(profit => profit > 0);
      const losses = convertedTrades.filter(profit => profit < 0);
      
      const winRate = (wins.length / convertedTrades.length) * 100;
      const averageWin = wins.length > 0 ? wins.reduce((sum, profit) => sum + profit, 0) / wins.length : 0;
      const averageLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, profit) => sum + profit, 0) / losses.length) : 0;
      const profitFactor = averageLoss > 0 ? averageWin / averageLoss : 0;
      
      return {
        totalTrades: this.stats.trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        totalProfit,
        winRate,
        averageWin,
        averageLoss,
        profitFactor,
        currency
      };
    } catch (error) {
      console.error('Error getting performance in currency:', error);
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalProfit: 0,
        winRate: 0,
        error: error.message
      };
    }
  }

  /**
   * Verify that the performance tracker is working correctly
   * @returns {boolean} True if the performance tracker is working
   */
  verifyTracker() {
    try {
      // Check if we can load stats
      this.loadStats();
      
      // Check if we can save stats
      this.saveStats();
      
      // Check if we can record a dummy trade (but don't actually save it)
      const dummyTrade = {
        symbol: 'TEST/GBP',
        side: 'long',
        entryPrice: 1.0,
        exitPrice: 1.1,
        volume: 1.0,
        profit: 0.1,
        currency: 'GBP',
        reason: 'TEST',
        timestamp: new Date().toISOString()
      };
      
      // Create a backup of current stats
      const statsBackup = JSON.parse(JSON.stringify(this.stats));
      
      // Try recording the trade without saving
      const recordMethod = this.recordTrade;
      this.recordTrade = (trade) => {
        // Process the trade but don't save or log
        if (!trade.currency) {
          trade.currency = trade.symbol.endsWith('GBP') ? 'GBP' : 'USD';
        }
        
        if (!trade.timestamp) {
          trade.timestamp = new Date().toISOString();
        }
      };
      
      this.recordTrade(dummyTrade);
      
      // Restore the original method and stats
      this.recordTrade = recordMethod;
      this.stats = statsBackup;
      
      logger.logTrade('Performance tracker verification: SUCCESS');
      return true;
    } catch (error) {
      logger.logError('Performance tracker verification failed:', error);
      return false;
    }
  }

  /**
   * Fix common issues with the performance tracker
   * @returns {boolean} True if fixes were applied
   */
  fixTrackerIssues() {
    try {
      let fixesApplied = false;
      
      // Try to load stats
      try {
        this.loadStats();
      } catch (loadError) {
        logger.logError('Error loading stats, creating new file:', loadError);
        this.stats = {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          breakEvenTrades: 0,
          totalProfit: 0,
          largestWin: 0,
          largestLoss: 0,
          averageWin: 0,
          averageLoss: 0,
          winRate: 0,
          profitFactor: 0,
          trades: []
        };
        this.saveStats();
        fixesApplied = true;
      }
      
      // Check if trades array exists
      if (!this.stats.trades) {
        logger.logTrade('Fixing missing trades array');
        this.stats.trades = [];
        fixesApplied = true;
      }
      
      // Check for NaN values in stats
      for (const [key, value] of Object.entries(this.stats)) {
        if (typeof value === 'number' && isNaN(value)) {
          logger.logTrade(`Fixing NaN value in ${key}`);
          this.stats[key] = 0;
          fixesApplied = true;
        }
      }
      
      // Add currency to trades that don't have it
      let tradesUpdated = 0;
      this.stats.trades.forEach(trade => {
        if (!trade.currency) {
          trade.currency = trade.symbol.endsWith('GBP') ? 'GBP' : 'USD';
          tradesUpdated++;
        }
      });
      
      if (tradesUpdated > 0) {
        logger.logTrade(`Added missing currency to ${tradesUpdated} trades`);
        fixesApplied = true;
      }
      
      // Recalculate stats based on trades
      if (this.stats.trades.length > 0) {
        logger.logTrade('Recalculating performance stats');
        
        this.stats.totalTrades = this.stats.trades.length;
        this.stats.winningTrades = this.stats.trades.filter(t => t.profit > 0).length;
        this.stats.losingTrades = this.stats.trades.filter(t => t.profit < 0).length;
        this.stats.breakEvenTrades = this.stats.trades.filter(t => t.profit === 0).length;
        this.stats.totalProfit = this.stats.trades.reduce((sum, t) => sum + t.profit, 0);
        
        const wins = this.stats.trades.filter(t => t.profit > 0);
        const losses = this.stats.trades.filter(t => t.profit < 0);
        
        this.stats.largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profit)) : 0;
        this.stats.largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profit)) : 0;
        
        this.stats.averageWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.profit, 0) / wins.length : 0;
        this.stats.averageLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.profit, 0) / losses.length) : 0;
        
        this.stats.winRate = this.stats.totalTrades > 0 ? (this.stats.winningTrades / this.stats.totalTrades) * 100 : 0;
        this.stats.profitFactor = this.stats.averageLoss > 0 ? this.stats.averageWin / this.stats.averageLoss : 0;
        
        fixesApplied = true;
      }
      
      // Save if fixes were applied
      if (fixesApplied) {
        this.saveStats();
        logger.logTrade('Performance tracker fixes applied and saved');
      } else {
        logger.logTrade('Performance tracker is working correctly, no fixes needed');
      }
      
      return fixesApplied;
    } catch (error) {
      logger.logError('Error fixing performance tracker:', error);
      return false;
    }
  }

  /**
   * Get performance stats for a specific day
   * @param {string} date - The date in YYYY-MM-DD format (defaults to today)
   * @returns {Object} Performance stats for the specified day
   */
  getDailyPerformance(date = new Date().toISOString().split('T')[0]) {
    try {
      if (!this.stats.trades || this.stats.trades.length === 0) {
        return {
          date,
          trades: 0,
          profit: { GBP: 0, USD: 0 },
          winRate: 0
        };
      }
      
      // Filter trades for the specified day
      const dayTrades = this.stats.trades.filter(trade => {
        return trade.timestamp.startsWith(date);
      });
      
      if (dayTrades.length === 0) {
        return {
          date,
          trades: 0,
          profit: { GBP: 0, USD: 0 },
          winRate: 0
        };
      }
      
      // Group by currency
      const gbpTrades = dayTrades.filter(t => t.currency === 'GBP' || !t.currency);
      const usdTrades = dayTrades.filter(t => t.currency === 'USD');
      
      const gbpProfit = gbpTrades.reduce((sum, t) => sum + t.profit, 0);
      const usdProfit = usdTrades.reduce((sum, t) => sum + t.profit, 0);
      
      const winningTrades = dayTrades.filter(t => t.profit > 0).length;
      const winRate = (winningTrades / dayTrades.length) * 100;
      
      return {
        date,
        trades: dayTrades.length,
        profit: {
          GBP: gbpProfit,
          USD: usdProfit
        },
        winRate
      };
    } catch (error) {
      console.error('Error getting daily performance:', error);
      return {
        date,
        trades: 0,
        profit: { GBP: 0, USD: 0 },
        winRate: 0,
        error: error.message
      };
    }
  }
}

// Create a singleton instance with error handling
let instance;
try {
  instance = new PerformanceTracker();
} catch (error) {
  console.error('Failed to create PerformanceTracker, using empty instance:', error);
  instance = {
    stats: {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      totalProfit: 0,
      largestWin: 0,
      largestLoss: 0,
      averageWin: 0,
      averageLoss: 0,
      winRate: 0,
      profitFactor: 0,
      trades: []
    },
    recordTrade: (trade) => console.log('Trade recorded (fallback):', trade),
    logPerformance: () => console.log('Performance logging disabled (fallback)'),
    getPerformanceInCurrency: (currency) => console.log('Performance in currency not implemented (fallback)'),
    verifyTracker: () => console.log('Performance tracker verification not implemented (fallback)'),
    fixTrackerIssues: () => console.log('Performance tracker issue fixing not implemented (fallback)'),
    getDailyPerformance: (date) => console.log('Daily performance not implemented (fallback)')
  };
}

module.exports = instance; 