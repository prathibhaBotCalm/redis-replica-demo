# Local Development Environment Documentation

This guide provides instructions for setting up and running the application in a local development environment using Docker.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Configuration](#configuration)
4. [Running the Application](#running-the-application)
5. [Development Workflow](#development-workflow)
6. [Using Redis](#using-redis)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have the following installed on your development machine:

- Docker (20.10.x or later)
- Docker Compose (2.x or later)
- Git
- Node.js (recommended, for running npm/yarn commands directly)

## Initial Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd <project-directory>
```

### 2. Create Environment File

Create a `.env` file in the project root by copying the example:

```bash
cp .env.example .env  # If .env.example exists
```

Or create the `.env` file manually with the required variables (see [Configuration](#configuration) section).

## Configuration

### Essential Environment Variables for Development

Edit your `.env` file to include these important settings:

```bash
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

You can keep the default Redis password for local development, but ensure you're using a secure password in shared development environments.

### Service URLs for Development

The following URLs are already configured in the `.env` file for local development:

```bash
NEXT_PUBLIC_AGGREGATE__SERVICE="http://localhost:3001"
NEXT_PUBLIC_ADMIN__SERVICE="http://localhost:3001"
LOCKER_DASHBOARD_SERVICE='http://localhost:3001'
NEXT_PUBLIC_WALLET__SERVICE="http://localhost:3001"
NEXT_PUBLIC_DEV_DASHBOARD__SERVICE="http://localhost:3001"
NEXT_PUBLIC_PAW_COMPILER_SERVICE='http://localhost:3001'
```

## Running the Application

### Start Development Environment

To start the application with hot-reloading:

```bash
docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
```

This command:

1. Uses the development Docker file (`Dockerfile.dev`)
2. Mounts your local source code for hot-reloading
3. Exposes the application on the configured port (default: 3000)
4. Starts Redis with the development configuration
5. Sets up Redis Sentinel for high availability

### Verify Running Containers

Check if all containers are running properly:

```bash
docker-compose ps
```

You should see containers for:

- app (Next.js application)
- redis-master
- redis-slave-1, redis-slave-2, redis-slave-3, redis-slave-4
- sentinel-1, sentinel-2, sentinel-3
- redis-backup

### Access the Application

Once the containers are up and running, access your application at:

```
http://localhost:3000
```

## Development Workflow

### View Application Logs

To see real-time logs from the application:

```bash
docker-compose logs -f app
```

For Redis logs:

```bash
docker-compose logs -f redis-master
```

### Making Code Changes

The development environment is configured with volume mounts, so changes to your source code will be reflected immediately. The Next.js development server will automatically reload when files change.

### Installing New Dependencies

If you add new dependencies to your project:

```bash
# Stop the containers
docker-compose down

# Rebuild the containers
docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d --build
```

### Stopping the Environment

To stop all containers:

```bash
docker-compose down
```

To remove all containers and volumes (will delete Redis data):

```bash
docker-compose down -v
```

## Using Redis

### Redis Structure

The development environment includes:

- 1 Redis master
- 4 Redis replicas (slaves)
- 3 Sentinel instances for high availability

### Connecting to Redis CLI

To connect to the Redis master:

```bash
docker-compose exec redis-master redis-cli -a your_redis_password
```

### Redis Commands

Some useful Redis commands:

```bash
# Check replication status
info replication

# List keys
keys *

# Monitor Redis operations in real-time
monitor

# Check Redis memory usage
info memory
```

### Redis Sentinel

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

## Troubleshooting

### Common Issues

#### Application Container Exits Immediately

Check the application logs:

```bash
docker-compose logs app
```

Common causes:

- Missing environment variables
- Redis connection issues
- Build errors

#### Redis Connection Issues

Verify Redis is running and accessible:

```bash
docker-compose exec app ping redis-master
```

#### Hot-Reload Not Working

If code changes are not being detected:

1. Verify the volume mounts in `docker-compose.override.yml`
2. Check for file permission issues
3. Restart the development containers:

   ```bash
   docker-compose restart app
   ```

#### Memory or Performance Issues

If Docker is consuming too much memory:

1. Review resource limits in Docker Desktop settings
2. Clean up unused Docker resources:

   ```bash
   docker system prune
   ```

### Reset Development Environment

For a complete reset:

```bash
# Stop and remove containers, networks, and volumes
docker-compose down -v

# Remove unused Docker resources
docker system prune

# Restart environment
docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
```

---

## Quick Reference

### Start Development Environment

```bash
docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
```

### View Logs

```bash
docker-compose logs -f app
```

### Rebuild After Changes to Docker Configuration

```bash
docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d --build
```

### Stop Environment

```bash
docker-compose down
```
