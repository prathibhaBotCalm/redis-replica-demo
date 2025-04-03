pipeline {
    agent any
    
    environment {
        // Repository configuration
        REPO_NAME = "${env.JOB_NAME.replaceAll(/[^a-zA-Z0-9._-]/, '-')}".toLowerCase()
        DOCKER_REGISTRY = "docker.io"
        DOCKER_CREDENTIALS = credentials('docker-registry-credentials')
        
        // Environment variables
        NODE_ENV = 'production'
        APP_PORT = '3000'
        
        // SSH configuration
        SSH_CREDENTIALS = credentials('live-ssh')
        
        // Build version
        BUILD_VERSION = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(8)}"
        
        // Timeouts
        DEPLOYMENT_TIMEOUT = '10m'
        HEALTH_CHECK_RETRIES = '5'
        HEALTH_CHECK_DELAY = '10'
    }
    
    options {
        timeout(time: 60, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }
    
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        
        stage('Build Docker Image') {
            when {
                anyOf {
                    branch 'main',
                    branch 'dev',
                }
            }
            steps {
                script {
                    try {
                        // Login to Docker Hub with credential helper
                        sh '''
                            echo "${DOCKER_CREDENTIALS_PSW}" | docker login -u "${DOCKER_CREDENTIALS_USR}" --password-stdin ${DOCKER_REGISTRY}
                        '''
                        
                        // Set up Buildx
                        sh '''
                            docker buildx create --use --name pipeline-builder || true
                            docker buildx inspect --bootstrap pipeline-builder
                        '''
                        
                        // Determine tag based on branch
                        def imageTag = ""
                        def additionalTags = ""
                        
                        if (env.BRANCH_NAME == 'dev') {
                            imageTag = "staging-${BUILD_VERSION}"
                            additionalTags = "--tag ${DOCKER_REGISTRY}/${REPO_NAME}:staging-latest"
                        } else if (env.BRANCH_NAME == 'main') {
                            imageTag = "live-${BUILD_VERSION}"
                            additionalTags = "--tag ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest"
                        }
                        
                        // Build and push image
                        sh """
                            docker buildx build \\
                                --push \\
                                --tag ${DOCKER_REGISTRY}/${REPO_NAME}:${imageTag} \\
                                ${additionalTags} \\
                                --cache-from type=registry,ref=${DOCKER_REGISTRY}/${REPO_NAME}:buildcache \\
                                --cache-to type=registry,ref=${DOCKER_REGISTRY}/${REPO_NAME}:buildcache,mode=max \\
                                --build-arg NODE_ENV=${NODE_ENV} \\
                                --build-arg BUILD_VERSION=${BUILD_VERSION} \\
                                --label org.opencontainers.image.created=\$(date -u +'%Y-%m-%dT%H:%M:%SZ') \\
                                --label org.opencontainers.image.revision=${env.GIT_COMMIT} \\
                                --label org.opencontainers.image.version=${BUILD_VERSION} \\
                                .
                        """
                    } catch (Exception e) {
                        currentBuild.result = 'FAILURE'
                        error "Failed to build Docker image: ${e.message}"
                    }
                }
            }
        }
        
        stage('Deploy to Staging') {
            when {
                branch 'dev'
            }
            steps {
                script {
                    try {
                        // Generate docker-compose file
                        def stagingComposeFile = """
version: '3.8'
services:
  app:
    image: ${DOCKER_REGISTRY}/${REPO_NAME}:staging-${BUILD_VERSION}
    ports:
      - "${APP_PORT}:${APP_PORT}"
    environment:
      - NODE_ENV=${NODE_ENV}
      - APP_PORT=${APP_PORT}
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${APP_PORT}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
"""
                        writeFile file: 'staging-compose.yml', text: stagingComposeFile
                        
                        // Deploy to staging server
                        sshagent([SSH_CREDENTIALS]) {
                            sh """
                                # Copy files to staging server
                                scp -o StrictHostKeyChecking=no -r staging-compose.yml ${SSH_CREDENTIALS_USR}@${env.STAGING_HOST}:/home/${SSH_CREDENTIALS_USR}/
                                
                                # Execute deployment script
                                ssh -o StrictHostKeyChecking=no ${SSH_CREDENTIALS_USR}@${env.STAGING_HOST} << EOF
#!/bin/bash
set -e

cd /home/${SSH_CREDENTIALS_USR}
                                
# Install Docker if not present
if ! command -v docker &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker \$USER
fi
                                
# Login to Docker Hub
echo "${DOCKER_CREDENTIALS_PSW}" | docker login -u "${DOCKER_CREDENTIALS_USR}" --password-stdin ${DOCKER_REGISTRY}
                                
# Pull the latest image
docker pull ${DOCKER_REGISTRY}/${REPO_NAME}:staging-${BUILD_VERSION}
                                
# Stop and remove existing containers with graceful timeout
timeout ${DEPLOYMENT_TIMEOUT} docker-compose -f staging-compose.yml down || true
                                
# Start new containers
docker-compose -f staging-compose.yml up -d
                                
# Health check with retries
for i in \$(seq 1 ${HEALTH_CHECK_RETRIES}); do
    echo "Health check attempt \$i of ${HEALTH_CHECK_RETRIES}..."
    if curl --silent --fail http://localhost:${APP_PORT}/health; then
        echo "Health check passed!"
        exit 0
    fi
    echo "Health check failed, retrying in ${HEALTH_CHECK_DELAY} seconds..."
    sleep ${HEALTH_CHECK_DELAY}
done
                                
echo "Health check failed after ${HEALTH_CHECK_RETRIES} attempts"
exit 1
EOF
                            """
                        }
                    } catch (Exception e) {
                        currentBuild.result = 'FAILURE'
                        error "Failed to deploy to staging: ${e.message}"
                    }
                }
            }
        }
        
        stage('Deploy Canary to Live') {
            when {
                branch 'main'
            }
            steps {
                script {
                    try {
                        // Generate production docker-compose file with canary setup
                        def productionComposeFile = """
version: '3.8'
services:
  app-stable:
    image: ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
    ports:
      - "3001:${APP_PORT}"
    environment:
      - NODE_ENV=${NODE_ENV}
      - APP_PORT=${APP_PORT}
      - DEPLOYMENT_TYPE=stable
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${APP_PORT}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
                            
  app-canary:
    image: ${DOCKER_REGISTRY}/${REPO_NAME}:live-${BUILD_VERSION}
    ports:
      - "3002:${APP_PORT}"
    environment:
      - NODE_ENV=${NODE_ENV}
      - APP_PORT=${APP_PORT}
      - DEPLOYMENT_TYPE=canary
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${APP_PORT}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
"""
                        writeFile file: 'production-compose.yml', text: productionComposeFile
                        
                        // Generate Nginx configuration
                        def nginxConfig = """
upstream nextjs_stable {
    server 127.0.0.1:3001;
}
                        
upstream nextjs_canary {
    server 127.0.0.1:3002;
}
                        
# Split traffic - 20% to canary
split_clients "\${remote_addr}\${http_user_agent}\${time_local}" \$upstream {
    20%   nextjs_canary;
    *     nextjs_stable;
}
                        
server {
    listen 80;
    server_name _;
                        
    # Add version header for debugging
    add_header X-Version \$upstream;
    add_header X-Deployment-Id "${BUILD_VERSION}";
                            
    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
                            
    location / {
        proxy_pass http://\$upstream;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
                                
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
                            
    # Health check endpoint
    location /health {
        proxy_pass http://\$upstream;
        access_log off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
"""
                        writeFile file: 'nginx-config.conf', text: nginxConfig
                        
                        // Deploy to live server
                        sshagent([SSH_CREDENTIALS]) {
                            sh """
                                # Copy files to live server
                                scp -o StrictHostKeyChecking=no -r production-compose.yml nginx-config.conf ${SSH_CREDENTIALS_USR}@${env.LIVE_HOST}:/home/${SSH_CREDENTIALS_USR}/
                                
                                # Execute deployment script
                                ssh -o StrictHostKeyChecking=no ${SSH_CREDENTIALS_USR}@${env.LIVE_HOST} << EOF
#!/bin/bash
set -e

cd /home/${SSH_CREDENTIALS_USR}
                                
# Install Docker if not present
if ! command -v docker &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose nginx
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker \$USER
fi
                                
# Login to Docker Hub
echo "${DOCKER_CREDENTIALS_PSW}" | docker login -u "${DOCKER_CREDENTIALS_USR}" --password-stdin ${DOCKER_REGISTRY}
                                
# Pull the latest images
docker pull ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
docker pull ${DOCKER_REGISTRY}/${REPO_NAME}:live-${BUILD_VERSION}
                                
# Deploy using docker-compose
docker-compose -f production-compose.yml up -d
                                
# Configure Nginx for canary deployment
sudo mkdir -p /etc/nginx/conf.d
sudo cp nginx-config.conf /etc/nginx/conf.d/nextjs-app.conf
                                
# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
                                
# Verify both services are running
if ! curl --silent --fail http://localhost:3001/health; then
    echo "Stable service is not healthy!"
    exit 1
fi
                                
if ! curl --silent --fail http://localhost:3002/health; then
    echo "Canary service is not healthy!"
    exit 1
fi
                                
echo "Canary deployment completed successfully. 20% of traffic routed to new version."
EOF
                            """
                        }
                    } catch (Exception e) {
                        currentBuild.result = 'FAILURE'
                        error "Failed to deploy canary to live: ${e.message}"
                    }
                }
            }
        }
        
        stage('Canary Health Check') {
            when {
                branch 'main'
            }
            steps {
                script {
                    try {
                        // Monitor canary for a period before promoting
                        echo "Monitoring canary deployment for 5 minutes..."
                        
                        // Check canary health every minute for 5 minutes
                        for (int i = 0; i < 5; i++) {
                            sleep time: 1, unit: 'MINUTES'
                            
                            sshagent([SSH_CREDENTIALS]) {
                                def healthStatus = sh(
                                    script: """
                                        ssh -o StrictHostKeyChecking=no ${SSH_CREDENTIALS_USR}@${env.LIVE_HOST} 'curl --silent --fail http://localhost:3002/health || echo "FAILED"'
                                    """,
                                    returnStdout: true
                                ).trim()
                                
                                if (healthStatus == "FAILED") {
                                    error "Canary health check failed! Deployment may need to be rolled back."
                                }
                                
                                echo "Canary health check passed (${i+1}/5)"
                            }
                        }
                        
                        echo "Canary deployment stable for 5 minutes. Ready for promotion."
                    } catch (Exception e) {
                        currentBuild.result = 'FAILURE'
                        error "Canary health checks failed: ${e.message}"
                    }
                }
            }
        }
        
        stage('Promote Canary') {
            when {
                branch 'main'
            }
            input {
                message "Promote canary to stable?"
                ok "Promote"
                parameters {
                    string(name: 'PROMOTION_REASON', defaultValue: '', description: 'Reason for promotion')
                    booleanParam(name: 'SKIP_TESTS', defaultValue: false, description: 'Skip additional tests before promotion')
                }
            }
            steps {
                script {
                    try {
                        // Run additional tests if not skipped
                        if (!params.SKIP_TESTS) {
                            echo "Running pre-promotion tests..."
                            // Add your test steps here
                        }
                        
                        // Execute promotion script on live server
                        sshagent([SSH_CREDENTIALS]) {
                            sh """
                                ssh -o StrictHostKeyChecking=no ${SSH_CREDENTIALS_USR}@${env.LIVE_HOST} << EOF
#!/bin/bash
set -e

cd /home/${SSH_CREDENTIALS_USR}
                                
# Create backup of current stable
TIMESTAMP=\$(date +%Y%m%d%H%M%S)
docker tag ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest ${DOCKER_REGISTRY}/${REPO_NAME}:live-backup-\$TIMESTAMP
docker push ${DOCKER_REGISTRY}/${REPO_NAME}:live-backup-\$TIMESTAMP
                                
# Promote canary to stable
docker tag ${DOCKER_REGISTRY}/${REPO_NAME}:live-${BUILD_VERSION} ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
docker push ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
                                
# Update Nginx config to direct all traffic to stable
cat <<EOT | sudo tee /etc/nginx/conf.d/nextjs-app.conf
upstream nextjs_app {
    server 127.0.0.1:3001;
}
                        
server {
    listen 80;
    server_name _;
                        
    # Add version header for debugging
    add_header X-Version "stable";
    add_header X-Deployment-Id "${BUILD_VERSION}";
                            
    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
                            
    location / {
        proxy_pass http://nextjs_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
                                
        # WebSocket support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
                                
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
                            
    # Health check endpoint
    location /health {
        proxy_pass http://nextjs_app;
        access_log off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOT
                                
# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
                                
# Update docker-compose file to run only the stable version
cat <<EOT > production-compose.yml
version: '3.8'
services:
  app-stable:
    image: ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
    ports:
      - "3001:${APP_PORT}"
    environment:
      - NODE_ENV=${NODE_ENV}
      - APP_PORT=${APP_PORT}
      - DEPLOYMENT_TYPE=stable
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${APP_PORT}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOT
                                
# Restart with new configuration
docker-compose -f production-compose.yml up -d
                                
# Clean up canary container
docker-compose -f production-compose.yml stop app-canary || true
docker-compose -f production-compose.yml rm -f app-canary || true
                                
echo "Canary promoted to stable. Backup image: ${DOCKER_REGISTRY}/${REPO_NAME}:live-backup-\$TIMESTAMP"
EOF
                            """
                        }
                        
                        // Record promotion details
                        def promotionLog = """
Promotion Details:
-----------------
Build: ${env.BUILD_NUMBER}
Version: ${BUILD_VERSION}
Promoted by: ${env.USER ?: 'SYSTEM'}
Reason: ${params.PROMOTION_REASON ?: 'No reason provided'}
Timestamp: ${new Date().format("yyyy-MM-dd HH:mm:ss 'UTC'", TimeZone.getTimeZone('UTC'))}
Git Commit: ${env.GIT_COMMIT}
Branch: ${env.BRANCH_NAME}
                        """
                        
                        writeFile file: 'promotion.log', text: promotionLog
                        archiveArtifacts artifacts: 'promotion.log', onlyIfSuccessful: true
                    } catch (Exception e) {
                        currentBuild.result = 'FAILURE'
                        error "Failed to promote canary: ${e.message}"
                    }
                }
            }
        }
        
        stage('Rollback') {
            when {
                expression { return currentBuild.result == 'FAILURE' && env.BRANCH_NAME == 'main' }
            }
            steps {
                script {
                    try {
                        // Execute rollback script on live server
                        sshagent([SSH_CREDENTIALS]) {
                            sh """
                                ssh -o StrictHostKeyChecking=no ${SSH_CREDENTIALS_USR}@${env.LIVE_HOST} << EOF
#!/bin/bash
set -e

cd /home/${SSH_CREDENTIALS_USR}
                                
# Find the most recent backup
BACKUP_TAG=\$(docker images --format '{{.Repository}}:{{.Tag}}' ${DOCKER_REGISTRY}/${REPO_NAME} | grep 'live-backup' | sort -r | head -n 1)
                                
if [ -z "\$BACKUP_TAG" ]; then
    echo "No backup image found for rollback!"
    exit 1
fi
                                
echo "Rolling back to: \$BACKUP_TAG"
                                
# Restore from backup
docker tag \$BACKUP_TAG ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
docker push ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
                                
# Update docker-compose file to use the rollback image
cat <<EOT > rollback-compose.yml
version: '3.8'
services:
  app-stable:
    image: ${DOCKER_REGISTRY}/${REPO_NAME}:live-latest
    ports:
      - "3001:${APP_PORT}"
    environment:
      - NODE_ENV=${NODE_ENV}
      - APP_PORT=${APP_PORT}
      - DEPLOYMENT_TYPE=stable-rollback
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${APP_PORT}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOT
                                
# Deploy the rollback
docker-compose -f rollback-compose.yml up -d
                                
# Update Nginx configuration
cat <<EOT | sudo tee /etc/nginx/conf.d/nextjs-app.conf
upstream nextjs_app {
    server 127.0.0.1:3001;
}
                        
server {
    listen 80;
    server_name _;
                        
    # Add version header
    add_header X-Version "stable-rollback";
                            
    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
                            
    location / {
        proxy_pass http://nextjs_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
                                
        # WebSocket support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
                                
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOT
                                
# Test and restart Nginx
sudo nginx -t
sudo systemctl restart nginx
                                
# Clean up canary container
docker-compose stop app-canary || true
docker-compose rm -f app-canary || true
                                
echo "Rollback to \$BACKUP_TAG completed successfully."
EOF
                            """
                        }
                        
                        // Record rollback details
                        def rollbackLog = """
Rollback Details:
----------------
Build: ${env.BUILD_NUMBER}
Triggered by: ${env.USER ?: 'SYSTEM'}
Reason: Pipeline failure
Timestamp: ${new Date().format("yyyy-MM-dd HH:mm:ss 'UTC'", TimeZone.getTimeZone('UTC'))}
Git Commit: ${env.GIT_COMMIT}
Branch: ${env.BRANCH_NAME}
                        """
                        
                        writeFile file: 'rollback.log', text: rollbackLog
                        archiveArtifacts artifacts: 'rollback.log', onlyIfSuccessful: true
                    } catch (Exception e) {
                        echo "Error during rollback: ${e.message}"
                    }
                }
            }
        }
    }
    
    post {
        always {
            // Clean up Docker credentials
            sh 'docker logout ${DOCKER_REGISTRY} || true'
            
            // Clean up workspace
            cleanWs(
                cleanWhenAborted: true,
                cleanWhenFailure: true,
                cleanWhenNotBuilt: true,
                cleanWhenSuccess: true,
                deleteDirs: true
            )
        }
        
        success {
            echo 'Pipeline completed successfully'
            
            // Send success notification
            emailext (
                subject: "SUCCESS: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]'",
                body: """
SUCCESSFUL: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]'
Check console output at ${env.BUILD_URL}
                """,
                recipientProviders: [[$class: 'DevelopersRecipientProvider']]
            )
        }
        
        failure {
            echo 'Pipeline failed'
            
            // Send failure notification
            emailext (
                subject: "FAILED: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]'",
                body: """
FAILED: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]'
Check console output at ${env.BUILD_URL}
                """,
                recipientProviders: [[$class: 'DevelopersRecipientProvider']]
            )
        }
    }
}