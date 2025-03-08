const KrakenClient = require('kraken-api');
const { MIN_ORDER_SIZES } = require('../config/constants');

class KrakenService {
  constructor() {
    this.client = new KrakenClient(
      process.env.KRAKEN_API_KEY,
      process.env.KRAKEN_API_SECRET
    );
  }

  getMinOrderSize(symbol) {
    return MIN_ORDER_SIZES[symbol] || MIN_ORDER_SIZES.default;
  }

  async getMarginTradingPairs() {
    try {
      const response = await this.client.api('AssetPairs');
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

  // Add other Kraken API methods...
}

module.exports = new KrakenService(); 