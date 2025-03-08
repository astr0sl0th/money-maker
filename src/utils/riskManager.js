const logger = require('../services/loggerService');
const currencyManager = require('./currencyManager');

class RiskManager {
  constructor() {
    this.maxRiskPerTrade = 0.01; // 1% of account (down from 5%)
    this.maxOpenPositions = 3;
    this.maxDailyLoss = 0.05; // 5% of account
    
    this.dailyPnL = {};
    this.lastResetDay = new Date().toDateString();
  }
  
  checkDailyReset() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDay) {
      logger.logTrade(`Resetting daily P&L tracking (was: ${this.dailyPnL[today]?.GBP.toFixed(2) || 0} GBP, ${this.dailyPnL[today]?.USD.toFixed(2) || 0} USD)`);
      this.dailyPnL[today] = {
        GBP: 0,
        USD: 0
      };
      this.lastResetDay = today;
    }
  }
  
  updateDailyPnL(profit, currency = 'GBP') {
    this.checkDailyReset();
    
    if (!this.dailyPnL[this.lastResetDay]) {
      this.dailyPnL[this.lastResetDay] = {
        GBP: 0,
        USD: 0
      };
    }
    
    // Update the appropriate currency
    this.dailyPnL[this.lastResetDay][currency] += profit;
    
    // Calculate total in GBP equivalent for risk management
    const gbpEquivalent = currency === 'GBP' 
      ? this.dailyPnL[this.lastResetDay].GBP 
      : this.dailyPnL[this.lastResetDay].GBP + (this.dailyPnL[this.lastResetDay].USD * currencyManager.exchangeRates['USD/GBP']);
    
    logger.logTrade(`
      Daily P&L updated:
      GBP: ${this.dailyPnL[this.lastResetDay].GBP.toFixed(2)}
      USD: ${this.dailyPnL[this.lastResetDay].USD.toFixed(2)}
      Total (GBP equivalent): ${gbpEquivalent.toFixed(2)}
    `);
    
    // Check if we've hit the daily loss limit
    if (gbpEquivalent < -this.maxDailyLoss) {
      this.tradingEnabled = false;
      logger.logTrade(`
        DAILY LOSS LIMIT REACHED (${this.maxDailyLoss.toFixed(2)} GBP)
        Trading disabled for today
      `);
    }
  }
  
  canOpenPosition(accountBalance, openPositionsCount) {
    this.checkDailyReset();
    
    // Check if we've hit daily loss limit - only if we've had trades today
    if (this.dailyPnL[this.lastResetDay].GBP < 0 && Math.abs(this.dailyPnL[this.lastResetDay].GBP) >= this.maxDailyLoss * accountBalance) {
      logger.logTrade(`Daily loss limit reached (${this.dailyPnL[this.lastResetDay].GBP.toFixed(2)} GBP). No new positions allowed.`);
      return false;
    }
    
    // Check if we've hit max positions
    if (openPositionsCount >= this.maxOpenPositions) {
      logger.logTrade(`Maximum open positions (${this.maxOpenPositions}) reached. No new positions allowed.`);
      return false;
    }
    
    return true;
  }
  
  calculatePositionSize(accountBalance, price, stopLossPercent, volatility = 1.0) {
    try {
      // Validate inputs
      if (isNaN(accountBalance) || accountBalance <= 0) {
        logger.logError(`Invalid account balance: ${accountBalance}`);
        return 0;
      }
      
      if (isNaN(price) || price <= 0) {
        logger.logError(`Invalid price: ${price}`);
        return 0;
      }
      
      if (isNaN(stopLossPercent) || stopLossPercent <= 0) {
        logger.logError(`Invalid stop loss percent: ${stopLossPercent}`);
        return 0;
      }
      
      // Adjust risk based on volatility
      let riskMultiplier = 1.0;
      
      // Reduce risk for high volatility
      if (volatility > 2.0) {
        riskMultiplier = 0.5;
      } 
      // Increase risk for low volatility
      else if (volatility < 0.5) {
        riskMultiplier = 1.5;
      }
      
      // Calculate position size based on risk
      const riskAmount = accountBalance * this.maxRiskPerTrade * riskMultiplier;
      const stopLossAmount = price * (stopLossPercent / 100);
      
      // Prevent division by zero or very small numbers
      if (stopLossAmount < 0.0000001) {
        logger.logError(`Stop loss amount too small: ${stopLossAmount}`);
        return 0;
      }
      
      const positionSize = riskAmount / stopLossAmount;
      
      // Log the calculation for debugging
      logger.logTrade(`
        Position size calculation:
        Account Balance: ${accountBalance}
        Price: ${price}
        Stop Loss %: ${stopLossPercent}
        Risk Multiplier: ${riskMultiplier}
        Risk Amount: ${riskAmount}
        Stop Loss Amount: ${stopLossAmount}
        Position Size: ${positionSize}
      `);
      
      return positionSize;
    } catch (error) {
      logger.logError('Error calculating position size:', error);
      return 0; // Return 0 as a safe default
    }
  }
}

module.exports = new RiskManager(); 