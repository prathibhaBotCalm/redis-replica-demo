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
        DEPLOY_TYPE = "${params.DEPLOYMENT_TYPE ?: 'canary'}" // Default deployment type
    }
    
    parameters {
        choice(name: 'ENVIRONMENT', choices: ['auto', 'dev', 'staging', 'prod'], description: 'Deployment environment (auto will determine based on branch)')
        choice(name: 'DEPLOYMENT_TYPE', choices: ['canary', 'standard', 'rollback'], description: 'Deployment type')
        string(name: 'CANARY_WEIGHT', defaultValue: '20', description: 'Percentage of traffic to route to canary (1-99)')
        string(name: 'ROLLBACK_VERSION', defaultValue: '', description: 'Version to rollback to (required for rollback)')
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

        stage('Initialize Environment Variables') {
            steps {
                script {
                    // Determine if this is a triggered build from GitHub
                    def isTriggerFromGitHub = false
                    try {
                        def causes = currentBuild.getBuildCauses()
                        causes.each { cause ->
                            echo "Build cause: ${cause}"
                            if (cause.toString().contains('github') || 
                                cause.toString().contains('GitHub') ||
                                cause.toString().contains('GitHubPushCause') || 
                                cause.toString().contains('SCMTriggerCause') || 
                                cause.toString().contains('Remote')) {
                                isTriggerFromGitHub = true
                                echo "Detected automatic GitHub trigger"
                            }
                        }
                        
                        // Additional detection methods
                        if (!isTriggerFromGitHub && (env.CHANGE_ID != null || env.GIT_COMMIT != null)) {
                            echo "Detected GitHub trigger via metadata"
                            isTriggerFromGitHub = true
                        }
                    } catch (Exception e) {
                        echo "Error determining build cause: ${e.getMessage()}"
                    }
                    
                    // Different initialization for automatic vs manual builds
                    if (isTriggerFromGitHub) {
                        // For automatic GitHub push builds, use default values that are safe
                        echo "Automatic build detected - setting default safe values"
                        
                        // Get branch name with improved detection
                        def branch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '')
                        
                        if (branch == null || branch.trim() == '') {
                            try {
                                def gitOutput = sh(script: "git branch --contains HEAD | grep '*' | cut -d' ' -f2", returnStdout: true).trim()
                                branch = gitOutput ?: 'unknown'
                            } catch (Exception e) {
                                branch = 'unknown'
                            }
                        }
                        
                        echo "Detected branch: ${branch}"
                        
                        // Safer defaults based on the branch
                        if (branch == 'main' || branch == 'master') {
                            env.DEPLOY_ENV = 'prod'
                            env.DEPLOY_TYPE = 'canary'  // Always use canary for automatic main branch builds
                            env.CANARY_WEIGHT = '20'    // Default to 20% traffic
                        } else if (branch == 'staging') {
                            env.DEPLOY_ENV = 'staging'
                            env.DEPLOY_TYPE = 'standard'
                        } else {
                            env.DEPLOY_ENV = 'dev'
                            env.DEPLOY_TYPE = 'standard'
                        }
                    } else {
                        // For manual builds, use the parameters from the UI
                        env.DEPLOY_ENV = params.ENVIRONMENT
                        env.DEPLOY_TYPE = params.DEPLOYMENT_TYPE
                    }
                    
                    echo "Initial environment setting: ${env.DEPLOY_ENV}"
                    echo "Initial deployment type: ${env.DEPLOY_TYPE}"
                }
            }
        }

        stage('Finalize Environment Settings') {
            steps {
                script {
                    // Print diagnostic information about environment variables
                    echo "Branch name: ${env.BRANCH_NAME}"
                    echo "GIT_BRANCH: ${env.GIT_BRANCH}"
                    
                    // Get branch name with improved detection
                    def branch = env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '')
                    
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
                    
                    echo "Resolved branch name: ${branch}"
                    
                    // Set environment based on branch if auto-detect is enabled and not already set
                    if (env.DEPLOY_ENV == 'auto') {
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
                    
                    // Final deployment type validation - ensure main branch always uses canary deployment
                    if ((branch == 'main' || branch == 'master') && env.DEPLOY_ENV == 'prod') {
                        // Force canary deployment for production main branch regardless of what's been set
                        // This is a safety mechanism
                        env.DEPLOY_TYPE = 'canary'
                        echo "IMPORTANT: Production main branch deployment detected - OVERRIDING to canary deployment for safety"
                    }
                    
                    echo "Final deployment type: ${env.DEPLOY_TYPE}"
                    
                    // Store a separate value for the credential ID determination
                    if (env.DEPLOY_ENV == 'auto') {
                        env.CRED_ENV = 'prod'  // Use prod-env-file when auto is detected
                        echo "Using credential ID: ${env.CRED_ENV}-env-file for auto environment"
                    } else {
                        env.CRED_ENV = env.DEPLOY_ENV
                        echo "Using credential ID: ${env.CRED_ENV}-env-file"
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
                    
                    // Update Nginx configuration to use IP instead of domain name
                    if (fileExists('nginx/nginx.conf')) {
                        sh "sed -i 's/your-domain.com/${DROPLET_IP}/g' nginx/nginx.conf"
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
                    echo "Deployment type: ${env.DEPLOY_TYPE}"
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
                            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/nginx"
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
                            
                            # Copy Nginx configuration
                            if [ -d "nginx" ]; then
                                scp -i \$SSH_KEY -o StrictHostKeyChecking=no nginx/nginx.conf \${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/nginx/
                                ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${DROPLET_IP} "mkdir -p ${DEPLOYMENT_DIR}/nginx/conf.d"
                                scp -i \$SSH_KEY -o StrictHostKeyChecking=no nginx/conf.d/* \${SSH_USER}@${DROPLET_IP}:${DEPLOYMENT_DIR}/nginx/conf.d/ || true
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
                echo "Deploying ${env.DEPLOY_TYPE} deployment"
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
                expression { 
                    echo "Checking if we should promote canary (DEPLOY_TYPE=${env.DEPLOY_TYPE})"
                    return env.DEPLOY_TYPE == 'canary'
                }
            }
            steps {
                script {
                    // For automatic builds, we can optionally set a timeout and then auto-promote
                    // if no issues are detected during the canary phase
                    def isTriggerFromGitHub = false
                    echo "Checking if build was triggered from GitHub..."
                    try {
                        def causes = currentBuild.getBuildCauses()
                        causes.each { cause ->
                            echo "Promote stage - Build cause: ${cause}"
                            if (cause.toString().contains('github') || 
                                cause.toString().contains('GitHub') ||
                                cause.toString().contains('GitHubPushCause') || 
                                cause.toString().contains('SCMTriggerCause') || 
                                cause.toString().contains('Remote')) {
                                isTriggerFromGitHub = true
                                echo "Detected GitHub trigger in promote stage"
                            }
                        }
                        
                        // Also check for branch and git commit presence as trigger indicators
                        if (!isTriggerFromGitHub && (env.GIT_COMMIT != null || env.BRANCH_NAME != null)) {
                            echo "Assuming GitHub trigger based on Git metadata being present"
                            isTriggerFromGitHub = true
                        }
                    } catch (Exception e) {
                        echo "Error determining build cause: ${e.getMessage()}"
                    }
                    
                    def canaryWeight = env.CANARY_WEIGHT ?: params.CANARY_WEIGHT ?: "20"
                    echo "Current canary weight: ${canaryWeight}%"
                    
                    if (isTriggerFromGitHub) {
                        echo "Automated deployment from GitHub push. Monitoring canary for issues..."
                        
                        // Sleep for a monitoring period for the canary
                        def monitoringMinutes = 1
                        echo "Monitoring canary deployment for ${monitoringMinutes} minutes..."
                        sleep(time: monitoringMinutes, unit: 'MINUTES')
                        
                        // Check for any errors in logs or monitoring
                        echo "Checking canary health..."
                        def healthCheckPort = 3000
                        def healthCheckPath = "/api/health"
                        def healthCheckUrl = "http://${DROPLET_IP}:${healthCheckPort}${healthCheckPath}"
                        
                        try {
                            def response = sh(script: "curl -s -o /dev/null -w '%{http_code}' ${healthCheckUrl}", returnStdout: true).trim()
                            def errorCheck = sh(script: "curl -s ${healthCheckUrl} | grep -c 'unhealthy' || true", returnStdout: true).trim()
                            
                            if (response == "200" && errorCheck == "0") {
                                echo "No issues detected in canary. Auto-promoting..."
                                promoteCanary()
                            } else {
                                error "Issues detected in canary deployment (response: ${response}, error check: ${errorCheck}). Rolling back."
                            }
                        } catch (Exception e) {
                            error "Error checking canary health: ${e.getMessage()}. Rolling back."
                        }
                    } else {
                        // For manual builds, require human approval
                        timeout(time: DEPLOY_TIMEOUT, unit: 'SECONDS') {
                            input message: "Canary deployment is serving ${canaryWeight}% of traffic. Promote to 100%?", ok: 'Promote'
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

def promoteCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        
        sh """
            # Update stable to use canary image
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${canaryImage}';
                echo 'DROPLET_IP=${deploymentHost}';
            } > .env.deployment"
            
            # Redeploy stable with canary image
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \\
                docker-compose up -d app"
                
            # Remove canary deployment
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \\
                docker-compose stop app-canary && \\
                docker-compose rm -f app-canary"
                
            # Update Nginx to 100% traffic to stable
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${deploymentHost} "cd ${env.DEPLOYMENT_DIR} && \\
                echo 'CANARY_WEIGHT=0' >> .env.deployment && \\
                docker-compose up -d nginx"
        """
    }
}

def rollbackCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        sh """
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${DROPLET_IP} "cd ${DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}';
                echo 'CANARY_WEIGHT=0';
                echo 'DROPLET_IP=${DROPLET_IP}';
                echo 'APP_PORT=3000';
            } > .env"
            
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${DROPLET_IP} "cd ${DEPLOYMENT_DIR} && \\
                export \$(grep -v '^#' .env | xargs) && \\
                docker-compose --env-file .env stop app-canary && \\
                docker-compose --env-file .env rm -f app-canary && \\
                docker-compose --env-file .env --profile production up -d"
        """
    }
}


// def deployCanary() {
//     withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
//         sh """
//             ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${DROPLET_IP} "cd ${DEPLOYMENT_DIR} && {
//                 echo 'APP_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}';
//                 echo 'CANARY_IMAGE=${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}';
//                 echo 'CANARY_WEIGHT=${params.CANARY_WEIGHT}';
//                 echo 'DROPLET_IP=${DROPLET_IP}';
//                 echo 'APP_PORT=3000';
//             } > .env"
            
//             # Deploy the services with the environment file
//             ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${DROPLET_IP} "cd ${DEPLOYMENT_DIR} && \\
//                 export \$(grep -v '^#' .env | xargs) && \\
//                 docker-compose --env-file .env pull && \\
//                 docker-compose --env-file .env --profile production up -d"
//         """
//     }
// }
def deployCanary() {
    withCredentials([sshUserPrivateKey(credentialsId: 'ssh-deployment-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
        def deploymentHost = env.DROPLET_IP
        def canaryImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
        def canaryWeight = params.CANARY_WEIGHT
        def appImage = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
        
        sh """
            # Create environment file
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && {
                echo 'APP_IMAGE=${appImage}';
                echo 'CANARY_IMAGE=${canaryImage}';
                echo 'CANARY_WEIGHT=${canaryWeight}';
                echo 'DROPLET_IP=${deploymentHost}';
                echo 'APP_PORT=3000';
            } > .env"
            
            # First deploy the infrastructure services (Redis, monitoring, etc.)
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && \\
                export \$(grep -v '^#' .env | xargs) && \\
                docker-compose --env-file .env pull && \\
                docker-compose --env-file .env up -d redis-master redis-slave-1 redis-slave-2 redis-slave-3 redis-slave-4 \\
                sentinel-1 sentinel-2 sentinel-3 redis-backup \\
                prometheus grafana cadvisor \\
                redis-exporter-master redis-exporter-slave1 redis-exporter-slave2 redis-exporter-slave3 redis-exporter-slave4"
                
            # Wait for Redis infrastructure to be ready
            echo "Waiting for Redis infrastructure to be ready..."
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && \\
                attempt=0; \\
                max_attempts=${params.REDIS_MAX_ATTEMPTS ?: 50}; \\
                sleep_duration=${params.REDIS_SLEEP_DURATION ?: 5}; \\
                echo 'Checking Redis readiness with max_attempts='\$max_attempts', sleep_duration='\$sleep_duration; \\
                until [ \$attempt -ge \$max_attempts ]; do \\
                    attempt=\$((attempt+1)); \\
                    echo 'Waiting for Redis to be ready... ('\$attempt'/'\$max_attempts')'; \\
                    if docker ps | grep -q redis-master && \\
                       docker exec -i \$(docker ps -q -f name=redis-master) redis-cli PING 2>/dev/null | grep -q 'PONG'; then \\
                        echo 'Redis is now ready!'; \\
                        break; \\
                    fi; \\
                    if [ \$attempt -ge \$max_attempts ]; then \\
                        echo 'Redis infrastructure did not become ready in time, but proceeding with deployment anyway'; \\
                    fi; \\
                    sleep \$sleep_duration; \\
                done"
                
            # Start Nginx first
            echo "Starting Nginx first..."
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && \\
                export \$(grep -v '^#' .env | xargs) && \\
                docker-compose --env-file .env up -d nginx"

            # Then deploy the stable app
            echo "Deploying stable app..."
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && \\
                export \$(grep -v '^#' .env | xargs) && \\
                docker-compose --env-file .env up -d app"

            # Now deploy the canary
            echo "Deploying canary..."
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && \\
                export \$(grep -v '^#' .env | xargs) && \\
                docker-compose --env-file .env up -d app-canary"
                
            # Check Nginx logs to diagnose any routing issues
            echo "Checking Nginx logs for routing information..."
            ssh -i \$SSH_KEY -o StrictHostKeyChecking=no \${SSH_USER}@${deploymentHost} "cd ${DEPLOYMENT_DIR} && \\
                docker logs \$(docker ps -q -f name=nginx) | tail -50"
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