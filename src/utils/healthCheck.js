/**
 * Health check module for monitoring bot status
 */
const fs = require('fs');
const path = require('path');
const logger = require('../services/loggerService');
const krakenService = require('../services/krakenService');
const performanceTracker = require('./performanceTracker');

class HealthCheck {
  constructor() {
    this.lastCheckTime = null;
    this.isHealthy = true;
    this.healthIssues = [];
  }
  
  /**
   * Run a comprehensive health check
   * @returns {Object} Health status
   */
  async runCheck() {
    try {
      this.healthIssues = [];
      this.lastCheckTime = new Date();
      
      // Check API connectivity
      const apiConnected = await this.checkApiConnectivity();
      
      // Check file system
      const fsHealthy = this.checkFileSystem();
      
      // Check performance metrics
      const performanceHealthy = this.checkPerformanceMetrics();
      
      // Check for error patterns in logs
      const logsHealthy = this.checkErrorLogs();
      
      // Overall health status
      this.isHealthy = apiConnected && fsHealthy && performanceHealthy && logsHealthy;
      
      // Log health status
      if (this.isHealthy) {
        logger.logInfo('Health check passed successfully');
      } else {
        logger.logWarning(`Health check failed with ${this.healthIssues.length} issues`, {
          issues: this.healthIssues
        });
      }
      
      return {
        healthy: this.isHealthy,
        lastCheck: this.lastCheckTime,
        issues: this.healthIssues,
        apiConnected,
        fsHealthy,
        performanceHealthy,
        logsHealthy
      };
    } catch (error) {
      logger.logError('Error running health check:', error);
      this.isHealthy = false;
      this.healthIssues.push('Health check system error: ' + error.message);
      return {
        healthy: false,
        error: error.message
      };
    }
  }
  
  /**
   * Check API connectivity
   * @returns {boolean} True if API is connected
   */
  async checkApiConnectivity() {
    try {
      const connected = await krakenService.testConnection();
      if (!connected) {
        this.healthIssues.push('Cannot connect to Kraken API');
      }
      return connected;
    } catch (error) {
      this.healthIssues.push('API connectivity check error: ' + error.message);
      return false;
    }
  }
  
  /**
   * Check file system health
   * @returns {boolean} True if file system is healthy
   */
  checkFileSystem() {
    try {
      // Check if logs directory is writable
      const logsDir = path.join(__dirname, '../../logs');
      fs.accessSync(logsDir, fs.constants.W_OK);
      
      // Check if performance file exists and is readable
      const perfFile = path.join(logsDir, 'performance.json');
      if (fs.existsSync(perfFile)) {
        fs.accessSync(perfFile, fs.constants.R_OK | fs.constants.W_OK);
      }
      
      return true;
    } catch (error) {
      this.healthIssues.push('File system check error: ' + error.message);
      return false;
    }
  }
  
  /**
   * Check performance metrics
   * @returns {boolean} True if performance metrics are healthy
   */
  checkPerformanceMetrics() {
    try {
      const dailyStats = performanceTracker.getDailyPerformance();
      const config = require('../config/constants');
      
      // Check for excessive losses
      if (dailyStats.consecutiveLosses >= config.MAX_CONSECUTIVE_LOSSES) {
        this.healthIssues.push(`Excessive consecutive losses: ${dailyStats.consecutiveLosses}`);
        return false;
      }
      
      // Check for daily loss limit
      const totalEquity = krakenService.getTotalEquity();
      if (totalEquity && dailyStats.profit.total < 0) {
        const lossPercent = Math.abs(dailyStats.profit.total) / totalEquity * 100;
        if (lossPercent > config.DAILY_LOSS_LIMIT_PERCENT) {
          this.healthIssues.push(`Daily loss limit exceeded: ${lossPercent.toFixed(2)}%`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      this.healthIssues.push('Performance metrics check error: ' + error.message);
      return false;
    }
  }
  
  /**
   * Check error logs for patterns
   * @returns {boolean} True if logs are healthy
   */
  checkErrorLogs() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const errorLogPath = path.join(__dirname, `../../logs/errors-${today}.log`);
      
      if (!fs.existsSync(errorLogPath)) {
        return true; // No error log file exists
      }
      
      const errorLog = fs.readFileSync(errorLogPath, 'utf8');
      const errorLines = errorLog.split('\n').filter(line => line.trim() !== '');
      
      // Check for excessive errors
      if (errorLines.length > 100) {
        this.healthIssues.push(`Excessive error log entries: ${errorLines.length}`);
        return false;
      }
      
      // Check for repeated API errors
      const apiErrors = errorLines.filter(line => line.includes('API error'));
      if (apiErrors.length > 20) {
        this.healthIssues.push(`Excessive API errors: ${apiErrors.length}`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.healthIssues.push('Error log check error: ' + error.message);
      return false;
    }
  }
  
  /**
   * Get current health status
   * @returns {Object} Health status
   */
  getStatus() {
    return {
      healthy: this.isHealthy,
      lastCheck: this.lastCheckTime,
      issues: this.healthIssues
    };
  }
}

module.exports = new HealthCheck(); 