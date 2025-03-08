const logger = require('../services/loggerService');

class MarketAnalyzer {
  analyzeMarketConditions(marketData) {
    // Calculate volatility
    const closes = marketData.map(candle => candle.close);
    const volatility = this.calculateVolatility(closes);
    
    // Calculate volume trend
    const volumes = marketData.map(candle => candle.volume);
    const volumeTrend = this.calculateVolumeTrend(volumes);
    
    // Calculate price trend
    const priceTrend = this.calculatePriceTrend(closes);
    
    // Determine market condition
    let marketCondition = 'neutral';
    if (volatility > 1.5 && volumeTrend > 0.5) {
      marketCondition = 'trending';
    } else if (volatility < 0.5 && Math.abs(priceTrend) < 0.2) {
      marketCondition = 'ranging';
    } else if (volatility > 2.0) {
      marketCondition = 'volatile';
    }
    
    return {
      volatility,
      volumeTrend,
      priceTrend,
      marketCondition
    };
  }
  
  calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
    }
    
    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
    const squaredDiffs = returns.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length;
    
    return Math.sqrt(variance);
  }
  
  calculateVolumeTrend(volumes) {
    if (volumes.length < 10) return 0;
    
    const recentVolumes = volumes.slice(-5);
    const previousVolumes = volumes.slice(-10, -5);
    
    const recentAvg = recentVolumes.reduce((sum, val) => sum + val, 0) / recentVolumes.length;
    const previousAvg = previousVolumes.reduce((sum, val) => sum + val, 0) / previousVolumes.length;
    
    return (recentAvg - previousAvg) / previousAvg;
  }
  
  calculatePriceTrend(prices) {
    if (prices.length < 2) return 0;
    
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    
    return (lastPrice - firstPrice) / firstPrice * 100;
  }

  detectTrend(marketData, periods = 10) {
    if (!marketData || marketData.length < periods) return 'unknown';
    
    const closes = marketData.map(candle => candle.close);
    const recentCloses = closes.slice(-periods);
    
    // Calculate simple moving averages
    const shortMA = this.calculateSMA(recentCloses, 3);
    const longMA = this.calculateSMA(recentCloses, 10);
    
    // Determine trend direction
    if (shortMA > longMA * 1.005) {
      return 'uptrend';
    } else if (shortMA < longMA * 0.995) {
      return 'downtrend';
    } else {
      return 'sideways';
    }
  }

  calculateSMA(prices, period) {
    if (prices.length < period) return 0;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }
}

/**
 * Check if current time is good for trading
 * @param {string} currency - The currency being traded (GBP or USD)
 * @returns {boolean} True if it's a good trading time
 */
function isGoodTradingTime(currency = 'GBP') {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  
  // Weekend check (reduced activity on weekends)
  const isWeekend = day === 0 || day === 6;
  
  // For USD trading, we're more lenient with trading hours
  if (currency === 'USD') {
    // US market hours are roughly 13:30-20:00 UTC (9:30-16:00 EST)
    const isUSMarketHours = hour >= 13 && hour < 20;
    
    // Extended hours trading (pre-market and after-hours)
    const isExtendedHours = (hour >= 9 && hour < 13) || (hour >= 20 && hour < 22);
    
    // Asian market hours (roughly 0:00-8:00 UTC)
    const isAsianMarketHours = hour >= 0 && hour < 8;
    
    // During weekends, only trade during peak Asian hours
    if (isWeekend) {
      // Only trade during Asian market hours on weekends
      return isAsianMarketHours;
    }
    
    // During weekdays
    if (isUSMarketHours) {
      // Full trading during US market hours
      logger.logInfo(`Good trading time: US market hours (${hour}:00 UTC)`);
      return true;
    } else if (isExtendedHours) {
      // Reduced but still active during extended hours
      logger.logInfo(`Acceptable trading time: US extended hours (${hour}:00 UTC)`);
      return true;
    } else if (isAsianMarketHours) {
      // Reduced but still active during Asian market hours
      logger.logInfo(`Acceptable trading time: Asian market hours (${hour}:00 UTC)`);
      return true;
    } else {
      // Very quiet hours (8-9 UTC, 22-24 UTC)
      logger.logWarning(`Low activity period for USD trading (${hour}:00 UTC)`);
      return false;
    }
  }
  
  // For GBP trading
  // UK market hours are roughly 8:00-16:30 UTC
  const isUKMarketHours = hour >= 8 && hour < 17;
  
  // European extended hours
  const isEuropeanExtendedHours = (hour >= 7 && hour < 8) || (hour >= 17 && hour < 19);
  
  // If it's weekend and not during UK/European hours, not a good time
  if (isWeekend && !isUKMarketHours && !isEuropeanExtendedHours) {
    logger.logWarning(`Weekend outside UK market hours (${hour}:00 UTC)`);
    return false;
  }
  
  // If it's very late night in UK, reduce activity
  if (hour >= 22 || hour < 7) {
    logger.logWarning(`Late night in UK (${hour}:00 UTC)`);
    return false;
  }
  
  logger.logInfo(`Good trading time for GBP: UK market hours (${hour}:00 UTC)`);
  return true;
}

/**
 * Check if there's enough market activity to trade
 * @param {Array} marketData - Array of candle data
 * @param {string} symbol - Trading pair symbol
 * @returns {boolean} True if there's enough activity
 */
function hasEnoughActivity(marketData, symbol) {
  try {
    if (!marketData || marketData.length < 10) {
      logger.logWarning(`Not enough market data for ${symbol}`);
      return false;
    }
    
    // Calculate average volume
    const volumes = marketData.map(candle => candle.volume);
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    
    // Calculate average price movement (volatility)
    const priceChanges = [];
    for (let i = 1; i < marketData.length; i++) {
      const change = Math.abs(marketData[i].close - marketData[i-1].close) / marketData[i-1].close * 100;
      priceChanges.push(change);
    }
    const avgPriceChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
    
    // Check if there's enough activity
    const hasVolume = avgVolume > 1000; // Adjust threshold as needed
    const hasMovement = avgPriceChange > 0.05; // 0.05% average movement
    
    logger.logInfo(`Market activity for ${symbol}`, {
      avgVolume: avgVolume.toFixed(2),
      avgPriceChange: `${avgPriceChange.toFixed(4)}%`,
      hasEnoughActivity: hasVolume && hasMovement
    });
    
    return hasVolume && hasMovement;
  } catch (error) {
    logger.logError(`Error checking market activity for ${symbol}:`, error);
    return false;
  }
}

/**
 * Analyze market conditions based on market data
 * @param {Array} marketData - Array of candle data
 * @returns {Object} Market conditions analysis
 */
function analyzeMarketConditions(marketData) {
  try {
    if (!marketData || marketData.length < 10) {
      logger.logWarning('Not enough market data for analysis');
      return {
        volatility: 1.0,
        volumeTrend: 0,
        priceTrend: 0,
        marketCondition: 'neutral'
      };
    }
    
    // Calculate volatility
    const closes = marketData.map(candle => candle.close);
    const volatility = calculateVolatility(closes);
    
    // Calculate volume trend
    const volumes = marketData.map(candle => candle.volume);
    const volumeTrend = calculateVolumeTrend(volumes);
    
    // Calculate price trend
    const priceTrend = calculatePriceTrend(closes);
    
    // Determine market condition
    let marketCondition = 'neutral';
    if (volatility > 1.5 && volumeTrend > 0.5) {
      marketCondition = 'trending';
    } else if (volatility < 0.5 && Math.abs(priceTrend) < 0.2) {
      marketCondition = 'ranging';
    } else if (volatility > 2.0) {
      marketCondition = 'volatile';
    }
    
    logger.logInfo('Market conditions analysis', {
      volatility: volatility.toFixed(2),
      volumeTrend: volumeTrend.toFixed(2),
      priceTrend: priceTrend.toFixed(2),
      marketCondition
    });
    
    return {
      volatility,
      volumeTrend,
      priceTrend,
      marketCondition
    };
  } catch (error) {
    logger.logError('Error analyzing market conditions:', error);
    return {
      volatility: 1.0,
      volumeTrend: 0,
      priceTrend: 0,
      marketCondition: 'neutral'
    };
  }
}

/**
 * Calculate volatility based on price data
 * @param {Array} prices - Array of price data
 * @returns {number} Volatility value
 */
function calculateVolatility(prices) {
  if (prices.length < 2) return 1.0;
  
  try {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
    }
    
    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
    const squaredDiffs = returns.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length;
    
    return Math.sqrt(variance);
  } catch (error) {
    logger.logError('Error calculating volatility:', error);
    return 1.0;
  }
}

/**
 * Calculate volume trend
 * @param {Array} volumes - Array of volume data
 * @returns {number} Volume trend value
 */
function calculateVolumeTrend(volumes) {
  if (volumes.length < 5) return 0;
  
  try {
    // Calculate short-term vs long-term volume
    const shortTerm = volumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / 5;
    const longTerm = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    
    // Return ratio of short-term to long-term (normalized around 0)
    return (shortTerm / longTerm) - 1;
  } catch (error) {
    logger.logError('Error calculating volume trend:', error);
    return 0;
  }
}

/**
 * Calculate price trend
 * @param {Array} prices - Array of price data
 * @returns {number} Price trend value
 */
function calculatePriceTrend(prices) {
  if (prices.length < 10) return 0;
  
  try {
    // Simple linear regression slope
    const n = prices.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = prices;
    
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Normalize by average price
    const avgPrice = sumY / n;
    return slope / avgPrice;
  } catch (error) {
    logger.logError('Error calculating price trend:', error);
    return 0;
  }
}

module.exports = {
  // Existing exports...
  isGoodTradingTime,
  hasEnoughActivity,
  analyzeMarketConditions,
  calculateVolatility,
  calculateVolumeTrend,
  calculatePriceTrend
}; 