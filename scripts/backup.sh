#!/bin/bash
set -e

# Configuration (with defaults that can be overridden via environment variables)
BACKUP_DIR=${BACKUP_DIR:-"/backup"}
DATA_DIR=${DATA_DIR:-"/data"}
SOURCE_RDB=${SOURCE_RDB:-"${DATA_DIR}/dump.rdb"}
BACKUP_INTERVAL=${BACKUP_INTERVAL:-600}  # Default: 10 minutes (600 seconds)
RETENTION_DAYS=${RETENTION_DAYS:-7}      # Default: keep backups for 7 days
MAX_BACKUPS=${MAX_BACKUPS:-24}           # Default: maximum 24 backups to prevent disk fill
BACKUP_PREFIX=${BACKUP_PREFIX:-"dump"}   # Prefix for backup files

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Function to create timestamp
get_timestamp() {
    date +"%Y%m%d-%H%M%S"
}

# Function to perform backup
perform_backup() {
    local timestamp=$(get_timestamp)
    local backup_file="${BACKUP_DIR}/${BACKUP_PREFIX}-${timestamp}.rdb"
    
    echo "$(date): Starting backup to ${backup_file}"
    
    # Check if source RDB exists
    if [ ! -f "${SOURCE_RDB}" ]; then
        echo "$(date): ERROR - Source RDB file ${SOURCE_RDB} not found!"
        return 1
    fi
    
    # Check source RDB file size
    local filesize=$(stat -c%s "${SOURCE_RDB}" 2>/dev/null || stat -f%z "${SOURCE_RDB}")
    if [ "${filesize}" -eq 0 ]; then
        echo "$(date): WARNING - Source RDB file has zero size, skipping backup"
        return 1
    fi
    
    # Copy RDB file
    cp "${SOURCE_RDB}" "${backup_file}"
    
    # Verify backup
    if [ ! -f "${backup_file}" ]; then
        echo "$(date): ERROR - Backup file creation failed!"
        return 1
    fi
    
    # Check backup size
    local backup_size=$(stat -c%s "${backup_file}" 2>/dev/null || stat -f%z "${backup_file}")
    if [ "${backup_size}" -eq 0 ]; then
        echo "$(date): ERROR - Created backup has zero size, removing it"
        rm -f "${backup_file}"
        return 1
    fi
    
    echo "$(date): Backup completed successfully (${backup_size} bytes)"
    
    # Also create a symlink to latest successful backup
    ln -sf "${backup_file}" "${BACKUP_DIR}/${BACKUP_PREFIX}-latest.rdb"
    
    return 0
}

# Function to rotate backups
rotate_backups() {
    echo "$(date): Starting backup rotation"
    
    # Delete backups older than RETENTION_DAYS
    find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
    
    # Count current backups (excluding the latest symlink)
    local backup_count=$(find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-2*.rdb" -type f | wc -l)
    
    # If we have more than MAX_BACKUPS, delete oldest ones
    if [ "${backup_count}" -gt "${MAX_BACKUPS}" ]; then
        local excess=$((backup_count - MAX_BACKUPS))
        echo "$(date): ${backup_count} backups found, removing ${excess} oldest"
        
        # Find the oldest backups and delete them
        find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f | sort | head -n "${excess}" | xargs rm -f
    fi
    
    # Report current backup status
    local new_count=$(find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f | wc -l)
    local disk_usage=$(du -sh "${BACKUP_DIR}" | cut -f1)
    echo "$(date): Backup rotation completed. ${new_count} backups using ${disk_usage} disk space"
}

# Monitor disk space
check_disk_space() {
    # Get available space in KB
    local available=$(df -k "${BACKUP_DIR}" | awk 'NR==2 {print $4}')
    local threshold=102400  # 100MB in KB
    
    if [ "${available}" -lt "${threshold}" ]; then
        echo "$(date): WARNING - Low disk space: ${available}KB available, removing oldest backups"
        
        # Force removal of oldest backups until we have only 5 left or enough space
        while [ "${available}" -lt "${threshold}" ] && [ "$(find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f | wc -l)" -gt 5 ]; do
            find "${BACKUP_DIR}" -name "${BACKUP_PREFIX}-*.rdb" -type f | sort | head -n 1 | xargs rm -f
            available=$(df -k "${BACKUP_DIR}" | awk 'NR==2 {print $4}')
            echo "$(date): Removed oldest backup, now ${available}KB available"
        done
    fi
}

# Initialize log
echo "$(date): Redis backup service started" | tee -a "${BACKUP_DIR}/backup.log"
echo "$(date): Backup interval: ${BACKUP_INTERVAL}s, retention: ${RETENTION_DAYS} days, max backups: ${MAX_BACKUPS}" | tee -a "${BACKUP_DIR}/backup.log"

# Main backup loop
while true; do
    # Redirect all output to both console and log file
    {
        # Check disk space first
        check_disk_space
        
        # Perform backup
        perform_backup
        
        # Rotate backups
        rotate_backups
        
        echo "$(date): Waiting ${BACKUP_INTERVAL} seconds until next backup"
    } 2>&1 | tee -a "${BACKUP_DIR}/backup.log"
    
    # Sleep until next backup
    sleep "${BACKUP_INTERVAL}"
done