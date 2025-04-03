pipeline {
    agent any
    
    environment {
        DOCKER_REGISTRY = "prathibhabotcalm" // Your Docker Hub username
        APP_IMAGE_NAME = "nextjs-app"
        APP_VERSION = "${env.BUILD_NUMBER}"
        GIT_COMMIT_SHORT = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        PROD_TAG = "${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}"
        CANARY_TAG = "${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}-canary"
        CANARY_WEIGHT = "${params.CANARY_WEIGHT ?: 20}" // Default to 20% traffic
        DEPLOY_TIMEOUT = 600 // 10 minutes timeout for deployment validation
        DROPLET_IP = "128.199.87.188" // Your Digital Ocean droplet IP
        DEPLOYMENT_DIR = "/opt/app" // Deployment directory
        NODE_ENV = "production"
        
        // GitHub repository information
        GITHUB_REPOSITORY = "${env.JOB_NAME.split('/')[0]}/${env.JOB_NAME.split('/')[1]}"
    }
    
    parameters {
        choice(name: 'DEPLOYMENT_TYPE', choices: ['canary', 'promote-canary', 'rollback'], description: 'Type of deployment to perform')
        string(name: 'CANARY_WEIGHT', defaultValue: '20', description: 'Percentage of traffic to route to canary (1-99)')
        text(name: 'PROMOTION_REASON', defaultValue: '', description: 'Reason for promoting canary to stable (only for promote-canary)')
        text(name: 'ROLLBACK_REASON', defaultValue: '', description: 'Reason for rolling back canary deployment (only for rollback)')
        string(name: 'REDIS_MAX_ATTEMPTS', defaultValue: '50', description: 'Maximum attempts to wait for Redis readiness')
        string(name: 'REDIS_SLEEP_DURATION', defaultValue: '5', description: 'Sleep duration between Redis readiness checks (in seconds)')
    }
    
    triggers {
        // Poll SCM every minute for changes
        pollSCM('* * * * *')
        
        // GitHub webhook trigger (requires GitHub plugin)
        githubPush()
    }
    
    stages {
        stage('Validate Parameters') {
            steps {
                script {
                    // Validate deployment type
                    if (!['canary', 'promote-canary', 'rollback'].contains(params.DEPLOYMENT_TYPE)) {
                        error "Invalid deployment type. Must be one of: canary, promote-canary, rollback"
                    }
                    
                    // For canary deployment, validate canary weight
                    if (params.DEPLOYMENT_TYPE == 'canary') {
                        def weight = params.CANARY_WEIGHT as Integer
                        if (weight < 1 || weight > 99) {
                            error "Canary weight must be between 1 and 99, got: ${params.CANARY_WEIGHT}"
                        }
                    }
                }
            }
        }
        
        stage('Verify Secrets') {
            steps {
                script {
                    // Different verification approach based on deployment type
                    if (params.DEPLOYMENT_TYPE == 'canary') {
                        // For canary, verify environment secrets for the full deployment
                        sh """
                            for secret in LIVE_HOST LIVE_USER LIVE_SSH_KEY APP_PORT REDIS_MASTER_PORT REDIS_SLAVE_1_PORT REDIS_SLAVE_2_PORT REDIS_SLAVE_3_PORT REDIS_SLAVE_4_PORT SENTINEL_1_PORT SENTINEL_2_PORT SENTINEL_3_PORT REDIS_PASSWORD REDIS_SENTINEL_PASSWORD REDIS_MASTER_NAME REDIS_SENTINEL_QUORUM REDIS_HOST_PROD REDIS_SENTINELS_PROD REDIS_HOST_DEV REDIS_SENTINELS_DEV REDIS_PORT IS_DIRECT_CONNECTION CANARY_WEIGHT; do
                                if [ -z "\${!secret}" ]; then
                                    echo "::error::Secret \$secret is not set"
                                    exit 1
                                fi
                            done
                        """
                    } else {
                        // For promote or rollback, only verify the basic secrets
                        sh """
                            for secret in LIVE_HOST LIVE_USER LIVE_SSH_KEY APP_PORT; do
                                if [ -z "\${!secret}" ]; then
                                    echo "::error::Secret \$secret is not set"
                                    exit 1
                                fi
                            done
                        """
                    }
                }
            }
        }
        
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        
        stage('Record Deployment Details') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'promote-canary' || params.DEPLOYMENT_TYPE == 'rollback' }
            }
            steps {
                script {
                    def logFileName = params.DEPLOYMENT_TYPE == 'promote-canary' ? 'promotion.log' : 'rollback.log'
                    def reason = params.DEPLOYMENT_TYPE == 'promote-canary' ? params.PROMOTION_REASON : params.ROLLBACK_REASON
                    
                    // Create the log file with the same format as GitHub Actions
                    writeFile file: logFileName, text: """
                        ${params.DEPLOYMENT_TYPE == 'promote-canary' ? 'Promotion' : 'Rollback'} triggered by: ${env.USER}
                        Commit SHA: ${env.GIT_COMMIT}
                        ${params.DEPLOYMENT_TYPE == 'promote-canary' ? 'Promotion' : 'Rollback'} reason: ${reason ?: 'Not provided'}
                        Timestamp: ${new Date().format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC'))}
                    """.stripIndent()
                    
                    // Archive the log file (equivalent to actions/upload-artifact)
                    archiveArtifacts artifacts: logFileName, fingerprint: true
                }
            }
        }
        
        stage('Push Docker Image') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'canary' }
            }
            steps {
                withCredentials([usernamePassword(credentialsId: 'docker-registry-credentials', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh "echo ${DOCKER_PASSWORD} | docker login -u ${DOCKER_USER} --password-stdin"
                    sh "docker build -t ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ."
                    sh "docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                    sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
                    sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                }
            }
        }
        
        stage('Deploy Canary') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'canary' }
            }
            steps {
                script {
                    // Execute the canary deployment steps from deploy-live-canary.yml
                    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                        // Copy deploy files to remote server
                        sh "scp -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no -r ./* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/"
                        
                        // Execute the deployment script remotely
                        sh """
                            ssh -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "cd ${DEPLOYMENT_DIR} && {
                                set -euo pipefail
                                
                                # Ensure Docker is installed
                                if ! command -v docker &> /dev/null; then
                                    echo 'Docker not found, installing...'
                                    sudo apt-get update
                                    sudo apt-get install -y docker.io
                                    sudo systemctl start docker
                                    sudo systemctl enable docker
                                    sudo usermod -aG docker \$USER
                                else
                                    echo 'Docker is already installed'
                                fi
                                
                                # Ensure Docker Compose is installed
                                if ! command -v docker-compose &> /dev/null; then
                                    echo 'Installing Docker Compose...'
                                    sudo curl -L 'https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-\$(uname -s)-\$(uname -m)' -o /usr/local/bin/docker-compose
                                    sudo chmod +x /usr/local/bin/docker-compose
                                else
                                    echo 'Docker Compose is already installed'
                                fi
                                
                                echo 'Logging into Docker Hub...'
                                echo '${DOCKER_PASSWORD}' | docker login -u '${DOCKER_USER}' --password-stdin
                                
                                # Clean up existing containers
                                echo 'Cleaning up existing containers...'
                                docker-compose down || true
                                
                                # Create or update .env file
                                if [ ! -f .env ]; then
                                    cp .env.example .env
                                fi
                                
                                # Append production environment variables to .env
                                cat << EOF >> .env
                                NODE_ENV=production
                                APP_PORT=${env.APP_PORT}
                                REDIS_MASTER_PORT=${env.REDIS_MASTER_PORT}
                                REDIS_SLAVE_1_PORT=${env.REDIS_SLAVE_1_PORT}
                                REDIS_SLAVE_2_PORT=${env.REDIS_SLAVE_2_PORT}
                                SENTINEL_1_PORT=${env.SENTINEL_1_PORT}
                                SENTINEL_2_PORT=${env.SENTINEL_2_PORT}
                                REDIS_SLAVE_3_PORT=${env.REDIS_SLAVE_3_PORT}
                                REDIS_SLAVE_4_PORT=${env.REDIS_SLAVE_4_PORT}
                                SENTINEL_3_PORT=${env.SENTINEL_3_PORT}
                                REDIS_PASSWORD=${env.REDIS_PASSWORD}
                                REDIS_SENTINEL_PASSWORD=${env.REDIS_SENTINEL_PASSWORD}
                                REDIS_MASTER_NAME=${env.REDIS_MASTER_NAME}
                                REDIS_SENTINEL_QUORUM=${env.REDIS_SENTINEL_QUORUM}
                                REDIS_SENTINELS=sentinel-1:${env.SENTINEL_1_PORT},sentinel-2:${env.SENTINEL_2_PORT},sentinel-3:${env.SENTINEL_3_PORT}
                                REDIS_HOST=${env.REDIS_HOST_PROD}
                                REDIS_PORT=${env.REDIS_PORT}
                                CANARY_WEIGHT=${env.CANARY_WEIGHT}
                                REDIS_SENTINELS_PROD=${env.REDIS_SENTINELS_PROD}
                                REDIS_HOST_PROD=${env.REDIS_HOST_PROD}
                                REDIS_SENTINELS_DEV=${env.REDIS_SENTINELS_DEV}
                                REDIS_HOST_DEV=${env.REDIS_HOST_DEV}
                                IS_DEV=${env.IS_DEV}
                                IS_DIRECT_CONNECTION=${env.IS_DIRECT_CONNECTION}
                                BACKUP_INTERVAL=${env.BACKUP_INTERVAL}
                                MAX_BACKUPS=${env.MAX_BACKUPS}
                                RETENTION_DAYS=${env.RETENTION_DAYS}
                                GDRIVE_ENABLED=${env.GDRIVE_ENABLED}
                                GDRIVE_DIR=${env.GDRIVE_DIR}
                                GDRIVE_MAX_BACKUPS=${env.GDRIVE_MAX_BACKUPS}
                                GDRIVE_RETENTION_DAYS=${env.GDRIVE_RETENTION_DAYS}
                                NEXT_PUBLIC_PAYMENT_VALIDATE_SERVICE=${env.NEXT_PUBLIC_PAYMENT_VALIDATE_SERVICE}
                                NEXT_PUBLIC_AGGREGATE__SERVICE=${env.NEXT_PUBLIC_AGGREGATE__SERVICE}
                                NEXT_PUBLIC_ADMIN__SERVICE=${env.NEXT_PUBLIC_ADMIN__SERVICE}
                                LOCKER_DASHBOARD_SERVICE=${env.LOCKER_DASHBOARD_SERVICE}
                                NEXT_PUBLIC_WALLET__SERVICE=${env.NEXT_PUBLIC_WALLET__SERVICE}
                                NEXT_PUBLIC_EXTENSION__SERVICE=${env.NEXT_PUBLIC_EXTENSION__SERVICE}
                                NEXT_PUBLIC_MIGRATION__SERVICE=${env.NEXT_PUBLIC_MIGRATION__SERVICE}
                                NEXT_PUBLIC_CLAIM__SERVICE=${env.NEXT_PUBLIC_CLAIM__SERVICE}
                                NEXT_PUBLIC_TOKEN_REQUEST=${env.NEXT_PUBLIC_TOKEN_REQUEST}
                                NEXT_PUBLIC_TELEGRAM_BOT_BRIDGE__SERVICE=${env.NEXT_PUBLIC_TELEGRAM_BOT_BRIDGE__SERVICE}
                                TELEGRAM_BOT_BRIDGE_API_KEY=${env.TELEGRAM_BOT_BRIDGE_API_KEY}
                                NEXT_PUBLIC_DEV_DASHBOARD__SERVICE=${env.NEXT_PUBLIC_DEV_DASHBOARD__SERVICE}
                                NEXT_PUBLIC_VALIDATOR=${env.NEXT_PUBLIC_VALIDATOR}
                                NEXT_PUBLIC_PAW_COMPILER_SERVICE=${env.NEXT_PUBLIC_PAW_COMPILER_SERVICE}
                                NEXT_PUBLIC_ISDEV=${env.NEXT_PUBLIC_ISDEV}
                                NATIVE_TOKEN_PRICE_API=${env.NATIVE_TOKEN_PRICE_API}
                                NATIVE_API_KEY=${env.NATIVE_API_KEY}
                                NEXT_PUBLIC_SCANNER_ENDPOINT=${env.NEXT_PUBLIC_SCANNER_ENDPOINT}
                                NEXT_PUBLIC_SCANNER_2025_ENDPOINT=${env.NEXT_PUBLIC_SCANNER_2025_ENDPOINT}
                                JOSE_SECRET=${env.JOSE_SECRET}
                                ENC_KEY=${env.ENC_KEY}
                                COMPILER_ENCRYPTION_KEY=${env.COMPILER_ENCRYPTION_KEY}
                                EOF
                                
                                # Make any necessary scripts executable
                                chmod +x scripts/*.sh
                                
                                # Pull the latest images for production
                                echo 'Pulling latest live images...'
                                docker pull ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest || true
                                docker pull ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}
                                
                                # Create an override file for the canary deployment
                                cat << EOF > docker-compose.override.yml
                                services:
                                  app-stable:
                                    image: ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                    environment:
                                      - NODE_ENV=production
                                      - NODE_OPTIONS=--max-old-space-size=2048
                                      - APP_PORT=${env.APP_PORT}
                                      - REDIS_SENTINELS=sentinel-1:${env.SENTINEL_1_PORT},sentinel-2:${env.SENTINEL_2_PORT},sentinel-3:${env.SENTINEL_3_PORT}
                                      - REDIS_MASTER_NAME=${env.REDIS_MASTER_NAME}
                                      - REDIS_PASSWORD=${env.REDIS_PASSWORD}
                                      - REDIS_SENTINEL_PASSWORD=${env.REDIS_SENTINEL_PASSWORD}
                                      - REDIS_SENTINEL_QUORUM=${env.REDIS_SENTINEL_QUORUM}
                                      - CANARY_WEIGHT=${env.CANARY_WEIGHT}
                                      - REDIS_SENTINELS_PROD=${env.REDIS_SENTINELS_PROD}
                                      - REDIS_HOST_PROD=${env.REDIS_HOST_PROD}
                                      - REDIS_SENTINELS_DEV=${env.REDIS_SENTINELS_DEV}
                                      - REDIS_HOST_DEV=${env.REDIS_HOST_DEV}
                                      - IS_DEV=${env.IS_DEV}
                                      - IS_DIRECT_CONNECTION=${env.IS_DIRECT_CONNECTION}
                                      - BACKUP_INTERVAL=${env.BACKUP_INTERVAL}
                                      - MAX_BACKUPS=${env.MAX_BACKUPS}
                                      - RETENTION_DAYS=${env.RETENTION_DAYS}
                                      - GDRIVE_ENABLED=${env.GDRIVE_ENABLED}
                                      - GDRIVE_DIR=${env.GDRIVE_DIR}
                                      - GDRIVE_MAX_BACKUPS=${env.GDRIVE_MAX_BACKUPS}
                                      - GDRIVE_RETENTION_DAYS=${env.GDRIVE_RETENTION_DAYS}
                                      - NEXT_PUBLIC_PAYMENT_VALIDATE_SERVICE=${env.NEXT_PUBLIC_PAYMENT_VALIDATE_SERVICE}
                                      - NEXT_PUBLIC_AGGREGATE__SERVICE=${env.NEXT_PUBLIC_AGGREGATE__SERVICE}
                                      - NEXT_PUBLIC_ADMIN__SERVICE=${env.NEXT_PUBLIC_ADMIN__SERVICE}
                                      - LOCKER_DASHBOARD_SERVICE=${env.LOCKER_DASHBOARD_SERVICE}
                                      - NEXT_PUBLIC_WALLET__SERVICE=${env.NEXT_PUBLIC_WALLET__SERVICE}
                                      - NEXT_PUBLIC_EXTENSION__SERVICE=${env.NEXT_PUBLIC_EXTENSION__SERVICE}
                                      - NEXT_PUBLIC_MIGRATION__SERVICE=${env.NEXT_PUBLIC_MIGRATION__SERVICE}
                                      - NEXT_PUBLIC_CLAIM__SERVICE=${env.NEXT_PUBLIC_CLAIM__SERVICE}
                                      - NEXT_PUBLIC_TOKEN_REQUEST=${env.NEXT_PUBLIC_TOKEN_REQUEST}
                                      - NEXT_PUBLIC_TELEGRAM_BOT_BRIDGE__SERVICE=${env.NEXT_PUBLIC_TELEGRAM_BOT_BRIDGE__SERVICE}
                                      - TELEGRAM_BOT_BRIDGE_API_KEY=${env.TELEGRAM_BOT_BRIDGE_API_KEY}
                                      - NEXT_PUBLIC_DEV_DASHBOARD__SERVICE=${env.NEXT_PUBLIC_DEV_DASHBOARD__SERVICE}
                                      - NEXT_PUBLIC_VALIDATOR=${env.NEXT_PUBLIC_VALIDATOR}
                                      - NEXT_PUBLIC_PAW_COMPILER_SERVICE=${env.NEXT_PUBLIC_PAW_COMPILER_SERVICE}
                                      - NEXT_PUBLIC_ISDEV=${env.NEXT_PUBLIC_ISDEV}
                                      - NATIVE_TOKEN_PRICE_API=${env.NATIVE_TOKEN_PRICE_API}
                                      - NATIVE_API_KEY=${env.NATIVE_API_KEY}
                                      - NEXT_PUBLIC_SCANNER_ENDPOINT=${env.NEXT_PUBLIC_SCANNER_ENDPOINT}
                                      - NEXT_PUBLIC_SCANNER_2025_ENDPOINT=${env.NEXT_PUBLIC_SCANNER_2025_ENDPOINT}
                                      - JOSE_SECRET=${env.JOSE_SECRET}
                                      - ENC_KEY=${env.ENC_KEY}
                                      - COMPILER_ENCRYPTION_KEY=${env.COMPILER_ENCRYPTION_KEY}
                                    ports:
                                      - '3001:${env.APP_PORT}'
                                    restart: always
                                    networks:
                                      - redis-network
                                    depends_on:
                                      - redis-master
                                
                                
                                  app-canary:
                                    image: ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}
                                    environment:
                                      - NODE_ENV=production
                                      - NODE_OPTIONS=--max-old-space-size=2048
                                      - APP_PORT=${env.APP_PORT}
                                      - REDIS_SENTINELS=sentinel-1:${env.SENTINEL_1_PORT},sentinel-2:${env.SENTINEL_2_PORT},sentinel-3:${env.SENTINEL_3_PORT}
                                      - REDIS_MASTER_NAME=${env.REDIS_MASTER_NAME}
                                      - REDIS_PASSWORD=${env.REDIS_PASSWORD}
                                      - REDIS_SENTINEL_PASSWORD=${env.REDIS_SENTINEL_PASSWORD}
                                      - REDIS_SENTINEL_QUORUM=${env.REDIS_SENTINEL_QUORUM}
                                      - REDIS_SENTINELS_PROD=${env.REDIS_SENTINELS_PROD}
                                      - REDIS_HOST_PROD=${env.REDIS_HOST_PROD}
                                      - REDIS_SENTINELS_DEV=${env.REDIS_SENTINELS_DEV}
                                      - REDIS_HOST_DEV=${env.REDIS_HOST_DEV}
                                      - IS_DEV=${env.IS_DEV}
                                      - IS_DIRECT_CONNECTION=${env.IS_DIRECT_CONNECTION}
                                      - BACKUP_INTERVAL=${env.BACKUP_INTERVAL}
                                      - MAX_BACKUPS=${env.MAX_BACKUPS}
                                      - RETENTION_DAYS=${env.RETENTION_DAYS}
                                      - GDRIVE_ENABLED=${env.GDRIVE_ENABLED}
                                      - GDRIVE_DIR=${env.GDRIVE_DIR}
                                      - GDRIVE_MAX_BACKUPS=${env.GDRIVE_MAX_BACKUPS}
                                      - GDRIVE_RETENTION_DAYS=${env.GDRIVE_RETENTION_DAYS}
                                      - NEXT_PUBLIC_PAYMENT_VALIDATE_SERVICE=${env.NEXT_PUBLIC_PAYMENT_VALIDATE_SERVICE}
                                      - NEXT_PUBLIC_AGGREGATE__SERVICE=${env.NEXT_PUBLIC_AGGREGATE__SERVICE}
                                      - NEXT_PUBLIC_ADMIN__SERVICE=${env.NEXT_PUBLIC_ADMIN__SERVICE}
                                      - LOCKER_DASHBOARD_SERVICE=${env.LOCKER_DASHBOARD_SERVICE}
                                      - NEXT_PUBLIC_WALLET__SERVICE=${env.NEXT_PUBLIC_WALLET__SERVICE}
                                      - NEXT_PUBLIC_EXTENSION__SERVICE=${env.NEXT_PUBLIC_EXTENSION__SERVICE}
                                      - NEXT_PUBLIC_MIGRATION__SERVICE=${env.NEXT_PUBLIC_MIGRATION__SERVICE}
                                      - NEXT_PUBLIC_CLAIM__SERVICE=${env.NEXT_PUBLIC_CLAIM__SERVICE}
                                      - NEXT_PUBLIC_TOKEN_REQUEST=${env.NEXT_PUBLIC_TOKEN_REQUEST}
                                      - NEXT_PUBLIC_TELEGRAM_BOT_BRIDGE__SERVICE=${env.NEXT_PUBLIC_TELEGRAM_BOT_BRIDGE__SERVICE}
                                      - TELEGRAM_BOT_BRIDGE_API_KEY=${env.TELEGRAM_BOT_BRIDGE_API_KEY}
                                      - NEXT_PUBLIC_DEV_DASHBOARD__SERVICE=${env.NEXT_PUBLIC_DEV_DASHBOARD__SERVICE}
                                      - NEXT_PUBLIC_VALIDATOR=${env.NEXT_PUBLIC_VALIDATOR}
                                      - NEXT_PUBLIC_PAW_COMPILER_SERVICE=${env.NEXT_PUBLIC_PAW_COMPILER_SERVICE}
                                      - NEXT_PUBLIC_ISDEV=${env.NEXT_PUBLIC_ISDEV}
                                      - NATIVE_TOKEN_PRICE_API=${env.NATIVE_TOKEN_PRICE_API}
                                      - NATIVE_API_KEY=${env.NATIVE_API_KEY}
                                      - NEXT_PUBLIC_SCANNER_ENDPOINT=${env.NEXT_PUBLIC_SCANNER_ENDPOINT}
                                      - NEXT_PUBLIC_SCANNER_2025_ENDPOINT=${env.NEXT_PUBLIC_SCANNER_2025_ENDPOINT}
                                      - JOSE_SECRET=${env.JOSE_SECRET}
                                      - ENC_KEY=${env.ENC_KEY}
                                      - COMPILER_ENCRYPTION_KEY=${env.COMPILER_ENCRYPTION_KEY}
                                    ports:
                                      - '3002:${env.APP_PORT}'
                                    restart: always
                                    networks:
                                      - redis-network
                                    depends_on:
                                      - redis-master
                                
                                
                                volumes:
                                  redis-data:
                                  grafana-data:
                                EOF
                                
                                # Validate Docker Compose configuration
                                echo 'Validating Docker Compose configuration...'
                                docker-compose config
                                
                                # Bring up production services (including Redis and the app variants)
                                echo 'Starting Redis services and application containers...'
                                docker-compose --profile production up -d
                                
                                # Wait for services to initialize
                                echo 'Waiting for services to be ready...'
                                sleep 10
                                
                                # Ensure Nginx is installed before trying to configure it
                                if ! command -v nginx &> /dev/null; then
                                  echo 'Nginx not found, installing...'
                                  sudo lsof -i :80 || true
                                  sudo systemctl stop nginx || true
                                  sudo apt-get update
                                  sudo apt-get install -y nginx
                                  sudo systemctl stop nginx
                                fi
                                
                                # Configure Nginx for canary deployment
                                echo 'Updating Nginx configuration for canary deployment...'
                                sudo mkdir -p /etc/nginx/conf.d
                                
                                # First verify if ports 3001 and 3002 are accessible
                                echo 'Verifying ports 3001 and 3002 are accessible...'
                                timeout 5 curl -s http://localhost:3001 || echo 'Port 3001 not responding yet'
                                timeout 5 curl -s http://localhost:3002 || echo 'Port 3002 not responding yet'
                                
                                # Create the Nginx configuration file
                                cat << EOF | sudo tee /etc/nginx/conf.d/nextjs-app.conf
                                upstream nextjs_stable {
                                    server 127.0.0.1:3001;
                                }
                                
                                upstream nextjs_canary {
                                    server 127.0.0.1:3002;
                                }
                                
                                # Split traffic between stable and canary based on a random number
                                split_clients "\${remote_addr}\${time_iso8601}" \$upstream {
                                    ${env.CANARY_WEIGHT}%   nextjs_canary;
                                    *                       nextjs_stable;
                                }
                                
                                server {
                                    listen 80;
                                
                                    # Add header to identify the serving version
                                    add_header X-Version \$upstream;
                                
                                    location / {
                                        proxy_pass http://\$upstream;
                                        proxy_set_header Host \$host;
                                        proxy_set_header X-Real-IP \$remote_addr;
                                        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
                                    }
                                }
                                EOF
                                
                                # Backup the default nginx site configuration (if it exists)
                                if [ -f /etc/nginx/sites-enabled/default ]; then
                                  sudo mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak
                                fi
                                
                                # Test Nginx configuration
                                echo 'Testing Nginx configuration...'
                                if sudo nginx -t; then
                                  echo 'Nginx configuration test passed. Starting/reloading Nginx...'
                                  sudo systemctl restart nginx || sudo systemctl start nginx
                                  sleep 3
                                  sudo systemctl status nginx
                                else
                                  echo 'Nginx configuration failed. Checking for errors...'
                                  sudo cat /var/log/nginx/error.log
                                  exit 1
                                fi
                                
                                echo 'Canary deployment completed successfully. Routing ${env.CANARY_WEIGHT}% of traffic to the new version.'
                                echo 'Monitor the canary deployment before promoting it to stable.'
                            }"
                        """
                    }
                }
            }
        }
        
        stage('Promote Canary to Stable') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'promote-canary' }
            }
            steps {
                script {
                    // Execute the promotion steps from promote-canary.yml
                    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                        sh """
                            ssh -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "cd ${DEPLOYMENT_DIR} && {
                                set -euo pipefail
                                
                                echo 'Starting canary promotion process at \$(date)'
                                
                                # Check if we can reach Docker 
                                if ! docker ps > /dev/null 2>&1; then
                                  echo '::error::Cannot connect to Docker daemon. Ensure Docker is running.'
                                  exit 1
                                fi
                                
                                # Check if we can log in to Docker Hub
                                echo 'Logging into Docker Hub...'
                                echo '${DOCKER_PASSWORD}' | docker login -u '${DOCKER_USER}' --password-stdin
                                
                                # Create backup of current stable image tag
                                TIMESTAMP=\$(date +%Y%m%d%H%M%S)
                                echo 'Creating backup of current stable image as ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-backup-\$TIMESTAMP'
                                docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-backup-\$TIMESTAMP
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-backup-\$TIMESTAMP
                                
                                echo 'Promoting canary deployment to stable...'
                                
                                # Tag the canary image as the new stable
                                docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                
                                # Create a backup of the current nginx configuration
                                sudo cp /etc/nginx/conf.d/nextjs-app.conf /etc/nginx/conf.d/nextjs-app.conf.bak.\$TIMESTAMP
                                
                                # Update stable container with the promoted image
                                echo 'Stopping stable container...'
                                docker-compose --profile direct stop app-stable || true
                                docker-compose --profile direct rm -f app-stable || true
                                
                                echo 'Starting new stable container...'
                                docker-compose --profile direct up -d app-stable
                                
                                # Wait for the stable container to initialize
                                echo 'Waiting for stable container to initialize...'
                                sleep 10
                                
                                # Verify the container is running and get its container ID
                                CONTAINER_ID=\$(docker ps --filter 'name=app-app-stable' --format '{{.ID}}')
                                if [ -z '\$CONTAINER_ID' ]; then
                                  echo '::error::Stable container failed to start or could not be found.'
                                  docker ps
                                  exit 1
                                fi
                                
                                echo 'Container ID: \$CONTAINER_ID'
                                
                                # Update nginx configuration to direct all traffic to the stable version
                                cat << 'EOF' | sudo tee /etc/nginx/conf.d/nextjs-app.conf
                                upstream nextjs_app {
                                    server 127.0.0.1:3001;
                                }
                                
                                server {
                                    listen 80 default_server;
                                    
                                    # Add header to identify which version is serving the request
                                    add_header X-Version stable;
                                    add_header X-Deployed-At '\$(date -u +"%Y-%m-%dT%H:%M:%SZ")';
                                    add_header X-Commit-SHA '${env.GIT_COMMIT}';
                                    
                                    location / {
                                        proxy_pass http://nextjs_app;
                                        proxy_set_header Host \$host;
                                        proxy_set_header X-Real-IP \$remote_addr;
                                        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
                                        proxy_set_header X-Forwarded-Proto \$scheme;
                                        proxy_set_header X-Request-ID \$request_id;
                                        
                                        # Set appropriate timeouts
                                        proxy_connect_timeout 60s;
                                        proxy_send_timeout 60s;
                                        proxy_read_timeout 60s;
                                    }
                                    
                                    # Health check endpoint
                                    location /health {
                                        access_log off;
                                        return 200 'OK';
                                    }
                                }
                                EOF
                                
                                # Ensure no default configuration exists that might override our setup
                                if [ -f /etc/nginx/sites-enabled/default ]; then
                                  echo 'Removing default Nginx site configuration...'
                                  sudo rm /etc/nginx/sites-enabled/default
                                fi
                                
                                # Remove any backup files that might cause conflicts
                                if [ -f /etc/nginx/sites-enabled/default.bak ]; then
                                  echo 'Removing conflicting Nginx backup configuration...'
                                  sudo rm /etc/nginx/sites-enabled/default.bak
                                fi
                                
                                # Test nginx configuration before reloading
                                echo 'Testing Nginx configuration...'
                                if ! sudo nginx -t; then
                                  echo '::error::Nginx configuration test failed. Restoring previous configuration.'
                                  sudo cp /etc/nginx/conf.d/nextjs-app.conf.bak.\$TIMESTAMP /etc/nginx/conf.d/nextjs-app.conf
                                  sudo systemctl reload nginx
                                  exit 1
                                fi
                                
                                # Reload nginx
                                echo 'Reloading Nginx...'
                                sudo systemctl reload nginx
                                
                                # Check if nginx is running
                                if ! sudo systemctl is-active nginx; then
                                  echo '::error::Nginx is not running. Attempting to start...'
                                  sudo systemctl start nginx
                                  
                                  if ! sudo systemctl is-active nginx; then
                                    echo '::error::Failed to start Nginx. Check logs for details.'
                                    sudo journalctl -u nginx --no-pager -n 50
                                    exit 1
                                  fi
                                fi
                                
                                # Verify if nginx has the correct configuration loaded
                                echo 'Checking Nginx process and configuration...'
                                sudo ps aux | grep nginx
                                
                                # Verify if app-stable is listening on the expected port
                                echo 'Checking if app-stable is accessible on port 3001...'
                                if ! curl -s http://localhost:3001/health; then
                                  echo '::warning::Cannot access app-stable directly. Checking Docker logs...'
                                  docker logs \$CONTAINER_ID
                                fi
                                
                                # Verify if the app is accessible through Nginx
                                echo 'Checking if the app is accessible through Nginx on port 80...'
                                if ! curl -s http://localhost/health; then
                                  echo '::error::Cannot access the app through Nginx. Checking Nginx logs...'
                                  sudo cat /var/log/nginx/error.log
                                  echo '::error::Nginx access logs:'
                                  sudo cat /var/log/nginx/access.log
                                  
                                  # Debug network connections
                                  echo 'Active connections to port 80:'
                                  sudo netstat -tulpn | grep :80
                                  
                                  # Check if there's any conflict
                                  echo 'Checking for processes using port 80:'
                                  sudo lsof -i :80
                                  
                                  echo 'Restarting Nginx as a last resort...'
                                  sudo systemctl restart nginx
                                  sleep 5
                                  
                                  if ! curl -s http://localhost/health; then
                                    echo '::error::Still cannot access the app through Nginx after restart.'
                                    exit 1
                                  fi
                                else
                                  echo 'App is successfully accessible through Nginx on port 80.'
                                fi
                                
                                # Clean up the canary container after successful promotion
                                echo 'Cleaning up canary container...'
                                docker-compose --profile direct stop app-canary || true
                                docker-compose --profile direct rm -f app-canary || true
                                
                                # Prune unused images to save space
                                echo 'Pruning unused images...'
                                docker image prune -af --filter 'until=24h'
                                
                                echo 'Canary deployment successfully promoted to stable at \$(date).'
                                echo 'New stable version: ${PROD_TAG}'
                                echo 'Backup image available as: ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-backup-\$TIMESTAMP'
                            }"
                        """
                    }
                }
            }
        }
    }
}

    post {
        always {
            script {
                // Clean up workspace
                cleanWs()
            }
        }
    }
