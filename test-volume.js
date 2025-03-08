require('dotenv').config();
const KrakenClient = require('kraken-api');
const kraken = new KrakenClient(
  process.env.KRAKEN_API_KEY,
  process.env.KRAKEN_API_SECRET
);

async function testVolumeFormats() {
  try {
    console.log('Testing volume formats for Kraken API...');
    
    // Test pair
    const symbol = 'XBTUSD'; // Bitcoin/USD
    
    // Test volume
    const volume = 0.001; // 0.001 BTC
    
    // Try different volume formats
    const formats = [
      volume.toFixed(8),
      volume.toFixed(6),
      volume.toFixed(4),
      volume.toFixed(2),
      volume.toFixed(0),
      volume.toString(),
      Math.floor(volume * 100000000) / 100000000 + '',
      parseFloat(volume.toFixed(8)) + ''
    ];
    
    console.log(`Testing formats for ${symbol} with volume ~${volume}:`);
    
    for (const format of formats) {
      console.log(`  - Testing format: ${format}`);
      
      try {
        // Create a validation-only order
        const orderParams = {
          pair: symbol,
          type: 'buy',
          ordertype: 'market',
          volume: format,
          validate: true
        };
        
        const result = await kraken.api('AddOrder', orderParams);
        console.log(`  ✓ Valid format: ${format}`);
        console.log(`    Result: ${JSON.stringify(result)}`);
      } catch (error) {
        console.log(`  ✗ Invalid format: ${format} - ${error.message}`);
      }
    }
    
    console.log('Test completed.');
  } catch (error) {
    console.error('Error testing volume formats:', error);
  }
}

testVolumeFormats().catch(console.error); 