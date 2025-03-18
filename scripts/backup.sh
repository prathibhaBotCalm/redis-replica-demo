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

# Google Drive configuration
GDRIVE_ENABLED=${GDRIVE_ENABLED:-true}   # Set to false to disable Google Drive backups
GDRIVE_DIR=${GDRIVE_DIR:-"redis-backups"} # Google Drive folder to store backups
GDRIVE_RETENTION_DAYS=${GDRIVE_RETENTION_DAYS:-${RETENTION_DAYS}} # Can be different from local retention
GDRIVE_MAX_BACKUPS=${GDRIVE_MAX_BACKUPS:-${MAX_BACKUPS}}         # Can be different from local max

# Rclone configuration
RCLONE_CONFIG=${RCLONE_CONFIG:-"/config/rclone/rclone.conf"}
RCLONE_REMOTE=${RCLONE_REMOTE:-"gdrive"}

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Check if rclone config exists
if [ "${GDRIVE_ENABLED}" = true ] && [ ! -f "${RCLONE_CONFIG}" ]; then
    echo "$(date): WARNING - Google Drive backup is enabled but rclone config not found at ${RCLONE_CONFIG}"
    echo "$(date): Continuing with local backups only"
    GDRIVE_ENABLED=false
fi

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
    
    # Upload to Google Drive if enabled
    if [ "${GDRIVE_ENABLED}" = true ]; then
        echo "$(date): Uploading backup to Google Drive (${GDRIVE_DIR})"
        
        # Ensure the remote directory exists
        rclone mkdir "${RCLONE_REMOTE}:${GDRIVE_DIR}" --config="${RCLONE_CONFIG}" 2>/dev/null || true
        
        # Upload the backup file
        if rclone copy "${backup_file}" "${RCLONE_REMOTE}:${GDRIVE_DIR}/" --config="${RCLONE_CONFIG}"; then
            echo "$(date): Successfully uploaded backup to Google Drive"
            
            # Also upload the latest symlink (as a copy of the file, since rclone doesn't handle symlinks well)
            rclone copy "${backup_file}" "${RCLONE_REMOTE}:${GDRIVE_DIR}/${BACKUP_PREFIX}-latest.rdb" --config="${RCLONE_CONFIG}" --no-check-dest
            echo "$(date): Updated latest backup reference in Google Drive"
        else
            echo "$(date): ERROR - Failed to upload backup to Google Drive"
        fi
    fi
    
    return 0
}

# Function to rotate local backups
rotate_backups() {
    echo "$(date): Starting local backup rotation"
    
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
    echo "$(date): Local backup rotation completed. ${new_count} backups using ${disk_usage} disk space"
}

# Function to rotate Google Drive backups
rotate_gdrive_backups() {
    if [ "${GDRIVE_ENABLED}" != true ]; then
        return 0
    fi
    
    echo "$(date): Starting Google Drive backup rotation"
    
    # Get list of Google Drive backups sorted by name (oldest first, since we use timestamps)
    local temp_file=$(mktemp)
    if ! rclone lsf "${RCLONE_REMOTE}:${GDRIVE_DIR}/" --include "${BACKUP_PREFIX}-*.rdb" --config="${RCLONE_CONFIG}" | grep -v "${BACKUP_PREFIX}-latest.rdb" > "${temp_file}"; then
        echo "$(date): ERROR - Failed to list Google Drive backups"
        rm -f "${temp_file}"
        return 1
    fi
    
    # Count current backups
    local backup_count=$(wc -l < "${temp_file}")
    echo "$(date): Found ${backup_count} backups in Google Drive"
    
    # If we have more than GDRIVE_MAX_BACKUPS, delete oldest ones
    if [ "${backup_count}" -gt "${GDRIVE_MAX_BACKUPS}" ]; then
        local excess=$((backup_count - GDRIVE_MAX_BACKUPS))
        echo "$(date): ${backup_count} Google Drive backups found, removing ${excess} oldest"
        
        # Get the list of files to delete (oldest first)
        local files_to_delete=$(head -n "${excess}" "${temp_file}")
        
        # Delete each file
        echo "${files_to_delete}" | while read -r file; do
            echo "$(date): Deleting old Google Drive backup: ${file}"
            rclone delete "${RCLONE_REMOTE}:${GDRIVE_DIR}/${file}" --config="${RCLONE_CONFIG}"
        done
    fi
    
    rm -f "${temp_file}"
    echo "$(date): Google Drive backup rotation completed"
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
if [ "${GDRIVE_ENABLED}" = true ]; then
    echo "$(date): Google Drive backup enabled, folder: ${GDRIVE_DIR}, retention: ${GDRIVE_RETENTION_DAYS} days, max backups: ${GDRIVE_MAX_BACKUPS}" | tee -a "${BACKUP_DIR}/backup.log"
    echo "$(date): Using rclone config: ${RCLONE_CONFIG}" | tee -a "${BACKUP_DIR}/backup.log"
else
    echo "$(date): Google Drive backup disabled" | tee -a "${BACKUP_DIR}/backup.log"
fi

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
        
        # Rotate Google Drive backups if enabled
        if [ "${GDRIVE_ENABLED}" = true ]; then
            rotate_gdrive_backups
        fi
        
        echo "$(date): Waiting ${BACKUP_INTERVAL} seconds until next backup"
    } 2>&1 | tee -a "${BACKUP_DIR}/backup.log"
    
    # Sleep until next backup
    sleep "${BACKUP_INTERVAL}"
done