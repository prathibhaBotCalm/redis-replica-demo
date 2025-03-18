# Application CI/CD & Infrastructure Documentation

## Table of Contents

1. [System Architecture Overview](#system-architecture-overview)
2. [Infrastructure Setup](#infrastructure-setup)
   - [Digital Ocean Setup with Terraform](#digital-ocean-setup-with-terraform)
   - [SSH Key Configuration](#ssh-key-configuration)
   - [GitHub Repository Secrets](#github-repository-secrets)
3. [CI/CD Pipeline](#cicd-pipeline)
   - [Pipeline Overview](#pipeline-overview)
   - [Branching Strategy](#branching-strategy)
   - [Workflow Files](#workflow-files)
   - [Docker Images](#docker-images)
4. [Deployment Process](#deployment-process)
   - [Staging Deployment](#staging-deployment)
   - [Production Deployment](#production-deployment)
   - [Canary Deployment Strategy](#canary-deployment-strategy)
   - [Promotion and Rollback Processes](#promotion-and-rollback-processes)
5. [Redis High Availability Cluster](#redis-high-availability-cluster)
   - [Redis Cluster Architecture](#redis-cluster-architecture)
   - [Data Flow and Replication](#data-flow-and-replication)
   - [Failover Process](#failover-process)
   - [Redis to Google Drive Backups](#redis-to-google-drive-backups)
6. [Local Development Environment](#local-development-environment)
   - [Prerequisites](#prerequisites)
   - [Configuration](#configuration)
   - [Running the Application](#running-the-application)
   - [Development Workflow](#development-workflow-local)
7. [Developer's Guide](#developers-guide)
   - [Day-to-Day Operations](#day-to-day-operations)
   - [Common Tasks](#common-tasks)
   - [Troubleshooting](#troubleshooting)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)

## System Architecture Overview

The application architecture consists of several interconnected components:

- **Application Server**: A containerized Next.js application with multiple deployment environments.
- **Redis High Availability Cluster**: For data persistence, featuring master-slave replication with Sentinel for automatic failover.
- **CI/CD Pipeline**: GitHub Actions workflows for automated building, testing, and deployment.
- **Infrastructure**: Digital Ocean droplets provisioned using Terraform.

The system employs a canary deployment strategy in production for risk mitigation, ensuring smooth rollouts with automated verification and rollback capabilities.

## Infrastructure Setup

### Digital Ocean Setup with Terraform

#### Prerequisites

Before you begin, ensure you have:
- Terraform (v1.0.0 or later) installed
- Digital Ocean account
- Digital Ocean API Token with write permissions
- SSH key pair for secure access to droplets

#### Installation

1. **Install Terraform**

   For macOS (using Homebrew):
   ```bash
   brew install terraform
   ```

   For Linux (Ubuntu/Debian):
   ```bash
   sudo apt-get update && sudo apt-get install -y gnupg software-properties-common
   wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
   sudo apt-get update && sudo apt-get install terraform
   ```

   Verify installation:
   ```bash
   terraform --version
   ```

2. **Generate SSH Key** (if needed)
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa
   ```

3. **Clone the repository containing Terraform configuration files**

4. **Create the project directory structure**:
   ```
   project/
   ├── main.tf
   ├── variables.tf
   ├── terraform.tfvars
   ├── deploy.sh
   └── scripts/
       └── setup.sh
   ```

5. **Make the deploy script executable**:
   ```bash
   chmod +x deploy.sh
   ```

#### Configuration

1. **Create a Digital Ocean API token**:
   - Log in to your Digital Ocean account
   - Go to API > Personal access tokens
   - Click "Generate New Token"
   - Name your token (e.g., "Terraform")
   - Select "Write" scope
   - Copy the generated token immediately

2. **Create and configure terraform.tfvars**:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

   Edit the file with your settings:
   ```
   do_token             = "your_digital_ocean_api_token"
   project_name         = "my-application"
   ssh_key_name         = "my-ssh-key"
   ssh_public_key_path  = "~/.ssh/id_rsa.pub"
   ssh_private_key_path = "~/.ssh/id_rsa"
   droplet_count        = 2
   droplet_image        = "ubuntu-22-04-x64"
   droplet_size         = "s-2vcpu-2gb"
   region               = "nyc1"
   vpc_cidr             = "10.118.0.0/20"
   environment          = "development"
   create_loadbalancer  = true
   allowed_ssh_ips      = ["your_ip_address/32"]
   ```

#### Deployment Workflow

Use the `deploy.sh` script for Terraform operations:

1. **Initialize Terraform**:
   ```bash
   ./deploy.sh init
   ```

2. **Create a deployment plan**:
   ```bash
   ./deploy.sh plan
   ```

3. **Apply the changes**:
   ```bash
   ./deploy.sh apply
   ```

4. **View resource outputs**:
   ```bash
   ./deploy.sh output
   ```

5. **Destroy infrastructure** (when needed):
   ```bash
   ./deploy.sh destroy
   ```

### SSH Key Configuration

After creating your infrastructure with Terraform, you'll need to properly configure SSH keys for secure access to your droplets and for use with GitHub Actions.

#### Configuring SSH Keys on the Droplet

1. **Generate a dedicated deployment key**:
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/deployment_key -C "deployment@yourdomain.com"
   ```
   
   This creates:
   - A private key: `~/.ssh/deployment_key`
   - A public key: `~/.ssh/deployment_key.pub`

2. **Connect to your droplet** using the SSH key configured in Terraform:
   ```bash
   ssh -i ~/.ssh/id_rsa root@your_droplet_ip
   ```

3. **Configure the authorized_keys file** for the deployment user:
   ```bash
   # Create deployment user if it doesn't exist
   adduser --disabled-password --gecos "" deploy
   
   # Create .ssh directory and set permissions
   mkdir -p /home/deploy/.ssh
   touch /home/deploy/.ssh/authorized_keys
   
   # Add your deployment public key to authorized_keys
   echo "ssh-rsa AAAA..." > /home/deploy/.ssh/authorized_keys
   
   # Set proper permissions
   chmod 700 /home/deploy/.ssh
   chmod 600 /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh
   
   # Add deploy user to Docker group for container management
   usermod -aG docker deploy
   ```

4. **Configure sudo access** for the deployment user (optional, for specific commands):
   ```bash
   # Create a sudoers file for the deploy user
   echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose" > /etc/sudoers.d/deploy
   chmod 440 /etc/sudoers.d/deploy
   ```

5. **Test the connection** using the deployment key:
   ```bash
   ssh -i ~/.ssh/deployment_key deploy@your_droplet_ip
   ```

### GitHub Repository Secrets

To enable the CI/CD pipeline to deploy to your infrastructure, add the following secrets to your GitHub repository:

1. **Navigate to your GitHub repository** → Settings → Secrets and variables → Actions → New repository secret

2. **Add the following repository secrets**:

   | Secret Name | Description | Value |
   |-------------|-------------|-------|
   | `LIVE_USER` | Username for SSH connections to the production server | `deploy` |
   | `LIVE_HOST` | IP address or hostname of the production server | `your_droplet_ip` |
   | `LIVE_SSH_KEY` | Private SSH key for connecting to the production server | Content of `~/.ssh/deployment_key` |

   For `LIVE_SSH_KEY`, you'll need to copy the entire content of your private key file, including the `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----` lines.

3. **Add additional required secrets** for your CI/CD pipeline:
   
   | Secret Name | Description |
   |-------------|-------------|
   | `STAGING_USER` | Username for SSH connections to staging server |
   | `STAGING_HOST` | IP address or hostname of staging server |
   | `STAGING_SSH_KEY` | Private SSH key for connecting to staging server |
   | `REDIS_PASSWORD` | Password for Redis authentication |
   | `REDIS_SENTINEL_PASSWORD` | Password for Redis Sentinel authentication |

4. **Verify secret configuration**:
   - Secrets are environment variables available in GitHub Actions workflows
   - They are automatically masked in logs
   - They cannot be viewed after creation, only updated or deleted

## CI/CD Pipeline

### Pipeline Overview

The CI/CD pipeline automates the build, test, and deployment processes for both staging and production environments. It implements a canary deployment strategy for production to reduce the risk of introducing bugs.

```
┌─────────┐         ┌─────────┐         ┌────────────────┐
│  Build  │  ──────>│ Deploy  │  ──────>│ Deploy Canary  │
└─────────┘         │ Staging │         │  (if main)     │
                    └─────────┘         └───────┬────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                           ┌───success──┤ Verification  │
                           │            └───────────────┘
                           │                    │
                           │                    │failure
                           ▼                    ▼
                ┌────────────────────┐   ┌─────────────┐
                │ Promote to Stable  │   │  Rollback   │
                └────────────────────┘   └─────────────┘
```

### Branching Strategy

| Branch | Purpose | Deployment Target | Auto-Deploy |
|--------|---------|-------------------|------------|
| `dev`  | Development work, feature integration | Staging | Yes, on push |
| `main` | Production code | Production (canary) | Yes, on push |
| Feature branches | Individual feature development | None | No |

### Workflow Files

The pipeline consists of the following workflow files:

1. **ci-cd-pipeline.yml**: Main workflow orchestrator
2. **build-docker.yml**: Builds and pushes Docker images
3. **deploy-staging.yml**: Deploys to staging
4. **deploy-live-canary.yml**: Deploys canary release to production
5. **promote-canary.yml**: Promotes canary to stable
6. **rollback.yml**: Rolls back to previous stable version if needed

#### Pipeline Orchestration (`ci-cd-pipeline.yml`)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches:
      - main
      - dev
  workflow_dispatch: {}

jobs:
  # First build the Docker image
  build:
    uses: ./.github/workflows/build-docker.yml

  # If dev branch, deploy to staging
  deploy-staging:
    needs: build
    uses: ./.github/workflows/deploy-staging.yml
    secrets: inherit
    if: github.ref == 'refs/heads/dev'

  # If main branch, deploy canary to production
  deploy-live-canary:
    needs: build
    uses: ./.github/workflows/deploy-live-canary.yml
    secrets: inherit
    if: github.ref == 'refs/heads/main'

  # If canary deployment succeeds, promote to stable
  promote-canary:
    needs: deploy-live-canary
    uses: ./.github/workflows/promote-canary.yml
    secrets: inherit
    if: github.ref == 'refs/heads/main'

  # If canary deployment fails, rollback
  rollback:
    if: failure() && github.ref == 'refs/heads/main'
    needs: deploy-live-canary
    secrets: inherit
    uses: ./.github/workflows/rollback.yml
```

### Docker Images

| Image Tag | Purpose | Source Branch |
|-----------|---------|--------------|
| `ghcr.io/<repo>:staging-latest` | Staging deployment | `dev` |
| `ghcr.io/<repo>:live-latest` | Production stable | `main` (after promotion) |
| `ghcr.io/<repo>:live-<commit-sha>` | Production canary | `main` (before promotion) |
| `ghcr.io/<repo>:live-backup-<timestamp>` | Backup version | Prior stable version |

## Deployment Process

### Staging Deployment

The staging deployment process:

1. Validates required secrets
2. Copies application files to the staging server
3. Creates or updates the `.env` file with staging configuration
4. Creates a Docker Compose override file to use the staging image
5. Pulls the latest staging image from GitHub Container Registry
6. Deploys the application using Docker Compose
7. Performs a health check to verify deployment

#### Environment URLs

| Environment | URL | Notes |
|-------------|-----|-------|
| Local Development | http://localhost:3000 | Running via Docker Compose |
| Staging | http://staging-server-address | 100% of traffic gets latest `dev` code |
| Production | http://production-server-address | Canary receives 20% of traffic initially |

### Production Deployment

Production deployment uses a canary release strategy implemented in two phases:

#### Canary Deployment Strategy

The canary deployment process:

1. Validates required secrets
2. Copies application files to the production server
3. Creates or updates the `.env` file with production configuration
4. Pulls both stable and canary Docker images
5. Creates a Docker Compose override file defining both services
6. Deploys Redis, Sentinels, monitoring, and both application versions
7. Configures Nginx to split traffic between stable (80%) and canary (20%)
8. Performs health checks to verify deployment

##### How Canary Deployment Works

1. When you push to `main`, a new image is built with tag `live-<commit-sha>`
2. This canary version receives 20% of production traffic
3. The stable version (`live-latest`) continues to serve 80% of traffic
4. After verification, canary is promoted to stable automatically

##### Nginx Configuration for Canary

The canary deployment uses Nginx's `split_clients` directive to route traffic:

```nginx
# Split traffic between stable and canary based on a random number
split_clients "${remote_addr}${time_iso8601}" $upstream {
    20%   nextjs_canary;
    *     nextjs_stable;
}
```

### Promotion and Rollback Processes

#### Promotion Process

After successful verification, the canary is promoted:

1. Records deployment details for auditing
2. Creates a backup of the current stable image
3. Tags the canary image as the new stable version
4. Updates Nginx to direct all traffic to the stable version
5. Cleans up the canary container
6. Performs health checks to verify the promotion

#### Manual Promotion

If automatic promotion is disabled:

1. Go to GitHub Actions
2. Find the latest workflow run
3. Manually run the `promote-canary` workflow

#### Rollback Process

If the canary deployment fails:

1. Records rollback details for auditing
2. Updates Nginx to direct all traffic back to the stable version
3. Stops and removes the canary container
4. Ensures the stable version is running correctly
5. Notifies about the rollback event

#### Dealing with Failed Canary

If a canary deployment fails:

1. Automatic rollback will trigger
2. Check logs for the reason:
   ```bash
   ssh user@production-server
   cd ~/app
   cat rollback-*.log
   ```
3. Fix the issue in your code
4. Push new changes to `dev` and test thoroughly before trying again on `main`

## Redis High Availability Cluster

### Redis Cluster Architecture

The Redis architecture follows Redis's master-slave replication with Redis Sentinel for automatic failover:

#### Components

- **Redis Master**: Primary node handling all write operations
- **Redis Slaves (1-4)**: Replicas providing read scalability and redundancy
- **Redis Sentinel**: Monitoring system for automatic failover
- **Redis Backup**: Dedicated service for regular backups

### Data Flow and Replication

#### Normal Operation

1. **Write Operations**:
   - Application sends write commands to Redis master
   - Master processes and persists the data
   - Master asynchronously replicates data to all slaves

2. **Read Operations**:
   - Application can read from any slave node
   - Read operations are distributed for load balancing
   - Master can also handle reads if needed

3. **Replication Process**:
   - Slaves maintain a connection to the master
   - Initial sync: Full dataset copied from master to slave
   - Ongoing sync: Master sends command stream to slaves
   - Slaves apply commands to maintain data consistency

### Failover Process

#### Sentinel Monitoring

1. **Health Checking**:
   - Each Sentinel continuously pings the master and slaves
   - Sentinels communicate with each other to share health information
   - `REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS` (10,000ms) determines failure detection threshold

2. **Failure Detection**:
   - If a Sentinel cannot reach the master, it marks it as subjectively down (SDOWN)
   - Sentinels communicate this state to other Sentinels
   - If a quorum of Sentinels agree, the master is marked as objectively down (ODOWN)

#### Sentinel Failover

1. **Leader Election**:
   - Sentinels elect a leader among themselves to coordinate the failover
   - Election uses Raft-based algorithm for consensus

2. **Master Selection**:
   - The leader Sentinel selects the most suitable slave to promote
   - Considers priority, replication offset, and running ID

3. **Promotion and Reconfiguration**:
   - Selected slave becomes a master
   - Other slaves replicate from the new master
   - Sentinels update their configuration

### Redis to Google Drive Backups

#### Setup Instructions

1. **Prepare Configuration Files**:
   - Create directory structure with backup, config, and scripts folders
   - Add the Dockerfile.redis-backup and backup.sh script

2. **Configure rclone for Google Drive Access**:
   ```bash
   mkdir -p config/rclone
   rclone config --config=config/rclone/rclone.conf
   ```
   - Set up a new remote named "gdrive"
   - Test with `rclone lsd gdrive: --config=config/rclone/rclone.conf`

3. **Environment Variables**:
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

#### Monitoring and Troubleshooting

1. **Monitor Backup Logs**:
   ```bash
   docker logs -f $(docker ps -q -f name=redis-backup)
   ```

2. **Verify Backups**:
   ```bash
   # Local backups
   ls -la backup/
   
   # Google Drive backups
   rclone ls gdrive:redis-backups --config=config/rclone/rclone.conf
   ```

3. **Troubleshooting Google Drive Connection**:
   ```bash
   # Verify rclone configuration
   rclone config show --config=config/rclone/rclone.conf
   
   # Test connectivity
   rclone lsd gdrive: --config=config/rclone/rclone.conf
   
   # Refresh authentication
   rclone config reconnect gdrive: --config=config/rclone/rclone.conf
   ```

## Local Development Environment

### Prerequisites

Before you begin, ensure you have the following installed:

- Docker (20.10.x or later)
- Docker Compose (2.x or later)
- Git
- Node.js (recommended, for running npm/yarn commands directly)

### Configuration

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd <project-directory>
   ```

2. **Create Environment File**:
   ```bash
   cp .env.example .env  # If .env.example exists
   ```

   Or create the `.env` file manually with required variables:
   ```
   # Development Mode
   NODE_ENV=development
   NEXT_PUBLIC_ISDEV=true
   
   # Application
   APP_PORT=3000
   
   # Redis Configuration for Development
   REDIS_HOST_DEV=157.230.253.3
   REDIS_SENTINELS_DEV=157.230.253.3:26379,157.230.253.3:26380,157.230.253.3:26381
   REDIS_PORT=6379
   
   # Redis Credentials
   REDIS_MASTER_NAME=mymaster
   REDIS_PASSWORD=your_redis_password
   REDIS_SENTINEL_PASSWORD=your_redis_password
   REDIS_SENTINEL_QUORUM=2
   
   # Redis Ports for Local Development
   REDIS_MASTER_PORT=6379
   REDIS_SLAVE_1_PORT=6380
   REDIS_SLAVE_2_PORT=6381
   REDIS_SLAVE_3_PORT=6382
   REDIS_SLAVE_4_PORT=6383
   
   # Sentinel Ports
   SENTINEL_1_PORT=26379
   SENTINEL_2_PORT=26380
   SENTINEL_3_PORT=26381
   ```

### Running the Application

1. **Start Development Environment**:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
   ```

2. **Verify Running Containers**:
   ```bash
   docker-compose ps
   ```

3. **Access the Application**:
   ```
   http://localhost:3000
   ```

### Development Workflow (Local)

1. **Create Feature Branch**:
   ```bash
   git checkout dev
   git pull
   git checkout -b feature/your-feature-name
   ```

2. **Develop and Test Locally**:
   ```bash
   # Start local Docker environment
   docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
   ```

3. **View Application Logs**:
   ```bash
   docker-compose logs -f app
   ```

4. **Making Code Changes**:
   The development environment is configured with volume mounts, so changes to your source code will be reflected immediately.

5. **Installing New Dependencies**:
   ```bash
   # Stop the containers
   docker-compose down
   
   # Rebuild the containers
   docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d --build
   ```

6. **Push Changes to Feature Branch**:
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin feature/your-feature-name
   ```

7. **Create Pull Request to `dev`**:
   - Create PR through GitHub interface
   - Ensure tests pass and code review is completed

## Developer's Guide

### Day-to-Day Operations

#### Development Workflow

1. **Create Feature Branch**: 
   ```bash
   git checkout dev
   git pull
   git checkout -b feature/your-feature-name
   ```

2. **Develop and Test Locally**:
   ```bash
   # Start local Docker environment
   docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
   ```

3. **Push Changes to Feature Branch**:
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin feature/your-feature-name
   ```

4. **Create Pull Request to `dev`**: 
   - Create PR through GitHub interface
   - Ensure tests pass and code review is completed

5. **Merge to `dev`**: 
   - Merge PR to `dev` branch
   - CI/CD pipeline automatically deploys to staging

6. **Promote to Production**:
   - Create PR from `dev` to `main`
   - Merge PR to `main`
   - CI/CD pipeline automatically deploys canary to production

### Common Tasks

#### Adding New Environment Variables

1. Add to your local `.env` file for testing
2. Add to GitHub repository secrets
3. Update workflow files that need access to the variable:
   - `deploy-staging.yml` for staging
   - `deploy-live-canary.yml` for production

#### Testing Canary Manually

To specifically hit the canary version:

1. SSH to the production server
2. Access the canary directly:
   ```bash
   curl http://localhost:3002/health
   ```

#### Redeploying Last Successful Build

For staging:
```bash
# Force workflow execution on dev branch
git checkout dev
git commit --allow-empty -m "Force redeploy to staging"
git push
```

For production:
```bash
# Force workflow execution on main branch
git checkout main
git commit --allow-empty -m "Force redeploy to production"
git push
```

### Troubleshooting

#### Deployment Failures

1. Check GitHub Actions logs for errors
2. Verify server connection and SSH keys
3. Check Docker and Docker Compose installation on server
4. Examine server resources (disk space, memory)

#### Container Issues

If containers are crashing:
```bash
# Check container status
docker-compose ps

# Check container logs
docker-compose logs app-stable
docker-compose logs app-canary

# Check for resource constraints
docker stats
```

#### Nginx Issues

If traffic routing is not working correctly:
```bash
# Check Nginx configuration
sudo nginx -t

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

#### Redis Connection Issues

Verify Redis is running and accessible:
```bash
docker-compose exec app ping redis-master
```

To connect to the Redis master:
```bash
docker-compose exec redis-master redis-cli -a your_redis_password
```

Redis commands:
```bash
# Check replication status
info replication

# List keys
keys *

# Monitor Redis operations in real-time
monitor
```

To connect to a Sentinel instance:
```bash
docker-compose exec sentinel-1 redis-cli -p 26379
```

Sentinel commands:
```bash
# Check master status
sentinel master mymaster

# List slaves
sentinel slaves mymaster

# List sentinels
sentinel sentinels mymaster
```

## Monitoring and Maintenance

### Monitoring Deployments

#### Staging Deployments

1. Check GitHub Actions workflow status for `deploy-staging` job
2. SSH to staging server and check logs:
   ```bash
   ssh user@staging-server
   cd ~/app
   docker-compose logs -f app
   ```

#### Production Deployments

1. Check GitHub Actions workflow status for `deploy-live-canary` job
2. Monitor canary performance:
   ```bash
   ssh user@production-server
   cd ~/app
   docker-compose logs -f app-canary
   ```
3. Check Nginx logs for traffic distribution:
   ```bash
   sudo tail -f /var/log/nginx/access.log | grep "X-Version"
   ```

### Security Best Practices

1. **Restrict SSH access** to your droplets by updating the allowed IPs
2. **Use unique projects** for different applications or environments
3. **Regular updates** to keep your Terraform version and OS images updated
4. **Protect sensitive data** with encryption before uploading to Google Drive
5. **Use service accounts** instead of personal Google accounts for production environments
6. **Implement GDPR/compliance features** with proper data retention policies

### Cost Management

1. **Monitor resources** via the Digital Ocean dashboard
2. **Destroy unused resources** when no longer needed
3. **Right-size droplets** based on actual usage metrics

### Backup Verification

Periodically verify backup integrity:
1. Create a verification script that downloads and checks backups
2. Schedule it to run weekly using a separate container or cron job
