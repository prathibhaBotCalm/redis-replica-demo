# Redis High Availability Cluster Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [Data Flow](#data-flow)
4. [High Availability & Failover](#high-availability--failover)
5. [Backup & Recovery](#backup--recovery)
6. [Network Configuration](#network-configuration)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)
9. [Scaling Considerations](#scaling-considerations)
10. [Appendix: Configuration Details](#appendix-configuration-details)

## Architecture Overview

This document describes a highly available Redis cluster implemented using Docker Compose. The architecture follows Redis's recommended master-slave replication with Redis Sentinel for automatic failover.

![Redis Architecture Overview](redis-architecture.png)

### Key Features

- **High Availability**: Automatic failover with Redis Sentinel
- **Scalability**: Read operations distribution across multiple slave nodes
- **Data Persistence**: Regular backups for disaster recovery
- **Monitoring**: Prometheus and Grafana integration (optional)

## Components

### Redis Master

The Redis master is the primary node in the cluster responsible for:

- Handling all write operations
- Replicating data to slave nodes
- Maintaining data persistence

**Configuration Details:**

- Uses `redis/redis-stack:latest` image
- Custom initialization via `init-master.sh`
- Health check configured to verify Redis server availability
- Persistent volume for data storage
- Backup volume mounted

### Redis Slaves (1-4)

Slave nodes provide:

- Read scalability
- Data redundancy
- Failover candidates

**Configuration Details:**

- Use `redis/redis-stack:latest` image
- Initialize with custom `init-slave.sh` script
- Connect to master during startup
- Each slave exposes Redis on a different port

### Redis Sentinel

The Sentinel system provides:

- Monitoring of master and slave nodes
- Automatic failover coordination
- Client notifications of topology changes

**Configuration Details:**

- 3 Sentinel instances for quorum-based decisions
- Configured with `bitnami/redis-sentinel:latest` image
- Set to monitor the Redis master
- Failover quorum defined by `REDIS_SENTINEL_QUORUM`
- Failover timeout set to 180,000ms

### Redis Backup

A dedicated service for:

- Regular backup of Redis data
- Storage of backups in a separate volume

### Application

The main application that:

- Connects to the Redis cluster
- Uses Redis for data storage and retrieval
- Must handle Redis failover events

## Data Flow

### Normal Operation

![Normal Operation Data Flow](normal-operation-flow.png)

1. **Write Operations**:

   - Application sends write commands to the Redis master
   - Master processes and persists the data
   - Master asynchronously replicates data to all slaves

2. **Read Operations**:

   - Application can read from any slave node
   - Read operations are distributed for load balancing
   - Master can also handle reads if needed

3. **Replication Process**:
   - Slaves maintain a connection to the master
   - Initial sync: Full dataset is copied from master to slave
   - Ongoing sync: Master sends command stream to slaves
   - Slaves apply commands to maintain data consistency

## High Availability & Failover

### Sentinel Monitoring

![Sentinel Monitoring](sentinel-monitoring.png)

1. **Health Checking**:

   - Each Sentinel continuously pings the master and slaves
   - Sentinels communicate with each other to share health information
   - `REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS` (10,000ms) determines failure detection threshold

2. **Failure Detection**:
   - If a Sentinel cannot reach the master, it marks it as subjectively down (SDOWN)
   - Sentinels communicate this state to other Sentinels
   - If a quorum (defined by `REDIS_SENTINEL_QUORUM`) of Sentinels agree, the master is marked as objectively down (ODOWN)

### Failover Process

![Failover Process](failover-process.png)

1. **Leader Election**:

   - Sentinels elect a leader among themselves to coordinate the failover
   - Election uses Raft-based algorithm for consensus

2. **Master Selection**:

   - The leader Sentinel selects the most suitable slave to promote:
     - Priority (if configured)
     - Replication offset (most up-to-date slave)
     - Running ID (as a tiebreaker)

3. **Promotion and Reconfiguration**:

   - Selected slave is instructed to stop replication and become a master
   - Other slaves are reconfigured to replicate from the new master
   - Sentinels update their configuration to monitor the new master

4. **Client Notification**:
   - Sentinels inform clients of the new master address
   - Clients with Sentinel-aware libraries reconnect to the new master

### Recovery Timeline

Typical failover timeline:

- 0-10s: Failure detection (based on `REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS`)
- 10-11s: Sentinel leader election
- 11-12s: Master selection
- 12-15s: Promotion and reconfiguration
- Total: ~15 seconds from failure to complete recovery

## Backup & Recovery

### Backup Process

The dedicated backup service:

- Executes regular backups via `backup.sh`
- Creates RDB snapshots of the Redis database
- Stores backups in the `/backup` directory
- Can be scheduled as needed

### Recovery Options

1. **Point-in-Time Recovery**:

   - Stop Redis master service
   - Replace RDB file with backup
   - Restart Redis master
   - Slaves will automatically sync from master

2. **Full Cluster Rebuild**:
   - Stop all Redis services
   - Clear all Redis data volumes except backup
   - Restore backup to master data directory
   - Start master, then slaves and sentinels

## Network Configuration

### Network Topology

![Network Configuration](network-topology.png)

This setup uses two Docker networks:

- **redis-network**: Internal communication between Redis components
- **monitoring-network**: Connects monitoring tools with Redis components

### Service Discovery

- Redis services discover each other using Docker DNS
- Sentinel announces itself using `REDIS_SENTINEL_ANNOUNCE_HOSTNAMES=yes`
- Services reference each other by container name

### Port Mapping

All services expose their ports to the host system:

- Redis Master: `${REDIS_MASTER_PORT}:6379`
- Redis Slaves: `${REDIS_SLAVE_*_PORT}:6379`
- Sentinels: `${SENTINEL_*_PORT}:26379`

## Security Considerations

### Authentication

- Redis authentication is enabled using `REDIS_PASSWORD`
- All nodes (master, slaves, sentinels) use the same password
- Client connections must provide this password

### Network Isolation

- Redis components are isolated in their own network
- Only necessary ports are exposed to the host

### Data Protection

- Redis persistence ensures data is not lost during restarts
- Regular backups protect against data corruption
- Encrypted backups should be considered for sensitive data

## Troubleshooting

### Common Issues

1. **Replication Lag**:

   - Monitor slave replication with `INFO REPLICATION`
   - Check network between master and lagging slaves
   - Consider reducing write load if lag persists

2. **Failed Failover**:

   - Verify Sentinel quorum is properly set
   - Check Sentinel logs for election issues
   - Ensure network connectivity between Sentinels

3. **Split-Brain Scenario**:
   - Can occur if network partition separates Sentinels
   - Always use odd number of Sentinels across availability zones
   - Monitor for multiple masters and reconcile manually if needed

### Monitoring Commands

**Master Status**:

```
redis-cli -h redis-master -a ${REDIS_PASSWORD} INFO REPLICATION
```

**Sentinel Status**:

```
redis-cli -h sentinel-1 -p 26379 -a ${REDIS_PASSWORD} SENTINEL MASTER ${REDIS_MASTER_NAME}
```

**Slave Sync Status**:

```
redis-cli -h redis-slave-1 -a ${REDIS_PASSWORD} INFO REPLICATION
```

## Scaling Considerations

### Read Scaling

- Add more slave nodes for increased read capacity
- Update Docker Compose file with new slave definitions
- No downtime required as slaves can be added dynamically

### Write Scaling

Redis master-slave architecture has these write scaling options:

- Vertical scaling: Increase master resources
- Sharding: Split data across multiple Redis instances
- Redis Cluster: Native sharding (requires architecture change)

### Geographic Distribution

- Place slaves in different regions for local reads
- Configure higher timeout values for cross-region replication
- Consider regional Redis clusters with cross-region replication

## Appendix: Configuration Details

### init-master.sh

The master initialization script typically:

- Sets Redis password
- Configures persistence settings
- Enables AOF if needed
- Sets memory limits

### init-slave.sh

The slave initialization script:

- Configures replication from master
- Sets read-only mode
- Establishes authentication

### Sentinel Configuration

Key Sentinel parameters:

- `REDIS_SENTINEL_QUORUM`: Number of Sentinels that must agree to trigger failover
- `REDIS_SENTINEL_DOWN_AFTER_MILLISECONDS`: Time to mark node as down
- `REDIS_SENTINEL_FAILOVER_TIMEOUT`: Time before another failover can be attempted

### Environment Variables

Key environment variables used:

- `REDIS_PASSWORD`: Authentication for all Redis instances
- `REDIS_MASTER_NAME`: Name to identify the master in Sentinel
- `REDIS_SENTINEL_QUORUM`: Failover consensus threshold
- Port mappings for all services
