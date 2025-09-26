# Dialpad System Call Logs

**Full-stack application** for syncing and managing Dialpad call logs with Airtable CRM, featuring a Node.js backend API and React frontend dashboard.

## 🚀 Features

### Backend (Node.js API)
- **Dialpad Integration**: Sync call logs via official Dialpad API v2
- **Airtable Integration**: Automatic matching and upserting to CRM
- **Phone Normalization**: E.164 format using libphonenumber-js
- **State Management**: Persistent sync tracking with crash recovery
- **Retry Logic**: Exponential backoff with jitter for API failures
- **Rate Limiting**: Respects Airtable's 5 rps limit
- **RESTful API**: Express.js endpoints for frontend consumption
- **Real-time Updates**: WebSocket support for live sync status

### Frontend (React Dashboard)
- **Call Analytics Dashboard**: Visualize call metrics and trends
- **Real-time Sync Status**: Live updates on sync progress
- **Call Log Browser**: Search, filter, and export call records
- **Customer Matching**: View matched/unmatched calls
- **Configuration UI**: Manage sync settings without code
- **Responsive Design**: Works on desktop and mobile

## 📋 Prerequisites

- Node.js 20+
- npm or yarn
- Dialpad API Key (Admin access)
- Airtable Personal Access Token
- Airtable Base configured with proper schema

## 🛠️ Installation

### Clone the repository
```bash
git clone https://github.com/iceman-vici/dp-system-call-logs.git
cd dp-system-call-logs
```

### Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev  # Development mode with nodemon
```

### Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm start  # Runs on http://localhost:3000
```

## 📦 Project Structure

```
dp-system-call-logs/
├── backend/               # Node.js API Server
│   ├── src/
│   │   ├── api/          # Express routes
│   │   ├── services/     # Business logic
│   │   ├── sync/         # Sync engine
│   │   ├── utils/        # Helpers
│   │   └── config/       # Configuration
│   ├── package.json
│   └── .env.example
├── frontend/             # React Dashboard
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Page components
│   │   ├── services/     # API client
│   │   └── utils/        # Helpers
│   ├── package.json
│   └── .env.example
└── docker-compose.yml    # Full stack deployment
```

## 🔧 Configuration

### Backend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DIALPAD_API_KEY` | ✅ | | Dialpad Bearer token |
| `AIRTABLE_PAT` | ✅ | | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | ✅ | | Airtable Base ID |
| `PORT` | | `3001` | API server port |
| `NODE_ENV` | | `development` | Environment mode |
| `SYNC_INTERVAL` | | `300000` | Auto-sync interval (ms) |

### Frontend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `http://localhost:3001` | Backend API URL |
| `REACT_APP_WS_URL` | `ws://localhost:3001` | WebSocket URL |

## 🚢 Deployment

### Docker Compose (Recommended)
```bash
docker-compose up -d
```

### Production Build
```bash
# Backend
cd backend
npm run build
npm start

# Frontend
cd frontend
npm run build
# Serve build/ directory with nginx or similar
```

### Systemd Service
See `deployment/systemd/` for service configuration examples.

## 📊 API Documentation

### Core Endpoints

- `GET /api/sync/status` - Current sync status
- `POST /api/sync/trigger` - Manually trigger sync
- `GET /api/calls` - List call logs (paginated)
- `GET /api/calls/:id` - Get specific call
- `GET /api/analytics` - Call analytics data
- `GET /api/customers` - List customers
- `GET /api/config` - Get/update configuration

## 🔍 Monitoring

- Health check: `GET /api/health`
- Metrics: `GET /api/metrics`
- Logs: Check `logs/` directory or stdout

## 🐛 Troubleshooting

- **No calls syncing**: Check API keys and permissions
- **Unmatched customers**: Ensure phone numbers are E.164 format
- **Rate limits**: Adjust `SYNC_INTERVAL` and batch sizes
- **Connection errors**: Verify network and firewall settings

## 📝 License

MIT - See LICENSE file for details

## 🤝 Contributing

Pull requests welcome! Please read CONTRIBUTING.md first.

## 📧 Support

For issues and questions, please use the GitHub issues tab.