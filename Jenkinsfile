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
                    if (env.DEPLOY_ENV == 'auto') {
                        // Auto-detect based on branch name
                        def branch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '')
                        echo "Detected branch: ${branch}"
                        
                        switch(branch) {
                            case 'main':
                            case 'master':
                                env.DEPLOY_ENV = 'prod'
                                break
                            case 'staging':
                                env.DEPLOY_ENV = 'staging'
                                break
                            default:
                                env.DEPLOY_ENV = 'dev'
                        }
                    }
                    
                    echo "Deploying to environment: ${env.DEPLOY_ENV}"
                    
                    // For automatic deployments to prod, default to canary for safety
                    if (env.DEPLOY_ENV == 'prod' && !params.DEPLOYMENT_TYPE && currentBuild.getBuildCauses()[0].toString().contains('github')) {
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
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    file(credentialsId: "${env.DEPLOY_ENV}-env-file", variable: 'ENV_FILE')
                ]) {
                    script {
                        // Fix 1: Break down the complex SSH commands into smaller, manageable chunks
                        // Create deployment directory structure
                        sh """
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/traefik"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/scripts"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/backup"
                        """
                        
                        // Fix 2: Copy the environment file with simpler command
                        sh "scp -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no \"${ENV_FILE}\" ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/.env"
                        
                        // Fix 3: Add DROPLET_IP to env file with cleaner approach
                        sh """
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "grep -q 'DROPLET_IP=' ${DEPLOYMENT_DIR}/.env || echo 'DROPLET_IP=${DROPLET_IP}' >> ${DEPLOYMENT_DIR}/.env"
                        """
                        
                        // Fix 4: Copy compose files safely
                        sh """
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/
                            [ -f docker-compose.canary.yml ] && scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.canary.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/ || echo "No canary compose file found"
                        """
                        
                        // Fix 5: Create Redis init scripts - split into separate commands
                        def masterScript = '''#!/bin/bash
echo "Redis master configuration"
redis-server --requirepass "${REDIS_PASSWORD}"
'''
                        
                        def slaveScript = '''#!/bin/bash
echo "Redis slave configuration"
redis-server --slaveof ${REDIS_MASTER_HOST} ${REDIS_MASTER_PORT} --requirepass "${REDIS_PASSWORD}" --masterauth "${REDIS_PASSWORD}"
'''
                        
                        // Write scripts to temporary files and copy them over
                        writeFile file: 'temp-init-master.sh', text: masterScript
                        writeFile file: 'temp-init-slave.sh', text: slaveScript
                        
                        sh """
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no temp-init-master.sh ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/scripts/init-master.sh
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no temp-init-slave.sh ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/scripts/init-slave.sh
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "chmod +x ${DEPLOYMENT_DIR}/scripts/init-master.sh"
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "chmod +x ${DEPLOYMENT_DIR}/scripts/init-slave.sh"
                        """
                        
                        // Fix 6: Handle traefik configuration more safely
                        if (fileExists('traefik/traefik.yml')) {
                            sh "scp -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no traefik/traefik.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/traefik/"
                        } else {
                            def traefikConfig = '''api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  metrics:
    address: ":8082"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: monitoring-network

metrics:
  prometheus:
    entryPoint: metrics
    addServicesLabels: true
    addEntryPointsLabels: true

log:
  level: DEBUG
'''
                            writeFile file: 'temp-traefik.yml', text: traefikConfig
                            sh "scp -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no temp-traefik.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/traefik/traefik.yml"
                        }
                        
                        // Fix 7: Create docker networks with safer approach
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
                    def healthCheckPort = env.DEPLOY_ENV == 'prod' ? 3000 : 3000
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
                    if (currentBuild.getBuildCauses()[0].toString().contains('github')) {
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
        
        // Fix 8: Create a more structured deployment step for standard deployments
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && echo 'APP_IMAGE=${appImage}' > .env.deployment"
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && echo 'DROPLET_IP=${deploymentHost}' >> .env.deployment"
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && export APP_IMAGE='${appImage}' && export DROPLET_IP='${deploymentHost}' && docker-compose pull app"
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && export APP_IMAGE='${appImage}' && export DROPLET_IP='${deploymentHost}' && docker-compose --profile production up -d app"
        """
    }
}

def deployCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def canaryWeight = params.CANARY_WEIGHT
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // Fix 9: Create a better structured canary deployment
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'CANARY_IMAGE=${canaryImage}';
                echo 'CANARY_WEIGHT=${canaryWeight}';
                echo 'APP_IMAGE=${appImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
            
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export CANARY_IMAGE='${canaryImage}' && \
                export CANARY_WEIGHT='${canaryWeight}' && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml --profile production up -d canary traefik"
        """
    }
}

def promoteCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        
        // Fix 10: Better structured canary promotion
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${canaryImage}';
                echo 'DROPLET_IP=${deploymentHost}';
                echo 'CANARY_IMAGE=${canaryImage}';
                echo 'CANARY_WEIGHT=${params.CANARY_WEIGHT}';
            } > .env.deployment"
            
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export APP_IMAGE='${canaryImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                export CANARY_IMAGE='${canaryImage}' && \
                export CANARY_WEIGHT='${params.CANARY_WEIGHT}' && \
                docker-compose pull app && \
                docker-compose --profile production up -d app && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary"
        """
    }
}

def rollbackCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // Fix 11: Improved canary rollback process
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \
                export CANARY_IMAGE='${canaryImage}' && \
                export CANARY_WEIGHT='${params.CANARY_WEIGHT}' && \
                export APP_IMAGE='${appImage}' && \
                export DROPLET_IP='${deploymentHost}' && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary || true && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary || true"
        """
    }
}

def deployRollback() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def rollbackImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${params.ROLLBACK_VERSION}"
        
        // Fix 12: Better structured rollback deployment
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