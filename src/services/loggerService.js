const fs = require('fs');

class LoggerService {
  constructor() {
    this.tradeStream = fs.createWriteStream('trade_log.txt', { flags: 'a' });
  }

  logTrade(message) {
    const logMessage = `${new Date().toISOString()} - ${message}\n`;
    console.log(logMessage);
    this.tradeStream.write(logMessage);
  }

  logError(error) {
    const errorMessage = `${new Date().toISOString()} - Error: ${error.message}\n${error.stack}\n`;
    fs.appendFileSync('error_log.txt', errorMessage);
    console.error(errorMessage);
  }

  cleanup() {
    this.tradeStream.end();
  }
}

module.exports = new LoggerService(); 