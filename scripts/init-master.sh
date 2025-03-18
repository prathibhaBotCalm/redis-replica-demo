#!/bin/bash
set -e

REDIS_PASSWORD="${REDIS_PASSWORD:-your_redis_password}"
BACKUP_DIR="/backup"
DATA_DIR="/data"
DUMP_FILE="$DATA_DIR/dump.rdb"
LATEST_SYMLINK="$BACKUP_DIR/dump-latest.rdb"

# Function to check if Redis is already running
check_redis_running() {
    if pgrep -x "redis-server" > /dev/null; then
        echo "Redis is already running. Shutting it down..."
        redis-cli -h 127.0.0.1 -p 6379 -a $REDIS_PASSWORD shutdown NOSAVE || pkill redis-server
        # Wait for the process to fully terminate
        sleep 2
    fi
}

# Find the most recent backup by timestamp
find_latest_backup() {
    # Check if the latest symlink exists and is valid
    if [ -L "$LATEST_SYMLINK" ] && [ -f "$(readlink -f "$LATEST_SYMLINK")" ]; then
        echo "$(readlink -f "$LATEST_SYMLINK")"
        return
    fi
    
    # Look for the most recent timestamp-based backup
    LATEST_BY_TIME=$(find "$BACKUP_DIR" -name "dump-*.rdb" -type f -printf "%T@ %p\n" 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2)
    if [ -n "$LATEST_BY_TIME" ]; then
        echo "$LATEST_BY_TIME"
        return
    fi
    
    # Check for a standard dump.rdb in backup directory
    if [ -f "$BACKUP_DIR/dump.rdb" ]; then
        echo "$BACKUP_DIR/dump.rdb"
        return
    fi

    # Check for existing dump.rdb in data directory
    if [ -f "$DATA_DIR/dump.rdb" ]; then
        echo "$DATA_DIR/dump.rdb"
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

# Log function with timestamp
log() {
    echo "$(date +'%Y-%m-%d %H:%M:%S') - $1"
}

# Check for existing Redis processes before starting
check_redis_running

# Find the most recent backup
LATEST_BACKUP=$(find_latest_backup)

if [ -n "$LATEST_BACKUP" ]; then
    log "Found latest RDB backup: $LATEST_BACKUP"
    
    # Calculate backup age in seconds
    if [ -f "$LATEST_BACKUP" ]; then
        BACKUP_TIME=$(stat -c %Y "$LATEST_BACKUP")
        CURRENT_TIME=$(date +%s)
        BACKUP_AGE=$((CURRENT_TIME - BACKUP_TIME))
        
        log "Backup is ${BACKUP_AGE} seconds old ($(echo "scale=2; ${BACKUP_AGE}/3600" | bc) hours)"
    fi
    
    # Ensure data directory exists
    mkdir -p "$DATA_DIR"
    
    log "Copying latest backup to $DUMP_FILE..."
    cp -f "$LATEST_BACKUP" "$DUMP_FILE"
    
    # Set proper permissions
    chmod 644 "$DUMP_FILE"
    
    # Verify file size to ensure it's a valid backup
    BACKUP_SIZE=$(stat -c %s "$DUMP_FILE" 2>/dev/null || stat -f %z "$DUMP_FILE")
    log "Backup file size: ${BACKUP_SIZE} bytes"
    
    if [ "$BACKUP_SIZE" -eq 0 ]; then
        log "WARNING: Backup file has zero size, may be corrupted!"
    fi
    
    log "Starting Redis with data from latest backup..."
    # Disable AOF initially to ensure RDB is loaded
    exec redis-server \
        --bind 0.0.0.0 \
        --port 6379 \
        --requirepass "$REDIS_PASSWORD" \
        --masterauth "$REDIS_PASSWORD" \
        --dir "$DATA_DIR" \
        --dbfilename dump.rdb \
        --appendonly no \
        --save 60 1 \
        --loadmodule /opt/redis-stack/lib/redisearch.so \
        --loadmodule /opt/redis-stack/lib/redisbloom.so \
        --loadmodule /opt/redis-stack/lib/rejson.so
else
    log "No backup found. Starting Redis with a new instance."
    # Start Redis in foreground
    exec redis-server \
        --bind 0.0.0.0 \
        --port 6379 \
        --requirepass "$REDIS_PASSWORD" \
        --masterauth "$REDIS_PASSWORD" \
        --dir "$DATA_DIR" \
        --dbfilename dump.rdb \
        --appendonly yes \
        --save 60 1 \
        --loadmodule /opt/redis-stack/lib/redisearch.so \
        --loadmodule /opt/redis-stack/lib/redisbloom.so \
        --loadmodule /opt/redis-stack/lib/rejson.so
fi