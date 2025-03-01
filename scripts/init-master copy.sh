#!/bin/bash

REDIS_PASSWORD="your_redis_password"
BACKUP_DIR="/backup"
DATA_DIR="/data"
DUMP_FILE="$DATA_DIR/dump.rdb"

echo "Starting Redis server in recovery mode..."
redis-server \
    --requirepass $REDIS_PASSWORD \
    --masterauth $REDIS_PASSWORD \
    --dir $DATA_DIR \
    --dbfilename dump.rdb \
    --appendonly yes \
    --save 60 1 \
    --daemonize yes \
    --loadmodule /opt/redis-stack/lib/redisearch.so \
    --loadmodule /opt/redis-stack/lib/redisbloom.so \
    --loadmodule /opt/redis-stack/lib/rejson.so

# Wait for Redis to start
until redis-cli -a $REDIS_PASSWORD ping > /dev/null 2>&1; do
    echo "Waiting for Redis to start..."
    sleep 1
done

# Find the latest backup file if exists
LATEST_BACKUP=$(ls -t $BACKUP_DIR/dump-*.rdb 2>/dev/null | head -n 1)

if [ -f "$LATEST_BACKUP" ]; then
    echo "Found latest backup: $LATEST_BACKUP"
    echo "Stopping Redis..."
    redis-cli -a $REDIS_PASSWORD shutdown

    echo "Restoring from backup..."
    cp $LATEST_BACKUP $DUMP_FILE

    echo "Restarting Redis with restored data..."
    exec redis-server \
        --requirepass $REDIS_PASSWORD \
        --masterauth $REDIS_PASSWORD \
        --dir $DATA_DIR \
        --dbfilename dump.rdb \
        --save 60 1 \
        --loadmodule /opt/redis-stack/lib/redisearch.so \
        --loadmodule /opt/redis-stack/lib/redisbloom.so \
        --loadmodule /opt/redis-stack/lib/rejson.so
else
    echo "No backup found. Starting Redis with a new instance."
    # Keep Redis running in foreground
    exec redis-server \
        --requirepass $REDIS_PASSWORD \
        --masterauth $REDIS_PASSWORD \
        --dir $DATA_DIR \
        --dbfilename dump.rdb \
        --save 60 1 \
        --loadmodule /opt/redis-stack/lib/redisearch.so \
        --loadmodule /opt/redis-stack/lib/redisbloom.so \
        --loadmodule /opt/redis-stack/lib/rejson.so
fi