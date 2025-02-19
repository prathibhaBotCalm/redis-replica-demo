#!/bin/bash



# Start Redis as a replica (slave) of the master
redis-server \
  --replicaof redis-master 6379 \
  --masterauth your_redis_password \
  --requirepass your_redis_password \
  --loadmodule /opt/redis-stack/lib/redisearch.so \
  --loadmodule /opt/redis-stack/lib/redisbloom.so \
  --loadmodule /opt/redis-stack/lib/rejson.so
