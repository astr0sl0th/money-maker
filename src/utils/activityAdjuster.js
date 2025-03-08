const logger = require('../services/loggerService');

class ActivityAdjuster {
  constructor() {
    this.defaultAdjustments = {
      priceChanges: 1,
      minMovement: 0.001,
      volatilityThreshold: 0.06,
      volumeThreshold: 1000,
      minTrades: 1,
      rsiPeriod: 5,
      minActiveCandles: 1,
      uniquePrices: 1,
      lookbackMinutes: 60
    };
  }

  adjustForActivity(marketData, symbol) {
    try {
      // Count active candles (candles with price changes)
      const activeCandles = marketData.filter((candle, i) => {
        if (i === 0) return false;
        // Consider even very small changes as activity (0.0001% instead of 0.01%)
        return Math.abs(candle.close - marketData[i-1].close) / marketData[i-1].close > 0.0001;
      }).length;
      
      const activityRatio = (activeCandles / marketData.length) * 100;
      
      // Adjust parameters based on activity level
      let adjustments = {
        minTrades: 3,
        minActiveCandles: 5,
        rsiPeriod: 14
      };
      
      // More aggressive adjustments for low activity
      if (activityRatio < 10) {
        adjustments = {
          minTrades: 1,
          minActiveCandles: 2,
          rsiPeriod: 3
        };
      } else if (activityRatio < 20) {
        adjustments = {
          minTrades: 2,
          minActiveCandles: 3,
          rsiPeriod: 5
        };
      } else if (activityRatio < 30) {
        adjustments = {
          minTrades: 2,
          minActiveCandles: 4,
          rsiPeriod: 7
        };
      }
      
      logger.logTrade(`
        ${symbol} Activity Adjustments:
        Active candles: ${activeCandles}/${marketData.length}
        Activity ratio: ${activityRatio.toFixed(2)}%
        Min trades: ${adjustments.minTrades}
        Min active candles: ${adjustments.minActiveCandles}
        RSI period: ${adjustments.rsiPeriod}
      `);
      
      return adjustments;
    } catch (error) {
      logger.logError(`Error adjusting for ${symbol} activity:`, error);
      return this.defaultAdjustments;
    }
  }
}

module.exports = new ActivityAdjuster(); 