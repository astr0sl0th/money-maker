const logger = require('../services/loggerService');
const marketAnalyzer = require('../utils/marketAnalyzer');

class RSIStrategy {
  constructor(adjustments) {
    this.adjustments = adjustments;
  }

  validatePrices(marketData, symbol) {
    const closingPrices = marketData.map(d => d.close);
    const recentPrices = closingPrices.slice(-10);
    const priceChanges = [];
    
    // Calculate price changes
    for (let i = 1; i < recentPrices.length; i++) {
      const change = ((recentPrices[i] - recentPrices[i-1]) / recentPrices[i-1]) * 100;
      priceChanges.push(Math.abs(change));
    }

    const totalVolatility = priceChanges.reduce((a, b) => a + b, 0);
    const maxChange = Math.max(...priceChanges, 0);
    const uniquePrices = new Set(recentPrices).size;
    const activeCandles = marketData.filter(d => d.trades > 0).length;

    // Log validation details
    logger.logTrade(`
      ${symbol} RSI Validation:
      Active candles: ${activeCandles}
      Total volatility: ${totalVolatility.toFixed(4)}%
      Max change: ${maxChange.toFixed(4)}%
      Unique prices: ${uniquePrices}
      Recent changes: ${priceChanges.map(c => c.toFixed(4) + '%').join(', ')}
    `);

    // Lower the validation requirements
    if (this.adjustments.minTrades <= 1) {
      // Accept if we have any price changes
      if (activeCandles >= 1 && uniquePrices >= 1) {
        logger.logTrade(`${symbol}: Accepting minimal data`);
        return true;
      }
    }
    // For low activity
    else if (this.adjustments.minTrades <= 2) {
      // Accept if we have enough active candles and unique prices
      if (activeCandles >= 2 && uniquePrices >= 1) {
        logger.logTrade(`${symbol}: Accepting low activity data`);
        return true;
      }
    }
    // For normal activity
    else {
      // Require more substantial activity
      if (activeCandles >= 5 && uniquePrices >= 3) {
        logger.logTrade(`${symbol}: Accepting data with normal activity`);
        return true;
      }
    }

    // Log rejection reason
    if (activeCandles < 2) {
      logger.logTrade(`${symbol}: Insufficient active candles (${activeCandles})`);
    } else if (uniquePrices < 2) {
      logger.logTrade(`${symbol}: Not enough price variation (${uniquePrices} unique prices)`);
    } else if (totalVolatility === 0) {
      logger.logTrade(`${symbol}: No price movement detected`);
    } else {
      logger.logTrade(`${symbol}: Activity requirements not met`);
    }

    return false;
  }

  calculateRSI(marketData) {
    try {
      const symbol = marketData[0]?.symbol || 'Unknown';
      const period = this.adjustments.rsiPeriod;

      // Validate input data
      if (!this.validatePrices(marketData, symbol)) {
        return null;
      }

      const closingPrices = marketData.map(d => d.close);
      const changes = [];
      const gains = [];
      const losses = [];

      // Calculate price changes and separate gains/losses
      for (let i = 1; i < closingPrices.length; i++) {
        const change = ((closingPrices[i] - closingPrices[i-1]) / closingPrices[i-1]) * 100;
        changes.push(change);
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
      }

      // Calculate RSI using most recent data
      const recentGains = gains.slice(-period);
      const recentLosses = losses.slice(-period);

      const avgGain = recentGains.reduce((a, b) => a + b, 0) / period;
      const avgLoss = recentLosses.reduce((a, b) => a + b, 0) / period;

      // Calculate RSI
      let rsi;
      if (avgLoss === 0) {
        rsi = avgGain > 0 ? 70 : 50; // Use 70 for gains, 50 for no movement
      } else if (avgGain === 0) {
        rsi = 30; // Only losses
      } else {
        const rs = avgGain / avgLoss;
        rsi = 100 - (100 / (1 + rs));
      }

      logger.logTrade(`
        ${symbol} RSI Calculation:
        Period: ${period}
        Average Gain: ${avgGain.toFixed(4)}%
        Average Loss: ${avgLoss.toFixed(4)}%
        RSI: ${rsi.toFixed(2)}
        Recent Changes: ${changes.slice(-5).map(c => c.toFixed(4) + '%').join(', ')}
      `);

      return [rsi];
    } catch (error) {
      logger.logError('RSI Calculation Error:', error);
      return null;
    }
  }

  shouldTrade(symbol, rsiValues, price, position = null, marketData = []) {
    if (!rsiValues || !rsiValues.length) {
      logger.logTrade(`${symbol}: No RSI value available`);
      return { action: 'wait', reason: 'NO_RSI' };
    }

    const rsi = rsiValues[0];
    const isLowActivity = this.adjustments.minTrades <= 2;
    
    // Analyze market conditions
    const marketConditions = marketData && marketData.length > 0 
      ? marketAnalyzer.analyzeMarketConditions(marketData)
      : { marketCondition: 'unknown', volatility: 0 };
    
    const trend = marketData && marketData.length > 0 
      ? marketAnalyzer.detectTrend(marketData)
      : 'unknown';
    
    logger.logTrade(`
      ${symbol} Trading Analysis:
      RSI: ${rsi.toFixed(2)}
      Price: ${price}
      Activity: ${isLowActivity ? 'Low' : 'Normal'}
      Market Condition: ${marketConditions.marketCondition}
      Volatility: ${marketConditions.volatility.toFixed(2)}
      Trend: ${trend}
    `);

    // Adjust thresholds based on market conditions
    let thresholds;
    
    if (marketConditions.marketCondition === 'trending') {
      // In trending markets, be more aggressive with entries and exits
      thresholds = {
        oversold: 45,
        overbought: 55,
        strongOversold: 40,
        strongOverbought: 60
      };
    } else if (marketConditions.marketCondition === 'ranging') {
      // In ranging markets, be more aggressive with entries and exits
      thresholds = {
        oversold: 40,  // Increased from 30
        overbought: 60, // Decreased from 70
        strongOversold: 35, // Increased from 20
        strongOverbought: 65 // Decreased from 80
      };
    } else if (marketConditions.marketCondition === 'volatile') {
      // In volatile markets, be more conservative
      thresholds = {
        oversold: 25,
        overbought: 75,
        strongOversold: 15,
        strongOverbought: 85
      };
    } else if (isLowActivity) {
      // For low activity, use more lenient thresholds
      thresholds = {
        oversold: 45,
        overbought: 55,
        strongOversold: 40,
        strongOverbought: 60
      };
    } else {
      // Default thresholds
      thresholds = {
        oversold: 30,
        overbought: 70,
        strongOversold: 20,
        strongOverbought: 80
      };
    }

    if (position) {
      // Exit conditions
      if (position.side === 'long') {
        if (rsi > thresholds.strongOverbought) {
          return { 
            action: 'exit', 
            reason: `STRONG_OVERBOUGHT (${rsi.toFixed(2)} > ${thresholds.strongOverbought})` 
          };
        }
        if (rsi > thresholds.overbought) {
          return { 
            action: 'exit', 
            reason: `OVERBOUGHT (${rsi.toFixed(2)} > ${thresholds.overbought})` 
          };
        }
      }
      return { action: 'hold' };
    }

    // Modify entry conditions based on trend
    if (trend === 'downtrend' && rsi < thresholds.oversold) {
      return { 
        action: 'buy', 
        reason: `OVERSOLD_IN_DOWNTREND (${rsi.toFixed(2)} < ${thresholds.oversold})` 
      };
    }

    // Add counter-trend trading for overbought conditions
    if (trend === 'uptrend' && rsi > 75) {
      return { 
        action: 'sell', 
        reason: `OVERBOUGHT_IN_UPTREND (${rsi.toFixed(2)} > 75)` 
      };
    }

    // Add counter-trend trading for oversold conditions in uptrends
    if (trend === 'uptrend' && rsi < 40) {
      return { 
        action: 'buy', 
        reason: `OVERSOLD_IN_UPTREND (${rsi.toFixed(2)} < 40)` 
      };
    }

    return { action: 'wait', reason: 'NO_SIGNAL' };
  }

  /**
   * Get trading signal based on RSI values
   * @param {Array} rsiValues - Array of RSI values
   * @param {Object} position - Current position if any
   * @returns {Object} Trading signal
   */
  getSignal(rsiValues, position) {
    if (!rsiValues || rsiValues.length < 2) {
      return { action: 'wait', reason: 'INSUFFICIENT_DATA' };
    }
    
    const currentRSI = rsiValues[rsiValues.length - 1];
    const previousRSI = rsiValues[rsiValues.length - 2];
    
    // Exit signals (if we have a position)
    if (position) {
      if (position.side === 'buy') {
        // For long positions, exit on overbought
        if (currentRSI > this.overboughtExtreme) {
          return { action: 'exit', reason: `STRONG_OVERBOUGHT (${currentRSI.toFixed(2)} > ${this.overboughtExtreme})` };
        }
        
        if (currentRSI > this.overbought) {
          return { action: 'exit', reason: `OVERBOUGHT (${currentRSI.toFixed(2)} > ${this.overbought})` };
        }
      } else if (position.side === 'sell') {
        // For short positions, exit on oversold
        if (currentRSI < this.oversoldExtreme) {
          return { action: 'exit', reason: `STRONG_OVERSOLD (${currentRSI.toFixed(2)} < ${this.oversoldExtreme})` };
        }
        
        if (currentRSI < this.oversold) {
          return { action: 'exit', reason: `OVERSOLD (${currentRSI.toFixed(2)} < ${this.oversold})` };
        }
      }
      
      // No exit signal
      return { action: 'wait', reason: 'HOLDING_POSITION' };
    }
    
    // Entry signals (if we don't have a position)
    
    // Buy signals
    if (currentRSI < this.oversoldExtreme) {
      return { action: 'buy', reason: `EXTREME_OVERSOLD (${currentRSI.toFixed(2)} < ${this.oversoldExtreme})` };
    }
    
    if (currentRSI < this.oversold && previousRSI >= this.oversold) {
      return { action: 'buy', reason: `CROSSING_OVERSOLD (${currentRSI.toFixed(2)} < ${this.oversold})` };
    }
    
    // Sell signals
    if (currentRSI > this.overboughtExtreme) {
      return { action: 'sell', reason: `EXTREME_OVERBOUGHT (${currentRSI.toFixed(2)} > ${this.overboughtExtreme})` };
    }
    
    if (currentRSI > this.overbought && previousRSI <= this.overbought) {
      return { action: 'sell', reason: `CROSSING_OVERBOUGHT (${currentRSI.toFixed(2)} > ${this.overbought})` };
    }
    
    // No strong signal
    return { action: 'wait', reason: 'NEUTRAL_RSI' };
  }
}

module.exports = RSIStrategy; 