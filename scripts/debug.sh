#!/bin/bash

# Deploy with simplified setup first
echo "===== Deploying with simplified configuration ====="
docker-compose -f docker-compose.yml down
docker-compose -f docker-compose.yml up -d app

echo "===== Waiting 30 seconds for app to initialize ====="
sleep 30

echo "===== Deploying Traefik ====="
docker-compose -f docker-compose.yml -f docker-compose.canary.yml up -d traefik

echo "===== Checking if app is healthy ====="
docker ps | grep app-app

echo "===== Checking Traefik logs ====="
docker logs app-traefik-1

echo "===== Testing direct access to app ====="
curl -v http://localhost:3000

echo "===== Testing access through Traefik ====="
curl -v http://localhost:80

echo "===== Viewing Traefik router configuration ====="
curl -s http://localhost:8080/api/http/routers | jq .

echo "===== Viewing Traefik services configuration ====="
curl -s http://localhost:8080/api/http/services | jq .

echo "===== Checking environment variables ====="
docker exec app-app-1 env | grep APP_PORT
docker exec app-traefik-1 env | grep DROPLET

echo "===== Testing direct container communication ====="
docker exec app-traefik-1 wget -q -O- app-app-1:3000 || echo "Failed to connect directly"