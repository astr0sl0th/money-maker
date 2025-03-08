// Trading parameters
exports.INTERVAL = 1; // 1-minute candlesticks
exports.RSI_PERIOD = 14;
exports.TRADE_AMOUNT_USD = 10;
exports.MAX_TRADE_AMOUNT_USD = 30;
exports.STOP_LOSS_PERCENT = 2;
exports.TAKE_PROFIT_PERCENT = 1;

// Market thresholds
exports.VOLATILITY_THRESHOLD = 0.3;
exports.VOLUME_THRESHOLD = 10000;
exports.MAX_PAIRS = 5;
exports.MAX_PRICE_AGE_MINUTES = 3;

// Position management
exports.MAX_POSITIONS = 3;
exports.LEVERAGE = 3;
exports.POSITION_CHECK_INTERVAL = 5000;

// RSI thresholds
exports.RSI_OVERSOLD_EXTREME = 20;
exports.RSI_OVERSOLD = 30;
exports.RSI_OVERBOUGHT = 70;
exports.RSI_OVERBOUGHT_EXIT = 65;
exports.RSI_EXTREME_OVERBOUGHT = 80;

// Minimum order sizes
exports.MIN_ORDER_SIZES = {
  'default': 0.0002,
  'SUIUSD': 10,
  'LTCUSD': 0.05,
  'ETHUSD': 0.005,
  'BTCUSD': 0.0001
}; 