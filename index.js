require('dotenv').config();

const KrakenClient = require('kraken-api');
const { RSI } = require('technicalindicators');
const fs = require('fs');

// Initialize Kraken API with your keys
const kraken = new KrakenClient(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);

const INTERVAL = 1; // 1-minute candlesticks
const RSI_PERIOD = 14; // RSI period
const TRADE_AMOUNT_USD = 10; // $10 per trade (changed from GBP)
const MAX_TRADE_AMOUNT_USD = 30; // Maximum trade amount in USD
const STOP_LOSS_PERCENT = 2; // 2% stop-loss
const TAKE_PROFIT_PERCENT = 1; // 1% take profit target

// Market filtering thresholds
const VOLATILITY_THRESHOLD = 0.3; // Minimum price change %
const VOLUME_THRESHOLD = 10000; // Minimum 24h volume in USD
const MAX_PAIRS = 5; // Maximum pairs to monitor
const MAX_PRICE_AGE_MINUTES = 3; // Number of minutes to check for price changes

// Position management
const MAX_POSITIONS = 3; // Maximum concurrent positions
const LEVERAGE = 3; // 3x leverage for margin trading
const POSITION_CHECK_INTERVAL = 5000; // Check positions every 5 seconds

// RSI thresholds
const RSI_OVERSOLD_EXTREME = 20; // Strong buy signal
const RSI_OVERSOLD = 30;  // Regular buy signal
const RSI_OVERBOUGHT = 70; // Sell/Short signal
const RSI_OVERBOUGHT_EXIT = 65; // Exit long positions
const RSI_EXTREME_OVERBOUGHT = 80; // Force exit long positions

// Track open positions
const openPositions = new Map(); // Will store: {volume, entryPrice, stopPrice, leverage, side}

// Log file setup
const logStream = fs.createWriteStream('trade_log.txt', { flags: 'a' });

// Update minimum order sizes for USD pairs
const MIN_ORDER_SIZES = {
  'default': 0.0002, // Default minimum for most pairs
  'SUIUSD': 10,      // SUI specific minimum
  'LTCUSD': 0.05,    // LTC specific minimum
  'ETHUSD': 0.005,   // ETH specific minimum
  'BTCUSD': 0.0001   // BTC specific minimum
};

// Add function to check minimum order size
function getMinOrderSize(symbol) {
  return MIN_ORDER_SIZES[symbol] || MIN_ORDER_SIZES.default;
}

// Add new function to check margin trading availability
async function getMarginTradingPairs() {
  try {
    const response = await kraken.api('AssetPairs');
    const marginPairs = Object.entries(response.result)
      .filter(([_, data]) => {
        return data && data.leverage_buy && Array.isArray(data.leverage_buy) && data.leverage_buy.length > 0;
      })
      .map(([pair, _]) => pair);
    console.log('Margin trading available for:', marginPairs);
    return new Set(marginPairs);
  } catch (error) {
    console.error('Error fetching margin pairs:', error);
    return new Set();
  }
}

// Update getValidGBPPairs to get USD pairs instead
async function getValidUSDPairs() {
  try {
    const response = await kraken.api('AssetPairs');
    const marginPairs = await getMarginTradingPairs();
    
    // Get USD pairs instead of GBP
    const usdPairs = Object.entries(response.result)
      .filter(([pair, _]) => pair.endsWith('USD') || pair.endsWith('ZUSD'))
      .map(([pair, _]) => ({
        symbol: pair,
        marginEnabled: marginPairs.has(pair)
      }))
      // Sort margin pairs first
      .sort((a, b) => b.marginEnabled - a.marginEnabled);

    console.log('Found margin pairs:', usdPairs.filter(p => p.marginEnabled).map(p => p.symbol));

    if (usdPairs.length === 0) {
      console.log('No USD pairs found');
      return [];
    }

    // Get current ticker data for volume check
    try {
      const symbols = usdPairs.map(p => p.symbol);
      const tickerData = await kraken.api('Ticker', { pair: symbols.join(',') });
      
      // Filter pairs with volume
      const activePairs = usdPairs.filter(pair => {
        const data = tickerData.result[pair.symbol];
        return data && data.v && parseFloat(data.v[1]) > 0;
      });

      console.log('Valid USD pairs:', activePairs.map(p => `${p.symbol} (Margin: ${p.marginEnabled})`));
      return activePairs;
    } catch (error) {
      console.error('Error fetching ticker data for volume check:', error);
      return usdPairs;
    }
  } catch (error) {
    console.error('Error fetching asset pairs:', error);
    return [];
  }
}

// Update filtering constants for off-hours
const MIN_PRICE_CHANGES = 2; // Lower from 3 to 2
const MIN_PRICE_MOVEMENT = 0.02; // Lower from 0.05% to 0.02%
const MIN_TRADES_24H = 3; // Lower from 5 to 3

// Update constants for better overnight trading
const RSI_CALCULATION_PERIOD = 5; // Use shorter RSI period during off-hours
const MIN_UNIQUE_PRICES = 2; // Require at least 2 different prices
const MIN_ACTIVE_CANDLES = 3; // Default minimum active candles
const MIN_ACTIVE_CANDLES_NIGHT = 1; // More lenient during off-hours

// Update constants for extremely low activity periods
const MIN_UNIQUE_PRICES_NIGHT = 1; // Allow single price during off-hours
const LOOKBACK_PERIODS = 60; // Look back 60 minutes for more data

// Add cleanup handler array
const positionMonitors = new Set();

// Update getActivityAdjustments to include more parameters
function getActivityAdjustments() {
  const hour = new Date().getUTCHours();
  const isWeekend = [0, 6].includes(new Date().getUTCDay());
  const isNighttime = hour >= 0 && hour <= 7;
  const isExtremelyLowActivity = isWeekend || (isNighttime && hour <= 4); // Extra low between 12-4am
  
  if (isExtremelyLowActivity) {
    return {
      priceChanges: 1,
      minMovement: 0.001, // 0.001% minimum movement
      volatilityThreshold: VOLATILITY_THRESHOLD * 0.2,
      volumeThreshold: VOLUME_THRESHOLD * 0.1,
      minTrades: 1,
      rsiPeriod: 5,
      minActiveCandles: 1,
      uniquePrices: MIN_UNIQUE_PRICES_NIGHT,
      lookbackMinutes: LOOKBACK_PERIODS
    };
  } else if (isWeekend || isNighttime) {
    return {
      priceChanges: 1,
      minMovement: 0.005,
      volatilityThreshold: VOLATILITY_THRESHOLD * 0.3,
      volumeThreshold: VOLUME_THRESHOLD * 0.3,
      minTrades: 2,
      rsiPeriod: RSI_CALCULATION_PERIOD,
      minActiveCandles: MIN_ACTIVE_CANDLES_NIGHT,
      uniquePrices: MIN_UNIQUE_PRICES,
      lookbackMinutes: 30
    };
  }
  
  return {
    priceChanges: MIN_PRICE_CHANGES,
    minMovement: MIN_PRICE_MOVEMENT,
    volatilityThreshold: VOLATILITY_THRESHOLD,
    volumeThreshold: VOLUME_THRESHOLD,
    minTrades: MIN_TRADES_24H,
    rsiPeriod: RSI_PERIOD,
    minActiveCandles: MIN_ACTIVE_CANDLES,
    uniquePrices: MIN_UNIQUE_PRICES,
    lookbackMinutes: 15
  };
}

// Update getMarketData to return more data during low activity
async function getMarketData(symbol) {
  try {
    const adjustments = getActivityAdjustments();
    console.log(`Current market adjustments for ${symbol}:`, adjustments);

    const ohlcData = await kraken.api('OHLC', { 
      pair: symbol, 
      interval: INTERVAL,
      since: Math.floor(Date.now()/1000) - adjustments.lookbackMinutes * 60
    });

    if (!ohlcData.result || !ohlcData.result[symbol]) {
      console.log(`No OHLC data received for ${symbol}`);
      return [];
    }

    const candles = ohlcData.result[symbol];
    console.log(`Got ${candles.length} candles for ${symbol}`);

    // Check for active trading with adjusted requirement
    const activeCandles = candles.filter(candle => {
      const volume = parseFloat(candle[6]);
      const price = parseFloat(candle[4]);
      return volume > 0 && price > 0;
    });

    console.log(`${symbol} trading activity:
      Total candles: ${candles.length}
      Active candles: ${activeCandles.length}
      Required active candles: ${adjustments.minActiveCandles}
      Period: ${new Date().toUTCString()}`);

    if (activeCandles.length < adjustments.minActiveCandles) {
      console.log(`${symbol} insufficient active trading candles`);
      return [];
    }

    // Use recent active candles directly instead of sliding window
    const recentActiveCandles = activeCandles.slice(-10); // Get last 10 active candles
    
    console.log(`${symbol} recent trading activity:
      Active candles being used: ${recentActiveCandles.length}
      First candle time: ${new Date(recentActiveCandles[0][0] * 1000).toLocaleTimeString()}
      Last candle time: ${new Date(recentActiveCandles[recentActiveCandles.length - 1][0] * 1000).toLocaleTimeString()}
      Prices: ${recentActiveCandles.map(c => parseFloat(c[4]).toFixed(4)).join(', ')}`);

    // Check price movement
    const prices = recentActiveCandles.map(candle => parseFloat(candle[4]));
    const priceChanges = prices.slice(1).map((price, i) => 
      ((price - prices[i]) / prices[i]) * 100
    );

    const totalChange = Math.abs(
      ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100
    );

    console.log(`${symbol} price analysis:
      Total price change: ${totalChange.toFixed(4)}%
      Individual changes: ${priceChanges.map(c => c.toFixed(4) + '%').join(', ')}
      Required movement: ${adjustments.minMovement}%`);

    // During low activity, accept any price movement
    if (adjustments.minTrades <= 1) {
      console.log(`${symbol} accepting all price movements during extremely low activity`);
      
      // Ensure we have enough price variation for RSI
      const priceSet = new Set(prices);
      if (priceSet.size === 1) {
        console.log(`${symbol} all prices are identical (${prices[0]}), cannot calculate meaningful RSI`);
        return [];
      }

      // Calculate basic statistics for logging
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const std = Math.sqrt(prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length);
      
      console.log(`${symbol} price statistics:
        Mean: ${mean.toFixed(8)}
        Std Dev: ${std.toFixed(8)}
        Unique prices: ${priceSet.size}
        Price range: ${Math.min(...prices)} - ${Math.max(...prices)}`);
    } else if (totalChange < adjustments.minMovement) {
      console.log(`${symbol} insufficient price movement`);
      return [];
    }

    // Return normalized data for RSI calculation
    return recentActiveCandles.map(candle => ({
      timestamp: parseInt(candle[0]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[6])
    }));

  } catch (error) {
    console.error(`Error fetching OHLC for ${symbol}:`, error);
    return [];
  }
}

// Update calculateRSI to handle low activity better
function calculateRSI(closingPrices, adjustments) {
  const period = adjustments.rsiPeriod;
  
  if (closingPrices.length < period + 1) {
    console.log(`Not enough prices for RSI calculation. Need ${period + 1}, got ${closingPrices.length}`);
    return [];
  }

  // Add small random variation to identical prices during low activity
  if (adjustments.minTrades <= 1) {
    const priceSet = new Set(closingPrices);
    if (priceSet.size < 3) {
      const modifiedPrices = closingPrices.map(price => {
        const variation = price * 0.0001 * (Math.random() - 0.5); // ±0.005% variation
        return price + variation;
      });
      console.log('Added small variations to prices for RSI calculation');
      closingPrices = modifiedPrices;
    }
  }

  const input = {
    values: closingPrices,
    period: period
  };

  try {
    const rsi = new RSI(input);
    const result = rsi.getResult();
    
    // Log RSI calculation details
    console.log(`RSI calculation:
      Period used: ${period}
      Prices used: ${closingPrices.slice(-5).map(p => p.toFixed(8)).join(', ')}
      RSI values: ${result.slice(-5).map(v => v.toFixed(2)).join(', ')}`);
    
    // During extremely low activity, accept all RSI values except undefined
    if (adjustments.minTrades <= 1) {
      if (result[result.length - 1] === undefined) {
        console.log('RSI calculation produced undefined value');
        return [];
      }
      return result;
    }
    
    // Normal RSI validation
    const lastRSI = result[result.length - 1];
    if (lastRSI === undefined || lastRSI === 100 || lastRSI === 0) {
      console.log(`Warning: Invalid RSI value detected: ${lastRSI}`);
      return [];
    }

    return result;
  } catch (error) {
    console.error('Error calculating RSI:', error);
    return [];
  }
}

// Update executeTrade to use USD
async function executeTrade(symbol, side, price, useMargin = false) {
  try {
    // Add price validation
    if (isNaN(price) || price <= 0) {
      console.error(`Invalid price for ${symbol}: ${price}`);
      return null;
    }
    
    let volume = (TRADE_AMOUNT_USD / price).toFixed(6);
    const minSize = getMinOrderSize(symbol);
    
    // Validate inputs
    if (!symbol || !side || !price) {
      console.error('Missing required parameters for trade execution');
      return null;
    }

    if (price <= 0) {
      console.error('Invalid price for trade execution');
      return null;
    }

    // Check if order size meets minimum requirements
    if (parseFloat(volume) < minSize) {
      console.log(`${symbol}: Order size ${volume} below minimum ${minSize}. Adjusting order size.`);
      const adjustedAmount = (minSize * price * 1.1).toFixed(2); // Add 10% buffer
      console.log(`Minimum order value for ${symbol}: $${adjustedAmount}`);
      
      // Skip if minimum order is too large
      if (adjustedAmount > MAX_TRADE_AMOUNT_USD) { // Maximum we're willing to trade
        console.log(`${symbol}: Minimum order value $${adjustedAmount} exceeds maximum allowed. Skipping.`);
        return null;
      }
      
      // Use adjusted volume
      volume = minSize.toFixed(6);
    }

    // Base order parameters
    const orderParams = {
      pair: symbol,
      type: side.toLowerCase(),
      ordertype: 'market',
      volume: volume,
    };

    // Add margin parameters if margin trading is enabled
    if (useMargin) {
      orderParams.leverage = LEVERAGE.toString();
      orderParams.trading_agreement = 'agree';
    }

    // Log the actual order we're about to place
    console.log(`Placing order for ${symbol}:`, {
      side,
      volume,
      estimatedValue: `$${(volume * price).toFixed(2)}`,
      useMargin
    });

    const order = await kraken.api('AddOrder', orderParams);

    const logMessage = `${new Date().toISOString()} - ${symbol} ${side} ${volume} @ ${price}${useMargin ? ` (${LEVERAGE}x leverage)` : ''}\n`;
    console.log(logMessage);
    logStream.write(logMessage);

    if (side === 'BUY') {
      const stopPrice = price * (1 - STOP_LOSS_PERCENT / 100);
      const takeProfitPrice = price * (1 + TAKE_PROFIT_PERCENT / 100);
      
      openPositions.set(symbol, {
        volume,
        entryPrice: price,
        stopPrice,
        takeProfitPrice,
        leverage: useMargin ? LEVERAGE : 1,
        side: 'long',
        isMargin: useMargin
      });

      monitorPosition(symbol, volume, stopPrice, takeProfitPrice);
    } else if (side === 'SELL' && useMargin) { // Only allow short positions with margin
      const stopPrice = price * (1 + STOP_LOSS_PERCENT / 100);
      const takeProfitPrice = price * (1 - TAKE_PROFIT_PERCENT / 100);
      
      openPositions.set(symbol, {
        volume,
        entryPrice: price,
        stopPrice,
        takeProfitPrice,
        leverage: LEVERAGE,
        side: 'short',
        isMargin: true
      });

      monitorPosition(symbol, volume, stopPrice, takeProfitPrice);
    }

    return order;
  } catch (error) {
    console.error(`Trade error for ${symbol}:`, error);
    if (error.message.includes('Order minimum not met')) {
      console.log(`${symbol}: Order minimum not met. Consider increasing TRADE_AMOUNT_USD or skipping this pair.`);
    } else if (useMargin && error.message.includes('Margin trading in asset is restricted')) {
      console.log(`Falling back to spot trading for ${symbol}`);
      return executeTrade(symbol, side, price, false);
    }
    return null;
  }
}

// Updated position monitoring to handle both stop loss and take profit
async function monitorPosition(symbol, volume, stopPrice, takeProfitPrice) {
  const position = openPositions.get(symbol);
  if (!position) {
    console.log(`No position found for ${symbol}, canceling monitor`);
    return;
  }

  const isLong = position.side === 'long';
  let monitoringActive = true;

  const checkPosition = setInterval(async () => {
    if (!monitoringActive || !openPositions.has(symbol)) {
      clearInterval(checkPosition);
      return;
    }

    try {
      const ticker = await kraken.api('Ticker', { pair: symbol });
      if (!ticker.result || !ticker.result[symbol]) {
        console.log(`No ticker data for ${symbol}, skipping check`);
        return;
      }

      const currentPrice = parseFloat(ticker.result[symbol].c[0]);
      console.log(`${symbol} Position Check - Current: ${currentPrice}, Stop: ${stopPrice}, Take Profit: ${takeProfitPrice}`);

      // Check stop loss
      if ((isLong && currentPrice <= stopPrice) || (!isLong && currentPrice >= stopPrice)) {
        monitoringActive = false;
        await closePosition(symbol, volume, currentPrice, 'STOP-LOSS');
        clearInterval(checkPosition);
        return;
      }

      // Check take profit
      if ((isLong && currentPrice >= takeProfitPrice) || (!isLong && currentPrice <= takeProfitPrice)) {
        monitoringActive = false;
        await closePosition(symbol, volume, currentPrice, 'TAKE-PROFIT');
        clearInterval(checkPosition);
        return;
      }
    } catch (error) {
      console.error(`Position monitoring error for ${symbol}:`, error);
    }
  }, POSITION_CHECK_INTERVAL);
  
  positionMonitors.add(checkPosition);
  
  // Remove from tracking when cleared
  const clearAndRemove = () => {
    clearInterval(checkPosition);
    positionMonitors.delete(checkPosition);
  };
}

// Update scalpPair to handle low activity RSI better
async function scalpPair(pair) {
  const { symbol, lastPrice, marginEnabled } = pair;
  const adjustments = getActivityAdjustments();
  const isLowActivity = adjustments.minTrades <= 2;

  console.log(`\nChecking ${symbol} at ${new Date().toLocaleTimeString()} (Margin: ${marginEnabled}, Activity: ${isLowActivity ? 'Low' : 'Normal'})`);

  if (openPositions.size >= MAX_POSITIONS) {
    console.log('Maximum positions reached, skipping new trades');
    return;
  }

  const marketData = await getMarketData(symbol);
  if (marketData.length < RSI_PERIOD + 1) {
    console.log(`Insufficient data for ${symbol}, skipping`);
    return;
  }

  // Sort data by timestamp to ensure correct order
  marketData.sort((a, b) => a.timestamp - b.timestamp);
  const closingPrices = marketData.map(data => data.close);

  const rsiValues = calculateRSI(closingPrices, adjustments);
  if (rsiValues.length === 0) {
    console.log(`Unable to calculate RSI for ${symbol}, skipping`);
    return;
  }

  const lastRSI = rsiValues[rsiValues.length - 1];
  const prevRSI = rsiValues[rsiValues.length - 2];

  console.log(`${symbol} RSI: ${lastRSI?.toFixed(2)} (prev: ${prevRSI?.toFixed(2)}) - Price: ${lastPrice}`);
  console.log(`Last ${Math.min(5, marketData.length)} prices:`, 
    marketData.slice(-5).map(d => `${new Date(d.timestamp * 1000).toLocaleTimeString()}: ${d.close}`));

  // More lenient RSI validation during low activity
  if (lastRSI === undefined) {
    console.log(`Skipping ${symbol} due to undefined RSI value`);
    return;
  }

  if (!isLowActivity && (lastRSI === 100 || lastRSI === 0)) {
    console.log(`Skipping ${symbol} due to extreme RSI value`);
    return;
  }

  // Check if we have an open position
  const position = openPositions.get(symbol);

  // More conservative trading during low activity
  if (position) {
    // Exit positions more quickly during low activity
    if (position.side === 'long') {
      if (lastRSI > RSI_EXTREME_OVERBOUGHT || (isLowActivity && lastRSI > RSI_OVERBOUGHT)) {
        console.log(`${symbol} RSI > ${isLowActivity ? RSI_OVERBOUGHT : RSI_EXTREME_OVERBOUGHT}: Closing long position (${isLowActivity ? 'low activity' : 'normal'} exit)`);
        await closePosition(symbol, position.volume, lastPrice, 'RSI-EXIT');
      }
    }
  } else {
    // Only take very strong signals during low activity
    if (lastRSI < RSI_OVERSOLD_EXTREME && (!isLowActivity || lastRSI > prevRSI)) {
      console.log(`${symbol} RSI < ${RSI_OVERSOLD_EXTREME}: STRONG LONG signal`);
      await executeTrade(symbol, 'BUY', lastPrice, marginEnabled);
    } else if (!isLowActivity && lastRSI < RSI_OVERSOLD && lastRSI > prevRSI) {
      console.log(`${symbol} RSI < ${RSI_OVERSOLD} and rising: LONG signal (normal activity)`);
      await executeTrade(symbol, 'BUY', lastPrice, marginEnabled);
    } else if (marginEnabled && !isLowActivity && lastRSI > RSI_OVERBOUGHT) {
      console.log(`${symbol} RSI > ${RSI_OVERBOUGHT}: SHORT signal (normal activity only)`);
      await executeTrade(symbol, 'SELL', lastPrice, true);
    }
  }
}

// Update closePosition with better error handling
async function closePosition(symbol, volume, price, reason) {
  try {
    const position = openPositions.get(symbol);
    if (!position) {
      console.error(`No position found for ${symbol}`);
      return;
    }

    if (isNaN(volume) || volume <= 0) {
      console.error(`Invalid volume for ${symbol}: ${volume}`);
      return;
    }

    const closeType = position.side === 'long' ? 'sell' : 'buy';

    const orderParams = {
      pair: symbol,
      type: closeType,
      ordertype: 'market',
      volume: volume,
    };

    // Only add leverage parameters if it's a margin position
    if (position.isMargin) {
      orderParams.leverage = position.leverage.toString();
      orderParams.trading_agreement = 'agree';
    }

    await kraken.api('AddOrder', orderParams);

    const logMessage = `${new Date().toISOString()} - ${symbol} ${reason} ${closeType.toUpperCase()} ${volume} @ ${price}\n`;
    console.log(logMessage);
    logStream.write(logMessage);
    openPositions.delete(symbol);
  } catch (error) {
    console.error(`Error closing position for ${symbol}:`, error);
  }
}

// Main bot loop
async function runBot() {
  const candidatePairs = await getValidUSDPairs();
  if (candidatePairs.length === 0) {
    console.log('No valid USD pairs found. Check API keys or network.');
    return;
  }

  const volatilePairs = await selectVolatilePairs(candidatePairs);
  if (volatilePairs.length === 0) {
    console.log('No suitable pairs found. Retrying in 5 minutes...');
    return;
  }

  for (const pair of volatilePairs) {
    await scalpPair(pair);
  }
}

// Run every minute, refresh pairs every 5 minutes
setInterval(runBot, 60000);
setInterval(async () => {
  const candidatePairs = await getValidUSDPairs();
  selectVolatilePairs(candidatePairs);
}, 300000);

// Start immediately
runBot();

// Update cleanup function
function cleanup() {
  console.log('Cleaning up and closing positions...');
  // Clear all position monitors
  positionMonitors.forEach(interval => clearInterval(interval));
  positionMonitors.clear();
  logStream.end();
  process.exit();
}

// Add signal handlers
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Add error logging to file
process.on('uncaughtException', (error) => {
  const errorMessage = `${new Date().toISOString()} - Uncaught Exception: ${error.message}\n${error.stack}\n`;
  fs.appendFileSync('error_log.txt', errorMessage);
  console.error(errorMessage);
  cleanup();
});

// Update selectVolatilePairs to use time-based adjustments
async function selectVolatilePairs(candidatePairs) {
  try {
    const adjustments = getActivityAdjustments();
    console.log(`Market period adjustments:
      Volatility threshold: ${adjustments.volatilityThreshold}%
      Volume threshold: ${adjustments.volumeThreshold} USD
      Minimum trades: ${adjustments.minTrades}
      Time: ${new Date().toUTCString()}`);

    const pairSymbols = candidatePairs.map(pair => pair.symbol);
    console.log('Checking pairs:', pairSymbols);
    
    const tickerData = await kraken.api('Ticker', { pair: pairSymbols.join(',') });
    
    if (!tickerData.result || Object.keys(tickerData.result).length === 0) {
      console.log('No ticker data received from Kraken');
      return [];
    }

    const pairStats = Object.entries(tickerData.result)
      .map(([pair, data]) => {
        // Add null checks for data
        if (!data.c || !data.c[0] || !data.o || !data.v || !data.v[1] || !data.t || !data.t[1]) {
          console.log(`Invalid data for ${pair}:`, data);
          return null;
        }

        const currentPrice = parseFloat(data.c[0]);
        const openPrice = parseFloat(data.o);
        const volume = parseFloat(data.v[1]) * currentPrice;
        const trades = parseInt(data.t[1]); // Number of trades in last 24h

        const priceChangePercent = ((currentPrice - openPrice) / openPrice) * 100;
        
        // Find the original pair object to get marginEnabled status
        const originalPair = candidatePairs.find(p => p.symbol === pair);
        
        // Enhanced logging
        console.log(`${pair}:
          Current Price: ${currentPrice}
          Open Price: ${openPrice}
          24h Volume: ${volume.toFixed(2)} USD
          24h Trades: ${trades}
          Volatility: ${priceChangePercent.toFixed(2)}%
          Margin Enabled: ${originalPair?.marginEnabled}`);
        
        return { 
          pair,
          priceChangePercent,
          volume,
          trades,
          lastPrice: currentPrice,
          marginEnabled: originalPair?.marginEnabled || false
        };
      })
      .filter(stat => {
        if (!stat) return false;
        
        // Adjusted trading activity check
        if (stat.trades < adjustments.minTrades) {
          console.log(`${stat.pair} low trading activity (${stat.trades} trades/24h). Minimum: ${adjustments.minTrades} (adjusted for period)`);
          return false;
        }
        
        return true;
      });

    // Apply adjusted filters
    const filteredPairs = pairStats
      .filter(stat => {
        const meetsVolatility = Math.abs(stat.priceChangePercent) >= adjustments.volatilityThreshold;
        const meetsVolume = stat.volume >= adjustments.volumeThreshold;
        const minSize = getMinOrderSize(stat.pair);
        const minOrderValue = minSize * stat.lastPrice;
        const meetsMinOrder = TRADE_AMOUNT_USD >= minOrderValue;
        
        if (!meetsVolatility || !meetsVolume || !meetsMinOrder) {
          console.log(`${stat.pair} filtered out:
            Volatility: ${meetsVolatility ? 'Pass' : 'Fail'} (${stat.priceChangePercent.toFixed(2)}%)
            Volume: ${meetsVolume ? 'Pass' : 'Fail'} (${stat.volume.toFixed(2)} USD)
            Min Order: ${meetsMinOrder ? 'Pass' : 'Fail'} (Min: $${minOrderValue.toFixed(2)})`);
        }
        
        return meetsVolatility && meetsVolume && meetsMinOrder;
      })
      .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)) // Sort by absolute volatility
      .slice(0, MAX_PAIRS)
      .map(stat => ({
        symbol: stat.pair,
        volatility: stat.priceChangePercent,
        lastPrice: stat.lastPrice,
        marginEnabled: stat.marginEnabled
      }));

    if (filteredPairs.length === 0) {
      console.log('\nNo pairs met the criteria:',
        `\nVolatility threshold: ${adjustments.volatilityThreshold}%`,
        `\nVolume threshold: ${adjustments.volumeThreshold} USD`,
        `\nMinimum trades: ${adjustments.minTrades} per 24h`);
    } else {
      console.log('\nSelected pairs:', 
        filteredPairs.map(p => `${p.symbol} (${p.volatility.toFixed(2)}%, Margin: ${p.marginEnabled})`));
    }

    return filteredPairs;

  } catch (error) {
    console.error('Error fetching ticker data:', error);
    return [];
  }
}

// Add environment variable validation
function validateEnv() {
  const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Please check your .env file');
    process.exit(1);
  }
}

// Call validation before starting the bot
validateEnv();
