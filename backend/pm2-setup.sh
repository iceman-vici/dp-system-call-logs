#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Dialpad Sync PM2 Setup Script${NC}"
echo -e "${GREEN}========================================${NC}\n"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 is not installed. Installing PM2 globally...${NC}"
    npm install -g pm2
    
    # Setup PM2 to start on system boot
    echo -e "${YELLOW}Setting up PM2 startup script...${NC}"
    pm2 startup systemd -u $USER --hp /home/$USER
    echo -e "${GREEN}PM2 installed successfully!${NC}\n"
else
    echo -e "${GREEN}PM2 is already installed${NC}\n"
fi

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
    echo -e "${YELLOW}Creating logs directory...${NC}"
    mkdir -p logs
    echo -e "${GREEN}Logs directory created${NC}\n"
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}ERROR: .env file not found!${NC}"
    echo -e "${YELLOW}Please create a .env file from .env.example:${NC}"
    echo -e "  cp .env.example .env"
    echo -e "  Then edit .env with your configuration\n"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}Dependencies installed${NC}\n"
fi

# Stop existing PM2 processes if they exist
echo -e "${YELLOW}Checking for existing PM2 processes...${NC}"
pm2 stop dialpad-sync 2>/dev/null || true
pm2 stop dialpad-cron 2>/dev/null || true
pm2 delete dialpad-sync 2>/dev/null || true
pm2 delete dialpad-cron 2>/dev/null || true
echo -e "${GREEN}Cleaned up existing processes${NC}\n"

# Start the applications using ecosystem file
echo -e "${YELLOW}Starting applications with PM2...${NC}"
pm2 start ecosystem.config.js

# Save PM2 process list
echo -e "\n${YELLOW}Saving PM2 process list...${NC}"
pm2 save

# Show status
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}   PM2 Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}\n"

pm2 status

echo -e "\n${GREEN}Useful PM2 Commands:${NC}"
echo -e "  ${YELLOW}pm2 status${NC}          - Show process status"
echo -e "  ${YELLOW}pm2 logs${NC}            - Show all logs"
echo -e "  ${YELLOW}pm2 logs dialpad-sync${NC} - Show sync server logs"
echo -e "  ${YELLOW}pm2 logs dialpad-cron${NC} - Show cron job logs"
echo -e "  ${YELLOW}pm2 restart all${NC}     - Restart all processes"
echo -e "  ${YELLOW}pm2 stop all${NC}        - Stop all processes"
echo -e "  ${YELLOW}pm2 delete all${NC}      - Delete all processes"
echo -e "  ${YELLOW}pm2 monit${NC}           - Advanced monitoring interface"
echo -e "  ${YELLOW}pm2 reload all${NC}      - Zero-downtime reload\n"

echo -e "${GREEN}Your applications are now running!${NC}"
echo -e "${GREEN}Server: http://localhost:3001${NC}"
echo -e "${GREEN}Cron: Running every 5 minutes${NC}\n"