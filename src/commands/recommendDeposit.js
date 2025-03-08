// Script to recommend minimum deposit amount
const krakenService = require('../services/krakenService');
const logger = require('../services/loggerService');

async function recommendDeposit() {
  try {
    console.log('Analyzing Kraken pairs to recommend minimum deposit amount...');
    
    // Initialize Kraken service
    await krakenService.initialize();
    
    // Get minimum deposit needed
    const lowestMinOrderPairs = await krakenService.getMinimumDepositNeeded();
    
    if (lowestMinOrderPairs.length > 0) {
      console.log('\nRecommended minimum deposit:');
      console.log('----------------------------');
      console.log(`Minimum recommended: £${(lowestMinOrderPairs[0].minOrderValue * 1.5).toFixed(2)}`);
      console.log(`Comfortable amount: £${(lowestMinOrderPairs[0].minOrderValue * 5).toFixed(2)}`);
      console.log(`Optimal amount: £${(lowestMinOrderPairs[0].minOrderValue * 20).toFixed(2)}`);
      
      console.log('\nPairs with lowest minimum order values:');
      lowestMinOrderPairs.forEach(p => {
        console.log(`- ${p.symbol}: £${p.minOrderValue.toFixed(2)}`);
      });
    } else {
      console.log('Could not determine minimum deposit amount. Please try again later.');
    }
  } catch (error) {
    console.error('Error recommending deposit:', error);
  }
}

// Run if called directly
if (require.main === module) {
  recommendDeposit().finally(() => process.exit(0));
}

module.exports = { recommendDeposit }; 