// Trading parameters
exports.INTERVAL = 1; // 1-minute candlesticks
exports.RSI_PERIOD = 14;
exports.TRADE_AMOUNT_USD = 3;
exports.MAX_TRADE_AMOUNT_USD = 5;
exports.STOP_LOSS_PERCENT = 2;
exports.LEVERAGED_STOP_LOSS_PERCENT = 1; // Tighter stop loss for leveraged positions
exports.TAKE_PROFIT_PERCENT = 1;
exports.LEVERAGED_TAKE_PROFIT_PERCENT = 0.5; // Tighter take profit for leveraged positions

// Market thresholds
exports.VOLATILITY_THRESHOLD = 0.3;
exports.VOLUME_THRESHOLD = 10000;
exports.MAX_PAIRS = 5;
exports.MAX_PRICE_AGE_MINUTES = 3;

// Position management
exports.MAX_POSITIONS = 3;
exports.LEVERAGE = 2;  // Default leverage
exports.USE_MARGIN = true;  // Enable margin trading
exports.POSITION_CHECK_INTERVAL = 5000;

// RSI thresholds
exports.RSI_OVERSOLD_EXTREME = 25;
exports.RSI_OVERSOLD = 35;
exports.RSI_OVERBOUGHT = 65;
exports.RSI_OVERBOUGHT_EXIT = 60;
exports.RSI_EXTREME_OVERBOUGHT = 75;

// Minimum order sizes for various assets on Kraken
const MIN_ORDER_SIZES = {
  default: 0.0001,
  BTC: 0.0001,
  ETH: 0.001,
  
  // Add more as needed
};

// Add these constants for USD trading
exports.TRADE_AMOUNT_USD_USD = 5; // Amount to trade in USD when using USD pairs
exports.MAX_TRADE_AMOUNT_USD_USD = 10; // Maximum trade amount in USD when using USD pairs

// Function to get trade amount based on currency
exports.getTradeAmount = function(currency) {
  return currency === 'USD' ? exports.TRADE_AMOUNT_USD_USD : exports.TRADE_AMOUNT_USD;
};

// Function to get max trade amount based on currency
exports.getMaxTradeAmount = function(currency) {
  return currency === 'USD' ? exports.MAX_TRADE_AMOUNT_USD_USD : exports.MAX_TRADE_AMOUNT_USD;
};

// Add this to ensure LEVERAGE is always a valid number
exports.getValidLeverage = function() {
  return isNaN(exports.LEVERAGE) ? 1 : exports.LEVERAGE;
};

module.exports = {
  MIN_ORDER_SIZES
}; 