const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class LoggerService {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs');
    this.ensureLogDirectory();
    this.currentDate = this.getFormattedDate();
    this.logFile = path.join(this.logDir, `trading-${this.currentDate}.log`);
    this.errorFile = path.join(this.logDir, `errors-${this.currentDate}.log`);
    
    // Set up console formatting
    this.symbols = {
      info: chalk.blue('ℹ'),
      success: chalk.green('✓'),
      warning: chalk.yellow('⚠'),
      error: chalk.red('✖'),
      trade: chalk.magenta('$'),
      profit: chalk.green('↑'),
      loss: chalk.red('↓'),
      neutral: chalk.blue('→')
    };
  }
  
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  getFormattedDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  
  getFormattedTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  }
  
  checkRotateLogFile() {
    const currentDate = this.getFormattedDate();
    if (currentDate !== this.currentDate) {
      this.currentDate = currentDate;
      this.logFile = path.join(this.logDir, `trading-${this.currentDate}.log`);
      this.errorFile = path.join(this.logDir, `errors-${this.currentDate}.log`);
    }
  }
  
  writeToFile(filePath, message) {
    try {
      const timestamp = this.getFormattedTime();
      const logMessage = `[${timestamp}] ${message}\n`;
      fs.appendFileSync(filePath, logMessage);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }
  
  formatMessage(message) {
    if (typeof message === 'object') {
      return JSON.stringify(message, null, 2);
    }
    return message;
  }
  
  logTrade(message, data = null) {
    this.checkRotateLogFile();
    
    const formattedMessage = this.formatMessage(message);
    const dataString = data ? ` ${this.formatMessage(data)}` : '';
    
    // Detect if this is a profit/loss message
    let symbol = this.symbols.trade;
    if (formattedMessage.includes('P/L:')) {
      if (formattedMessage.includes('-')) {
        symbol = this.symbols.loss;
      } else if (formattedMessage.match(/P\/L:.*[1-9]/)) {
        symbol = this.symbols.profit;
      } else {
        symbol = this.symbols.neutral;
      }
    }
    
    // Format for console
    console.log(`${chalk.gray(`[${this.getFormattedTime()}]`)} ${symbol} ${chalk.cyan('TRADE')} ${formattedMessage}${dataString}`);
    
    // Write to file (without color codes)
    this.writeToFile(this.logFile, `TRADE: ${formattedMessage}${dataString}`);
  }
  
  logError(message, error = null) {
    this.checkRotateLogFile();
    
    const formattedMessage = this.formatMessage(message);
    let errorString = '';
    
    if (error) {
      if (error instanceof Error) {
        errorString = ` ${error.message}\n${error.stack}`;
      } else {
        errorString = ` ${this.formatMessage(error)}`;
      }
    }
    
    // Format for console
    console.error(`${chalk.gray(`[${this.getFormattedTime()}]`)} ${this.symbols.error} ${chalk.red('ERROR')} ${formattedMessage}${errorString}`);
    
    // Write to both files (without color codes)
    this.writeToFile(this.errorFile, `ERROR: ${formattedMessage}${errorString}`);
    this.writeToFile(this.logFile, `ERROR: ${formattedMessage}${errorString}`);
  }
  
  logInfo(message, data = null) {
    this.checkRotateLogFile();
    
    const formattedMessage = this.formatMessage(message);
    const dataString = data ? ` ${this.formatMessage(data)}` : '';
    
    // Format for console
    console.log(`${chalk.gray(`[${this.getFormattedTime()}]`)} ${this.symbols.info} ${chalk.blue('INFO')} ${formattedMessage}${dataString}`);
    
    // Write to file (without color codes)
    this.writeToFile(this.logFile, `INFO: ${formattedMessage}${dataString}`);
  }
  
  logSuccess(message, data = null) {
    this.checkRotateLogFile();
    
    const formattedMessage = this.formatMessage(message);
    const dataString = data ? ` ${this.formatMessage(data)}` : '';
    
    // Format for console
    console.log(`${chalk.gray(`[${this.getFormattedTime()}]`)} ${this.symbols.success} ${chalk.green('SUCCESS')} ${formattedMessage}${dataString}`);
    
    // Write to file (without color codes)
    this.writeToFile(this.logFile, `SUCCESS: ${formattedMessage}${dataString}`);
  }
  
  logWarning(message, data = null) {
    this.checkRotateLogFile();
    
    const formattedMessage = this.formatMessage(message);
    const dataString = data ? ` ${this.formatMessage(data)}` : '';
    
    // Format for console
    console.log(`${chalk.gray(`[${this.getFormattedTime()}]`)} ${this.symbols.warning} ${chalk.yellow('WARNING')} ${formattedMessage}${dataString}`);
    
    // Write to file (without color codes)
    this.writeToFile(this.logFile, `WARNING: ${formattedMessage}${dataString}`);
  }
  
  // Special method for performance logs
  logPerformance(stats) {
    this.checkRotateLogFile();
    
    // Create a nicely formatted performance summary
    const summary = [
      chalk.bold.underline('Performance Summary'),
      `${chalk.bold('Total Trades:')} ${stats.totalTrades}`,
      `${chalk.bold('Win Rate:')} ${stats.winRate.toFixed(2)}%`,
      `${chalk.bold('Profit Factor:')} ${stats.profitFactor.toFixed(2)}`,
      `${chalk.bold('Total Profit:')} ${stats.totalProfit > 0 ? chalk.green(stats.totalProfit.toFixed(2)) : chalk.red(stats.totalProfit.toFixed(2))}`,
      `${chalk.bold('Largest Win:')} ${chalk.green(stats.largestWin.toFixed(2))}`,
      `${chalk.bold('Largest Loss:')} ${chalk.red(stats.largestLoss.toFixed(2))}`,
      `${chalk.bold('Average Win:')} ${chalk.green(stats.averageWin.toFixed(2))}`,
      `${chalk.bold('Average Loss:')} ${chalk.red(stats.averageLoss.toFixed(2))}`
    ].join('\n');
    
    // Format for console
    console.log(`\n${chalk.gray(`[${this.getFormattedTime()}]`)} ${this.symbols.info} ${chalk.blue('PERFORMANCE')}\n${summary}\n`);
    
    // Write to file (without color codes)
    this.writeToFile(this.logFile, `PERFORMANCE: ${JSON.stringify(stats, null, 2)}`);
  }
}

module.exports = new LoggerService(); 