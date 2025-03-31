pipeline {
    agent any
    
    parameters {
        choice(name: 'ENVIRONMENT', choices: ['staging', 'canary', 'production'], description: 'Deployment environment')
        string(name: 'PROMOTION_REASON', defaultValue: '', description: 'Reason for promoting canary to stable (only for canary promotion)')
        booleanParam(name: 'SKIP_TESTS', defaultValue: false, description: 'Skip running tests')
    }
    
    environment {
        DOCKER_REGISTRY = 'ghcr.io'
        DOCKER_REPO = "${DOCKER_REGISTRY}/${env.GIT_URL.tokenize('/')[-2].toLowerCase()}/${env.GIT_URL.tokenize('/')[-1].toLowerCase().replace('.git', '')}"
        CANARY_WEIGHT = 20
        APP_PORT = 3000
        NODE_ENV = "${params.ENVIRONMENT == 'staging' ? 'development' : 'production'}"
    }
    
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        
        stage('Setup Environment Variables') {
            steps {
                script {
                    // Load environment variables based on selected environment
                    if (params.ENVIRONMENT == 'staging') {
                        // Load staging environment variables
                        withCredentials([file(credentialsId: 'staging-env-file', variable: 'ENV_FILE')]) {
                            def envContent = readFile(file: "${ENV_FILE}")
                            def envMap = parseEnvFile(envContent)
                            envMap.each { key, value ->
                                env."${key}" = value
                            }
                        }
                    } else {
                        // Load production/canary environment variables
                        withCredentials([file(credentialsId: 'production-env-file', variable: 'ENV_FILE')]) {
                            def envContent = readFile(file: "${ENV_FILE}")
                            def envMap = parseEnvFile(envContent)
                            envMap.each { key, value ->
                                env."${key}" = value
                            }
                        }
                    }
                }
            }
        }
        
        stage('Build Docker Image') {
            steps {
                script {
                    def imageTag
                    def additionalTag = ''
                    
                    switch(params.ENVIRONMENT) {
                        case 'staging':
                            imageTag = 'staging-latest'
                            break
                        case 'canary':
                        case 'production':
                            imageTag = 'live-latest'
                            additionalTag = "live-${env.GIT_COMMIT}"
                            break
                        default:
                            error "Unknown environment: ${params.ENVIRONMENT}"
                    }
                    
                    // Login to GHCR
                    withCredentials([usernamePassword(credentialsId: 'github-credentials', usernameVariable: 'GITHUB_USER', passwordVariable: 'GITHUB_TOKEN')]) {
                        sh "echo '${GITHUB_TOKEN}' | docker login ${DOCKER_REGISTRY} -u ${GITHUB_USER} --password-stdin"
                    }
                    
                    // Set up buildx (for better caching)
                    sh "docker buildx create --use --driver docker-container --buildkitd-flags '--debug'"
                    
                    // Build and push Docker image
                    def buildArgs = [
                        "--cache-from", "type=registry,ref=${DOCKER_REPO}:${imageTag}",
                        "--cache-to", "type=inline",
                        "-t", "${DOCKER_REPO}:${imageTag}",
                        "."
                    ]
                    
                    if (additionalTag) {
                        buildArgs.add("-t")
                        buildArgs.add("${DOCKER_REPO}:${additionalTag}")
                    }
                    
                    sh "docker buildx build --push ${buildArgs.join(' ')}"
                }
            }
        }
        
    }
    
    post {
        always {
            // Cleanup workspace
            cleanWs()
        }
        success {
            echo "Pipeline completed successfully!"
        }
        failure {
            echo "Pipeline failed! Check the logs for details."
        }
    }
}

// Helper function to parse .env file content into a map
def parseEnvFile(String content) {
    def map = [:]
    content.split('\n').each { line ->
        line = line.trim()
        if (line && !line.startsWith('#')) {
            def matcher = line =~ /([^=]+)=(.+)/
            if (matcher.matches()) {
                def key = matcher.group(1).trim()
                def value = matcher.group(2).trim()
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) || 
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1)
                }
                map[key] = value
            }
        }
    }
    return map
}