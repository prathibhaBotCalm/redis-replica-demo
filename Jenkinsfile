pipeline {
    agent any
    
    environment {
        DOCKER_REGISTRY = "prathibhabotcalm" // Your Docker Hub username
        APP_IMAGE_NAME = "nextjs-app"
        APP_VERSION = "${env.BUILD_NUMBER}"
        GIT_COMMIT_SHORT = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        PROD_TAG = "${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}"
        CANARY_TAG = "${GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}-canary"
        CANARY_WEIGHT = "${params.CANARY_WEIGHT ?: 20}" // Default to 20% traffic if not specified
        DEPLOY_TIMEOUT = 600 // 10 minutes timeout for deployment validation
        DROPLET_IP = "128.199.87.188" // Your Digital Ocean droplet IP
        DEPLOYMENT_DIR = "/opt/app" // Deployment directory
        DEPLOY_ENV = "${params.ENVIRONMENT ?: 'auto'}" // Will be overridden if auto-detected
        DEPLOY_TYPE = "${params.DEPLOYMENT_TYPE ?: 'standard'}" // Default deployment type
    }
    
    parameters {
        choice(name: 'ENVIRONMENT', choices: ['auto', 'dev', 'staging', 'prod'], description: 'Deployment environment (auto will determine based on branch)')
        choice(name: 'DEPLOYMENT_TYPE', choices: ['standard', 'canary', 'rollback'], description: 'Deployment type')
        string(name: 'CANARY_WEIGHT', defaultValue: '20', description: 'Percentage of traffic to route to canary (1-99)')
        string(name: 'ROLLBACK_VERSION', defaultValue: '', description: 'Version to rollback to (required for rollback)')
        string(name: 'REDIS_MAX_ATTEMPTS', defaultValue: '30', description: 'Maximum attempts to wait for Redis readiness')
        string(name: 'REDIS_SLEEP_DURATION', defaultValue: '5', description: 'Sleep duration between Redis readiness checks (in seconds)')
    }
    
    triggers {
        // Poll SCM every minute for changes
        pollSCM('* * * * *')
        
        // GitHub webhook trigger (requires GitHub plugin)
        githubPush()
    }
    
    stages {
        stage('Determine Environment') {
            steps {
                script {
                    // Print diagnostic information about environment variables
                    echo "Initial environment setting: ${env.DEPLOY_ENV}"
                    echo "Branch name: ${env.BRANCH_NAME}"
                    echo "GIT_BRANCH: ${env.GIT_BRANCH}"
                    
                    if (env.DEPLOY_ENV == 'auto') {
                        // Auto-detect based on branch name
                        def branch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '')
                        echo "Detected branch: ${branch}"
                        
                        // Add more robust branch detection
                        if (branch == null || branch.trim() == '') {
                            echo "WARNING: Branch name is empty or null, trying alternate methods"
                            try {
                                def gitOutput = sh(script: "git branch --contains HEAD | grep '*' | cut -d' ' -f2", returnStdout: true).trim()
                                branch = gitOutput ?: 'unknown'
                                echo "Determined branch using git command: ${branch}"
                            } catch (Exception e) {
                                echo "Failed to get branch name: ${e.getMessage()}"
                                branch = 'dev' // Default to dev if we can't determine
                                echo "Defaulting to branch: ${branch}"
                            }
                        }
                        
                        // More robust branch determination logic
                        if (branch == 'main' || branch == 'master') {
                            env.DEPLOY_ENV = 'prod'
                        } else if (branch == 'staging') {
                            env.DEPLOY_ENV = 'staging'
                        } else {
                            env.DEPLOY_ENV = 'dev'
                        }
                    }
                    
                    echo "Deploying to environment: ${env.DEPLOY_ENV}"
                    
                    // Store a separate value for the credential ID determination
                    // This is the key fix for auto environment
                    if (env.DEPLOY_ENV == 'auto') {
                        env.CRED_ENV = 'prod'  // Use prod-env-file when auto is detected
                        echo "Using credential ID: ${env.CRED_ENV}-env-file for auto environment"
                    } else {
                        env.CRED_ENV = env.DEPLOY_ENV
                        echo "Using credential ID: ${env.CRED_ENV}-env-file"
                    }
                    
                    // Safer check for automatic deployments
                    def isTriggerFromGitHub = false
                    try {
                        def causes = currentBuild.getBuildCauses()
                        causes.each { cause ->
                            if (cause.toString().contains('github')) {
                                isTriggerFromGitHub = true
                            }
                        }
                    } catch (Exception e) {
                        echo "Error determining build cause: ${e.getMessage()}"
                    }
                    
                    // Get branch name from environment variables again for safety
                    def currentBranch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '')
                    
                    if (currentBranch == 'main' && env.DEPLOY_TYPE == 'standard' && isTriggerFromGitHub) {
                        env.DEPLOY_TYPE = 'canary'
                        echo "Auto-detected prod deployment from GitHub push. Using canary deployment for safety."
                    }
                }
            }
        }

        stage('Validate Parameters') {
            steps {
                script {
                    if (env.DEPLOY_TYPE == 'rollback' && params.ROLLBACK_VERSION == '') {
                        error "Rollback version is required for rollback deployment type"
                    }
                    
                    if (env.DEPLOY_TYPE == 'canary') {
                        def canaryWeight = params.CANARY_WEIGHT.toInteger()
                        if (canaryWeight < 1 || canaryWeight > 99) {
                            error "Canary weight must be between 1 and 99"
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
        
        stage('Build Docker Image') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' }
            }
            steps {
                script {
                    try {
                        sh "docker build -t ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ."
                        
                        if (env.DEPLOY_TYPE == 'canary') {
                            sh "docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                        }
                    } catch (Exception e) {
                        echo "Error building Docker image: ${e.getMessage()}"
                        echo "Checking if Docker is installed..."
                        sh "which docker || echo 'Docker not found'"
                        sh "id | grep docker || echo 'User not in docker group'"
                        throw e
                    }
                }
            }
        }
        
        stage('Push Docker Image') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' }
            }
            steps {
                withCredentials([usernamePassword(credentialsId: 'docker-registry-credentials', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh "echo ${DOCKER_PASSWORD} | docker login -u ${DOCKER_USER} --password-stdin"
                    sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
                    
                    script {
                        if (env.DEPLOY_TYPE == 'canary') {
                            sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                        }
                    }
                }
            }
        }
        
        stage('Update Config Files') {
            steps {
                script {
                    def envFile = '.env'
                    def composeFile = 'docker-compose.yml'
                    
                    // Create environment-specific .env file
                    if (env.DEPLOY_ENV == 'dev') {
                        sh "sed -i 's/IS_DEV=false/IS_DEV=true/g' ${envFile}"
                        sh "sed -i 's/REDIS_SENTINELS_PROD/REDIS_SENTINELS_DEV/g' ${composeFile}"
                        sh "sed -i 's/REDIS_HOST_PROD/REDIS_HOST_DEV/g' ${composeFile}"
                    }
                    
                    // Update canary deployment settings if needed
                    if (env.DEPLOY_TYPE == 'canary') {
                        sh "sed -i 's/CANARY_WEIGHT=.*/CANARY_WEIGHT=${params.CANARY_WEIGHT}/g' ${envFile}"
                    }
                    
                    // Update Traefik configuration to use IP instead of domain name
                    if (fileExists('traefik/traefik.yml')) {
                        sh "sed -i 's/your-domain.com/${DROPLET_IP}/g' traefik/traefik.yml"
                    }
                    
                    // Update docker-compose.canary.yml to use IP instead of domain name
                    if (fileExists('docker-compose.canary.yml')) {
                        sh "sed -i 's/your-domain.com/${DROPLET_IP}/g' docker-compose.canary.yml"
                    }
                }
            }
        }
        
        stage('Prepare Deployment Target') {
            steps {
                script {
                    // Print diagnostic information about credentials
                    echo "Current environment: ${env.DEPLOY_ENV}"
                    echo "Credential environment: ${env.CRED_ENV}"
                    echo "Credentials ID to look for: ${env.CRED_ENV}-env-file"
                }
                
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    file(credentialsId: "${env.CRED_ENV}-env-file", variable: 'ENV_FILE')
                ]) {
                    script {
                        // Create deployment directory structure
                        sh """
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/traefik"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/scripts"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/backup"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/config/rclone"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/grafana/dashboards"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/grafana/datasources"
                        """
                        
                        // Copy the environment file with robust error handling
                        try {
                            // Check if ENV_FILE exists
                            sh "ls -la \"${ENV_FILE}\" || echo 'WARNING: ENV_FILE not found!'"
                            
                            // Create a default .env file if the credential doesn't exist
                            sh """
                                if [ ! -s "${ENV_FILE}" ]; then
                                    echo "Creating default .env file since '${env.CRED_ENV}-env-file' credential is missing"
                                    echo "DEPLOY_ENV=${env.DEPLOY_ENV}" > default.env
                                    echo "APP_VERSION=${env.APP_VERSION}" >> default.env
                                    echo "DROPLET_IP=${DROPLET_IP}" >> default.env
                                    scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no default.env ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/.env
                                else
                                    scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${ENV_FILE}" ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/.env
                                fi
                            """
                        } catch (Exception e) {
                            echo "Error handling env file: ${e.getMessage()}"
                            sh """
                                echo "Using .env file from repository instead"
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no .env ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/.env
                            """
                        }
                        
                        // Add DROPLET_IP to env file
                        sh """
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "grep -q 'DROPLET_IP=' ${DEPLOYMENT_DIR}/.env || echo 'DROPLET_IP=${DROPLET_IP}' >> ${DEPLOYMENT_DIR}/.env"
                        """
                        
                        // Copy configuration files from repository
                        sh """
                            # Copy docker-compose files
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose*.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/

                            # Copy db dump
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no backup/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/backup/ || true
                            
                            # Copy Traefik configuration
                            if [ -d "traefik" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no traefik/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/traefik/
                            fi
                            
                            # Copy scripts
                            if [ -d "scripts" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no scripts/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/scripts/
                                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "chmod +x ${DEPLOYMENT_DIR}/scripts/*.sh"
                            fi
                            
                            # Copy Prometheus configuration if it exists
                            if [ -f "prometheus.yml" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no prometheus.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/
                            fi
                            
                            # Copy Grafana configuration if it exists
                            if [ -d "grafana" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no grafana/datasources/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/grafana/datasources/ || true
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no grafana/dashboards/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/grafana/dashboards/ || true
                            fi
                            
                            # Copy rclone configuration if it exists
                            if [ -d "config/rclone" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no config/rclone/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/config/rclone/
                            fi
                        """
                        
                        // Create docker networks with safer approach
                        sh """
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} 'docker network ls | grep redis-network || docker network create redis-network'
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} 'docker network ls | grep monitoring-network || docker network create monitoring-network'
                        """
                    }
                }
            }
        }
        
        stage('Deploy Application') {
            steps {
                script {
                    if (env.DEPLOY_TYPE == 'rollback') {
                        deployRollback()
                    } else if (env.DEPLOY_TYPE == 'canary') {
                        deployCanary()
                    } else {
                        deployStandard()
                    }
                }
            }
        }
        
        stage('Health Check') {
            steps {
                script {
                    def healthCheckPort = 3000
                    def healthCheckPath = "/api/health"
                    def healthCheckUrl = "http://${DROPLET_IP}:${healthCheckPort}${healthCheckPath}"
                    
                    echo "Checking health at: ${healthCheckUrl}"
                    
                    def healthCheckAttempts = 0
                    def maxAttempts = 10
                    def healthCheckSuccess = false
                    
                    while (!healthCheckSuccess && healthCheckAttempts < maxAttempts) {
                        try {
                            def response = sh(script: "curl -s -o /dev/null -w '%{http_code}' ${healthCheckUrl}", returnStdout: true).trim()
                            if (response == "200") {
                                echo "Health check succeeded"
                                healthCheckSuccess = true
                            } else {
                                echo "Health check failed with response: ${response}, retrying..."
                                healthCheckAttempts++
                                sleep 15 // Wait 15 seconds before next attempt
                            }
                        } catch (Exception e) {
                            echo "Health check failed with exception: ${e.getMessage()}, retrying..."
                            healthCheckAttempts++
                            sleep 15
                        }
                    }
                    
                    if (!healthCheckSuccess) {
                        error "Health check failed after ${maxAttempts} attempts"
                    }
                }
            }
        }
        
        stage('Promote Canary') {
            when {
                expression { env.DEPLOY_TYPE == 'canary' }
            }
            steps {
                script {
                    // For automatic builds, we can optionally set a timeout and then auto-promote
                    // if no issues are detected during the canary phase
                    def isTriggerFromGitHub = false
                    try {
                        def causes = currentBuild.getBuildCauses()
                        causes.each { cause ->
                            if (cause.toString().contains('github')) {
                                isTriggerFromGitHub = true
                            }
                        }
                    } catch (Exception e) {
                        echo "Error determining build cause: ${e.getMessage()}"
                    }
                    
                    if (isTriggerFromGitHub) {
                        echo "Automated deployment from GitHub push. Monitoring canary for issues..."
                        
                        // Sleep for a monitoring period (e.g., 5 minutes)
                        sleep(time: 5, unit: 'MINUTES')
                        
                        // Check for any errors in logs or monitoring (simplified example)
                        def errorCheck = sh(script: "curl -s http://${DROPLET_IP}:3000/api/health | grep -c 'unhealthy' || true", returnStdout: true).trim()
                        
                        if (errorCheck == "0") {
                            echo "No issues detected in canary. Auto-promoting..."
                            promoteCanary()
                        } else {
                            error "Issues detected in canary deployment. Rolling back."
                        }
                    } else {
                        // For manual builds, require human approval
                        timeout(time: DEPLOY_TIMEOUT, unit: 'SECONDS') {
                            input message: "Canary deployment is serving ${params.CANARY_WEIGHT}% of traffic. Promote to 100%?", ok: 'Promote'
                        }
                        
                        promoteCanary()
                    }
                }
            }
        }
        
        stage('Cleanup') {
            steps {
                script {
                    if (env.DEPLOY_TYPE == 'canary') {
                        sh "docker rmi ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG} || true"
                    }
                    
                    // Clean up old images to save disk space - keep the last 5 builds
                    sh """
                        docker images ${DOCKER_REGISTRY}/${APP_IMAGE_NAME} --format '{{.Repository}}:{{.Tag}}' | 
                        sort -r | 
                        awk 'NR>5' | 
                        xargs -r docker rmi || true
                    """
                }
            }
        }
        
        stage('Notify Success') {
            steps {
                echo "Successfully deployed to ${env.DEPLOY_ENV} environment using ${env.DEPLOY_TYPE} deployment strategy."
                
                // Add notification integrations here if needed
                // For example, Slack, Email, MS Teams notifications
            }
        }
    }
    
    post {
        failure {
            script {
                if (env.DEPLOY_TYPE == 'canary') {
                    echo "Canary deployment failed, rolling back"
                    rollbackCanary()
                }
                
                // Add failure notifications here
                echo "Deployment to ${env.DEPLOY_ENV} environment failed!"
            }
        }
        success {
            echo "Deployment successful!"
        }
    }
}

// Helper functions for deployment strategies
def deployStandard() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // Create deployment environment file with necessary variables
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${appImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
        """
        
        // Deploy the full application stack with production profile
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose pull && \
                docker-compose --profile production up -d"
        """
    }
}

def deployCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def canaryWeight = params.CANARY_WEIGHT
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // Set up environment for canary deployment
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'CANARY_IMAGE=${canaryImage}';
                echo 'CANARY_WEIGHT=${canaryWeight}';
                echo 'APP_IMAGE=${appImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
            
            # First deploy the main infrastructure (Redis, monitoring, etc.)
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose pull && \
                docker-compose up -d redis-master redis-slave-1 redis-slave-2 redis-slave-3 redis-slave-4 \
                sentinel-1 sentinel-2 sentinel-3 redis-backup \
                prometheus grafana cadvisor \
                redis-exporter-master redis-exporter-slave1 redis-exporter-slave2 redis-exporter-slave3 redis-exporter-slave4"
                
            # Wait for Redis infrastructure to be ready
            echo "Waiting for Redis infrastructure to be ready..."
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                attempt=0; \
                max_attempts=${params.REDIS_MAX_ATTEMPTS ?: 30}; \
                sleep_duration=${params.REDIS_SLEEP_DURATION ?: 5}; \
                until [ \$attempt -ge \$max_attempts ] || docker exec -i \\\$(docker ps -q -f name=redis-master) redis-cli -a \\\${REDIS_PASSWORD} PING | grep -q 'PONG'; do \
                    attempt=\\\$((attempt+1)); \
                    echo 'Waiting for Redis to be ready... (\\\$attempt/\\\$max_attempts)'; \
                    sleep \\\$sleep_duration; \
                done; \
                if [ \$attempt -ge \$max_attempts ]; then \
                    echo 'Redis infrastructure did not become ready in time'; \
                    exit 1; \
                fi; \
                echo 'Redis infrastructure is ready'"
                
            # Then deploy both the stable and canary versions of the app
            echo "Deploying stable and canary applications..."
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export CANARY_IMAGE='${canaryImage}' && \
                export CANARY_WEIGHT='${canaryWeight}' && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose -f docker-compose.yml up -d app && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml up -d canary traefik"
        """
    }
}

def promoteCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // Update the main app to use the canary image (promotion)
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${canaryImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
            
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${canaryImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary || true && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary || true"
            
            # Also stop and remove Traefik if it's running
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop traefik || true && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f traefik || true"
            
            # Restart the main app with the canary image
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${canaryImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose --profile production up -d app"
        """
    }
}

def rollbackCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // Stop and remove the canary service, keeping the original app running
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${appImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
            
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary || true && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary || true"
            
            # Also stop and remove Traefik if it's running
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop traefik || true && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f traefik || true"
            
            # Ensure the main app is still running with the stable image
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose --profile production up -d app"
        """
    }
}

def deployRollback() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def rollbackImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${params.ROLLBACK_VERSION}"
        
        // Rollback by updating the app to the specified version while keeping the rest of the stack running
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${rollbackImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
            
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${rollbackImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose pull app && \
                docker-compose --profile production up -d app"
        """
    }
}