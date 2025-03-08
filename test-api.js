require('dotenv').config();
const KrakenClient = require('kraken-api');

async function testConnection() {
  try {
    console.log('Testing Kraken API connection...');
    console.log('API Key length:', process.env.KRAKEN_API_KEY.length);
    console.log('API Secret length:', process.env.KRAKEN_API_SECRET.length);
    
    const kraken = new KrakenClient(
      process.env.KRAKEN_API_KEY,
      process.env.KRAKEN_API_SECRET
    );
    
    // Try a simple, non-trading API call
    const serverTime = await kraken.api('Time');
    console.log('Server time:', new Date(serverTime.result.unixtime * 1000));
    console.log('Connection successful!');
    
    // Try to get account balance (requires more permissions)
    try {
      const balance = await kraken.api('Balance');
      console.log('Balance API call successful');
      console.log('Account has access to balances');
    } catch (balanceError) {
      console.error('Balance API call failed:', balanceError.message);
      console.log('Your API key may not have permission to view balances');
    }
    
    // Add this to the testConnection function
    try {
      console.log('\nChecking available GBP pairs:');
      const ticker = await kraken.api('Ticker');
      const gbpPairs = Object.keys(ticker.result).filter(pair => pair.endsWith('GBP'));
      console.log(`Found ${gbpPairs.length} GBP pairs:`);
      gbpPairs.forEach(pair => {
        const data = ticker.result[pair];
        const price = parseFloat(data.c[0]);
        const volume = parseFloat(data.v[1]) * price;
        console.log(`${pair}: Price: ${price.toFixed(4)} GBP, Volume: ${volume.toFixed(2)} GBP`);
      });
    } catch (tickerError) {
      console.error('Failed to get ticker data:', tickerError.message);
    }
    
  } catch (error) {
    console.error('API connection failed:', error.message);
    if (error.message.includes('Invalid key')) {
      console.log('Possible issues:');
      console.log('1. The API key is incorrect or malformed');
      console.log('2. The API secret is incorrect or malformed');
      console.log('3. There may be IP restrictions on your API key');
    }
  }
}

testConnection(); 