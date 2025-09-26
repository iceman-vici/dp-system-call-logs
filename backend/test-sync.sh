# Create test-sync.sh in backend folder
cat > backend/test-sync.sh << 'EOF'
#!/bin/bash
cd /path/to/dp-system-call-logs/backend
source .env
node src/sync/sync.js >> sync-test.log 2>&1
echo "Sync completed at $(date)" >> sync-test.log
EOF

chmod +x backend/test-sync.sh