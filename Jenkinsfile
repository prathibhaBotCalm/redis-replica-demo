pipeline {
    agent any
    
    options {
        timeout(time: 2, unit: 'HOURS') // Global timeout for the entire pipeline
        disableConcurrentBuilds() // Prevent multiple builds running simultaneously
        buildDiscarder(logRotator(numToKeepStr: '10')) // Keep only last 10 builds
    }
    
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
        HEALTH_CHECK_MAX_ATTEMPTS = 15 // Increased from 10
        HEALTH_CHECK_INTERVAL = 10 // Seconds between checks
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
        pollSCM('H/5 * * * *') // Poll SCM every 5 minutes instead of every minute
        githubPush()
    }
    
    stages {
        stage('Initialize') {
            steps {
                script {
                    // Clean workspace at the start
                    cleanWs()
                    
                    // Initialize build status
                    env.BUILD_STATUS = "IN_PROGRESS"
                    currentBuild.displayName = "#${BUILD_NUMBER} - ${env.DEPLOY_ENV} (${env.DEPLOY_TYPE})"
                }
            }
        }

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Determine Environment') {
            steps {
                script {
                    // Improved environment detection logic
                    def branch = env.GIT_BRANCH.toLowerCase()
                    
                    if (params.ENVIRONMENT == 'auto') {
                        if (branch.contains('main') || branch.contains('master')) {
                            env.DEPLOY_ENV = 'prod'
                            env.DEPLOY_TYPE = 'canary' // Force canary for production
                        } else if (branch.contains('staging') || branch.contains('release')) {
                            env.DEPLOY_ENV = 'staging'
                            env.DEPLOY_TYPE = 'standard'
                        } else {
                            env.DEPLOY_ENV = 'dev'
                            env.DEPLOY_TYPE = 'standard'
                        }
                    } else {
                        env.DEPLOY_ENV = params.ENVIRONMENT
                    }
                    
                    // Safety override for production
                    if (env.DEPLOY_ENV == 'prod') {
                        env.DEPLOY_TYPE = 'canary' // Always use canary for production
                    }
                    
                    // Update build display name with environment info
                    currentBuild.displayName = "#${BUILD_NUMBER} - ${env.DEPLOY_ENV} (${env.DEPLOY_TYPE})"
                    
                    echo "Deploying to: ${env.DEPLOY_ENV}"
                    echo "Deployment type: ${env.DEPLOY_TYPE}"
                    echo "Branch: ${env.GIT_BRANCH}"
                }
            }
        }

        stage('Validate Parameters') {
            steps {
                script {
                    if (env.DEPLOY_TYPE == 'rollback') {
                        if (!params.ROLLBACK_VERSION?.trim()) {
                            error "Rollback version is required for rollback deployment type"
                        }
                        // Validate rollback version format
                        if (!(params.ROLLBACK_VERSION ==~ /^[a-f0-9]{7}-\d+$/)) {
                            error "Invalid rollback version format. Expected format: commit-hash-buildnumber"
                        }
                    }
                    
                    if (env.DEPLOY_TYPE == 'canary') {
                        def canaryWeight = params.CANARY_WEIGHT.toInteger()
                        if (canaryWeight < 1 || canaryWeight > 99) {
                            error "Canary weight must be between 1 and 99"
                        }
                    }
                    
                    // Validate Redis parameters
                    try {
                        Integer.parseInt(params.REDIS_MAX_ATTEMPTS)
                        Integer.parseInt(params.REDIS_SLEEP_DURATION)
                    } catch (NumberFormatException e) {
                        error "Redis parameters must be valid integers"
                    }
                }
            }
        }
        
        stage('Build Docker Image') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' }
            }
            steps {
                script {
                    try {
                        // Use BuildKit for better build performance and caching
                        withEnv(['DOCKER_BUILDKIT=1']) {
                            sh """
                                docker build \
                                    --build-arg BUILD_NUMBER=${env.BUILD_NUMBER} \
                                    --build-arg GIT_COMMIT=${env.GIT_COMMIT} \
                                    -t ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} \
                                    .
                            """
                            
                            if (env.DEPLOY_TYPE == 'canary') {
                                sh "docker tag ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG} ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                            }
                        }
                    } catch (Exception e) {
                        echo "Docker build failed. Checking environment..."
                        sh "docker --version || echo 'Docker not installed'"
                        sh "docker info || echo 'Docker not running'"
                        sh "groups | grep docker || echo 'User not in docker group'"
                        error "Docker build failed: ${e.getMessage()}"
                    }
                }
            }
            
            post {
                success {
                    script {
                        // Store image metadata
                        env.BUILT_IMAGE = "${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
                        echo "Successfully built image: ${env.BUILT_IMAGE}"
                    }
                }
            }
        }
        
        stage('Scan Docker Image') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' && env.DEPLOY_ENV == 'prod' }
            }
            steps {
                script {
                    // Use Trivy or other scanning tools to check for vulnerabilities
                    try {
                        sh """
                            docker run --rm \
                                -v /var/run/docker.sock:/var/run/docker.sock \
                                aquasec/trivy image \
                                --severity HIGH,CRITICAL \
                                --exit-code 1 \
                                ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}
                        """
                    } catch (Exception e) {
                        error "Image scanning found critical vulnerabilities. Deployment aborted."
                    }
                }
            }
        }
        
        stage('Push Docker Image') {
            when {
                expression { env.DEPLOY_TYPE != 'rollback' }
            }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'docker-registry-credentials', 
                    usernameVariable: 'DOCKER_USER', 
                    passwordVariable: 'DOCKER_PASSWORD'
                )]) {
                    script {
                        try {
                            sh "echo ${DOCKER_PASSWORD} | docker login -u ${DOCKER_USER} --password-stdin"
                            
                            // Retry push operation in case of network issues
                            retry(3) {
                                sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${PROD_TAG}"
                            }
                            
                            if (env.DEPLOY_TYPE == 'canary') {
                                retry(3) {
                                    sh "docker push ${DOCKER_REGISTRY}/${APP_IMAGE_NAME}:${CANARY_TAG}"
                                }
                            }
                        } catch (Exception e) {
                            error "Failed to push Docker images: ${e.getMessage()}"
                        }
                    }
                }
            }
        }
        
        stage('Prepare Deployment') {
            steps {
                script {
                    // Create a deployment manifest file
                    def deploymentManifest = [
                        "build_number": env.BUILD_NUMBER,
                        "git_commit": env.GIT_COMMIT,
                        "git_branch": env.GIT_BRANCH,
                        "deploy_env": env.DEPLOY_ENV,
                        "deploy_type": env.DEPLOY_TYPE,
                        "image_tag": env.PROD_TAG,
                        "timestamp": new Date().format("yyyy-MM-dd'T'HH:mm:ssZ"),
                        "initiated_by": currentBuild.getBuildCauses()[0].shortDescription
                    ]
                    
                    writeJSON file: 'deployment-manifest.json', json: deploymentManifest
                    
                    // Update configuration files
                    updateConfigFiles()
                }
            }
        }
        
        stage('Deploy to ${DEPLOY_ENV}') {
            steps {
                script {
                    // Record deployment start time
                    env.DEPLOY_START_TIME = new Date().format("yyyy-MM-dd'T'HH:mm:ssZ")
                    
                    try {
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
                    } catch (Exception e) {
                        error "Deployment failed: ${e.getMessage()}"
                    }
                }
            }
        }
        
        stage('Verify Deployment') {
            steps {
                script {
                    // Health check with retries
                    healthCheck() 
                }
            }
        }
        
        stage('Promote Canary') {
            when {
                allOf {
                    expression { env.DEPLOY_TYPE == 'canary' }
                    expression { env.DEPLOY_ENV == 'prod' }
                }
            }
            steps {
                script {
                    if (isAutomatedBuild()) {
                        // For automated builds, monitor before promoting
                        echo "Monitoring canary deployment for 5 minutes before promotion..."
                        sleep(time: 5, unit: 'MINUTES')
                            promoteCanary()
                       
                    } else {
                        // For manual builds, get approval
                        timeout(time: env.DEPLOY_TIMEOUT, unit: 'SECONDS') {
                            input(
                                message: "Promote canary to 100% traffic?", 
                                ok: 'Promote',
                                parameters: [
                                    string(
                                        name: 'CONFIRMATION', 
                                        defaultValue: 'yes', 
                                        description: 'Type "yes" to confirm promotion'
                                    )
                                ]
                            )
                        }
                        
                        promoteCanary()
                    }
                }
            }
        }
        
        stage('Finalize') {
            steps {
                script {
                    env.BUILD_STATUS = "SUCCESS"
                    env.DEPLOY_END_TIME = new Date().format("yyyy-MM-dd'T'HH:mm:ssZ")
                    
                    // Generate deployment report
                    generateDeploymentReport()
                    
                    // Clean up resources
                    cleanUp()
                }
            }
        }
    }
    
    post {
        always {
            script {
                // Send notifications and clean up regardless of build status
                // notifyBuildStatus()
                cleanWs() // Clean workspace at the end
            }
        }
        success {
            echo "Deployment to ${env.DEPLOY_ENV} completed successfully!"
        }
        failure {
            script {
                env.BUILD_STATUS = "FAILURE"
                echo "Deployment to ${env.DEPLOY_ENV} failed!"
                
                // Rollback if this was a canary deployment
                if (env.DEPLOY_TYPE == 'canary') {
                    rollbackCanary()
                }
            }
        }
        unstable {
            echo "Deployment to ${env.DEPLOY_ENV} completed with warnings"
        }
    }
}

// --------------------------
// Helper Methods
// --------------------------

def updateConfigFiles() {
    script {
        def envFile = '.env'
        def composeFile = 'docker-compose.yml'
        
        // Backup original files
        sh "cp ${envFile} ${envFile}.bak"
        sh "cp ${composeFile} ${composeFile}.bak"
        
        // Update environment-specific settings
        if (env.DEPLOY_ENV == 'dev') {
            sh """
                sed -i 's/IS_DEV=false/IS_DEV=true/g' ${envFile}
                sed -i 's/REDIS_SENTINELS_PROD/REDIS_SENTINELS_DEV/g' ${composeFile}
                sed -i 's/REDIS_HOST_PROD/REDIS_HOST_DEV/g' ${composeFile}
            """
        }
        
        // Update canary settings
        if (env.DEPLOY_TYPE == 'canary') {
            sh "sed -i 's/CANARY_WEIGHT=.*/CANARY_WEIGHT=${params.CANARY_WEIGHT}/g' ${envFile}"
        }
        
        // Update domain/IP settings
        def configFiles = ['traefik/traefik.yml', 'docker-compose.canary.yml']
        configFiles.each { file ->
            if (fileExists(file)) {
                sh "sed -i 's/your-domain.com/${env.DROPLET_IP}/g' ${file}"
            }
        }
    }
}

def healthCheck() {
    script {
        def healthCheckUrl = "http://${env.DROPLET_IP}:3000/api/health"
        def attempts = 0
        def success = false
        
        echo "Starting health checks for ${healthCheckUrl}"
        
        while (!success && attempts < env.HEALTH_CHECK_MAX_ATTEMPTS.toInteger()) {
            attempts++
            try {
                def response = sh(
                    script: "curl -s -o /dev/null -w '%{http_code}' ${healthCheckUrl}", 
                    returnStdout: true
                ).trim()
                
                if (response == "200") {
                    echo "Health check succeeded (attempt ${attempts})"
                    success = true
                } else {
                    echo "Health check failed with HTTP ${response} (attempt ${attempts})"
                    sleep(time: env.HEALTH_CHECK_INTERVAL.toInteger(), unit: 'SECONDS')
                }
            } catch (Exception e) {
                echo "Health check failed with exception: ${e.getMessage()}"
                sleep(time: env.HEALTH_CHECK_INTERVAL.toInteger(), unit: 'SECONDS')
            }
        }
        
        if (!success) {
            error "Health check failed after ${attempts} attempts"
        }
    }
}





def isAutomatedBuild() {
    script {
        try {
            def causes = currentBuild.getBuildCauses()
            return causes.any { cause ->
                cause.toString().contains('github') || 
                cause.toString().contains('GitHub') ||
                cause.toString().contains('GitHubPushCause') || 
                cause.toString().contains('SCMTriggerCause') || 
                cause.toString().contains('Remote')
            }
        } catch (Exception e) {
            echo "Error determining build cause: ${e.getMessage()}"
            return false
        }
    }
}

def generateDeploymentReport() {
    script {
        def report = """
            Deployment Report
            ================
            Environment: ${env.DEPLOY_ENV}
            Deployment Type: ${env.DEPLOY_TYPE}
            Build Number: ${env.BUILD_NUMBER}
            Git Commit: ${env.GIT_COMMIT_SHORT}
            Branch: ${env.GIT_BRANCH}
            Start Time: ${env.DEPLOY_START_TIME}
            End Time: ${env.DEPLOY_END_TIME}
            Duration: ${currentBuild.durationString}
            Status: ${env.BUILD_STATUS}
            
            Docker Images:
            - Production: ${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.PROD_TAG}
            ${env.DEPLOY_TYPE == 'canary' ? "- Canary: ${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.CANARY_TAG}" : ""}
        """
        
        writeFile file: 'deployment-report.txt', text: report
        archiveArtifacts artifacts: 'deployment-report.txt,deployment-manifest.json'
    }
}

def cleanUp() {
    script {
        // Clean up Docker images
        sh """
            docker images --filter "reference=${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}" --format "{{.Repository}}:{{.Tag}}" | \
            sort -r | \
            awk 'NR>5' | \
            xargs -r docker rmi || true
        """
        
        // Clean up dangling images
        sh "docker image prune -f"
    }
}


def deployStandard() {
    withCredentials([
        sshUserPrivateKey(
            credentialsId: 'ssh-deployment-key', 
            keyFileVariable: 'SSH_KEY', 
            usernameVariable: 'SSH_USER'
        ),
        file(
            credentialsId: "${env.DEPLOY_ENV}-env-file", 
            variable: 'ENV_FILE'
        )
    ]) {
        script {
            def appImage = "${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.PROD_TAG}"
            
            // Create deployment environment file
            sh """
                echo 'APP_IMAGE=${appImage}' > .env.deployment
                echo 'DROPLET_IP=${env.DROPLET_IP}' >> .env.deployment
                echo 'DEPLOY_ENV=${env.DEPLOY_ENV}' >> .env.deployment
                
                # Copy the environment file to server
                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no .env.deployment ${SSH_USER}@${env.DROPLET_IP}:${env.DEPLOYMENT_DIR}/.env
                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${ENV_FILE}" ${SSH_USER}@${env.DROPLET_IP}:${env.DEPLOYMENT_DIR}/.env.production
            """
            
            // Deploy the application
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    export APP_IMAGE='${appImage}' && \
                    export DROPLET_IP='${env.DROPLET_IP}' && \
                    docker-compose pull && \
                    docker-compose --profile production up -d --build
                "
            """
        }
    }
}

def deployCanary() {
    withCredentials([
        sshUserPrivateKey(
            credentialsId: 'ssh-deployment-key', 
            keyFileVariable: 'SSH_KEY', 
            usernameVariable: 'SSH_USER'
        ),
        file(
            credentialsId: "${env.DEPLOY_ENV}-env-file", 
            variable: 'ENV_FILE'
        )
    ]) {
        script {
            def canaryImage = "${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.CANARY_TAG}"
            def appImage = "${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.PROD_TAG}"
            
            // Create deployment environment file
            sh """
                echo 'CANARY_IMAGE=${canaryImage}' > .env.deployment
                echo 'CANARY_WEIGHT=${params.CANARY_WEIGHT}' >> .env.deployment
                echo 'APP_IMAGE=${appImage}' >> .env.deployment
                echo 'DROPLET_IP=${env.DROPLET_IP}' >> .env.deployment
                echo 'DEPLOY_ENV=${env.DEPLOY_ENV}' >> .env.deployment
                
                # Copy files to server
                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no .env.deployment ${SSH_USER}@${env.DROPLET_IP}:${env.DEPLOYMENT_DIR}/.env
                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${ENV_FILE}" ${SSH_USER}@${env.DROPLET_IP}:${env.DEPLOYMENT_DIR}/.env.production
            """
            
            // Deploy Redis infrastructure first
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    docker-compose up -d redis-master redis-slave-1 redis-slave-2 redis-slave-3 redis-slave-4 \
                        sentinel-1 sentinel-2 sentinel-3 redis-backup \
                        prometheus grafana cadvisor \
                        redis-exporter-master redis-exporter-slave1 redis-exporter-slave2 redis-exporter-slave3 redis-exporter-slave4
                "
            """
            
            // Wait for Redis to be ready
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    attempt=0; \
                    max_attempts=${params.REDIS_MAX_ATTEMPTS}; \
                    sleep_duration=${params.REDIS_SLEEP_DURATION}; \
                    until [ \$attempt -ge \$max_attempts ] || \\
                          docker exec -i \$(docker ps -q -f name=redis-master) redis-cli -a \${REDIS_PASSWORD} PING | grep -q 'PONG'; do \
                        attempt=\$((attempt+1)); \
                        echo 'Waiting for Redis to be ready... (\$attempt/\$max_attempts)'; \
                        sleep \$sleep_duration; \
                    done; \
                    if [ \$attempt -ge \$max_attempts ]; then \
                        echo 'Redis did not become ready in time'; \
                        exit 1; \
                    fi
                "
            """
            
            // Deploy both stable and canary versions
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    export CANARY_IMAGE='${canaryImage}' && \
                    export CANARY_WEIGHT='${params.CANARY_WEIGHT}' && \
                    export APP_IMAGE='${appImage}' && \
                    export DROPLET_IP='${env.DROPLET_IP}' && \
                    docker-compose -f docker-compose.yml up -d app && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml up -d canary traefik
                "
            """
        }
    }
}

def promoteCanary() {
    withCredentials([
        sshUserPrivateKey(
            credentialsId: 'ssh-deployment-key', 
            keyFileVariable: 'SSH_KEY', 
            usernameVariable: 'SSH_USER'
        )
    ]) {
        script {
            def canaryImage = "${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.CANARY_TAG}"
            
            // Update the main app to use the canary image
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    echo 'APP_IMAGE=${canaryImage}' > .env.deployment && \
                    echo 'DROPLET_IP=${env.DROPLET_IP}' >> .env.deployment && \
                    export APP_IMAGE='${canaryImage}' && \
                    export DROPLET_IP='${env.DROPLET_IP}' && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary || true && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary || true && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop traefik || true && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f traefik || true && \
                    docker-compose up -d app
                "
            """
            
            echo "Canary successfully promoted to production"
        }
    }
}

def rollbackCanary() {
    withCredentials([
        sshUserPrivateKey(
            credentialsId: 'ssh-deployment-key', 
            keyFileVariable: 'SSH_KEY', 
            usernameVariable: 'SSH_USER'
        )
    ]) {
        script {
            def appImage = "${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${env.PROD_TAG}"
            
            // Rollback to the stable version
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    echo 'APP_IMAGE=${appImage}' > .env.deployment && \
                    echo 'DROPLET_IP=${env.DROPLET_IP}' >> .env.deployment && \
                    export APP_IMAGE='${appImage}' && \
                    export DROPLET_IP='${env.DROPLET_IP}' && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop canary || true && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f canary || true && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml stop traefik || true && \
                    docker-compose -f docker-compose.yml -f docker-compose.canary.yml rm -f traefik || true && \
                    docker-compose up -d app
                "
            """
            
            echo "Successfully rolled back canary deployment"
        }
    }
}

def deployRollback() {
    withCredentials([
        sshUserPrivateKey(
            credentialsId: 'ssh-deployment-key', 
            keyFileVariable: 'SSH_KEY', 
            usernameVariable: 'SSH_USER'
        ),
        file(
            credentialsId: "${env.DEPLOY_ENV}-env-file", 
            variable: 'ENV_FILE'
        )
    ]) {
        script {
            def rollbackImage = "${env.DOCKER_REGISTRY}/${env.APP_IMAGE_NAME}:${params.ROLLBACK_VERSION}"
            
            // Create deployment environment file
            sh """
                echo 'APP_IMAGE=${rollbackImage}' > .env.deployment
                echo 'DROPLET_IP=${env.DROPLET_IP}' >> .env.deployment
                echo 'DEPLOY_ENV=${env.DEPLOY_ENV}' >> .env.deployment
                
                # Copy files to server
                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no .env.deployment ${SSH_USER}@${env.DROPLET_IP}:${env.DEPLOYMENT_DIR}/.env
                scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${ENV_FILE}" ${SSH_USER}@${env.DROPLET_IP}:${env.DEPLOYMENT_DIR}/.env.production
            """
            
            // Perform the rollback
            sh """
                ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SSH_USER}@${env.DROPLET_IP} "
                    cd ${env.DEPLOYMENT_DIR} && \
                    export APP_IMAGE='${rollbackImage}' && \
                    export DROPLET_IP='${env.DROPLET_IP}' && \
                    docker-compose pull app && \
                    docker-compose --profile production up -d --no-deps app
                "
            """
        }
    }
}