const logger = require('../services/loggerService');

class CurrencyManager {
  constructor() {
    this.defaultCurrency = 'GBP';
    this.alternativeCurrency = 'USD';
    this.currentCurrency = 'GBP';
    this.exchangeRates = {
      'GBP/USD': 1.27, // Default fallback rate
      'USD/GBP': 0.79  // Default fallback rate
    };
  }
  
  /**
   * Determine the best currency to use based on time of day
   * @returns {string} The currency code to use (GBP or USD)
   */
  getBestCurrency() {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
    
    // UK night time (8 PM to 6 AM UTC) - use USD
    if (hour >= 20 || hour < 6) {
      this.currentCurrency = this.alternativeCurrency;
      logger.logInfo(`Night time in UK (${hour}:00 UTC), using ${this.alternativeCurrency} pairs`);
      return this.alternativeCurrency;
    }
    
    // Weekend - prefer USD for better liquidity
    if (day === 0 || day === 6) {
      this.currentCurrency = this.alternativeCurrency;
      logger.logInfo(`Weekend (${day === 0 ? 'Sunday' : 'Saturday'}), using ${this.alternativeCurrency} pairs for better liquidity`);
      return this.alternativeCurrency;
    }
    
    // UK day time on weekdays - use GBP
    this.currentCurrency = this.defaultCurrency;
    logger.logInfo(`Day time in UK (${hour}:00 UTC), using ${this.defaultCurrency} pairs`);
    return this.defaultCurrency;
  }
  
  /**
   * Update exchange rates between currencies
   * @param {Object} rates - Exchange rates object
   */
  updateExchangeRates(rates) {
    if (rates['GBP/USD']) {
      this.exchangeRates['GBP/USD'] = rates['GBP/USD'];
      this.exchangeRates['USD/GBP'] = 1 / rates['GBP/USD'];
    }
    
    logger.logTrade(`Updated exchange rates: 1 GBP = ${this.exchangeRates['GBP/USD'].toFixed(4)} USD`);
  }
  
  /**
   * Convert amount from one currency to another
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency
   * @param {string} toCurrency - Target currency
   * @returns {number} Converted amount
   */
  convert(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return amount;
    }
    
    const rateKey = `${fromCurrency}/${toCurrency}`;
    if (this.exchangeRates[rateKey]) {
      return amount * this.exchangeRates[rateKey];
    }
    
    // Try reverse rate
    const reverseRateKey = `${toCurrency}/${fromCurrency}`;
    if (this.exchangeRates[reverseRateKey]) {
      return amount / this.exchangeRates[reverseRateKey];
    }
    
    logger.logError(`No exchange rate found for ${rateKey}`);
    return amount; // Return original amount if no rate found
  }
  
  /**
   * Get the current trading currency
   * @returns {string} Current currency code
   */
  getCurrentCurrency() {
    return this.currentCurrency;
  }
}

module.exports = new CurrencyManager(); 