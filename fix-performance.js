// Script to fix performance.json file
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

function fixPerformanceFile() {
  try {
    const logsDir = path.join(__dirname, 'logs');
    const filePath = path.join(logsDir, 'performance.json');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
      console.log('Created logs directory');
    }
    
    // Write default stats to file
    fs.writeFileSync(filePath, JSON.stringify(defaultStats, null, 2), 'utf8');
    console.log('Fixed performance.json with default stats');
    
    // Verify the file is valid
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      JSON.parse(content);
      console.log('Verified: performance.json contains valid JSON');
    } catch (verifyError) {
      console.error('Error: File still contains invalid JSON after fix', verifyError);
    }
    
    return true;
  } catch (error) {
    console.error('Error fixing performance file:', error);
    return false;
  }
}

// Run the fix
fixPerformanceFile(); 