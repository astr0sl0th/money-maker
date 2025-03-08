const logger = require('../services/loggerService');
const { EMA } = require('technicalindicators');

class MACDStrategy {
  constructor(adjustments = {}) {
    this.adjustments = adjustments;
  }
  
  calculateMACD(marketData) {
    if (marketData.length < 26) {
      logger.logTrade('Not enough data for MACD calculation');
      return null;
    }
    
    const closePrices = marketData.map(candle => candle.close);
    
    // Calculate EMAs
    const ema12 = EMA.calculate({
      period: 12,
      values: closePrices
    });
    
    const ema26 = EMA.calculate({
      period: 26,
      values: closePrices
    });
    
    // Calculate MACD line
    const macdLine = [];
    for (let i = 0; i < ema12.length; i++) {
      const ema26Index = ema26.length - ema12.length + i;
      if (ema26Index >= 0) {
        macdLine.push(ema12[i] - ema26[ema26Index]);
      }
    }
    
    // Calculate signal line (9-period EMA of MACD line)
    const signalLine = EMA.calculate({
      period: 9,
      values: macdLine
    });
    
    // Calculate histogram
    const histogram = [];
    for (let i = 0; i < signalLine.length; i++) {
      const macdIndex = macdLine.length - signalLine.length + i;
      histogram.push(macdLine[macdIndex] - signalLine[i]);
    }
    
    return {
      macdLine,
      signalLine,
      histogram
    };
  }
  
  shouldTrade(symbol, macdData, price, position, marketData) {
    if (!macdData) {
      return { action: 'wait', reason: 'NO_MACD_DATA' };
    }
    
    const { macdLine, signalLine, histogram } = macdData;
    
    // Get the most recent values
    const currentMACD = macdLine[macdLine.length - 1];
    const previousMACD = macdLine[macdLine.length - 2];
    const currentSignal = signalLine[signalLine.length - 1];
    const previousSignal = signalLine[signalLine.length - 2];
    const currentHistogram = histogram[histogram.length - 1];
    const previousHistogram = histogram[histogram.length - 2];
    
    // Check for bullish crossover (MACD crosses above signal line)
    const bullishCrossover = previousMACD < previousSignal && currentMACD > currentSignal;
    
    // Check for bearish crossover (MACD crosses below signal line)
    const bearishCrossover = previousMACD > previousSignal && currentMACD < currentSignal;
    
    // Check for histogram reversal
    const bullishReversal = previousHistogram < 0 && currentHistogram > previousHistogram;
    const bearishReversal = previousHistogram > 0 && currentHistogram < previousHistogram;
    
    logger.logTrade(`
      ${symbol} MACD Analysis:
      MACD: ${currentMACD.toFixed(6)}
      Signal: ${currentSignal.toFixed(6)}
      Histogram: ${currentHistogram.toFixed(6)}
      Bullish Crossover: ${bullishCrossover}
      Bearish Crossover: ${bearishCrossover}
      Bullish Reversal: ${bullishReversal}
      Bearish Reversal: ${bearishReversal}
    `);
    
    // Trading logic
    if (position) {
      // Exit logic for existing positions
      if (position.side === 'long' && bearishCrossover) {
        return { action: 'exit', reason: 'MACD_BEARISH_CROSSOVER' };
      }
      
      if (position.side === 'short' && bullishCrossover) {
        return { action: 'exit', reason: 'MACD_BULLISH_CROSSOVER' };
      }
      
      return { action: 'wait', reason: 'HOLDING_POSITION' };
    } else {
      // Entry logic for new positions
      if (bullishCrossover || (bullishReversal && currentHistogram > 0)) {
        return { action: 'buy', reason: 'MACD_BULLISH_SIGNAL' };
      }
      
      if (bearishCrossover || (bearishReversal && currentHistogram < 0)) {
        return { action: 'sell', reason: 'MACD_BEARISH_SIGNAL' };
      }
      
      return { action: 'wait', reason: 'NO_SIGNAL' };
    }
  }

  /**
   * Get trading signal based on MACD values
   * @param {Object} macdData - MACD data object
   * @param {Object} position - Current position if any
   * @returns {Object} Trading signal
   */
  getSignal(macdData, position) {
    if (!macdData || !macdData.MACD || !macdData.signal || !macdData.histogram) {
      return { action: 'wait', reason: 'INSUFFICIENT_DATA' };
    }
    
    const macd = macdData.MACD;
    const signal = macdData.signal;
    const histogram = macdData.histogram;
    
    // Get the last few values
    const currentMACD = macd[macd.length - 1];
    const currentSignal = signal[signal.length - 1];
    const currentHistogram = histogram[histogram.length - 1];
    
    const previousHistogram = histogram[histogram.length - 2];
    
    // Exit signals (if we have a position)
    if (position) {
      if (position.side === 'buy') {
        // For long positions, exit on bearish signals
        if (currentMACD > 0 && currentMACD < currentSignal && previousHistogram > currentHistogram) {
          return { action: 'exit', reason: 'MACD_BEARISH_CROSS' };
        }
      } else if (position.side === 'sell') {
        // For short positions, exit on bullish signals
        if (currentMACD < 0 && currentMACD > currentSignal && previousHistogram < currentHistogram) {
          return { action: 'exit', reason: 'MACD_BULLISH_CROSS' };
        }
      }
      
      // No exit signal
      return { action: 'wait', reason: 'HOLDING_POSITION' };
    }
    
    // Entry signals (if we don't have a position)
    
    // Buy signals
    if (currentMACD < 0 && currentMACD > currentSignal && previousHistogram < currentHistogram) {
      return { action: 'buy', reason: 'MACD_BULLISH_CROSS_BELOW_ZERO' };
    }
    
    if (currentMACD > 0 && currentMACD > currentSignal && previousHistogram < currentHistogram) {
      return { action: 'buy', reason: 'MACD_BULLISH_CROSS_ABOVE_ZERO' };
    }
    
    // Sell signals
    if (currentMACD > 0 && currentMACD < currentSignal && previousHistogram > currentHistogram) {
      return { action: 'sell', reason: 'MACD_BEARISH_CROSS_ABOVE_ZERO' };
    }
    
    if (currentMACD < 0 && currentMACD < currentSignal && previousHistogram > currentHistogram) {
      return { action: 'sell', reason: 'MACD_BEARISH_CROSS_BELOW_ZERO' };
    }
    
    // No strong signal
    return { action: 'wait', reason: 'NEUTRAL_MACD' };
  }
}

module.exports = MACDStrategy; 