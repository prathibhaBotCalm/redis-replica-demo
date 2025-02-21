# #!/bin/bash

# REDIS_PASSWORD="your_redis_password"
# BACKUP_DIR="/backup"
# DATA_DIR="/data"
# DUMP_FILE="$DATA_DIR/dump.rdb"

# echo "Starting Redis server in recovery mode..."
# redis-server \
#     --requirepass $REDIS_PASSWORD \
#     --masterauth $REDIS_PASSWORD \
#     --dir $DATA_DIR \
#     --dbfilename dump.rdb \
#     --appendonly yes \
#     --save 60 1 \
#     --daemonize yes \
#     --loadmodule /opt/redis-stack/lib/redisearch.so \
#     --loadmodule /opt/redis-stack/lib/redisbloom.so \
#     --loadmodule /opt/redis-stack/lib/rejson.so

# # Wait for Redis to start
# until redis-cli -a $REDIS_PASSWORD ping > /dev/null 2>&1; do
#     echo "Waiting for Redis to start..."
#     sleep 1
# done

# # Find the latest backup file if exists
# LATEST_BACKUP=$(ls -t $BACKUP_DIR/dump-*.rdb 2>/dev/null | head -n 1)

# if [ -f "$LATEST_BACKUP" ]; then
#     echo "Found latest backup: $LATEST_BACKUP"
#     echo "Stopping Redis..."
#     redis-cli -a $REDIS_PASSWORD shutdown

#     echo "Restoring from backup..."
#     cp $LATEST_BACKUP $DUMP_FILE

#     echo "Restarting Redis with restored data..."
#     exec redis-server \
#         --requirepass $REDIS_PASSWORD \
#         --masterauth $REDIS_PASSWORD \
#         --dir $DATA_DIR \
#         --dbfilename dump.rdb \
#         --save 60 1 \
#         --loadmodule /opt/redis-stack/lib/redisearch.so \
#         --loadmodule /opt/redis-stack/lib/redisbloom.so \
#         --loadmodule /opt/redis-stack/lib/rejson.so
# else
#     echo "No backup found. Starting Redis with a new instance."
#     # Keep Redis running in foreground
#     exec redis-server \
#         --requirepass $REDIS_PASSWORD \
#         --masterauth $REDIS_PASSWORD \
#         --dir $DATA_DIR \
#         --dbfilename dump.rdb \
#         --save 60 1 \
#         --loadmodule /opt/redis-stack/lib/redisearch.so \
#         --loadmodule /opt/redis-stack/lib/redisbloom.so \
#         --loadmodule /opt/redis-stack/lib/rejson.so
# fi

#!/bin/bash
set -e

# These variables could also come from the environment, but for now they're hardcoded.
REDIS_PASSWORD="your_redis_password"
BACKUP_DIR="/backup"
DATA_DIR="/data"
DUMP_FILE="$DATA_DIR/dump.rdb"

echo "Starting Redis server in recovery mode (daemonized)..."
redis-server \
    --requirepass "$REDIS_PASSWORD" \
    --masterauth "$REDIS_PASSWORD" \
    --dir "$DATA_DIR" \
    --dbfilename dump.rdb \
    --appendonly yes \
    --save 60 1 \
    --daemonize yes \
    --loadmodule /opt/redis-stack/lib/redisearch.so \
    --loadmodule /opt/redis-stack/lib/redisbloom.so \
    --loadmodule /opt/redis-stack/lib/rejson.so

echo "Waiting for Redis to start..."
until redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; do
    echo "Waiting for Redis to start..."
    sleep 1
done

echo "Redis is up. Shutting it down to prepare for restoration (if needed)..."
# Shut down the daemonized instance.
redis-cli -a "$REDIS_PASSWORD" shutdown || true

echo "Waiting for Redis to shut down completely..."
while redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; do
    sleep 1
done

# Check if there's a backup file.
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/dump-*.rdb 2>/dev/null | head -n 1)

if [ -f "$LATEST_BACKUP" ]; then
    echo "Found latest backup: $LATEST_BACKUP"
    echo "Restoring from backup..."
    cp "$LATEST_BACKUP" "$DUMP_FILE"
else
    echo "No backup found. Proceeding with a fresh start."
fi

echo "Restarting Redis in the foreground..."
exec redis-server \
    --requirepass "$REDIS_PASSWORD" \
    --masterauth "$REDIS_PASSWORD" \
    --dir "$DATA_DIR" \
    --dbfilename dump.rdb \
    --save 60 1 \
    --loadmodule /opt/redis-stack/lib/redisearch.so \
    --loadmodule /opt/redis-stack/lib/redisbloom.so \
    --loadmodule /opt/redis-stack/lib/rejson.so
