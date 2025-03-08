# Kraken RSI Trading Bot

An automated cryptocurrency trading bot for the Kraken exchange that uses RSI (Relative Strength Index) for trade signals. The bot supports both spot and margin trading, with adaptive parameters for different market conditions.

## Features

- RSI-based trading strategy
- Support for both spot and margin trading
- Automatic pair selection based on volatility and volume
- Dynamic adjustment for different market conditions (day/night, weekday/weekend)
- Stop-loss and take-profit management
- Comprehensive logging system
- Environment-based configuration

## Prerequisites

- Node.js (v14 or higher)
- Kraken API keys with trading permissions
- Sufficient funds in your Kraken account

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd kraken-rsi-bot
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```
Edit `.env` with your Kraken API credentials:
```
KRAKEN_API_KEY=your_api_key_here
KRAKEN_API_SECRET=your_api_secret_here
```

## Configuration

Key parameters can be adjusted in `src/config/constants.js`:

- `TRADE_AMOUNT_USD`: Base trade size in USD
- `MAX_TRADE_AMOUNT_USD`: Maximum allowed trade size
- `STOP_LOSS_PERCENT`: Stop loss percentage
- `TAKE_PROFIT_PERCENT`: Take profit percentage
- `LEVERAGE`: Margin trading leverage (if enabled)
- Various RSI thresholds and market filters

## Usage

Start the bot:
```bash
node src/index.js
```

The bot will:
1. Scan for tradeable pairs
2. Filter based on volatility and volume
3. Monitor RSI signals
4. Execute trades when conditions are met
5. Manage positions with stop-loss and take-profit

## Trading Strategy

The bot uses RSI with the following signals:

- Strong buy: RSI < 20
- Regular buy: RSI < 30 (with trend confirmation)
- Regular sell: RSI > 70
- Force exit: RSI > 80

Additional filters:
- Minimum volatility threshold
- Minimum trading volume
- Active trading detection
- Price staleness checks

## Logging

The bot maintains two log files:
- `trade_log.txt`: Records all trading activity
- `error_log.txt`: Records errors and exceptions

## Safety Features

- Maximum position limit
- Maximum trade size limit
- Automatic position monitoring
- Graceful shutdown handling
- Invalid data detection
- Low liquidity protection

## Project Structure

```
project/
├── src/
│   ├── config/
│   │   └── constants.js      # Configuration parameters
│   ├── services/
│   │   ├── krakenService.js  # Kraken API interactions
│   │   └── loggerService.js  # Logging functionality
│   ├── strategies/
│   │   └── rsiStrategy.js    # RSI trading logic
│   ├── utils/
│   │   ├── activityAdjuster.js  # Market activity adjustments
│   │   └── validators.js     # Input validation
│   ├── models/
│   │   └── Position.js       # Position management
│   └── index.js             # Main entry point
├── .env                     # API credentials
├── .env.example            # Template for .env
└── .gitignore             # Git ignore rules
```

## Warning

Trading cryptocurrencies involves significant risk of loss. Use this bot at your own risk. Always start with small amounts and test thoroughly before committing significant capital.

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
```