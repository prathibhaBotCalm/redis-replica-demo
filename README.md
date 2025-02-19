# 🚀 Dockerized Next.js & Redis Setup

This repository provides a **Docker Compose setup** for a Next.js application using Redis with Sentinel for high availability. It supports both **development** and **production** environments.

---

## 📂 Folder Structure
```
.
├── docker-compose.yml          # Base configuration
├── docker-compose.override.yml # Development overrides (hot-reloading)
├── docker-compose.prod.yml     # Production optimizations
├── .env                        # Environment variables (create manually)
├── Dockerfile                  # Multi-stage Dockerfile
├── backup/
│   └── dump.rdb                 # Redis backup data
└── init-master.sh               # Redis master initialization script
```

---

## ⚙️ Setup & Configuration

### 1️⃣ **Create an `.env` file** (if not already present)
Copy the following into `.env` and update values as needed:

```ini
# Next.js Application
NODE_ENV=production
APP_PORT=3000

# Redis Configuration
REDIS_MASTER_NAME=mymaster
REDIS_PASSWORD=your_redis_password
REDIS_SENTINEL_QUORUM=2

# Sentinel Ports
SENTINEL_1_PORT=26379
SENTINEL_2_PORT=26380
SENTINEL_3_PORT=26381

# Redis Ports
REDIS_MASTER_PORT=6379
REDIS_SLAVE_1_PORT=6380
REDIS_SLAVE_2_PORT=6381
```

---

## 🚀 Running the Application

### **Development Mode** (Hot-Reloading)
```sh
docker-compose up --build
```
- Uses `docker-compose.override.yml`
- Runs `yarn dev` for fast development
- Mounts local files for live changes

### **Production Mode** (Optimized for Deployment)
```sh
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```
- Uses `docker-compose.prod.yml`
- Runs `yarn start` with minimal resource usage
- Applies **CPU & memory limits**

### **Stopping Services**
```sh
docker-compose down
```
Stops and removes containers.

---

## 🏗️ Dockerfile Structure
This setup uses a **multi-stage Dockerfile** for efficient builds:
1. **Base Stage** → Installs dependencies.
2. **Development Stage** → Runs `yarn dev` with live reload.
3. **Build Stage** → Compiles the Next.js app.
4. **Production Stage** → Copies necessary files for deployment.

---

## 🛠️ Managing Redis
### **Check Redis Master Health**
```sh
docker exec -it <redis-master-container-id> redis-cli -a your_redis_password ping
```

### **Check Sentinel Status**
```sh
docker exec -it <sentinel-container-id> redis-cli -p 26379 info Sentinel
```

### **Manually Trigger a Failover**
```sh
docker exec -it <sentinel-container-id> redis-cli -p 26379 sentinel failover mymaster
```

---


## 📌 Troubleshooting
### **1️⃣ Cannot Connect to Redis?**
- Ensure `REDIS_PASSWORD` is correctly set in `.env`.
- Run `docker ps` and check if all containers are running.
- Check Redis logs:
  ```sh
  docker logs <redis-master-container-id>
  ```

### **2️⃣ Next.js Not Updating in Dev Mode?**
- Ensure the volume `- .:/app` is correctly mounted.
- Try removing old containers:
  ```sh
  docker-compose down && docker-compose up --build
  ```

---

## 🎯 Summary
- **Development Mode:** `docker-compose up --build`
- **Production Mode:** `docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d`
- **Stop Containers:** `docker-compose down`