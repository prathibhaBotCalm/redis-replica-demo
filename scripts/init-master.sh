#!/bin/bash
set -e

REDIS_PASSWORD="your_redis_password"
BACKUP_DIR="/backup"
DATA_DIR="/data"
DUMP_FILE="$DATA_DIR/dump.rdb"

# Function to check if Redis is already running
check_redis_running() {
    if pgrep -x "redis-server" > /dev/null; then
        echo "Redis is already running. Shutting it down..."
        redis-cli -h 127.0.0.1 -p 6379 -a $REDIS_PASSWORD shutdown NOSAVE || pkill redis-server
        # Wait for the process to fully terminate
        sleep 2
    fi
}

# Function to find a valid dump.rdb file in multiple locations
find_dump_file() {
    # Check multiple locations in order of preference
    if [ -f "$BACKUP_DIR/dump.rdb" ]; then
        echo "$BACKUP_DIR/dump.rdb"
        return
    fi

    if [ -f "$DATA_DIR/dump.rdb" ]; then
        echo "$DATA_DIR/dump.rdb"
        return
    fi
    
    # Look for timestamp-based dumps
    LATEST_BACKUP=$(ls -t $BACKUP_DIR/dump-*.rdb 2>/dev/null | head -n 1)
    if [ -n "$LATEST_BACKUP" ]; then
        echo "$LATEST_BACKUP"
        return
    fi
    
    # Check root directory as fallback
    if [ -f "/dump.rdb" ]; then
        echo "/dump.rdb"
        return
    fi
    
    # No dump file found
    echo ""
}

# Check for existing Redis processes before starting
check_redis_running

# Find any existing dump.rdb file
DUMP_SOURCE=$(find_dump_file)

if [ -n "$DUMP_SOURCE" ]; then
    echo "Found RDB file: $DUMP_SOURCE"
    
    # Ensure data directory exists
    mkdir -p $DATA_DIR
    
    echo "Copying RDB file to $DUMP_FILE..."
    cp -f "$DUMP_SOURCE" "$DUMP_FILE"
    
    # Set proper permissions
    chmod 644 "$DUMP_FILE"
    
    echo "Verifying RDB file was copied successfully..."
    ls -la "$DUMP_FILE"
    
    echo "Starting Redis with data from $DUMP_SOURCE..."
    # Disable AOF initially to ensure RDB is loaded
    exec redis-server \
        --bind 0.0.0.0 \
        --port 6379 \
        --requirepass $REDIS_PASSWORD \
        --masterauth $REDIS_PASSWORD \
        --dir $DATA_DIR \
        --dbfilename dump.rdb \
        --appendonly no \
        --save 60 1 \
        --loadmodule /opt/redis-stack/lib/redisearch.so \
        --loadmodule /opt/redis-stack/lib/redisbloom.so \
        --loadmodule /opt/redis-stack/lib/rejson.so
else
    echo "No backup found. Starting Redis with a new instance."
    # Start Redis in foreground
    exec redis-server \
        --bind 0.0.0.0 \
        --port 6379 \
        --requirepass $REDIS_PASSWORD \
        --masterauth $REDIS_PASSWORD \
        --dir $DATA_DIR \
        --dbfilename dump.rdb \
        --appendonly yes \
        --save 60 1 \
        --loadmodule /opt/redis-stack/lib/redisearch.so \
        --loadmodule /opt/redis-stack/lib/redisbloom.so \
        --loadmodule /opt/redis-stack/lib/rejson.so
fi