#!/bin/bash

REDIS_PASSWORD="${REDIS_PASSWORD:-your_redis_password}"
BACKUP_DIR="/backup"
DATA_DIR="/data"
DUMP_FILE="$DATA_DIR/dump.rdb"

# Find the latest backup file if exists
LATEST_BACKUP=$(ls -t $BACKUP_DIR/dump-*.rdb 2>/dev/null | head -n 1)

if [ -f "$LATEST_BACKUP" ]; then
    echo "Found latest backup: $LATEST_BACKUP"
    echo "Restoring from backup..."
    cp $LATEST_BACKUP $DUMP_FILE
fi

# Start Redis directly in foreground mode (no daemonize)
exec redis-server \
    --requirepass $REDIS_PASSWORD \
    --masterauth $REDIS_PASSWORD \
    --dir $DATA_DIR \
    --dbfilename dump.rdb \
    --appendonly yes \
    --save 60 1 \
    --loadmodule /opt/redis-stack/lib/redisearch.so \
    --loadmodule /opt/redis-stack/lib/redisbloom.so \
    --loadmodule /opt/redis-stack/lib/rejson.so