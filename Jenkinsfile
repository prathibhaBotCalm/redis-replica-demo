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
    }
    
    parameters {
        choice(name: 'ENVIRONMENT', choices: ['dev', 'staging', 'prod'], description: 'Deployment environment')
        choice(name: 'DEPLOYMENT_TYPE', choices: ['standard', 'canary', 'rollback'], description: 'Deployment type')
        string(name: 'CANARY_WEIGHT', defaultValue: '20', description: 'Percentage of traffic to route to canary (1-99)')
        string(name: 'ROLLBACK_VERSION', defaultValue: '', description: 'Version to rollback to (required for rollback)')
    }
    
    stages {
        stage('Validate Parameters') {
            steps {
                script {
                    if (params.DEPLOYMENT_TYPE == 'rollback' && params.ROLLBACK_VERSION == '') {
                        error "Rollback version is required for rollback deployment type"
                    }
                    
                    if (params.DEPLOYMENT_TYPE == 'canary') {
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
                expression { params.DEPLOYMENT_TYPE != 'rollback' }
            }
            steps {
                script {
                    try {
                        sh "docker build -t ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ."
                        
                        if (params.DEPLOYMENT_TYPE == 'canary') {
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
                expression { params.DEPLOYMENT_TYPE != 'rollback' }
            }
            steps {
                withCredentials([usernamePassword(credentialsId: 'docker-registry-credentials', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh "echo ${DOCKER_PASSWORD} | docker login -u ${DOCKER_USER} --password-stdin"
                    sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
                    
                    script {
                        if (params.DEPLOYMENT_TYPE == 'canary') {
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
                    if (params.ENVIRONMENT == 'dev') {
                        sh "sed -i 's/IS_DEV=false/IS_DEV=true/g' ${envFile}"
                        sh "sed -i 's/REDIS_SENTINELS_PROD/REDIS_SENTINELS_DEV/g' ${composeFile}"
                        sh "sed -i 's/REDIS_HOST_PROD/REDIS_HOST_DEV/g' ${composeFile}"
                    }
                    
                    // Update canary deployment settings if needed
                    if (params.DEPLOYMENT_TYPE == 'canary') {
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
                withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    script {
                        def deploymentHost = env.DROPLET_IP
                        def deploymentDir = env.DEPLOYMENT_DIR
                        
                        // Create deployment directory and required subdirectories
                        sh '''
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                                mkdir -p ''' + "${deploymentDir}" + ''' && \
                                mkdir -p ''' + "${deploymentDir}/traefik" + '''
                            "
                        '''
                        
                        // Copy necessary files to deployment target using more secure approach
                        sh '''
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/" + '''
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.canary.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/" + '''
                            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no .env ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/" + '''
                        '''
                        
                        // Check if traefik directory exists before copying
                        sh '''
                            if [ -d "traefik" ] && [ -f "traefik/traefik.yml" ]; then
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no traefik/traefik.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/traefik/" + '''
                            else
                                echo "Traefik config not found, creating minimal config"
                                mkdir -p traefik
                                echo "api:" > traefik/traefik.yml
                                echo "  dashboard: true" >> traefik/traefik.yml
                                echo "  insecure: true" >> traefik/traefik.yml
                                echo "entryPoints:" >> traefik/traefik.yml
                                echo "  web:" >> traefik/traefik.yml
                                echo "    address: \":80\"" >> traefik/traefik.yml
                                echo "providers:" >> traefik/traefik.yml
                                echo "  docker:" >> traefik/traefik.yml
                                echo "    endpoint: \"unix:///var/run/docker.sock\"" >> traefik/traefik.yml
                                echo "    exposedByDefault: false" >> traefik/traefik.yml
                                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no traefik/traefik.yml ''' + "${SSH_USER}@${deploymentHost}:${deploymentDir}/traefik/" + '''
                            fi
                        '''
                    }
                }
            }
        }
        
        stage('Deploy Application') {
            steps {
                script {
                    if (params.DEPLOYMENT_TYPE == 'rollback') {
                        deployRollback()
                    } else if (params.DEPLOYMENT_TYPE == 'canary') {
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
                    def healthCheckPort = params.ENVIRONMENT == 'prod' ? 3000 : 3000
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
                expression { params.DEPLOYMENT_TYPE == 'canary' }
            }
            steps {
                timeout(time: DEPLOY_TIMEOUT, unit: 'SECONDS') {
                    input message: "Canary deployment is serving ${params.CANARY_WEIGHT}% of traffic. Promote to 100%?", ok: 'Promote'
                }
                
                script {
                    promoteCanary()
                }
            }
        }
        
        stage('Cleanup') {
            steps {
                script {
                    if (params.DEPLOYMENT_TYPE == 'canary') {
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
    }
    
    post {
        failure {
            script {
                if (params.DEPLOYMENT_TYPE == 'canary') {
                    echo "Canary deployment failed, rolling back"
                    rollbackCanary()
                }
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
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                cat > .env.deployment << EOF
APP_IMAGE=''' + "${appImage}" + '''
EOF
                export APP_IMAGE=''' + "${appImage}" + ''' && \
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
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                cat > .env.deployment << EOF
CANARY_IMAGE=''' + "${canaryImage}" + '''
CANARY_WEIGHT=''' + "${canaryWeight}" + '''
EOF
                export CANARY_IMAGE=''' + "${canaryImage}" + ''' && \
                export CANARY_WEIGHT=''' + "${canaryWeight}" + ''' && \
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
EOF
                export APP_IMAGE=''' + "${canaryImage}" + ''' && \
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
        
        // More secure way to use SSH key without string interpolation
        sh '''
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ''' + "${SSH_USER}@${deploymentHost}" + ''' "
                cd ''' + "${env.DEPLOYMENT_DIR}" + ''' && \
                export CANARY_IMAGE=''' + "${canaryImage}" + ''' && \
                export CANARY_WEIGHT=''' + "${params.CANARY_WEIGHT}" + ''' && \
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
EOF
                export APP_IMAGE=''' + "${rollbackImage}" + ''' && \
                docker-compose pull app && \
                docker-compose --profile production up -d app
            "
        '''
    }
}