#!/bin/bash

echo "===== Traefik Debugging Script ====="
echo "Checking Docker containers..."
docker ps

echo -e "\n===== Checking networks ====="
docker network ls | grep -E 'redis-network|monitoring-network'

echo -e "\n===== Network inspection - redis-network ====="
docker network inspect redis-network

echo -e "\n===== Network inspection - monitoring-network ====="
docker network inspect monitoring-network

echo -e "\n===== Traefik logs ====="
TRAEFIK_CONTAINER=$(docker ps -q -f name=traefik)
if [ -n "$TRAEFIK_CONTAINER" ]; then
  docker logs $TRAEFIK_CONTAINER | tail -50
else
  echo "Traefik container not found!"
fi

echo -e "\n===== Checking Traefik providers ====="
if [ -n "$TRAEFIK_CONTAINER" ]; then
  echo "Checking Docker provider..."
  curl -s http://localhost:8080/api/rawdata | jq . || echo "jq not installed, showing raw output" && curl -s http://localhost:8080/api/rawdata
else
  echo "Traefik container not found!"
fi

echo -e "\n===== Testing connections ====="
echo "Testing connection to app on port 3000..."
curl -v -H "Host: ${DROPLET_IP}" http://localhost:3000 2>&1 | head -20

echo -e "\nTesting connection to app on port 80..."
curl -v -H "Host: ${DROPLET_IP}" http://localhost 2>&1 | head -20

echo -e "\n===== Checking IP resolution ====="
echo "Your machine resolves ${DROPLET_IP} to:"
ping -c 1 ${DROPLET_IP} || echo "Cannot ping ${DROPLET_IP}"

echo -e "\n===== Checking .env file ====="
echo "Contents of .env (redacting sensitive info):"
grep -v "PASSWORD\|SECRET\|KEY" .env || echo ".env file not found"

echo -e "\n===== Checking .env.deployment file ====="
echo "Contents of .env.deployment (redacting sensitive info):"
grep -v "PASSWORD\|SECRET\|KEY" .env.deployment || echo ".env.deployment file not found"

echo -e "\n===== Checking if APP_PORT is properly set ====="
APP_PORT=$(grep APP_PORT .env 2>/dev/null || echo "APP_PORT not found in .env")
echo $APP_PORT
APP_PORT_DEPLOYMENT=$(grep APP_PORT .env.deployment 2>/dev/null || echo "APP_PORT not found in .env.deployment")
echo $APP_PORT_DEPLOYMENT

echo "===== End of Debugging Info ====="