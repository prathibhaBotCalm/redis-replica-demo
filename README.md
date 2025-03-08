# Next.js with Redis HA (High Availability)

This project demonstrates a robust Next.js application with Redis High Availability using Redis Sentinel for automatic failover. It includes comprehensive monitoring with Prometheus and Grafana, as well as a canary deployment system.

## Features

- **Next.js Application**: Modern React application with server-side rendering
- **Redis High Availability**: Redis Sentinel setup with automatic master-slave failover
- **Redis Object Mapping**: Persistent data storage using Redis-OM
- **CI/CD Pipeline**: GitHub Actions workflow for continuous integration and deployment
- **Canary Deployments**: Gradual rollout of new versions with automated promotion/rollback
- **Monitoring**: Prometheus metrics and Grafana dashboards
- **Containerization**: Docker-based deployment with Docker Compose

## Architecture

The application uses a Redis Sentinel architecture for high availability:

- 1 Redis master node
- 4 Redis replica (slave) nodes
- 3 Redis Sentinel nodes monitoring the cluster
- Automatic failover when the master becomes unavailable
- Resilient connection management to handle master changes

![Redis HA Architecture](docs/redis-ha-architecture.png)

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- Git

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/prathibhaBotCalm/redis-replica-demo.git
   cd redis-replica-demo
   ```

2. Create a `.env` file based on the provided example:
   ```bash
   cp .env.example .env
   ```

3. Start the application in development mode:
   ```bash
   docker-compose --profile development up -d
   ```

4. Access the application at http://localhost:3000

## Environment Configuration

The application supports different environments through the `.env` file:

```
# Next.js Application
APP_PORT=3000

# Redis Configuration
REDIS_SENTINELS_DEV=157.230.253.3:26379,157.230.253.3:26380,157.230.253.3:26381
REDIS_SENTINELS_PROD=sentinel-1:26379,sentinel-2:26380,sentinel-3:26381
REDIS_HOST_DEV=157.230.253.3
REDIS_HOST_PROD=redis-master
REDIS_PORT=6379
REDIS_MASTER_NAME=mymaster
REDIS_PASSWORD=your_redis_password
REDIS_SENTINEL_PASSWORD=your_redis_password
REDIS_SENTINEL_QUORUM=2

# Set to "true" for development environment
IS_DEV=false

# Canary Deployment Settings
CANARY_WEIGHT=20
```

## Deployment Environments

### Development

```bash
docker-compose --profile development up -d
```

This starts a local development environment with:
- Next.js application with hot-reloading
- Redis master, replicas, and sentinels
- No monitoring stack (for improved performance)

### Production

```bash
docker-compose --profile production up -d
```

This starts a full production environment with:
- Next.js application optimized for production
- Redis HA cluster with automatic failover
- Prometheus and Grafana monitoring
- Redis exporters for detailed metrics

## Redis Failover Management

The application includes a robust connection manager that handles Redis master failover events:

1. Sentinel monitors Redis master health
2. If master fails, sentinel promotes a replica to become the new master
3. The connection manager detects the master change and reconnects automatically
4. Application continues normal operation with minimal disruption

## Monitoring

### Prometheus

Access Prometheus at http://localhost:9090

### Grafana

Access Grafana at http://localhost:3005

Default credentials:
- Username: `admin`
- Password: `admin`

Pre-configured dashboards include:
- Redis Master/Replica status
- Redis performance metrics
- Application metrics
- Node.js runtime metrics

## CI/CD Pipeline

The project includes a GitHub Actions pipeline for CI/CD:

1. Code quality and testing
2. Docker image build
3. Staging deployment
4. Canary production deployment
5. Canary promotion or rollback

## Canary Deployments

The system supports canary deployments for safe production releases:

1. New version deployed alongside existing version
2. Traffic split according to CANARY_WEIGHT setting
3. Monitoring for errors in the canary version
4. Automatic or manual promotion when stable
5. Automatic rollback if issues detected

## Backup and Recovery

The Redis data is automatically backed up:

1. Periodic RDB snapshots stored in `./backup` directory
2. Backup rotation to prevent disk space issues
3. Automatic recovery from latest backup during startup

## Troubleshooting

### Redis Connection Issues

If you experience connection issues after a Redis failover:

1. Check Redis Sentinel logs:
   ```bash
   docker-compose logs sentinel-1 sentinel-2 sentinel-3
   ```

2. Verify the current Redis master:
   ```bash
   docker-compose exec sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
   ```

3. Check application logs for connection errors:
   ```bash
   docker-compose logs app
   ```

### Monitoring Stack Issues

If Grafana or Prometheus is not accessible:

1. Verify the services are running:
   ```bash
   docker-compose ps prometheus grafana
   ```

2. Check logs for any errors:
   ```bash
   docker-compose logs prometheus grafana
   ```

## License

[MIT](LICENSE)