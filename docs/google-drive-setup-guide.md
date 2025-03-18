# Redis to Google Drive Backup Setup Guide

This guide will help you set up Redis backups to Google Drive using the provided scripts and Docker configuration.

## Prerequisites

- Docker and Docker Compose installed
- A Google account with Google Drive access

## Directory Structure

Create the following directory structure in your project:

```
.
├── backup/                # Location for local backups
├── config/                # Configuration files
│   └── rclone/            # rclone configuration
│       └── rclone.conf    # rclone config file
├── scripts/               # Scripts directory
│   ├── backup.sh          # Backup script
│   └── Dockerfile.redis-backup  # Dockerfile for the backup service
└── docker-compose.yml     # Your Docker Compose file
```

## Setup Instructions

### 1. Prepare Configuration Files

#### Create the Dockerfile

Save the provided `Dockerfile.redis-backup` in the `scripts/` directory.

#### Save the Backup Script

Save the provided `backup.sh` script in the `scripts/` directory and make it executable:

```bash
chmod +x scripts/backup.sh
```

### 2. Configure rclone for Google Drive Access

#### Install rclone locally (if not already installed)

```bash
curl https://rclone.org/install.sh | sudo bash
```

#### Configure rclone

1. Create a new rclone configuration:

```bash
mkdir -p config/rclone
rclone config --config=config/rclone/rclone.conf
```

2. Follow the prompts to set up a new remote named "gdrive":
   - Select "n" for new remote
   - Name: "gdrive"
   - Select the number corresponding to "Google Drive"
   - Client ID: leave blank for default
   - Client Secret: leave blank for default
   - Scope: typically select 1 for "full access"
   - Root folder ID: leave blank
   - Service Account: leave blank
   - Edit advanced config: "n"
   - Use auto config: "y" (browser will open)
   - Log in with your Google account and grant access
   - Team Drive: "n" (unless using a Shared Drive)
   - Confirm the configuration: "y"

3. Test the configuration:

```bash
rclone lsd gdrive: --config=config/rclone/rclone.conf
```

This should list the top-level directories in your Google Drive without error.

### 3. Environment Variables

Add the following environment variables to your `.env` file to customize the backup behavior:

```
# Redis Backup Configuration
BACKUP_INTERVAL=600
MAX_BACKUPS=24
RETENTION_DAYS=7
GDRIVE_ENABLED=true
GDRIVE_DIR=redis-backups
GDRIVE_MAX_BACKUPS=48
GDRIVE_RETENTION_DAYS=14
```

You can adjust these values to suit your needs.

## Usage

### Start the Services

```bash
docker-compose --profile development up -d
```

or

```bash
docker-compose --profile production up -d
```

### Monitor Backup Logs

```bash
docker logs -f $(docker ps -q -f name=redis-backup)
```

### Verify Backups

#### Local Backups

```bash
ls -la backup/
```

#### Google Drive Backups

```bash
rclone ls gdrive:redis-backups --config=config/rclone/rclone.conf
```

## Advanced Configuration

### Compression Options

To save storage space and bandwidth, you can add compression to your Redis backups:

1. Add the following environment variable to enable compression:
   ```
   BACKUP_COMPRESSION=true
   ```

2. In the backup.sh script, add the compression logic before uploading to Google Drive:
   ```bash
   if [ "${BACKUP_COMPRESSION}" = true ]; then
       compressed_file="${backup_file}.gz"
       gzip -c "${backup_file}" > "${compressed_file}"
       backup_file="${compressed_file}"
   fi
   ```

### Encryption

For sensitive data, add encryption before storing in Google Drive:

1. Install gpg in the Dockerfile by adding:
   ```dockerfile
   RUN apk add --no-cache gnupg
   ```

2. Generate a GPG key and store it securely
3. Add encryption to the backup process

### Scheduled Verification

To periodically verify backup integrity:

1. Create a verification script that downloads and checks backups
2. Schedule it to run weekly using a separate container or cron job

## Monitoring Integration

The backup service outputs detailed logs that can be integrated with:

1. **Prometheus**: Using a log exporter to capture backup metrics
2. **Grafana**: Creating dashboards to visualize backup success rates and timing
3. **Alert systems**: Setting up alerts for backup failures or storage issues

## Troubleshooting

### Google Drive Connection Issues

If you're experiencing connection issues to Google Drive:

1. Verify your rclone configuration:
   ```bash
   rclone config show --config=config/rclone/rclone.conf
   ```

2. Test rclone connectivity:
   ```bash
   rclone lsd gdrive: --config=config/rclone/rclone.conf
   ```

3. Check container logs for specific error messages:
   ```bash
   docker logs -f $(docker ps -q -f name=redis-backup)
   ```

4. Refresh authentication:
   ```bash
   rclone config reconnect gdrive: --config=config/rclone/rclone.conf
   ```

### Permission Issues

If you encounter permission issues:

1. Ensure the backup directory is properly mounted in the Docker container.
2. Check that the rclone.conf file has appropriate read permissions:
   ```bash
   chmod 600 config/rclone/rclone.conf
   ```
3. Verify the container has access to the rclone configuration:
   ```bash
   docker exec -it $(docker ps -q -f name=redis-backup) ls -la /config/rclone
   ```

### Backup Size Issues

If backups are failing due to size constraints:

1. Check Google Drive storage quota:
   ```bash
   rclone about gdrive: --config=config/rclone/rclone.conf
   ```
2. Adjust MAX_BACKUPS and RETENTION_DAYS to manage storage usage
3. Consider compressing large RDB files before upload by enabling the BACKUP_COMPRESSION feature

## Security Considerations

### Authentication

- The rclone.conf file contains sensitive authentication information. Ensure it has restricted permissions (chmod 600).
- Consider using environment variables instead of storing credentials in files.
- For production environments, use service accounts instead of personal Google accounts.

### Data Protection

- Enable encryption for sensitive data before uploading to Google Drive.
- Implement GDPR/compliance features by adding data retention policies.
- Consider adding file integrity verification (checksums) to the backup process.

### Access Control

- Create a dedicated Google account or service account with limited permissions for backups.
- Use a specific folder for backups and restrict its sharing settings.
- Regularly audit access to your Google Drive backup folder.

## Performance Optimization

### Resource Management

1. Configure CPU and memory limits in docker-compose.yml:
   ```yaml
   redis-backup:
     # existing configuration...
     deploy:
       resources:
         limits:
           memory: 256M
           cpus: '0.5'
   ```

2. Schedule backups during low-traffic periods:
   ```
   BACKUP_SCHEDULE="0 3 * * *"  # 3 AM daily
   ```

3. Implement incremental backups for large datasets to reduce bandwidth and storage requirements.