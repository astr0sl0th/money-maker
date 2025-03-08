/**
 * Production configuration settings
 */
module.exports = {
  // Logging settings
  LOG_LEVEL: 'info',  // 'debug', 'info', 'warning', 'error'
  CONSOLE_LOGGING: false,  // Disable console logging in production
  FILE_LOGGING: true,      // Enable file logging
  
  // Performance monitoring
  ENABLE_PERFORMANCE_TRACKING: true,
  DAILY_REPORT_TIME: '00:00', // UTC time for daily reports
  
  // Trading parameters
  MAX_CONSECUTIVE_LOSSES: 3,  // Stop trading after this many consecutive losses
  DAILY_LOSS_LIMIT_PERCENT: 5, // Stop trading if daily loss exceeds this percentage
  
  // Error handling
  MAX_API_RETRIES: 5,
  RETRY_DELAY_MS: 2000,
  
  // Health monitoring
  ENABLE_HEALTH_CHECK: true,
  HEALTH_CHECK_INTERVAL: 3600000, // 1 hour
  
  // Notification settings (if you implement notifications)
  ENABLE_NOTIFICATIONS: false,
  NOTIFICATION_CHANNELS: ['email'], // 'email', 'telegram', etc.
}; 