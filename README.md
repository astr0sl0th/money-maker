# Kraken Scalping Bot

An automated trading bot for the Kraken cryptocurrency exchange, designed for scalping strategies with support for both spot and margin trading.

## Features

- Automated trading on Kraken exchange
- Multiple trading strategies (RSI, MACD)
- Support for both spot and margin trading
- Currency switching based on market hours
- Performance tracking and reporting
- Health monitoring system
- Automatic position management
- Risk management controls

## Requirements

- Node.js 14+
- Kraken API key with trading permissions
- Linux/macOS/Windows environment
- PM2 for production deployment (optional but recommended)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/kraken-scalping-bot.git
   cd kraken-scalping-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your Kraken API credentials:
   ```
   KRAKEN_API_KEY=your_api_key
   KRAKEN_API_SECRET=your_api_secret
   ```

## Configuration

Edit the configuration files in `src/config/` to adjust trading parameters:

- `constants.js`: General trading parameters
  - `TRADE_AMOUNT_USD`: Base trade size in USD
  - `MAX_TRADE_AMOUNT_USD`: Maximum allowed trade size
  - `STOP_LOSS_PERCENT`: Stop loss percentage
  - `LEVERAGE`: Margin trading leverage (default: 2x)
  - `MAX_POSITIONS`: Maximum number of open positions (default: 3)

- `production.js`: Production-specific settings
  - Logging configuration
  - Performance monitoring settings
  - Health check parameters
  - Error handling settings

## Usage

### Development Mode

```
npm start
```

### Production Mode

```
npm run start:prod
```

### Using PM2 (recommended for production)

```
npm run start:pm2
```

To view logs:
```
npm run logs
```

To stop the bot:
```
npm run stop:pm2
```

## Production Deployment

### VPS Setup (Recommended)

1. **Rent a VPS**:
   - DigitalOcean, Linode, Vultr, or AWS EC2
   - Minimum specs: 1 CPU, 2GB RAM, 25GB SSD
   - Ubuntu 20.04 LTS or later recommended

2. **Initial server setup**:
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Install PM2
   sudo npm install -g pm2
   
   # Create directory for the bot
   mkdir -p ~/kraken-bot
   ```

3. **Transfer your code**:
   - Use SCP, SFTP, or Git to transfer your code to the server
   - Example with SCP:
     ```bash
     scp -r /path/to/local/kraken-scalping-bot user@your-server-ip:~/kraken-bot
     ```

4. **Set up the bot**:
   ```bash
   cd ~/kraken-bot
   npm install
   
   # Create .env file
   nano .env
   # Add your API credentials
   
   # Make start script executable
   chmod +x start.sh
   ```

5. **Start the bot**:
   ```bash
   ./start.sh
   ```

6. **Set up monitoring**:
   ```bash
   # Monitor logs
   pm2 logs kraken-bot
   
   # Set PM2 to start on system boot
   pm2 startup
   pm2 save
   ```

### Using systemd (Alternative)

1. **Create a systemd service file**:
   ```bash
   sudo nano /etc/systemd/system/kraken-bot.service
   ```

2. **Add the following content** (modify paths as needed):
   ```
   [Unit]
   Description=Kraken Trading Bot
   After=network.target

   [Service]
   Type=simple
   User=YOUR_USERNAME
   WorkingDirectory=/path/to/kraken-scalping-bot
   ExecStart=/usr/bin/node /path/to/kraken-scalping-bot/src/index.js
   Restart=on-failure
   RestartSec=10
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=kraken-bot
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service**:
   ```bash
   sudo systemctl enable kraken-bot
   sudo systemctl start kraken-bot
   ```

4. **Check status and logs**:
   ```bash
   sudo systemctl status kraken-bot
   sudo journalctl -u kraken-bot -f
   ```

## Security Best Practices

1. **API Key Security**:
   - Create API keys with the minimum required permissions
   - Enable IP restrictions for your API keys in Kraken
   - Never commit API keys to version control

2. **Server Security**:
   - Use SSH key authentication instead of passwords
   - Set up a firewall (UFW)
   ```bash
   sudo ufw allow ssh
   sudo ufw enable
   ```
   - Keep the server updated
   - Consider using fail2ban to prevent brute force attacks
   ```bash
   sudo apt install fail2ban
   ```

3. **Bot Security**:
   - Implement trading limits to prevent excessive losses
   - Use the health check system to monitor for issues
   - Regularly backup your performance data

## Monitoring

The bot includes a health check system that monitors:
- API connectivity
- File system access
- Performance metrics
- Error patterns

You can access health status through the command interface:
```
health status
```

## Troubleshooting

### Common Issues

1. **API Connection Errors**:
   - Check your API keys are correct
   - Verify your IP is allowed in Kraken's API settings
   - Check if Kraken API is experiencing downtime

2. **Insufficient Funds Errors**:
   - Ensure you have enough balance for the configured trade sizes
   - Check if funds are locked in open orders

3. **Performance Issues**:
   - If the bot is running slowly, consider upgrading your VPS
   - Check CPU and memory usage with `top` or `htop`

### Getting Help

If you encounter issues:
1. Check the error logs in the `logs` directory
2. Review the Kraken API documentation
3. Open an issue on the GitHub repository

## Disclaimer

This bot is provided for educational purposes only. Trading cryptocurrencies involves significant risk. Use at your own risk. The authors are not responsible for any financial losses incurred from using this software.

## License

MIT