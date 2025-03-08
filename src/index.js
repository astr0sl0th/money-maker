require('dotenv').config();
const fs = require('fs');
const path = require('path');
const RSIStrategy = require('./strategies/rsiStrategy');
const krakenService = require('./services/krakenService');
const logger = require('./services/loggerService');
const activityAdjuster = require('./utils/activityAdjuster');
const marketAnalyzer = require('./utils/marketAnalyzer');
const MACDStrategy = require('./strategies/macdStrategy');
const { LEVERAGE, LEVERAGED_STOP_LOSS_PERCENT, LEVERAGED_TAKE_PROFIT_PERCENT, USE_MARGIN } = require('./config/constants');
const currencyManager = require('./utils/currencyManager');
const performanceTracker = require('./utils/performanceTracker');
const readline = require('readline');

// Load environment-specific configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Load production config if in production mode
if (isProduction) {
  const productionConfig = require('./config/production');
  
  // Apply production settings
  logger.setLogLevel(productionConfig.LOG_LEVEL);
  logger.enableFileLogging(productionConfig.FILE_LOGGING);
  logger.enableConsoleLogging(productionConfig.CONSOLE_LOGGING);
  
  logger.logInfo(`Starting bot in PRODUCTION mode`);
} else {
  logger.logInfo(`Starting bot in DEVELOPMENT mode`);
}

// Add health check if in production
if (isProduction) {
  const healthCheck = require('./utils/healthCheck');
  const productionConfig = require('./config/production');
  
  if (productionConfig.ENABLE_HEALTH_CHECK) {
    // Run health check at intervals
    setInterval(async () => {
      try {
        await healthCheck.runCheck();
      } catch (error) {
        logger.logError('Health check error:', error);
      }
    }, productionConfig.HEALTH_CHECK_INTERVAL);
  }
}

// Initialize performance.json if it doesn't exist or is invalid
try {
  const performanceFilePath = path.join(__dirname, '../logs/performance.json');
  
  let needsInit = false;
  
  // Check if file exists
  if (!fs.existsSync(performanceFilePath)) {
    console.log('Performance file does not exist, will create it');
    needsInit = true;
  } else {
    // Check if file is valid JSON
    try {
      const content = fs.readFileSync(performanceFilePath, 'utf8');
      if (!content || content.trim() === '') {
        console.log('Performance file is empty, will initialize it');
        needsInit = true;
      } else {
        // Try to parse it
        JSON.parse(content);
        console.log('Performance file exists and is valid');
      }
    } catch (parseError) {
      console.log('Performance file contains invalid JSON, will fix it:', parseError.message);
      needsInit = true;
    }
  }
  
  // Initialize if needed
  if (needsInit) {
    const defaultStats = {
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
    
    // Create directory if it doesn't exist
    const dir = path.dirname(performanceFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log('Created logs directory');
    }
    
    // Write default stats to file
    fs.writeFileSync(performanceFilePath, JSON.stringify(defaultStats, null, 2), 'utf8');
    console.log('Initialized performance.json with default stats');
  }
} catch (error) {
  console.error('Error checking/initializing performance file:', error);
  // Continue anyway
}

// Verify environment variables
if (!process.env.KRAKEN_API_KEY || !process.env.KRAKEN_API_SECRET) {
  logger.logError('Missing Kraken API credentials');
  process.exit(1);
}

// Add error handling
process.on('uncaughtException', (error) => {
  logger.logError('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  logger.logError('Unhandled Rejection:', error);
  process.exit(1);
});

// Add this function to initialize the performance tracker
async function initializePerformanceTracker() {
  try {
    logger.logTrade('Verifying performance tracker...');
    
    // Verify the performance tracker
    const isWorking = performanceTracker.verifyTracker();
    
    if (!isWorking) {
      logger.logTrade('Performance tracker has issues, attempting to fix...');
      const fixed = performanceTracker.fixTrackerIssues();
      
      if (fixed) {
        logger.logTrade('Performance tracker fixed successfully');
      } else {
        logger.logError('Could not fix performance tracker, continuing with limited functionality');
      }
    } else {
      logger.logTrade('Performance tracker is working correctly');
    }
    
    // Log current performance
    const todayStats = performanceTracker.getDailyPerformance();
    logger.logTrade(`
      Today's Performance:
      Trades: ${todayStats.trades}
      Profit (GBP): ${todayStats.profit.GBP.toFixed(2)}
      Profit (USD): ${todayStats.profit.USD.toFixed(2)}
      Win Rate: ${todayStats.winRate.toFixed(2)}%
    `);
    
    return true;
  } catch (error) {
    logger.logError('Error initializing performance tracker:', error);
    return false;
  }
}

// Set up command interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Process commands
rl.on('line', async (input) => {
  const command = input.trim().toLowerCase();
  
  try {
    if (command === 'test margin') {
      logger.logInfo('Testing margin trading...');
      
      // Get a suitable pair for testing
      const pairs = await krakenService.getActivePairs();
      const marginPairs = [];
      
      for (const pair of pairs) {
        if (await krakenService.canUseMarginForPair(pair.symbol)) {
          marginPairs.push(pair);
        }
      }
      
      if (marginPairs.length === 0) {
        logger.logError('No margin-eligible pairs found for testing');
        return;
      }
      
      // Sort by minimum order value (ascending) to use the cheapest pair
      marginPairs.sort((a, b) => (a.minOrderSize * a.lastPrice) - (b.minOrderSize * b.lastPrice));
      
      const testPair = marginPairs[0];
      logger.logInfo(`Selected ${testPair.symbol} for margin testing`);
      
      const success = await krakenService.testMarginTrading(testPair.symbol);
      
      if (success) {
        logger.logSuccess(`
          Margin trading test successful!
          Your account is properly configured for margin trading.
        `);
      } else {
        logger.logError(`
          Margin trading test failed.
          Please check your account settings and API permissions.
        `);
      }
    } else if (command === 'margin status') {
      const marginStatus = await krakenService.checkMarginStatus();
      
      if (!marginStatus) {
        logger.logError('Could not get margin status');
        return;
      }
      
      logger.logInfo(`Margin Status`, {
        equity: `${marginStatus.equity.toFixed(2)} ${marginStatus.currency}`,
        marginLevel: `${marginStatus.marginLevel.toFixed(2)}%`,
        freeMargin: `${marginStatus.freeMargin.toFixed(2)} ${marginStatus.currency}`,
        usedMargin: `${marginStatus.usedMargin.toFixed(2)} ${marginStatus.currency}`,
        tradingPower: `${marginStatus.tradingPower.toFixed(2)} ${marginStatus.currency}`
      });
    } else if (command === 'help') {
      logger.logInfo(`
        Available commands:
        - test margin: Test if margin trading is working
        - margin status: Check your margin account status
        - help: Show this help message
      `);
    }
  } catch (error) {
    logger.logError(`Error processing command: ${command}`, error);
  }
});

async function scalpPair(pair) {
  const { symbol, lastPrice, marginEnabled, currency, reducePositionSize = false } = pair;
  
  // Log margin status for this pair
  logger.logInfo(`Analyzing ${symbol}`, {
    price: `${lastPrice} ${currency}`,
    margin: marginEnabled ? `ENABLED (${require('./config/constants').getValidLeverage()}x)` : 'DISABLED',
    reducedSize: reducePositionSize ? 'YES' : 'NO'
  });
  
  // Get market data first
  const marketData = await krakenService.getMarketData(symbol);
  if (!marketData || marketData.length === 0) {
    logger.logWarning(`No valid market data for ${symbol}`);
    return;
  }

  // Then get adjustments based on the market data
  const adjustments = activityAdjuster.adjustForActivity(marketData, symbol);

  // Initialize multiple strategies
  const rsiStrategy = new RSIStrategy(adjustments);
  const macdStrategy = new MACDStrategy(adjustments);

  // Get signals from each strategy
  const rsiValues = rsiStrategy.calculateRSI(marketData);
  const macdValues = macdStrategy.calculateMACD(marketData);

  if (!rsiValues) {
    logger.logWarning(`Could not calculate RSI for ${symbol}`);
    return;
  }

  if (!macdValues) {
    logger.logWarning(`Could not calculate MACD for ${symbol}`);
    return;
  }

  // Get current position if any
  const position = krakenService.getPosition(symbol);
  
  // Log position status if we have one
  if (position) {
    logger.logInfo(`Current position for ${symbol}`, {
      side: position.side,
      entryPrice: position.entryPrice.toFixed(8),
      volume: position.volume.toFixed(8),
      leveraged: position.leveraged ? `YES (${position.leverage}x)` : 'NO'
    });
  } else {
    logger.logInfo(`No current position for ${symbol}`);
  }

  // Get market conditions
  const marketConditions = marketAnalyzer.analyzeMarketConditions(marketData);
  
  // Get trading signals
  const rsiSignal = rsiStrategy.getSignal(rsiValues, position);
  const macdSignal = macdStrategy.getSignal(macdValues, position);
  
  // Combine signals
  const finalDecision = combineSignals(rsiSignal, macdSignal, marketConditions, position);
  
  logger.logInfo(`Analysis for ${symbol}`, {
    rsi: rsiValues[rsiValues.length - 1].toFixed(2),
    macdSignal: macdSignal.action,
    rsiSignal: rsiSignal.action,
    finalDecision: finalDecision.action,
    reason: finalDecision.reason,
    marketCondition: marketConditions.marketCondition
  });
  
  // Execute the decision
  switch (finalDecision.action) {
    case 'buy':
      if (position) {
        logger.logWarning(`Already have a position in ${symbol}, skipping buy`);
        break;
      }
      
      // Check if we've reached the maximum number of positions
      if (krakenService.hasReachedMaxPositions()) {
        logger.logWarning(`Maximum number of positions reached (${require('./config/constants').MAX_POSITIONS}), skipping buy`);
        break;
      }
      
      // Execute buy
      logger.logInfo(`Executing BUY for ${symbol}`, {
        price: lastPrice,
        usingMargin: marginEnabled ? 'YES' : 'NO',
        reason: finalDecision.reason
      });
      
      const buySuccess = await krakenService.executeTrade(
        symbol, 
        'buy', 
        lastPrice, 
        marginEnabled && await krakenService.canUseMarginForPair(symbol),
        marketConditions.volatility,
        reducePositionSize
      );
      
      if (buySuccess) {
        logger.logSuccess(`Buy order executed for ${symbol} at ${lastPrice} ${currency}`, {
          margin: marginEnabled ? 'YES' : 'NO',
          leverage: marginEnabled ? require('./config/constants').getValidLeverage() : 'N/A'
        });
      }
      break;
      
    case 'sell':
      if (position) {
        logger.logWarning(`Already have a position in ${symbol}, skipping sell`);
        break;
      }
      
      // Check if we've reached the maximum number of positions
      if (krakenService.hasReachedMaxPositions()) {
        logger.logWarning(`Maximum number of positions reached (${require('./config/constants').MAX_POSITIONS}), skipping sell`);
        break;
      }
      
      // Check if we can short (requires margin)
      if (marginEnabled && await krakenService.canUseMarginForPair(symbol)) {
        // Execute sell (short)
        logger.logInfo(`Executing SELL (short) for ${symbol}`, {
          price: lastPrice,
          reason: finalDecision.reason
        });
        
        const sellSuccess = await krakenService.executeTrade(
          symbol, 
          'sell', 
          lastPrice, 
          true, // Always use margin for shorts
          marketConditions.volatility,
          reducePositionSize
        );
        
        if (sellSuccess) {
          logger.logSuccess(`Sell (short) order executed for ${symbol} at ${lastPrice} ${currency}`);
        }
      } else {
        logger.logWarning(`Cannot short ${symbol} without margin trading`);
      }
      break;
      
    case 'exit':
      if (!position) {
        logger.logWarning(`No position to exit for ${symbol}`);
        break;
      }
      
      // Close position
      const closeSuccess = await krakenService.closePosition(
        symbol, 
        position.volume, 
        lastPrice, 
        finalDecision.reason
      );
      
      if (closeSuccess) {
        logger.logSuccess(`Position closed for ${symbol} at ${lastPrice} ${currency}`);
      }
      break;
      
    default:
      logger.logInfo(`No action needed for ${symbol}`);
  }
}

// Make sure this function is defined before it's used
function isGoodTradingTime(currency) {
  return marketAnalyzer.isGoodTradingTime(currency);
}

/**
 * Combine signals from different strategies
 * @param {Object} rsiSignal - Signal from RSI strategy
 * @param {Object} macdSignal - Signal from MACD strategy
 * @param {Object} marketConditions - Market conditions analysis
 * @param {Object} position - Current position if any
 * @returns {Object} Combined decision
 */
function combineSignals(rsiSignal, macdSignal, marketConditions, position) {
  // If we have a position, prioritize exit signals
  if (position) {
    if (rsiSignal.action === 'exit' || macdSignal.action === 'exit') {
      return rsiSignal.action === 'exit' ? rsiSignal : macdSignal;
    }
    
    // No exit signal, hold the position
    return { action: 'wait', reason: 'HOLDING_POSITION' };
  }
  
  // For new positions, require agreement or strong signals
  if (rsiSignal.action === macdSignal.action && rsiSignal.action !== 'wait') {
    return {
      action: rsiSignal.action,
      reason: `CONSENSUS: ${rsiSignal.reason} & ${macdSignal.reason}`
    };
  }
  
  // RSI extreme signals are strong enough on their own
  if (rsiSignal.reason && rsiSignal.reason.includes('EXTREME')) {
    return rsiSignal;
  }
  
  // In volatile markets, be more cautious
  if (marketConditions.marketCondition === 'volatile' && 
      (rsiSignal.action === 'buy' || macdSignal.action === 'buy')) {
    // Only take buy signals if both agree in volatile markets
    if (rsiSignal.action === 'buy' && macdSignal.action === 'buy') {
      return {
        action: 'buy',
        reason: `VOLATILE_CONSENSUS: ${rsiSignal.reason} & ${macdSignal.reason}`
      };
    }
    return { action: 'wait', reason: 'VOLATILE_MARKET_CAUTION' };
  }
  
  // In trending markets, be more aggressive with the trend
  if (marketConditions.marketCondition === 'trending') {
    // If either signal suggests following the trend, do it
    if (marketConditions.priceTrend > 0 && 
        (rsiSignal.action === 'buy' || macdSignal.action === 'buy')) {
      return {
        action: 'buy',
        reason: `TREND_FOLLOWING: ${rsiSignal.action === 'buy' ? rsiSignal.reason : macdSignal.reason}`
      };
    }
    
    if (marketConditions.priceTrend < 0 && 
        (rsiSignal.action === 'sell' || macdSignal.action === 'sell')) {
      return {
        action: 'sell',
        reason: `TREND_FOLLOWING: ${rsiSignal.action === 'sell' ? rsiSignal.reason : macdSignal.reason}`
      };
    }
  }
  
  // Default: no strong signal
  return { action: 'wait', reason: 'NO_STRONG_SIGNAL' };
}

async function main() {
  try {
    logger.logTrade(`
      Kraken Scalping Bot with Margin Trading
      --------------------------------------
      - Margin trading uses your crypto assets as collateral
      - No GBP balance is required if you have other assets
      - Leverage: ${LEVERAGE}x (${LEVERAGE}x your buying power)
      - Risk: Losses are also amplified by ${LEVERAGE}x
      - Stop Loss: ${LEVERAGED_STOP_LOSS_PERCENT}% (tighter for margin)
      - Take Profit: ${LEVERAGED_TAKE_PROFIT_PERCENT}% (tighter for margin)
    `);
    
    logger.logTrade('Starting Kraken Scalping Bot...');
    
    // Initialize Kraken service
    const initialized = await krakenService.initialize();
    if (!initialized) {
      logger.logError('Failed to initialize Kraken service');
      process.exit(1);
    }
    
    logger.logSuccess('Kraken service initialized successfully');
    
    // Initialize performance tracker
    await initializePerformanceTracker();
    
    // Verify margin trading capability
    if (require('./config/constants').USE_MARGIN) {
      logger.logInfo('Verifying margin trading capability...');
      const marginEnabled = await krakenService.verifyMarginTrading();
      
      if (marginEnabled) {
        logger.logSuccess(`
          Margin trading is enabled and working correctly.
          You can trade with up to ${require('./config/constants').getValidLeverage()}x leverage.
        `);
      } else {
        logger.logWarning(`
          Margin trading verification failed.
          The bot will continue with spot trading only.
          To enable margin trading:
          1. Make sure your Kraken account has margin trading enabled
          2. Ensure your API key has the right permissions
          3. Have sufficient collateral in your account
        `);
        
        // Disable margin trading
        require('./config/constants').USE_MARGIN = false;
      }
    }
    
    // Set up position checking interval (only once)
    setInterval(async () => {
      try {
        await krakenService.checkOpenPositions();
      } catch (error) {
        logger.logError('Error checking positions:', error);
      }
    }, require('./config/constants').POSITION_CHECK_INTERVAL);
    
    // Main trading loop
    while (true) {
      try {
        // Check margin status at the beginning of each cycle
        const marginStatus = await krakenService.checkMarginStatus();
        
        // If margin status is null or equity is not a valid number, handle it
        if (!marginStatus || isNaN(marginStatus.equity) || marginStatus.equity < 5) {
          logger.logWarning(`
            Margin trading issue detected:
            - Status: ${marginStatus ? 'Available' : 'Unavailable'}
            - Equity: ${marginStatus ? marginStatus.equity.toFixed(2) : 'Unknown'} ${marginStatus ? marginStatus.currency : ''}
            - Possible causes:
              1. Account not enabled for margin trading
              2. No assets in account
              3. API permission issues
            
            Continuing with spot trading only...
          `);
          
          // Disable margin trading for this cycle
          const USE_MARGIN_BACKUP = require('./config/constants').USE_MARGIN;
          require('./config/constants').USE_MARGIN = false;
          
          // Continue with the rest of the trading logic...
          
          // Restore the original setting at the end of the cycle
          require('./config/constants').USE_MARGIN = USE_MARGIN_BACKUP;
        } else {
          // Margin trading is available
          const equity = parseFloat(marginStatus.equity);
          const tradingPower = parseFloat(marginStatus.tradingPower);
          const maxPosition = (equity * 0.8).toFixed(2);
          
          logger.logInfo(`Margin Trading Available`, {
            equity: `${equity.toFixed(2)} ${marginStatus.currency}`,
            tradingPower: `${tradingPower.toFixed(2)} ${marginStatus.currency}`,
            maxPosition: `${maxPosition} ${marginStatus.currency}`
          });
        }

        // Determine the best currency to use based on time of day
        const tradingCurrency = currencyManager.getBestCurrency();
        logger.logInfo(`Trading with ${tradingCurrency} as base currency`);
        
        // Find tradeable pairs based on current balance
        const tradeablePairs = await krakenService.findTradeablePairs(tradingCurrency);
        
        if (tradeablePairs.length === 0) {
          logger.logTrade('No tradeable pairs found with your current balance. Waiting...');
          await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
          continue;
        }
        
        // Take top 5 pairs by volatility
        const topPairs = tradeablePairs.slice(0, 5);
        
        logger.logTrade(`
          Selected pairs: [
            ${topPairs.map(p => `'${p.symbol} (${p.change24h.toFixed(2)}%, Min: ${p.minOrderValue.toFixed(2)} ${tradingCurrency})'`).join(',\n            ')}
          ]
        `);
        
        // Check if it's a good trading time
        if (!isGoodTradingTime(tradingCurrency)) {
          logger.logWarning(`Outside optimal trading hours for ${tradingCurrency}, reducing activity`);
          
          // Instead of skipping completely, reduce the number of pairs to analyze
          const reducedPairs = tradeablePairs.slice(0, 2); // Only analyze top 2 pairs
          
          logger.logInfo(`Reduced trading activity: analyzing only ${reducedPairs.length} pairs`);
          
          // Analyze each pair with reduced position sizes
          for (const pair of reducedPairs) {
            try {
              // Set a flag to reduce position sizes during off-hours
              pair.reducePositionSize = true;
              await scalpPair(pair);
            } catch (pairError) {
              logger.logError(`Error analyzing pair ${pair.symbol}:`, pairError);
              // Continue with next pair
            }
          }
          
          // Wait longer between cycles during off-hours
          logger.logInfo(`Waiting longer between cycles during off-hours`);
          await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
          continue;
        }
        
        // Filter pairs by market activity
        const activePairs = [];
        for (const pair of topPairs) {
          try {
            // Get market data
            const marketData = await krakenService.getMarketData(pair.symbol);
            
            // Check if there's enough activity
            if (marketAnalyzer.hasEnoughActivity(marketData, pair.symbol)) {
              activePairs.push(pair);
            } else {
              logger.logWarning(`Skipping ${pair.symbol} due to low market activity`);
            }
          } catch (error) {
            logger.logError(`Error checking activity for ${pair.symbol}:`, error);
          }
        }

        logger.logInfo(`Found ${activePairs.length} active pairs out of ${topPairs.length} tradeable pairs`);

        // If no active pairs, wait and continue
        if (activePairs.length === 0) {
          logger.logWarning(`No active pairs found. Waiting for market activity...`);
          await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
          continue;
        }

        // Analyze each active pair
        for (const pair of activePairs) {
          try {
            await scalpPair(pair);
          } catch (pairError) {
            logger.logError(`Error analyzing pair ${pair.symbol}:`, pairError);
            // Continue with next pair
          }
        }
      } catch (cycleError) {
        logger.logError('Error in trading cycle:', cycleError);
      }
      
      // Wait before next cycle
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  } catch (error) {
    logger.logError('Fatal error in main loop:', error);
    await krakenService.closeAllPositions();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.logTrade('Cleaning up and closing positions...');
  await krakenService.closeAllPositions();
  process.exit(0);
});

// Start the bot
main().catch(error => {
  logger.logError('Failed to start bot:', error);
  process.exit(1);
}); 