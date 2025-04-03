pipeline {
    agent any
    
    options {
        disableConcurrentBuilds() // Prevent multiple deployments running simultaneously
        timeout(time: 30, unit: 'MINUTES') // Overall pipeline timeout
    }
    
    environment {
        DOCKER_REGISTRY = "prathibhabotcalm"
        APP_IMAGE_NAME = "nextjs-app"
        APP_VERSION = "${env.BUILD_NUMBER}"
        GIT_COMMIT_SHORT = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        PROD_TAG = "${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}"
        CANARY_TAG = "${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}-canary"
        CANARY_WEIGHT = "${params.CANARY_WEIGHT ?: 20}"
        DEPLOY_TIMEOUT = 600
        DROPLET_IP = "128.199.87.188"
        DEPLOYMENT_DIR = "/opt/app"
        NODE_ENV = "production"
        GITHUB_REPOSITORY = "${env.JOB_NAME.split('/')[0]}/${env.JOB_NAME.split('/')[1]}"
        
        // Notification settings
        SLACK_CHANNEL = '#deployments'
        NOTIFICATION_EMAIL = 'devops@example.com'
    }
    
    parameters {
        choice(name: 'DEPLOYMENT_TYPE', choices: ['canary', 'promote-canary', 'rollback'], description: 'Type of deployment to perform')
        string(name: 'CANARY_WEIGHT', defaultValue: '20', description: 'Percentage of traffic to route to canary (1-99)')
        text(name: 'PROMOTION_REASON', defaultValue: '', description: 'Reason for promoting canary to stable')
        text(name: 'ROLLBACK_REASON', defaultValue: '', description: 'Reason for rolling back canary deployment')
        string(name: 'REDIS_MAX_ATTEMPTS', defaultValue: '50', description: 'Maximum attempts to wait for Redis readiness')
        string(name: 'REDIS_SLEEP_DURATION', defaultValue: '5', description: 'Sleep duration between Redis readiness checks (in seconds)')
    }
    
    triggers {
        pollSCM('* * * * *')
        githubPush()
    }
    
    stages {
        stage('Validate Parameters') {
            steps {
                script {
                    if (!['canary', 'promote-canary', 'rollback'].contains(params.DEPLOYMENT_TYPE)) {
                        error "Invalid deployment type. Must be one of: canary, promote-canary, rollback"
                    }
                    
                    if (params.DEPLOYMENT_TYPE == 'canary') {
                        def weight = params.CANARY_WEIGHT as Integer
                        if (weight < 1 || weight > 99) {
                            error "Canary weight must be between 1 and 99, got: ${params.CANARY_WEIGHT}"
                        }
                    }
                    
                    // Validate other parameters if needed
                    if (params.DEPLOYMENT_TYPE in ['promote-canary', 'rollback'] && !params."${params.DEPLOYMENT_TYPE.toUpperCase()}_REASON") {
                        error "${params.DEPLOYMENT_TYPE} requires a reason to be specified"
                    }
                }
            }
        }
        
        stage('Verify Secrets') {
            steps {
                script {
                    def requiredSecrets = []
                    
                    if (params.DEPLOYMENT_TYPE == 'canary') {
                        requiredSecrets = [
                            'LIVE_HOST', 'LIVE_USER', 'LIVE_SSH_KEY', 'APP_PORT',
                            'REDIS_MASTER_PORT', 'REDIS_SLAVE_1_PORT', 'REDIS_SLAVE_2_PORT',
                            'REDIS_SLAVE_3_PORT', 'REDIS_SLAVE_4_PORT', 'SENTINEL_1_PORT',
                            'SENTINEL_2_PORT', 'SENTINEL_3_PORT', 'REDIS_PASSWORD',
                            'REDIS_SENTINEL_PASSWORD', 'REDIS_MASTER_NAME', 'REDIS_SENTINEL_QUORUM',
                            'REDIS_HOST_PROD', 'REDIS_SENTINELS_PROD', 'REDIS_HOST_DEV',
                            'REDIS_SENTINELS_DEV', 'REDIS_PORT', 'IS_DIRECT_CONNECTION'
                        ]
                    } else {
                        requiredSecrets = ['LIVE_HOST', 'LIVE_USER', 'LIVE_SSH_KEY', 'APP_PORT']
                    }
                    
                    // Verify each secret exists in Jenkins credentials
                    requiredSecrets.each { secret ->
                        try {
                            withCredentials([string(credentialsId: secret, variable: 'SECRET_VALUE')]) {
                                echo "Secret ${secret} is available"
                            }
                        } catch (Exception e) {
                            error "Required secret ${secret} is not configured in Jenkins credentials"
                        }
                    }
                }
            }
        }
        
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        
        stage('Set Repository Name') {
            steps {
                script {
                    def repo = sh(script: "echo '${GITHUB_REPOSITORY}' | tr '[:upper:]' '[:lower:]'", returnStdout: true).trim()
                    env.REPO_LOWERCASE = repo
                    echo "Repository name: ${env.REPO_LOWERCASE}"
                }
            }
        }
        
        stage('Record Deployment Details') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'promote-canary' || params.DEPLOYMENT_TYPE == 'rollback' }
            }
            steps {
                script {
                    def action = params.DEPLOYMENT_TYPE == 'promote-canary' ? 'Promotion' : 'Rollback'
                    def logFileName = "${params.DEPLOYMENT_TYPE}.log"
                    def reason = params."${params.DEPLOYMENT_TYPE.toUpperCase()}_REASON"
                    
                    writeFile file: logFileName, text: """
                        ${action} triggered by: ${env.USER}
                        Commit SHA: ${env.GIT_COMMIT}
                        ${action} reason: ${reason ?: 'Not provided'}
                        Timestamp: ${new Date().format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC'))}
                        Build URL: ${env.BUILD_URL}
                    """.stripIndent()
                    
                    archiveArtifacts artifacts: logFileName, fingerprint: true
                }
            }
        }
        
        stage('Push Docker Image') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'canary' }
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'docker-registry-credentials',
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASSWORD'
                    )
                ]) {
                    script {
                        try {
                            sh """
                                docker login -u ${DOCKER_USER} --password-stdin <<< '${DOCKER_PASSWORD}'
                                docker build -t ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} .
                                docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}
                            """
                        } catch (Exception e) {
                            error "Failed to build or push Docker images: ${e.message}"
                        }
                    }
                }
            }
        }
        
        stage('Deploy Canary') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'canary' }
            }
            steps {
                script {
                    withCredentials([
                        sshUserPrivateKey(
                            credentialsId: 'ssh-deployment-key',
                            keyFileVariable: 'SSH_KEY',
                            usernameVariable: 'SSH_USER'
                        ),
                        // Include all required credentials for canary deployment
                        string(credentialsId: 'REDIS_PASSWORD', variable: 'REDIS_PASSWORD'),
                        string(credentialsId: 'REDIS_SENTINEL_PASSWORD', variable: 'REDIS_SENTINEL_PASSWORD')
                    ]) {
                        try {
                            // Break down the deployment into smaller steps for better error handling
                            
                            // Step 1: Copy files to remote server
                            sh """
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no -r ./* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/
                            """
                            
                            // Step 2: Execute remote deployment script
                            def remoteScript = """
                                set -euo pipefail
                                
                                # Install Docker if not present
                                if ! command -v docker &> /dev/null; then
                                    echo 'Installing Docker...'
                                    sudo apt-get update
                                    sudo apt-get install -y docker.io
                                    sudo systemctl start docker
                                    sudo systemctl enable docker
                                    sudo usermod -aG docker \$USER
                                fi
                                
                                # Install Docker Compose if not present
                                if ! command -v docker-compose &> /dev/null; then
                                    echo 'Installing Docker Compose...'
                                    sudo curl -L 'https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-\$(uname -s)-\$(uname -m)' -o /usr/local/bin/docker-compose
                                    sudo chmod +x /usr/local/bin/docker-compose
                                fi
                                
                                # Login to Docker Hub
                                echo '${DOCKER_PASSWORD}' | docker login -u '${DOCKER_USER}' --password-stdin
                                
                                # Clean up existing containers
                                echo 'Cleaning up existing containers...'
                                docker-compose down || true
                                
                                # Prepare environment file
                                echo 'Preparing environment configuration...'
                                if [ ! -f .env ]; then
                                    cp .env.example .env
                                fi
                                
                                # Append production environment variables
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
                                REDIS_PASSWORD=${REDIS_PASSWORD}
                                REDIS_SENTINEL_PASSWORD=${REDIS_SENTINEL_PASSWORD}
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
                                EOF
                                
                                # Make scripts executable
                                chmod +x scripts/*.sh
                                
                                # Pull Docker images
                                echo 'Pulling Docker images...'
                                docker pull ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest || true
                                docker pull ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}
                                
                                # Create Docker Compose override for canary
                                echo 'Creating Docker Compose override...'
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
                                      - REDIS_PASSWORD=${REDIS_PASSWORD}
                                      - REDIS_SENTINEL_PASSWORD=${REDIS_SENTINEL_PASSWORD}
                                      - REDIS_SENTINEL_QUORUM=${env.REDIS_SENTINEL_QUORUM}
                                      - CANARY_WEIGHT=${env.CANARY_WEIGHT}
                                    ports:
                                      - '3001:${env.APP_PORT}'
                                    restart: always
                                    networks:
                                      - redis-network
                                  
                                  app-canary:
                                    image: ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}
                                    environment:
                                      - NODE_ENV=production
                                      - NODE_OPTIONS=--max-old-space-size=2048
                                      - APP_PORT=${env.APP_PORT}
                                      - REDIS_SENTINELS=sentinel-1:${env.SENTINEL_1_PORT},sentinel-2:${env.SENTINEL_2_PORT},sentinel-3:${env.SENTINEL_3_PORT}
                                      - REDIS_MASTER_NAME=${env.REDIS_MASTER_NAME}
                                      - REDIS_PASSWORD=${REDIS_PASSWORD}
                                      - REDIS_SENTINEL_PASSWORD=${REDIS_SENTINEL_PASSWORD}
                                      - REDIS_SENTINEL_QUORUM=${env.REDIS_SENTINEL_QUORUM}
                                    ports:
                                      - '3002:${env.APP_PORT}'
                                    restart: always
                                    networks:
                                      - redis-network
                                EOF
                                
                                # Start services
                                echo 'Starting services...'
                                docker-compose --profile production up -d
                                
                                # Wait for services to initialize
                                echo 'Waiting for services to be ready...'
                                sleep 10
                                
                                # Configure Nginx
                                echo 'Configuring Nginx...'
                                sudo apt-get update
                                sudo apt-get install -y nginx
                                sudo systemctl stop nginx || true
                                
                                cat << EOF | sudo tee /etc/nginx/conf.d/nextjs-app.conf
                                upstream nextjs_stable {
                                    server 127.0.0.1:3001;
                                }
                                
                                upstream nextjs_canary {
                                    server 127.0.0.1:3002;
                                }
                                
                                split_clients "\${remote_addr}\${time_iso8601}" \$upstream {
                                    ${env.CANARY_WEIGHT}%   nextjs_canary;
                                    *                       nextjs_stable;
                                }
                                
                                server {
                                    listen 80;
                                    add_header X-Version \$upstream;
                                    
                                    location / {
                                        proxy_pass http://\$upstream;
                                        proxy_set_header Host \$host;
                                        proxy_set_header X-Real-IP \$remote_addr;
                                        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
                                    }
                                }
                                EOF
                                
                                # Test and start Nginx
                                if sudo nginx -t; then
                                    sudo systemctl restart nginx
                                    echo 'Nginx configuration test passed and service restarted'
                                else
                                    echo 'Nginx configuration test failed'
                                    exit 1
                                fi
                                
                                echo 'Canary deployment completed successfully'
                            """
                            
                            sh """
                                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} 'bash -s' << 'ENDSSH'
                                ${remoteScript}
                                ENDSSH
                            """
                            
                        } catch (Exception e) {
                            error "Canary deployment failed: ${e.message}"
                        }
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
                    withCredentials([
                        sshUserPrivateKey(
                            credentialsId: 'ssh-deployment-key',
                            keyFileVariable: 'SSH_KEY',
                            usernameVariable: 'SSH_USER'
                        ),
                        usernamePassword(
                            credentialsId: 'docker-registry-credentials',
                            usernameVariable: 'DOCKER_USER',
                            passwordVariable: 'DOCKER_PASSWORD'
                        )
                    ]) {
                        try {
                            def remoteScript = """
                                set -euo pipefail
                                
                                # Verify Docker connectivity
                                if ! docker ps > /dev/null 2>&1; then
                                    echo 'Cannot connect to Docker daemon'
                                    exit 1
                                fi
                                
                                # Login to Docker Hub
                                echo '${DOCKER_PASSWORD}' | docker login -u '${DOCKER_USER}' --password-stdin
                                
                                # Create backup of current stable image
                                TIMESTAMP=\$(date +%Y%m%d%H%M%S)
                                docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-backup-\$TIMESTAMP
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-backup-\$TIMESTAMP
                                
                                # Promote canary image to stable
                                docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                
                                # Backup nginx config
                                sudo cp /etc/nginx/conf.d/nextjs-app.conf /etc/nginx/conf.d/nextjs-app.conf.bak.\$TIMESTAMP
                                
                                # Update stable container
                                docker-compose --profile direct stop app-stable || true
                                docker-compose --profile direct rm -f app-stable || true
                                docker-compose --profile direct up -d app-stable
                                
                                # Wait for container to initialize
                                sleep 10
                                
                                # Verify container is running
                                CONTAINER_ID=\$(docker ps --filter 'name=app-app-stable' --format '{{.ID}}')
                                if [ -z "\$CONTAINER_ID" ]; then
                                    echo 'Stable container failed to start'
                                    exit 1
                                fi
                                
                                # Update nginx config
                                cat << 'EOF' | sudo tee /etc/nginx/conf.d/nextjs-app.conf
                                upstream nextjs_app {
                                    server 127.0.0.1:3001;
                                }
                                
                                server {
                                    listen 80 default_server;
                                    add_header X-Version stable;
                                    add_header X-Deployed-At '\$(date -u +"%Y-%m-%dT%H:%M:%SZ")';
                                    add_header X-Commit-SHA '${env.GIT_COMMIT}';
                                    
                                    location / {
                                        proxy_pass http://nextjs_app;
                                        proxy_set_header Host \$host;
                                        proxy_set_header X-Real-IP \$remote_addr;
                                        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
                                        proxy_connect_timeout 60s;
                                        proxy_send_timeout 60s;
                                        proxy_read_timeout 60s;
                                    }
                                    
                                    location /health {
                                        access_log off;
                                        return 200 'OK';
                                    }
                                }
                                EOF
                                
                                # Clean up default nginx config
                                sudo rm -f /etc/nginx/sites-enabled/default
                                sudo rm -f /etc/nginx/sites-enabled/default.bak
                                
                                # Test and reload nginx
                                if sudo nginx -t; then
                                    sudo systemctl reload nginx
                                    echo 'Nginx configuration test passed and service reloaded'
                                else
                                    echo 'Nginx configuration test failed'
                                    exit 1
                                fi
                                
                                # Verify nginx is running
                                if ! sudo systemctl is-active nginx; then
                                    sudo systemctl start nginx
                                    if ! sudo systemctl is-active nginx; then
                                        echo 'Failed to start Nginx'
                                        exit 1
                                    fi
                                fi
                                
                                # Verify application health
                                if ! curl -s http://localhost/health; then
                                    echo 'Application health check failed'
                                    docker logs \$CONTAINER_ID
                                    exit 1
                                fi
                                
                                # Clean up canary container
                                docker-compose --profile direct stop app-canary || true
                                docker-compose --profile direct rm -f app-canary || true
                                
                                # Prune unused images
                                docker image prune -af --filter 'until=24h'
                                
                                echo 'Canary successfully promoted to stable'
                            """
                            
                            sh """
                                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} 'bash -s' << 'ENDSSH'
                                ${remoteScript}
                                ENDSSH
                            """
                            
                        } catch (Exception e) {
                            error "Failed to promote canary to stable: ${e.message}"
                        }
                    }
                }
            }
        }
        
        stage('Rollback Deployment') {
            when {
                expression { params.DEPLOYMENT_TYPE == 'rollback' }
            }
            steps {
                script {
                    withCredentials([
                        sshUserPrivateKey(
                            credentialsId: 'ssh-deployment-key',
                            keyFileVariable: 'SSH_KEY',
                            usernameVariable: 'SSH_USER'
                        ),
                        usernamePassword(
                            credentialsId: 'docker-registry-credentials',
                            usernameVariable: 'DOCKER_USER',
                            passwordVariable: 'DOCKER_PASSWORD'
                        )
                    ]) {
                        try {
                            def remoteScript = """
                                set -euo pipefail
                                
                                # Verify Docker connectivity
                                if ! docker ps > /dev/null 2>&1; then
                                    echo 'Cannot connect to Docker daemon'
                                    exit 1
                                fi
                                
                                # Login to Docker Hub
                                echo '${DOCKER_PASSWORD}' | docker login -u '${DOCKER_USER}' --password-stdin
                                
                                # Get the latest backup image
                                BACKUP_IMAGE=\$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'live-backup-' | sort -r | head -n 1)
                                
                                if [ -z "\$BACKUP_IMAGE" ]; then
                                    echo 'No backup image found for rollback'
                                    exit 1
                                fi
                                
                                echo "Rolling back to image: \$BACKUP_IMAGE"
                                
                                # Tag the backup image as latest
                                docker tag \$BACKUP_IMAGE ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:live-latest
                                
                                # Stop and remove current stable container
                                docker-compose --profile direct stop app-stable || true
                                docker-compose --profile direct rm -f app-stable || true
                                
                                # Start the backup container
                                docker-compose --profile direct up -d app-stable
                                
                                # Wait for container to initialize
                                sleep 10
                                
                                # Verify container is running
                                CONTAINER_ID=\$(docker ps --filter 'name=app-app-stable' --format '{{.ID}}')
                                if [ -z "\$CONTAINER_ID" ]; then
                                    echo 'Rollback container failed to start'
                                    exit 1
                                fi
                                
                                # Verify application health
                                if ! curl -s http://localhost/health; then
                                    echo 'Application health check failed after rollback'
                                    docker logs \$CONTAINER_ID
                                    exit 1
                                fi
                                
                                # Clean up canary container if exists
                                docker-compose --profile direct stop app-canary || true
                                docker-compose --profile direct rm -f app-canary || true
                                
                                echo 'Rollback completed successfully to image: \$BACKUP_IMAGE'
                            """
                            
                            sh """
                                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} 'bash -s' << 'ENDSSH'
                                ${remoteScript}
                                ENDSSH
                            """
                            
                        } catch (Exception e) {
                            error "Rollback failed: ${e.message}"
                        }
                    }
                }
            }
        }
        
        stage('Verify Deployment') {
            when {
                expression { params.DEPLOYMENT_TYPE in ['canary', 'promote-canary', 'rollback'] }
            }
            steps {
                script {
                    withCredentials([
                        sshUserPrivateKey(
                            credentialsId: 'ssh-deployment-key',
                            keyFileVariable: 'SSH_KEY',
                            usernameVariable: 'SSH_USER'
                        )
                    ]) {
                        try {
                            def healthCheck = sh(script: """
                                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} \
                                "curl -s -o /dev/null -w '%{http_code}' http://localhost/health"
                            """, returnStdout: true).trim()
                            
                            if (healthCheck != "200") {
                                error "Deployment verification failed. Health check returned HTTP ${healthCheck}"
                            }
                            
                            echo "Deployment verified successfully (HTTP 200)"
                        } catch (Exception e) {
                            error "Deployment verification failed: ${e.message}"
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
        // success {
        //     script {
        //         // Send success notification
        //         if (params.DEPLOYMENT_TYPE == 'canary') {
        //             slackSend(
        //                 channel: env.SLACK_CHANNEL,
        //                 message: "✅ Canary deployment successful (${env.CANARY_WEIGHT}% traffic) - ${env.JOB_NAME} #${env.BUILD_NUMBER}\nCommit: ${env.GIT_COMMIT_SHORT}\nURL: ${env.BUILD_URL}"
        //             )
        //         } else if (params.DEPLOYMENT_TYPE == 'promote-canary') {
        //             slackSend(
        //                 channel: env.SLACK_CHANNEL,
        //                 message: "✅ Canary promoted to stable - ${env.JOB_NAME} #${env.BUILD_NUMBER}\nCommit: ${env.GIT_COMMIT_SHORT}\nReason: ${params.PROMOTION_REASON}\nURL: ${env.BUILD_URL}"
        //             )
        //         } else if (params.DEPLOYMENT_TYPE == 'rollback') {
        //             slackSend(
        //                 channel: env.SLACK_CHANNEL,
        //                 message: "⚠️ Rollback completed - ${env.JOB_NAME} #${env.BUILD_NUMBER}\nCommit: ${env.GIT_COMMIT_SHORT}\nReason: ${params.ROLLBACK_REASON}\nURL: ${env.BUILD_URL}"
        //             )
        //         }
        //     }
        // }
        // failure {
        //     script {
        //         // Send failure notification
        //         slackSend(
        //             channel: env.SLACK_CHANNEL,
        //             message: "❌ Deployment failed - ${env.JOB_NAME} #${env.BUILD_NUMBER}\nCommit: ${env.GIT_COMMIT_SHORT}\nURL: ${env.BUILD_URL}",
        //             color: 'danger'
        //         )
                
        //         // Optionally send email
        //         emailext (
        //             subject: "FAILED: Job '${env.JOB_NAME}' (${env.BUILD_NUMBER})",
        //             body: """
        //                 Check console output at ${env.BUILD_URL}
                        
        //                 Failed stage: ${currentBuild.result}
        //                 Commit: ${env.GIT_COMMIT}
        //                 Build: ${env.BUILD_NUMBER}
        //             """,
        //             to: env.NOTIFICATION_EMAIL
        //         )
        //     }
        // }
        // unstable {
        //     // Handle unstable build notifications if needed
        // }
    }
}