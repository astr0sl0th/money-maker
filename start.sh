#!/bin/bash

# Production startup script for Kraken trading bot

# Set environment to production
export NODE_ENV=production

# Ensure logs directory exists
mkdir -p logs

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Error: .env file not found. Please create it with your API credentials."
  exit 1
fi

# Check for required dependencies
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed."
  exit 1
fi

# Start the bot with PM2 for process management
if command -v pm2 &> /dev/null; then
  echo "Starting bot with PM2..."
  pm2 start src/index.js --name kraken-bot
else
  echo "PM2 not found. Installing PM2..."
  npm install -g pm2
  echo "Starting bot with PM2..."
  pm2 start src/index.js --name kraken-bot
fi

# Display status
pm2 status
echo "Bot started successfully. Check logs with: pm2 logs kraken-bot" 