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
                        def deploymentHost = env.DROPLET_IP
                        def deploymentDir = env.DEPLOYMENT_DIR
                        
                        // Create deployment directory and required subdirectories
                        sh '''
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                mkdir -p ''' + "${deploymentDir}" + ''' && \
                                mkdir -p ''' + "${deploymentDir}/traefik" + ''' && \
                                mkdir -p ''' + "${deploymentDir}/scripts" + '''
                            "
                        '''
                        
                        // Copy the environment-specific env file from Jenkins credentials
                        sh '''
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${ENV_FILE}" ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/.env" + '''
                        '''
                        
                        // Add DROPLET_IP to env file if not present
                        sh '''
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                grep -q 'DROPLET_IP=' ''' + "${deploymentDir}/.env" + ''' || echo 'DROPLET_IP=''' + "${deploymentHost}" + '''' >> ''' + "${deploymentDir}/.env" + '''
                            "
                        '''
                        
                        // Copy necessary files to deployment target using more secure approach
                        sh '''
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/" + '''
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.canary.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/" + '''
                        '''
                        
                        // Create directory structure for Redis scripts
                        sh '''
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                mkdir -p ''' + "${deploymentDir}/scripts" + '''
                                
                                # Create minimal Redis master init script if it doesn't exist
                                cat > ''' + "${deploymentDir}/scripts/init-master.sh" + ''' << 'EOF'
#!/bin/bash
echo "Redis master configuration"
redis-server --requirepass "${REDIS_PASSWORD}"
EOF
                                
                                # Create minimal Redis slave init script if it doesn't exist
                                cat > ''' + "${deploymentDir}/scripts/init-slave.sh" + ''' << 'EOF'
#!/bin/bash
echo "Redis slave configuration"
redis-server --slaveof ${REDIS_MASTER_HOST} ${REDIS_MASTER_PORT} --requirepass "${REDIS_PASSWORD}" --masterauth "${REDIS_PASSWORD}"
EOF

                                # Make scripts executable
                                chmod +x ''' + "${deploymentDir}/scripts/init-master.sh" + '''
                                chmod +x ''' + "${deploymentDir}/scripts/init-slave.sh" + '''
                            "
                        '''
                        
                        // Check if traefik directory exists and create minimal config if needed
                        sh '''
                            if [ -d "traefik" ] && [ -f "traefik/traefik.yml" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no traefik/traefik.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/traefik/" + '''
                            else
                                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                    echo "Traefik config not found, creating minimal config"
                                    cat > ''' + "${deploymentDir}/traefik/traefik.yml" + ''' << EOF
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: \":80\"
  metrics:
    address: \":8082\"

providers:
  docker:
    endpoint: \"unix:///var/run/docker.sock\"
    exposedByDefault: false
    network: monitoring-network

metrics:
  prometheus:
    entryPoint: metrics
    addServicesLabels: true
    addEntryPointsLabels: true

log:
  level: DEBUG
EOF
                                "
                            fi
                        '''
                        
                        // Create backup directories
                        sh '''
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                mkdir -p ''' + "${deploymentDir}/backup" + '''
                            "
                        '''
                        
                        // Create docker networks if they don't exist
                        sh '''
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                docker network ls | grep redis-network || docker network create redis-network
                                docker network ls | grep monitoring-network || docker network create monitoring-network
                            "
                        '''
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

// Helper functions for deployment strategies would be the same as in your current Jenkinsfile

// Helper functions for deployment strategies
def deployStandard() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                cat > .env.deployment << EOF
APP_IMAGE=''' + "${appImage}" + '''
DROPLET_IP=''' + "${deploymentHost}" + '''
EOF
                export APP_IMAGE=''' + "${appImage}" + ''' && \
                export DROPLET_IP=''' + "${deploymentHost}" + ''' && \
                docker-compose pull app && \
                docker-compose --profile production up -d app
            "
        '''
    }
}

def deployCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def canaryWeight = params.CANARY_WEIGHT
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                cat > .env.deployment << EOF
CANARY_IMAGE=''' + "${canaryImage}" + '''
CANARY_WEIGHT=''' + "${canaryWeight}" + '''
APP_IMAGE=''' + "${appImage}" + '''
DROPLET_IP=''' + "${deploymentHost}" + '''
EOF
                export CANARY_IMAGE=''' + "${canaryImage}" + ''' && \
                export CANARY_WEIGHT=''' + "${canaryWeight}" + ''' && \
                export APP_IMAGE=''' + "${appImage}" + ''' && \
                export DROPLET_IP=''' + "${deploymentHost}" + ''' && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml --profile production up -d canary traefik
            "
        '''
    }
}

def promoteCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                cat > .env.deployment << EOF
APP_IMAGE=''' + "${canaryImage}" + '''
DROPLET_IP=''' + "${deploymentHost}" + '''
CANARY_IMAGE=''' + "${canaryImage}" + '''
CANARY_WEIGHT=''' + "${params.CANARY_WEIGHT}" + '''
EOF
                export APP_IMAGE=''' + "${canaryImage}" + ''' && \
                export DROPLET_IP=''' + "${deploymentHost}" + ''' && \
                export CANARY_IMAGE=''' + "${canaryImage}" + ''' && \
                export CANARY_WEIGHT=''' + "${params.CANARY_WEIGHT}" + ''' && \
                docker-compose pull app && \
                docker-compose --profile production up -d app && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary
            "
        '''
    }
}

def rollbackCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                export CANARY_IMAGE=''' + "${canaryImage}" + ''' && \
                export CANARY_WEIGHT=''' + "${params.CANARY_WEIGHT}" + ''' && \
                export APP_IMAGE=''' + "${appImage}" + ''' && \
                export DROPLET_IP=''' + "${deploymentHost}" + ''' && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary || true && \
                docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary || true
            "
        '''
    }
}

def deployRollback() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def rollbackImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${params.ROLLBACK_VERSION}"
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                cat > .env.deployment << EOF
APP_IMAGE=''' + "${rollbackImage}" + '''
DROPLET_IP=''' + "${deploymentHost}" + '''
EOF
                export APP_IMAGE=''' + "${rollbackImage}" + ''' && \
                export DROPLET_IP=''' + "${deploymentHost}" + ''' && \
                docker-compose pull app && \
                docker-compose --profile production up -d app
            "
        '''
    }
}