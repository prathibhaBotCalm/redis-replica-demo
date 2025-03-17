#!/bin/bash
set -e

# Configuration 
BACKUP_DIR=${BACKUP_DIR:-"/backup"}
DATA_DIR=${DATA_DIR:-"/data"}
REDIS_PASSWORD=${REDIS_PASSWORD:-"your_redis_password"}
REDIS_HOST=${REDIS_HOST:-"redis-master"}
REDIS_PORT=${REDIS_PORT:-6379}
BACKUP_PREFIX=${BACKUP_PREFIX:-"dump"}
TEMP_DIR="/tmp/redis-restore"

# Google Drive configuration
GDRIVE_ENABLED=${GDRIVE_ENABLED:-true}
GDRIVE_DIR=${GDRIVE_DIR:-"redis-backups"}
RCLONE_CONFIG=${RCLONE_CONFIG:-"/config/rclone/rclone.conf"}
RCLONE_REMOTE=${RCLONE_REMOTE:-"gdrive"}

# Help message
show_help() {
  echo "Redis Backup Restore Utility"
  echo ""
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  -l, --list              List available backups"
  echo "  -r, --restore FILE      Restore specific backup file"
  echo "  -g, --google-drive      Use Google Drive instead of local storage"
  echo "  -n, --newest            Restore the newest backup (default action)"
  echo "  -d, --dry-run           Show what would happen without making changes"
  echo "  -f, --force             Don't ask for confirmation before restoring"
  echo "  -h, --help              Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 --list                        # List all local backups"
  echo "  $0 --list --google-drive         # List all Google Drive backups"
  echo "  $0 --restore dump-20250317-120000.rdb # Restore specific backup"
  echo "  $0 --newest                      # Restore most recent backup (default)"
  echo ""
}

# Function to list available backups
list_backups() {
  if [ "$use_gdrive" = true ] && [ "$GDRIVE_ENABLED" = true ]; then
    echo "Listing backups from Google Drive (${GDRIVE_DIR}):"
    if ! rclone lsf "${RCLONE_REMOTE}:${GDRIVE_DIR}/" --config="${RCLONE_CONFIG}" --include "${BACKUP_PREFIX}-*.rdb" | sort -r; then
      echo "ERROR: Failed to list Google Drive backups"
      exit 1
    fi
  else
    echo "Listing local backups (${BACKUP_DIR}):"
    find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f -printf "%T@ %p\n" | sort -nr | cut -d' ' -f2-
  fi
}

# Function to find the newest backup
find_newest_backup() {
  if [ "$use_gdrive" = true ] && [ "$GDRIVE_ENABLED" = true ]; then
    newest=$(rclone lsf "${RCLONE_REMOTE}:${GDRIVE_DIR}/" --config="${RCLONE_CONFIG}" --include "${BACKUP_PREFIX}-*.rdb" | grep -v "${BACKUP_PREFIX}-latest.rdb" | sort -r | head -n 1)
    echo "${newest}"
  else
    newest=$(find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f -printf "%T@ %p\n" | sort -nr | head -n 1 | cut -d' ' -f2-)
    echo "${newest##*/}"
  fi
}

# Function to restore a backup
restore_backup() {
  local backup_file="$1"
  local source_path=""
  local target_path="${DATA_DIR}/dump.rdb"
  
  # Create temp directory if it doesn't exist
  mkdir -p "${TEMP_DIR}"
  
  echo "Preparing to restore backup: ${backup_file}"
  
  # Download from Google Drive if needed
  if [ "$use_gdrive" = true ] && [ "$GDRIVE_ENABLED" = true ]; then
    echo "Downloading from Google Drive: ${GDRIVE_DIR}/${backup_file}"
    if [ "$dry_run" = true ]; then
      echo "[DRY RUN] Would download ${backup_file} from Google Drive"
      return 0
    fi
    
    if ! rclone copy "${RCLONE_REMOTE}:${GDRIVE_DIR}/${backup_file}" "${TEMP_DIR}/" --config="${RCLONE_CONFIG}"; then
      echo "ERROR: Failed to download backup from Google Drive"
      exit 1
    fi
    source_path="${TEMP_DIR}/${backup_file}"
  else
    source_path="${BACKUP_DIR}/${backup_file}"
  fi
  
  # Verify backup exists
  if [ ! -f "${source_path}" ]; then
    echo "ERROR: Backup file not found: ${source_path}"
    exit 1
  fi
  
  # Check backup size
  local backup_size=$(stat -c%s "${source_path}" 2>/dev/null || stat -f%z "${source_path}")
  echo "Backup size: ${backup_size} bytes"
  
  if [ "${backup_size}" -eq 0 ]; then
    echo "ERROR: Backup file has zero size, cannot restore"
    exit 1
  fi
  
  # Ask for confirmation unless forced
  if [ "$force" != true ] && [ "$dry_run" != true ]; then
    read -p "Are you sure you want to restore this backup? This will REPLACE all current data! (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "Restore cancelled."
      exit 0
    fi
  fi
  
  # Perform the restore
  if [ "$dry_run" = true ]; then
    echo "[DRY RUN] Would restore ${source_path} to ${target_path}"
    echo "[DRY RUN] Would shutdown Redis and restart it with restored data"
    return 0
  fi
  
  # Shutdown Redis gracefully
  echo "Shutting down Redis server..."
  if ! redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" -a "${REDIS_PASSWORD}" SAVE; then
    echo "WARNING: Failed to execute SAVE command, continuing anyway..."
  fi
  
  if ! redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" -a "${REDIS_PASSWORD}" SHUTDOWN NOSAVE; then
    echo "WARNING: Failed to shutdown Redis gracefully, trying to continue..."
  fi
  
  # Wait for Redis to shut down
  echo "Waiting for Redis to shut down..."
  sleep 3
  
  # Copy the backup to the data directory
  echo "Copying backup to data directory..."
  cp -f "${source_path}" "${target_path}"
  chmod 644 "${target_path}"
  
  # Clean up temp dir if used
  if [ -d "${TEMP_DIR}" ] && [ "$use_gdrive" = true ]; then
    rm -rf "${TEMP_DIR}"
  fi
  
  echo "Backup restored successfully. Redis will load the data on next start."
  echo "Restart your Redis service now with: docker-compose restart redis-master"
}

# Default options
use_gdrive=false
action="newest"
backup_file=""
dry_run=false
force=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -l|--list)
      action="list"
      shift
      ;;
    -r|--restore)
      action="restore"
      backup_file="$2"
      shift 2
      ;;
    -g|--google-drive)
      use_gdrive=true
      shift
      ;;
    -n|--newest)
      action="newest"
      shift
      ;;
    -d|--dry-run)
      dry_run=true
      shift
      ;;
    -f|--force)
      force=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

# Check Google Drive configuration if needed
if [ "$use_gdrive" = true ]; then
  if [ "$GDRIVE_ENABLED" != true ]; then
    echo "ERROR: Google Drive backup is not enabled in configuration"
    exit 1
  fi
  
  if [ ! -f "${RCLONE_CONFIG}" ]; then
    echo "ERROR: rclone configuration not found at ${RCLONE_CONFIG}"
    exit 1
  fi
fi

# Execute the requested action
case "$action" in
  list)
    list_backups
    ;;
  restore)
    if [ -z "$backup_file" ]; then
      echo "ERROR: No backup file specified for restore"
      show_help
      exit 1
    fi
    restore_backup "$backup_file"
    ;;
  newest)
    newest_backup=$(find_newest_backup)
    if [ -z "$newest_backup" ]; then
      echo "ERROR: No backups found"
      exit 1
    fi
    echo "Found newest backup: $newest_backup"
    restore_backup "$newest_backup"
    ;;
  *)
    echo "Unknown action: $action"
    show_help
    exit 1
    ;;
esac

exit 0