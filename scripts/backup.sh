#!/bin/sh

while true; do
  TIMESTAMP=$(date +%F-%H%M%S)
  BACKUP_FILE="backup/dump-$TIMESTAMP.rdb"

  echo "Backing up Redis at $TIMESTAMP" | tee -a backup/backup.log

  cp backup/dump.rdb "$BACKUP_FILE"

  # Ensure backups are rotated (delete backups older than 7 days)
  find backup -name "dump-*.rdb" -mtime +7 -delete

  sleep 600  # Run every 10 minutes
done
