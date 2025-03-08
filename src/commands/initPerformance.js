// Script to initialize performance.json with valid data
const fs = require('fs');
const path = require('path');

const defaultStats = {
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  breakEvenTrades: 0,
  totalProfit: 0,
  largestWin: 0,
  largestLoss: 0,
  averageWin: 0,
  averageLoss: 0,
  winRate: 0,
  profitFactor: 0,
  trades: []
};

function initializePerformanceFile() {
  try {
    const filePath = path.join(__dirname, '../../logs/performance.json');
    
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log('Created logs directory');
    }
    
    // Write default stats to file
    fs.writeFileSync(filePath, JSON.stringify(defaultStats, null, 2), 'utf8');
    console.log('Initialized performance.json with default stats');
    
    return true;
  } catch (error) {
    console.error('Error initializing performance file:', error);
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  initializePerformanceFile();
}

module.exports = { initializePerformanceFile }; 