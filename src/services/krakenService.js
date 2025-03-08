const KrakenClient = require('kraken-api');
const logger = require('./loggerService');
const { MIN_ORDER_SIZES, LEVERAGE, STOP_LOSS_PERCENT, TAKE_PROFIT_PERCENT, LEVERAGED_STOP_LOSS_PERCENT, LEVERAGED_TAKE_PROFIT_PERCENT } = require('../config/constants');
const performanceTracker = require('../utils/performanceTracker');
const riskManager = require('../utils/riskManager');
const currencyManager = require('../utils/currencyManager');

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

class KrakenService {
  constructor() {
    this.kraken = new KrakenClient(
      process.env.KRAKEN_API_KEY,
      process.env.KRAKEN_API_SECRET
    );
    this.positions = new Map();
    this.minOrderSizes = new Map();
    this.marginPairs = new Set();
  }

  async initialize() {
    try {
      // Test connection first
      const connectionOk = await this.testConnection();
      if (!connectionOk) {
        logger.logError('Failed to connect to Kraken API');
        return false;
      }
      
      // Check if margin trading is enabled for this account
      if (require('../config/constants').USE_MARGIN) {
        const marginEnabled = await this.verifyMarginTrading();
        
        if (!marginEnabled) {
          logger.logWarning(`
            Margin trading is not available or not properly configured.
            The bot will continue with spot trading only.
          `);
          
          // Disable margin trading
          require('../config/constants').USE_MARGIN = false;
        } else {
          logger.logSuccess(`
            Margin trading is properly configured and available.
            Using leverage: ${require('../config/constants').getValidLeverage()}x
          `);
        }
      } else {
        logger.logInfo('Margin trading is disabled in configuration. Using spot trading only.');
      }
      
      // Get asset info for minimum order sizes
      const assetInfo = await this.kraken.api('Assets');
      Object.entries(assetInfo.result).forEach(([symbol, info]) => {
        if (info.altname && info.ordermin) {
          this.minOrderSizes.set(info.altname, parseFloat(info.ordermin));
        }
      });
      
      // Get margin-eligible pairs
      try {
        this.marginPairs = await this.getMarginTradingPairs();
        logger.logInfo(`Found ${this.marginPairs.size} margin-eligible pairs`);
      } catch (error) {
        logger.logError('Error getting margin pairs:', error);
        this.marginPairs = new Set();
      }
      
      logger.logSuccess('Initialized Kraken service with asset information');
      return true;
    } catch (error) {
      logger.logError('Failed to initialize Kraken service', error);
      return false;
    }
  }

  async testConnection() {
    try {
      const result = await this.apiWithRetry('Time');
      logger.logTrade('Kraken API connection successful');
      
      // Test balance access
      try {
        await this.apiWithRetry('Balance');
        logger.logTrade('Balance API access confirmed');
      } catch (balanceError) {
        logger.logError('Cannot access balance API. Check API key permissions', balanceError);
      }
      
      return true;
    } catch (error) {
      logger.logError('Kraken API connection failed', error);
      if (error.message.includes('Invalid key')) {
        logger.logError('API key validation failed. Please check your .env file and API key permissions');
      }
      return false;
    }
  }

  async getMarketData(symbol, interval = 1, lookback = 60) {
    try {
      const response = await this.apiWithRetry('OHLC', {
        pair: symbol,
        interval: interval,
        since: Math.floor(Date.now() / 1000) - (lookback * 60)
      });

      const pair = Object.keys(response.result).find(key => key !== 'last');
      if (!pair || !response.result[pair]) {
        logger.logTrade(`No data returned for ${symbol}`);
        return [];
      }

      const candles = response.result[pair].map(candle => ({
        symbol,
        time: new Date(candle[0] * 1000),
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[6]),
        trades: parseInt(candle[7])
      }));

      return candles;
    } catch (error) {
      logger.logError(`Error fetching market data for ${symbol}:`, error);
      return [];
    }
  }

  async getActivePairs(currency = 'GBP') {
    try {
      const response = await this.apiWithRetry('Ticker');
      const pairs = [];
      
      for (const [symbol, data] of Object.entries(response.result)) {
        // Filter for pairs with the specified currency
        if (symbol.endsWith(currency)) {
          const lastPrice = parseFloat(data.c[0]);
          const volume = parseFloat(data.v[1]);
          const low = parseFloat(data.l[1]);
          const high = parseFloat(data.h[1]);
          const change24h = ((lastPrice - parseFloat(data.o)) / parseFloat(data.o)) * 100;
          
          pairs.push({
            symbol,
            lastPrice,
            volume,
            low,
            high,
            change24h
          });
        }
      }
      
      // Sort by 24h volume (descending)
      pairs.sort((a, b) => b.volume - a.volume);
      
      logger.logTrade(`Found ${pairs.length} active ${currency} pairs`);
      return pairs;
    } catch (error) {
      logger.logError('Error getting active pairs:', error);
      return [];
    }
  }

  async executeTrade(symbol, side, price, marginEnabled = false, volatility = 1.0, reducePositionSize = false) {
    try {
      // Get account balance and margin info
      let balance = 0;
      let totalEquity = 0;
      let marginLevel = 0;
      
      // Determine the currency from the symbol
      const currency = symbol.endsWith('GBP') ? 'GBP' : 'USD';
      
      // Get the leverage value with proper error checking
      const leverage = require('../config/constants').getValidLeverage();
      
      // Log the trade intent with margin details
      logger.logInfo(`Preparing to execute ${side} trade for ${symbol}`, {
        price: price.toFixed(8),
        usingMargin: marginEnabled ? 'YES' : 'NO',
        leverage: marginEnabled ? leverage : 'N/A',
        currency: currency
      });
      
      if (marginEnabled) {
        // For margin trading, check total equity
        const marginInfo = await this.apiWithRetry('TradeBalance');
        
        if (!marginInfo || !marginInfo.result) {
          logger.logError('Could not get margin info for trade');
          return false;
        }
        
        totalEquity = parseFloat(marginInfo.result.e || 0);
        marginLevel = parseFloat(marginInfo.result.ml || 0);
        balance = totalEquity; // Use total equity as available balance for margin
        
        logger.logInfo(`Margin Trading Info`, {
          totalEquity: `${totalEquity.toFixed(2)} ${currency}`,
          marginLevel: `${marginLevel.toFixed(2)}%`,
          leverage: leverage
        });
        
        // Check if margin level is too low (below 200% is risky)
        if (marginLevel < 200) {
          logger.logWarning(`Low margin level (${marginLevel.toFixed(2)}%). Reducing position size.`);
          volatility = volatility * 0.5; // Reduce position size
        }
        
        // Verify that we can use margin for this pair
        const canUseMargin = await this.canUseMarginForPair(symbol);
        if (!canUseMargin) {
          logger.logWarning(`Cannot use margin for ${symbol}. Falling back to spot trading.`);
          marginEnabled = false;
        }
      } else {
        // For spot trading, check balance in the appropriate currency
        const balanceInfo = await this.apiWithRetry('Balance');
        if (currency === 'GBP') {
          balance = parseFloat(balanceInfo.result.ZGBP || 0);
        } else {
          balance = parseFloat(balanceInfo.result.ZUSD || 0);
        }
        
        logger.logInfo(`Spot Trading Info`, {
          balance: `${balance.toFixed(2)} ${currency}`
        });
      }
      
      // Check if we have enough balance
      if (balance < 1) {
        logger.logWarning(`Very low balance (${balance.toFixed(2)} ${currency}). Consider depositing more funds.`);
      }
      
      // Calculate trade amount based on currency
      const baseTradeAmount = currency === 'GBP' 
        ? require('../config/constants').TRADE_AMOUNT_USD 
        : require('../config/constants').TRADE_AMOUNT_USD_USD;
      
      // Apply reduction for off-hours if needed
      const tradeAmount = reducePositionSize 
        ? baseTradeAmount * 0.5 // 50% reduction during off-hours
        : Math.min(baseTradeAmount, balance * 0.1);
      
      // Calculate volume based on price
      const volume = tradeAmount / price;
      
      // Format volume to 8 decimal places
      const volumeFormatted = volume.toFixed(8);
      
      logger.logInfo(`Executing ${side} trade for ${symbol}`, {
        price: price.toFixed(8),
        volume: volumeFormatted,
        value: `${(volume * price).toFixed(2)} ${currency}`,
        margin: marginEnabled ? `YES (${leverage}x)` : 'NO',
        reduced: reducePositionSize ? 'YES (off-hours)' : 'NO'
      });
      
      // Create order parameters
      const orderParams = {
        pair: symbol,
        type: side,
        ordertype: 'market',
        volume: volumeFormatted
      };
      
      if (marginEnabled) {
        orderParams.leverage = leverage.toString();
        orderParams.margin = 'true'; // Explicitly set margin to true
        
        logger.logInfo(`Adding margin parameters to order`, {
          leverage: leverage.toString(),
          margin: 'true'
        });
      }
      
      // Execute the order
      logger.logInfo(`Sending ${marginEnabled ? 'margin' : 'spot'} order to Kraken API`, orderParams);
      
      const result = await this.kraken.api('AddOrder', orderParams);
      
      if (result && result.result) {
        const txid = result.result.txid[0];
        
        logger.logSuccess(`Order executed successfully`, {
          symbol,
          side,
          txid,
          volume: volumeFormatted,
          margin: marginEnabled ? 'YES' : 'NO',
          leverage: marginEnabled ? leverage : 'N/A'
        });
        
        // Track the position
        this.positions.set(symbol, {
          symbol,
          side,
          entryPrice: price,
          volume: parseFloat(volumeFormatted),
          timestamp: new Date().toISOString(),
          leveraged: marginEnabled,
          leverage: marginEnabled ? leverage : 1,
          currency: currency
        });
        
        return true;
      } else {
        logger.logError(`Failed to execute ${side} order for ${symbol}`, result);
        return false;
      }
    } catch (error) {
      logger.logError(`Error executing ${side} trade for ${symbol}:`, error);
      
      // Check for specific margin-related errors
      if (error.message) {
        if (error.message.includes('Insufficient funds')) {
          logger.logError(`Insufficient funds for margin trade. Available balance: ${balance}`);
        } else if (error.message.includes('Invalid leverage')) {
          logger.logError(`Invalid leverage setting: ${leverage}. Check your configuration.`);
        } else if (error.message.includes('Permission denied')) {
          logger.logError(`Margin trading permission denied. Please enable it in your Kraken account.`);
        }
      }
      
      return false;
    }
  }

  // Add this helper method to format order volumes correctly
  formatOrderVolume(asset, volume) {
    // Different assets require different precision
    const precisionMap = {
      'BTC': 8,
      'ETH': 8,
      'XRP': 2,
      'ADA': 2,
      'DOT': 4,
      'SOL': 4,
      'VINE': 0, // Integer precision for VINE
      'BSX': 0,  // Integer precision for BSX
      'REN': 0,  // Integer precision for REN
      'default': 8
    };
    
    // For very large volumes (like BSX), use integer precision
    if (volume > 1000) {
      return Math.ceil(volume).toString(); // Round up to ensure we meet minimums
    }
    
    // For normal assets, use the precision map
    const precision = precisionMap[asset] || precisionMap.default;
    return volume.toFixed(precision);
  }

  getOpenPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  async closePosition(symbol, volume, currentPrice, reason = 'MANUAL') {
    try {
      const position = this.positions.get(symbol);
      if (!position) {
        logger.logTrade(`No open position found for ${symbol}`);
        return false;
      }
      
      // Determine the currency from the symbol
      const currency = symbol.endsWith('GBP') ? 'GBP' : 'USD';
      
      // Determine the close side (opposite of position side)
      const closeSide = position.side === 'long' ? 'sell' : 'buy';
      
      // Calculate profit/loss
      const pnlPercent = position.side === 'long'
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
      
      // Ensure pnlPercent is a valid number
      const validPnlPercent = isNaN(pnlPercent) ? 0 : pnlPercent;
      
      // Calculate profit in the appropriate currency
      const profitAmount = (position.volume * currentPrice) * (validPnlPercent / 100);
      
      logger.logTrade(`
        Closing ${position.side} position for ${symbol}:
        Reason: ${reason}
        Entry: ${position.entryPrice}
        Exit: ${currentPrice}
        Volume: ${position.volume}
        P/L: ${validPnlPercent.toFixed(2)}% (${profitAmount.toFixed(2)} ${currency})
        Leveraged: ${position.leveraged ? `YES (${position.leverage}x)` : 'NO'}
      `);
      
      // Execute the close order
      const orderParams = {
        pair: symbol,
        type: closeSide,
        ordertype: 'market',
        volume: position.volume.toString()
      };
      
      if (position.leveraged) {
        orderParams.leverage = position.leverage.toString();
      }
      
      try {
        const result = await this.kraken.api('AddOrder', orderParams);
        logger.logTrade(`Position closed: ${JSON.stringify(result)}`);
        
        // Record the trade in performance tracker
        performanceTracker.recordTrade({
          symbol,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          volume: position.volume,
          profit: profitAmount,
          leveraged: position.leveraged,
          leverage: position.leverage,
          currency,
          reason
        });
        
        // Update risk manager
        riskManager.updateDailyPnL(profitAmount);
        
        // Remove the position from tracking
        this.positions.delete(symbol);
        
        return true;
      } catch (orderError) {
        logger.logError(`Error closing position for ${symbol}:`, orderError);
        return false;
      }
    } catch (error) {
      logger.logError(`Error in closePosition for ${symbol}:`, error);
      return false;
    }
  }

  async closeAllPositions() {
    const symbols = Array.from(this.positions.keys());
    for (const symbol of symbols) {
      const position = this.positions.get(symbol);
      if (position) {
        await this.closePosition(
          symbol, 
          position.volume, 
          position.entryPrice, // Use last known price as estimate
          'FORCED_EXIT'
        );
      }
    }
  }

  async filterPairs(pairs) {
    const filtered = [];
    const rejected = [];
    
    for (const pair of pairs) {
      // Get the actual minimum order size from Kraken
      const minOrderSize = await this.getMinimumOrderSize(pair.symbol);
      
      if (minOrderSize !== null) {
        // Calculate the minimum order value in GBP
        const minOrderValue = minOrderSize * pair.lastPrice;
        
        // Get current balance
        let balance = 0;
        try {
          const balanceInfo = await this.apiWithRetry('Balance');
          balance = parseFloat(balanceInfo.result.ZGBP || 0);
        } catch (error) {
          logger.logError('Error getting balance:', error);
        }
        
        // Check if we have enough funds for the minimum order
        if (minOrderValue > balance * 0.95) {
          rejected.push({
            symbol: pair.symbol,
            reason: {
              minOrder: 'Fail',
              minOrderValue: minOrderValue,
              balance: balance
            }
          });
          continue;
        }
      }
      
      // Rest of the filtering logic remains the same...
    }
    
    // Log rejected pairs
    for (const pair of rejected) {
      logger.logTrade(`${pair.symbol} filtered out: Minimum order (${pair.reason.minOrderValue.toFixed(2)} GBP) exceeds available balance (${pair.reason.balance.toFixed(2)} GBP)`);
    }
    
    return filtered;
  }

  getMinOrderSize(symbol) {
    return MIN_ORDER_SIZES[symbol] || MIN_ORDER_SIZES.default;
  }

  async getMarginTradingPairs() {
    try {
      const marginPairs = new Set();
      
      // Get asset pairs info
      const pairsInfo = await this.apiWithRetry('AssetPairs');
      
      if (!pairsInfo || !pairsInfo.result) {
        logger.logWarning('Could not get asset pairs info');
        return marginPairs;
      }
      
      // Iterate through all pairs
      for (const [pairName, pairData] of Object.entries(pairsInfo.result)) {
        // Check if margin trading is enabled for this pair
        if (pairData.leverage_buy && pairData.leverage_buy.length > 0) {
          marginPairs.add(pairName);
          
          // Also add the alternate name if available
          if (pairData.wsname) {
            const altName = pairData.wsname.replace('/', '');
            marginPairs.add(altName);
          }
          
          // Add the alternate name from the 'altname' field
          if (pairData.altname) {
            marginPairs.add(pairData.altname);
          }
        }
      }
      
      // Get the current currency
      const currency = currencyManager.getCurrentCurrency();
      
      // Count pairs with the current currency
      let currencyPairsCount = 0;
      for (const pair of marginPairs) {
        if (pair.endsWith(currency)) {
          currencyPairsCount++;
        }
      }
      
      logger.logInfo(`Found ${marginPairs.size} margin-eligible pairs (${currencyPairsCount} in ${currency})`);
      return marginPairs;
    } catch (error) {
      logger.logError('Error getting margin trading pairs:', error);
      return new Set();
    }
  }

  async apiWithRetry(method, params = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.logTrade(`API call ${method} (attempt ${attempt}/${MAX_RETRIES})`);
        const result = await this.kraken.api(method, params);
        return result;
      } catch (error) {
        lastError = error;
        logger.logError(`API call failed (attempt ${attempt}/${MAX_RETRIES}):`, error);
        
        // Don't retry if it's an authentication or parameter error
        if (error.message.includes('Invalid key') || 
            error.message.includes('Invalid nonce') ||
            error.message.includes('Invalid arguments')) {
          break;
        }
        
        // Wait before retrying
        if (attempt < MAX_RETRIES) {
          logger.logTrade(`Retrying in ${RETRY_DELAY/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }
    }
    throw lastError;
  }

  async checkPositions() {
    const positions = Array.from(this.positions.entries());
    
    for (const [symbol, position] of positions) {
      try {
        // Get current price
        const ticker = await this.apiWithRetry('Ticker', { pair: symbol });
        const pair = Object.keys(ticker.result)[0];
        const currentPrice = parseFloat(ticker.result[pair].c[0]);
        
        // Calculate profit/loss
        const pnlPercent = position.side === 'long'
          ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
        
        // Import constants directly to ensure they're available
        const { STOP_LOSS_PERCENT, TAKE_PROFIT_PERCENT, LEVERAGED_STOP_LOSS_PERCENT, LEVERAGED_TAKE_PROFIT_PERCENT } = require('../config/constants');
        
        // For leveraged positions, use tighter stop loss and take profit
        const baseStopLoss = position.leveraged ? LEVERAGED_STOP_LOSS_PERCENT : STOP_LOSS_PERCENT;
        const baseTakeProfit = position.leveraged ? LEVERAGED_TAKE_PROFIT_PERCENT : TAKE_PROFIT_PERCENT;
        
        // Ensure we have valid numbers with fallbacks
        const effectiveStopLoss = isNaN(baseStopLoss) ? 2 : baseStopLoss;
        const effectiveTakeProfit = isNaN(baseTakeProfit) ? 1 : baseTakeProfit;
        
        // Adjust for leverage factor
        const leverageFactor = position.leveraged ? position.leverage : 1;
        
        logger.logTrade(`
          Position check for ${symbol}:
          Side: ${position.side}
          Entry: ${position.entryPrice}
          Current: ${currentPrice}
          Leveraged: ${position.leveraged ? `YES (${position.leverage}x)` : 'NO'}
          P/L: ${pnlPercent.toFixed(2)}%
          Stop Loss: -${effectiveStopLoss.toFixed(2)}%
          Take Profit: ${effectiveTakeProfit.toFixed(2)}%
        `);
        
        // Check stop loss
        if (pnlPercent <= -effectiveStopLoss) {
          logger.logTrade(`Stop loss triggered for ${symbol} at ${pnlPercent.toFixed(2)}%`);
          await this.closePosition(symbol, position.volume, currentPrice, 'STOP_LOSS');
          continue;
        }
        
        // Check take profit
        if (pnlPercent >= effectiveTakeProfit) {
          logger.logTrade(`Take profit triggered for ${symbol} at ${pnlPercent.toFixed(2)}%`);
          await this.closePosition(symbol, position.volume, currentPrice, 'TAKE_PROFIT');
          continue;
        }
      } catch (error) {
        logger.logError(`Error checking position for ${symbol}:`, error);
      }
    }
  }

  async checkMarginStatus() {
    try {
      const marginInfo = await this.apiWithRetry('TradeBalance');
      
      if (!marginInfo || !marginInfo.result) {
        logger.logError('Could not get margin status');
        return null;
      }
      
      // Get the current currency from the currency manager
      const currency = currencyManager.getCurrentCurrency();
      
      const result = marginInfo.result;
      const equity = parseFloat(result.e || 0);
      const marginLevel = parseFloat(result.ml || 0);
      const freeMargin = parseFloat(result.mf || 0);
      const usedMargin = parseFloat(result.m || 0);
      
      // Calculate trading power with proper error checking
      const leverage = require('../config/constants').LEVERAGE || 1;
      const tradingPower = isNaN(equity) || isNaN(leverage) ? 0 : equity * leverage;
      
      logger.logInfo(`Margin Status`, {
        equity: `${equity.toFixed(2)} ${currency}`,
        marginLevel: `${marginLevel.toFixed(2)}%`,
        freeMargin: `${freeMargin.toFixed(2)} ${currency}`,
        usedMargin: `${usedMargin.toFixed(2)} ${currency}`,
        tradingPower: `${tradingPower.toFixed(2)} ${currency}`
      });
      
      return {
        equity,
        marginLevel,
        freeMargin,
        usedMargin,
        tradingPower,
        currency
      };
    } catch (error) {
      logger.logError('Error checking margin status:', error);
      return null;
    }
  }

  // Add this method to test volume formatting
  async testVolumeFormat(symbol, volume) {
    try {
      // Check if volume is valid
      if (isNaN(volume) || volume <= 0) {
        logger.logError(`Invalid volume for ${symbol}: ${volume}`);
        return null;
      }
      
      // Get the base asset
      const baseAsset = symbol.replace(/GBP|USD$/, '');
      
      // Try different volume formats
      const formats = [
        '0.01', // Fixed small volume
        '0.1',  // Fixed larger volume
        volume.toFixed(8),
        volume.toFixed(6),
        volume.toFixed(4),
        volume.toFixed(2),
        volume.toFixed(0),
        volume.toString(),
        Math.floor(volume * 100000000) / 100000000 + '',
        parseFloat(volume.toFixed(8)) + ''
      ];
      
      logger.logTrade(`Testing volume formats for ${symbol}:`);
      
      for (const format of formats) {
        logger.logTrade(`  - Format: ${format}`);
        
        try {
          // Create a validation-only order (validate=true)
          const orderParams = {
            pair: symbol,
            type: 'buy',
            ordertype: 'market',
            volume: format,
            validate: true
          };
          
          const result = await this.kraken.api('AddOrder', orderParams);
          logger.logTrade(`  ✓ Valid format: ${format}`);
          return format; // Return the first valid format
        } catch (error) {
          logger.logTrade(`  ✗ Invalid format: ${format} - ${error.message}`);
        }
      }
      
      logger.logError(`No valid volume format found for ${symbol}`);
      return null;
    } catch (error) {
      logger.logError(`Error testing volume formats:`, error);
      return null;
    }
  }

  // Add this method to get the actual minimum order size for a pair
  async getMinimumOrderSize(symbol) {
    try {
      const pairInfo = await this.apiWithRetry('AssetPairs', { pair: symbol });
      
      if (!pairInfo.result || !pairInfo.result[symbol]) {
        logger.logError(`Could not find pair info for ${symbol}`);
        return null;
      }
      
      const pairData = pairInfo.result[symbol];
      
      if (pairData.ordermin) {
        const minOrderSize = parseFloat(pairData.ordermin);
        logger.logTrade(`Minimum order size for ${symbol}: ${minOrderSize}`);
        return minOrderSize;
      } else {
        logger.logTrade(`No minimum order size found for ${symbol}, using default`);
        return null;
      }
    } catch (error) {
      logger.logError(`Error getting minimum order size for ${symbol}:`, error);
      return null;
    }
  }

  async findTradeablePairs(currency = 'GBP') {
    try {
      // Get current balance and margin info
      let balance = 0;
      let marginEnabled = false;
      let marginEquity = 0;
      
      // Check if margin trading is enabled
      if (require('../config/constants').USE_MARGIN) {
        try {
          const marginInfo = await this.apiWithRetry('TradeBalance');
          marginEquity = parseFloat(marginInfo.result.e || 0);
          
          if (marginEquity > 0) {
            balance = marginEquity;
            marginEnabled = true;
            logger.logTrade(`Using margin trading with ${marginEquity.toFixed(2)} ${currency} equity`);
          } else {
            logger.logTrade('No margin equity available, falling back to spot trading');
          }
        } catch (marginError) {
          logger.logError('Error checking margin status:', marginError);
        }
      }
      
      // If margin is not enabled or failed, check spot balance
      if (!marginEnabled) {
        try {
          const balanceInfo = await this.apiWithRetry('Balance');
          
          // Check balance in the specified currency
          const currencyKey = currency === 'GBP' ? 'ZGBP' : 'ZUSD';
          balance = parseFloat(balanceInfo.result[currencyKey] || 0);
          
          // If balance in specified currency is too low, check the other currency
          if (balance < 1) {
            const altCurrencyKey = currency === 'GBP' ? 'ZUSD' : 'ZGBP';
            const altBalance = parseFloat(balanceInfo.result[altCurrencyKey] || 0);
            
            // If we have a better balance in the other currency, use that instead
            if (altBalance > balance) {
              const altCurrency = currency === 'GBP' ? 'USD' : 'GBP';
              logger.logTrade(`Low ${currency} balance (${balance}), switching to ${altCurrency} (${altBalance})`);
              
              // Update the currency manager
              currencyManager.currentCurrency = altCurrency;
              currency = altCurrency;
              balance = altBalance;
            }
          }
        } catch (error) {
          logger.logError('Error getting balance:', error);
        }
      }
      
      // Get all pairs with the specified currency
      const allPairs = await this.getActivePairs(currency);
      
      // Filter pairs by minimum order size
      const tradeablePairs = [];
      
      for (const pair of allPairs) {
        // Check if this pair is margin-eligible
        const pairMarginEnabled = marginEnabled && await this.canUseMarginForPair(pair.symbol);
        
        // Get the actual minimum order size from Kraken
        const minOrderSize = await this.getMinimumOrderSize(pair.symbol);
        
        if (minOrderSize !== null) {
          // Calculate the minimum order value in the specified currency
          const minOrderValue = minOrderSize * pair.lastPrice;
          
          // For margin trading, we can trade with less actual balance
          const effectiveBalance = pairMarginEnabled ? balance * leverage : balance;
          
          // Check if we have enough funds for the minimum order
          if (minOrderValue <= effectiveBalance * 0.95) {
            tradeablePairs.push({
              ...pair,
              minOrderSize,
              minOrderValue,
              marginEnabled: pairMarginEnabled,
              currency
            });
          }
        }
      }
      
      // Sort by volatility (descending)
      tradeablePairs.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
      
      logger.logTrade(`
        Found ${tradeablePairs.length} tradeable pairs with your ${marginEnabled ? 'margin equity' : 'balance'} of ${balance.toFixed(2)} ${currency}:
        ${tradeablePairs.slice(0, 5).map(p => 
          `${p.symbol}: ${Math.abs(p.change24h).toFixed(2)}% vol, Min: ${p.minOrderValue.toFixed(2)} ${currency}${p.marginEnabled ? ' (MARGIN)' : ''}`
        ).join('\n      ')}
      `);
      
      return tradeablePairs;
    } catch (error) {
      logger.logError('Error finding tradeable pairs:', error);
      return [];
    }
  }

  async getMinimumDepositNeeded() {
    try {
      // Get all pairs
      const allPairs = await this.getActivePairs();
      
      // Get minimum order sizes for all pairs
      const minOrderValues = [];
      
      for (const pair of allPairs) {
        // Get the actual minimum order size from Kraken
        const minOrderSize = await this.getMinimumOrderSize(pair.symbol);
        
        if (minOrderSize !== null) {
          // Calculate the minimum order value in GBP
          const minOrderValue = minOrderSize * pair.lastPrice;
          
          minOrderValues.push({
            symbol: pair.symbol,
            minOrderSize,
            minOrderValue
          });
        }
      }
      
      // Sort by minimum order value (ascending)
      minOrderValues.sort((a, b) => a.minOrderValue - b.minOrderValue);
      
      // Get the 5 pairs with the lowest minimum order value
      const lowestMinOrderPairs = minOrderValues.slice(0, 5);
      
      logger.logTrade(`
        Pairs with lowest minimum order values:
        ${lowestMinOrderPairs.map(p => `${p.symbol}: ${p.minOrderValue.toFixed(2)} GBP`).join('\n      ')}
        
        Recommended minimum deposit: ${(lowestMinOrderPairs[0].minOrderValue * 1.5).toFixed(2)} GBP
      `);
      
      return lowestMinOrderPairs;
    } catch (error) {
      logger.logError('Error getting minimum deposit needed:', error);
      return [];
    }
  }

  async canUseMarginForPair(symbol) {
    try {
      // First check if margin trading is enabled globally
      const useMargin = require('../config/constants').USE_MARGIN;
      if (!useMargin) {
        logger.logInfo(`Margin trading disabled globally for ${symbol}`);
        return false;
      }
      
      // Check if this pair is in our margin pairs set
      if (this.marginPairs.has(symbol)) {
        logger.logInfo(`Margin trading available for ${symbol}`);
        return true;
      }
      
      // If we haven't loaded margin pairs yet, try to get them
      if (this.marginPairs.size === 0) {
        this.marginPairs = await this.getMarginTradingPairs();
      }
      
      // Check again after loading
      const canUseMargin = this.marginPairs.has(symbol);
      logger.logInfo(`Margin trading ${canUseMargin ? 'available' : 'not available'} for ${symbol}`);
      return canUseMargin;
    } catch (error) {
      logger.logError(`Error checking margin for ${symbol}:`, error);
      return false;
    }
  }

  /**
   * Verify that margin trading is properly configured and available
   * @returns {Promise<boolean>} True if margin trading is available
   */
  async verifyMarginTrading() {
    try {
      logger.logInfo('Verifying margin trading capability...');
      
      // Check if margin trading is enabled in constants
      const useMargin = require('../config/constants').USE_MARGIN;
      if (!useMargin) {
        logger.logWarning('Margin trading is disabled in configuration');
        return false;
      }
      
      // Check if we can get margin info
      const marginInfo = await this.apiWithRetry('TradeBalance');
      
      if (!marginInfo || !marginInfo.result) {
        logger.logError('Could not get margin status - API returned no result');
        return false;
      }
      
      // Get margin details
      const equity = parseFloat(marginInfo.result.e || 0);
      const marginLevel = parseFloat(marginInfo.result.ml || 0);
      const freeMargin = parseFloat(marginInfo.result.mf || 0);
      
      // Get the current currency
      const currency = currencyManager.getCurrentCurrency();
      
      // Get the leverage value with proper error checking
      const leverage = require('../config/constants').getValidLeverage();
      
      // Check if we have enough equity
      if (equity < 5) {
        logger.logWarning(`
          Low equity for margin trading: ${equity.toFixed(2)} ${currency}
          Recommended minimum: 10 ${currency}
        `);
      }
      
      // Log detailed margin info
      logger.logInfo(`Margin Trading Details`, {
        enabled: 'YES',
        equity: `${equity.toFixed(2)} ${currency}`,
        marginLevel: `${marginLevel.toFixed(2)}%`,
        freeMargin: `${freeMargin.toFixed(2)} ${currency}`,
        leverage: leverage,
        tradingPower: `${(equity * leverage).toFixed(2)} ${currency}`
      });
      
      // Try to get margin-eligible pairs
      const marginPairs = await this.getMarginTradingPairs();
      
      if (marginPairs.size === 0) {
        logger.logWarning('No margin-eligible pairs found');
        return false;
      }
      
      // Find pairs with the current currency
      const currencyPairs = Array.from(marginPairs).filter(pair => 
        pair.endsWith(currency)
      );
      
      if (currencyPairs.length === 0) {
        logger.logWarning(`No margin-eligible pairs found for ${currency}`);
        return false;
      }
      
      logger.logInfo(`Found ${currencyPairs.length} margin-eligible pairs for ${currency}`, {
        examples: currencyPairs.slice(0, 5).join(', ')
      });
      
      return true;
    } catch (error) {
      if (error.message && error.message.includes('Permission denied')) {
        logger.logError(`
          Margin trading permission denied.
          Please enable margin trading in your Kraken account settings.
        `);
        return false;
      }
      
      logger.logError('Error verifying margin trading:', error);
      return false;
    }
  }

  /**
   * Test margin trading with a very small order
   * @param {string} symbol - Trading pair to test
   * @returns {Promise<boolean>} True if test was successful
   */
  async testMarginTrading(symbol) {
    try {
      logger.logInfo(`Testing margin trading with a small order for ${symbol}...`);
      
      // Check if margin trading is enabled
      if (!require('../config/constants').USE_MARGIN) {
        logger.logWarning('Margin trading is disabled in configuration');
        return false;
      }
      
      // Check if we can use margin for this pair
      const canUseMargin = await this.canUseMarginForPair(symbol);
      if (!canUseMargin) {
        logger.logWarning(`Cannot use margin for ${symbol}`);
        return false;
      }
      
      // Get current price
      const ticker = await this.apiWithRetry('Ticker', { pair: symbol });
      if (!ticker || !ticker.result || !ticker.result[symbol]) {
        logger.logError(`Could not get ticker for ${symbol}`);
        return false;
      }
      
      const price = parseFloat(ticker.result[symbol].c[0]);
      if (isNaN(price) || price <= 0) {
        logger.logError(`Invalid price for ${symbol}: ${price}`);
        return false;
      }
      
      // Get minimum order size
      const minOrderSize = await this.getMinimumOrderSize(symbol);
      if (minOrderSize === null || minOrderSize <= 0) {
        logger.logError(`Could not get minimum order size for ${symbol}`);
        return false;
      }
      
      // Use exactly the minimum order size
      const volume = minOrderSize;
      
      // Get the leverage value
      const leverage = require('../config/constants').getValidLeverage();
      
      // Create order parameters for a buy order
      const orderParams = {
        pair: symbol,
        type: 'buy',
        ordertype: 'market',
        volume: volume.toFixed(8),
        leverage: leverage.toString(),
        margin: 'true'
      };
      
      logger.logInfo(`Sending test margin order to Kraken API`, {
        pair: symbol,
        volume: volume.toFixed(8),
        leverage: leverage.toString()
      });
      
      // Execute the order
      const result = await this.kraken.api('AddOrder', orderParams);
      
      if (result && result.result && result.result.txid) {
        const txid = result.result.txid[0];
        
        logger.logSuccess(`Test margin order executed successfully`, {
          symbol,
          txid,
          volume: volume.toFixed(8)
        });
        
        // Immediately close the position
        logger.logInfo(`Closing test position...`);
        
        // Create order parameters for a sell order to close the position
        const closeOrderParams = {
          pair: symbol,
          type: 'sell',
          ordertype: 'market',
          volume: volume.toFixed(8),
          leverage: leverage.toString(),
          margin: 'true'
        };
        
        const closeResult = await this.kraken.api('AddOrder', closeOrderParams);
        
        if (closeResult && closeResult.result && closeResult.result.txid) {
          const closeTxid = closeResult.result.txid[0];
          
          logger.logSuccess(`Test position closed successfully`, {
            symbol,
            txid: closeTxid
          });
          
          return true;
        } else {
          logger.logError(`Failed to close test position`, closeResult);
          return false;
        }
      } else {
        logger.logError(`Failed to execute test margin order`, result);
        return false;
      }
    } catch (error) {
      logger.logError(`Error testing margin trading:`, error);
      
      // Check for specific margin-related errors
      if (error.message) {
        if (error.message.includes('Insufficient funds')) {
          logger.logError(`Insufficient funds for margin trade`);
        } else if (error.message.includes('Invalid leverage')) {
          logger.logError(`Invalid leverage setting: ${require('../config/constants').getValidLeverage()}`);
        } else if (error.message.includes('Permission denied')) {
          logger.logError(`Margin trading permission denied. Please enable it in your Kraken account.`);
        }
      }
      
      return false;
    }
  }

  async checkOpenPositions() {
    try {
      if (this.positions.size === 0) {
        return; // No positions to check
      }
      
      logger.logInfo(`Checking ${this.positions.size} open positions...`);
      
      // Get current prices for all positions
      const symbols = Array.from(this.positions.keys());
      const prices = await this.getCurrentPrices(symbols);
      
      if (!prices || Object.keys(prices).length === 0) {
        logger.logWarning('Could not get current prices for positions');
        return;
      }
      
      // Check each position
      for (const [symbol, position] of this.positions.entries()) {
        try {
          if (!prices[symbol]) {
            logger.logWarning(`No price data for ${symbol}, skipping position check`);
            continue;
          }
          
          const currentPrice = prices[symbol];
          const entryPrice = position.entryPrice;
          const side = position.side;
          const volume = position.volume;
          const leveraged = position.leveraged || false;
          const leverage = position.leverage || 1;
          const currency = position.currency || (symbol.endsWith('GBP') ? 'GBP' : 'USD');
          
          // Calculate profit/loss
          let percentChange = 0;
          if (side === 'buy') {
            percentChange = ((currentPrice - entryPrice) / entryPrice) * 100;
          } else {
            percentChange = ((entryPrice - currentPrice) / entryPrice) * 100;
          }
          
          // Apply leverage to percent change
          const leveragedPercentChange = percentChange * leverage;
          
          // Calculate absolute profit/loss
          const profitLoss = (side === 'buy' ? 
            (currentPrice - entryPrice) : 
            (entryPrice - currentPrice)) * volume;
          
          // Get stop loss and take profit thresholds
          const stopLossPercent = leveraged ? 
            require('../config/constants').LEVERAGED_STOP_LOSS_PERCENT : 
            require('../config/constants').STOP_LOSS_PERCENT;
            
          const takeProfitPercent = leveraged ? 
            require('../config/constants').LEVERAGED_TAKE_PROFIT_PERCENT : 
            require('../config/constants').TAKE_PROFIT_PERCENT;
          
          // Log position status
          logger.logInfo(`Position status for ${symbol}`, {
            side,
            entry: entryPrice.toFixed(8),
            current: currentPrice.toFixed(8),
            change: `${leveragedPercentChange.toFixed(2)}%`,
            profit: `${profitLoss.toFixed(4)} ${currency}`,
            leveraged: leveraged ? `YES (${leverage}x)` : 'NO',
            stopLoss: `-${stopLossPercent}%`,
            takeProfit: `+${takeProfitPercent}%`
          });
          
          // Check if we need to close the position
          let closeReason = null;
          
          // Check for stop loss
          if (leveragedPercentChange < -stopLossPercent) {
            closeReason = `STOP_LOSS (${leveragedPercentChange.toFixed(2)}% < -${stopLossPercent}%)`;
          }
          
          // Check for take profit
          if (leveragedPercentChange > takeProfitPercent) {
            closeReason = `TAKE_PROFIT (${leveragedPercentChange.toFixed(2)}% > ${takeProfitPercent}%)`;
          }
          
          // Close position if needed
          if (closeReason) {
            logger.logInfo(`Closing position for ${symbol}: ${closeReason}`);
            await this.closePosition(symbol, volume, currentPrice, closeReason);
          }
        } catch (positionError) {
          logger.logError(`Error checking position for ${symbol}:`, positionError);
        }
      }
    } catch (error) {
      logger.logError('Error checking open positions:', error);
    }
  }

  /**
   * Get position information for a symbol
   * @param {string} symbol - The trading pair symbol
   * @returns {Object|null} Position information or null if no position exists
   */
  getPosition(symbol) {
    try {
      // Check if we have a position for this symbol
      if (this.positions.has(symbol)) {
        return this.positions.get(symbol);
      }
      
      // No position found
      return null;
    } catch (error) {
      logger.logError(`Error getting position for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get all current positions
   * @returns {Map} Map of all positions
   */
  getAllPositions() {
    return this.positions;
  }

  /**
   * Get the number of open positions
   * @returns {number} Number of open positions
   */
  getPositionCount() {
    return this.positions.size;
  }

  /**
   * Check if we've reached the maximum number of positions
   * @returns {boolean} True if we've reached the maximum
   */
  hasReachedMaxPositions() {
    const maxPositions = require('../config/constants').MAX_POSITIONS;
    return this.positions.size >= maxPositions;
  }
}

module.exports = new KrakenService();