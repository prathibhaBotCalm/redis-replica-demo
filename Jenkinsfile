pipeline {
    agent any
    
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
        DEPLOY_ENV = "${params.ENVIRONMENT ?: 'auto'}"
        DEPLOY_TYPE = "${params.DEPLOYMENT_TYPE ?: 'canary'}"
    }
    
    parameters {
        choice(name: 'ENVIRONMENT', choices: ['auto', 'dev', 'staging', 'prod'], description: 'Deployment environment')
        choice(name: 'DEPLOYMENT_TYPE', choices: ['canary', 'standard', 'rollback'], description: 'Deployment type')
        string(name: 'CANARY_WEIGHT', defaultValue: '20', description: 'Percentage of traffic to route to canary (1-99)')
        string(name: 'ROLLBACK_VERSION', defaultValue: '', description: 'Version to rollback to')
        string(name: 'REDIS_MAX_ATTEMPTS', defaultValue: '50', description: 'Maximum attempts to wait for Redis readiness')
        string(name: 'REDIS_SLEEP_DURATION', defaultValue: '5', description: 'Sleep duration between Redis readiness checks')
    }
    
    triggers {
        pollSCM('* * * * *')
        githubPush()
    }
    
    stages {
        stage('Initialize Environment') {
            steps {
                script {
                    def isTriggerFromGitHub = tryGitHubTriggerDetection()
                    
                    if (isTriggerFromGitHub) {
                        def branch = detectGitBranch()
                        setAutoDeploymentValues(branch)
                    } else {
                        env.DEPLOY_ENV = params.ENVIRONMENT
                        env.DEPLOY_TYPE = params.DEPLOYMENT_TYPE
                    }
                    
                    // Force canary for production main branch
                    if ((env.BRANCH_NAME == 'main' || env.BRANCH_NAME == 'master') && env.DEPLOY_ENV == 'prod') {
                        env.DEPLOY_TYPE = 'canary'
                        echo "Forcing canary deployment for production main branch"
                    }
                }
            }
        }

        stage('Validate Parameters') {
            steps {
                script {
                    if (env.DEPLOY_TYPE == 'rollback' && params.ROLLBACK_VERSION == '') {
                        error "Rollback version is required for rollback deployment"
                    }
                    
                    if (env.DEPLOY_TYPE == 'canary') {
                        def weight = params.CANARY_WEIGHT.toInteger()
                        if (weight < 1 || weight > 99) {
                            error "Canary weight must be between 1 and 99"
                        }
                    }
                }
            }
        }
        
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }
        
        stage('Build Docker Images') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' }
            }
            steps {
                script {
                    sh "docker build -t ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ."
                    
                    if (env.DEPLOY_TYPE == 'canary') {
                        sh "docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                    }
                }
            }
        }
        
        stage('Push Docker Images') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' }
            }
            steps {
                withCredentials([usernamePassword(credentialsId: 'docker-registry-credentials', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh "echo ${DOCKER_PASSWORD} | docker login -u ${DOCKER_USER} --password-stdin"
                    sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
                    
                    if (env.DEPLOY_TYPE == 'canary') {
                        sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                    }
                }
            }
        }
        
        stage('Prepare Deployment') {
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    file(credentialsId: "${env.DEPLOY_ENV == 'auto' ? 'prod' : env.DEPLOY_ENV}-env-file", variable: 'ENV_FILE')
                ]) {
                    script {
                        prepareDeploymentDirectory()
                        copyConfigurationFiles()
                        setupDockerNetworks()
                        
                        // Update Traefik configuration with current IP
                        sh """
                            sed -i 's/DROPLET_IP=.*/DROPLET_IP=${DROPLET_IP}/g' .env
                            sed -i 's/CANARY_WEIGHT=.*/CANARY_WEIGHT=${CANARY_WEIGHT}/g' .env
                        """
                    }
                }
            }
        }
        
        stage('Deploy Application') {
            steps {
                script {
                    switch(env.DEPLOY_TYPE) {
                        case 'rollback':
                            deployRollback()
                            break
                        case 'canary':
                            deployCanary()
                            break
                        default:
                            deployStandard()
                    }
                }
            }
        }
        
        stage('Health Check') {
            steps {
                script {
                    def healthCheckUrl = "http://${DROPLET_IP}:3000/api/health"
                    def attempts = 0
                    def maxAttempts = 10
                    def success = false
                    
                    while (!success && attempts < maxAttempts) {
                        try {
                            def response = sh(script: "curl -s -o /dev/null -w '%{http_code}' ${healthCheckUrl}", returnStdout: true).trim()
                            if (response == "200") {
                                success = true
                                echo "Health check passed"
                            } else {
                                attempts++
                                sleep(15)
                                echo "Health check failed (attempt ${attempts}/${maxAttempts})"
                            }
                        } catch (Exception e) {
                            attempts++
                            sleep(15)
                            echo "Health check error: ${e.getMessage()}"
                        }
                    }
                    
                    if (!success) {
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
                    if (isGitHubTriggeredBuild()) {
                        monitorCanaryAndPromote()
                    } else {
                        timeout(time: DEPLOY_TIMEOUT, unit: 'SECONDS') {
                            input message: "Canary serving ${CANARY_WEIGHT}% traffic. Promote to 100%?", ok: 'Promote'
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
                    
                    // Clean up old images
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
                if (env.DEPLOY_TYPE == 'canary') {
                    rollbackCanary()
                }
                echo "Deployment failed!"
            }
        }
        success {
            echo "Deployment successful!"
        }
    }
}

// Helper functions
def tryGitHubTriggerDetection() {
    try {
        def causes = currentBuild.getBuildCauses()
        return causes.any { cause -> 
            cause.toString().contains('github') || 
            cause.toString().contains('GitHub') ||
            cause.toString().contains('SCMTrigger')
        } || (env.CHANGE_ID != null || env.GIT_COMMIT != null)
    } catch (Exception e) {
        echo "Error detecting trigger: ${e.getMessage()}"
        return false
    }
}

def detectGitBranch() {
    def branch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '')
    if (!branch) {
        branch = sh(script: "git branch --contains HEAD | grep '*' | cut -d' ' -f2", returnStdout: true).trim() ?: 'dev'
    }
    return branch
}

def setAutoDeploymentValues(branch) {
    if (branch == 'main' || branch == 'master') {
        env.DEPLOY_ENV = 'prod'
        env.DEPLOY_TYPE = 'canary'
        env.CANARY_WEIGHT = '20'
    } else if (branch == 'staging') {
        env.DEPLOY_ENV = 'staging'
        env.DEPLOY_TYPE = 'standard'
    } else {
        env.DEPLOY_ENV = 'dev'
        env.DEPLOY_TYPE = 'standard'
    }
}

def prepareDeploymentDirectory() {
    sh """
        ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}"
        ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/traefik"
        ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/scripts"
        
        # Copy env file or create default
        if [ -s "${ENV_FILE}" ]; then
            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${ENV_FILE}" ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/.env
        else
            echo "Creating default .env"
            echo "DEPLOY_ENV=${env.DEPLOY_ENV}" > default.env
            echo "APP_VERSION=${env.APP_VERSION}" >> default.env
            echo "DROPLET_IP=${DROPLET_IP}" >> default.env
            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no default.env ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/.env
        fi
    """
}

def copyConfigurationFiles() {
    sh """
        scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no docker-compose.yml ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/
        scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no .env ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/
        
        # Copy supporting files
        if [ -d "scripts" ]; then
            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no scripts/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/scripts/
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "chmod +x ${DEPLOYMENT_DIR}/scripts/*.sh"
        fi
        
        if [ -d "traefik" ]; then
            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no traefik/* ${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/traefik/
        fi
    """
}

def setupDockerNetworks() {
    sh """
        ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "
            docker network ls | grep redis-network || docker network create redis-network
            docker network ls | grep monitoring-network || docker network create monitoring-network
        "
    """
}

def deployStandard() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "
                cd ${DEPLOYMENT_DIR}
                echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}' > .env.deployment
                echo 'DROPLET_IP=${DROPLET_IP}' >> .env.deployment
                docker-compose --profile production up -d --remove-orphans
            "
        """
    }
}

def deployCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "
                cd ${DEPLOYMENT_DIR}
                echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}' > .env.deployment
                echo 'CANARY_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}' >> .env.deployment
                echo 'CANARY_WEIGHT=${CANARY_WEIGHT}' >> .env.deployment
                echo 'DROPLET_IP=${DROPLET_IP}' >> .env.deployment
                
                # Deploy infrastructure first
                docker-compose up -d redis-master redis-slave-1 redis-slave-2 redis-slave-3 redis-slave-4 \\
                    sentinel-1 sentinel-2 sentinel-3 redis-backup \\
                    prometheus grafana cadvisor \\
                    redis-exporter-master redis-exporter-slave1 redis-exporter-slave2 redis-exporter-slave3 redis-exporter-slave4
                
                # Wait for Redis
                attempt=0
                max_attempts=${params.REDIS_MAX_ATTEMPTS ?: 50}
                sleep_duration=${params.REDIS_SLEEP_DURATION ?: 5}
                until [ \$attempt -ge \$max_attempts ]; do
                    attempt=\$((attempt+1))
                    if docker ps | grep -q redis-master && \\
                       docker exec -i \$(docker ps -q -f name=redis-master) redis-cli PING 2>/dev/null | grep -q 'PONG'; then
                        break
                    fi
                    sleep \$sleep_duration
                done
                
                # Deploy app with canary
                docker-compose --profile production --profile canary up -d --remove-orphans
            "
        """
    }
}

def promoteCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "
                cd ${DEPLOYMENT_DIR}
                echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}' > .env.deployment
                echo 'DROPLET_IP=${DROPLET_IP}' >> .env.deployment
                docker-compose --profile production up -d app --remove-orphans
            "
        """
    }
}

def rollbackCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "
                cd ${DEPLOYMENT_DIR}
                echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}' > .env.deployment
                docker-compose --profile production up -d app --remove-orphans
            "
        """
    }
}

def deployRollback() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "
                cd ${DEPLOYMENT_DIR}
                echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${params.ROLLBACK_VERSION}' > .env.deployment
                docker-compose --profile production up -d app --remove-orphans
            "
        """
    }
}

def isGitHubTriggeredBuild() {
    return currentBuild.getBuildCauses().any { cause -> 
        cause.toString().contains('github') || 
        cause.toString().contains('GitHub') ||
        cause.toString().contains('SCMTrigger')
    } || (env.CHANGE_ID != null || env.GIT_COMMIT != null)
}

def monitorCanaryAndPromote() {
    echo "Automated canary deployment detected. Monitoring for 5 minutes..."
    sleep(time: 5, unit: 'MINUTES')
    
    def healthCheckUrl = "http://${DROPLET_IP}:3000/api/health"
    try {
        def response = sh(script: "curl -s -o /dev/null -w '%{http_code}' ${healthCheckUrl}", returnStdout: true).trim()
        def errorCheck = sh(script: "curl -s ${healthCheckUrl} | grep -c 'unhealthy' || true", returnStdout: true).trim()
        
        if (response == "200" && errorCheck == "0") {
            promoteCanary()
        } else {
            error "Canary health check failed. Rolling back."
            rollbackCanary()
        }
    } catch (Exception e) {
        error "Canary monitoring error: ${e.getMessage()}. Rolling back."
        rollbackCanary()
    }
}