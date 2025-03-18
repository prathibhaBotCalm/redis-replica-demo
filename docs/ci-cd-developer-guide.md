# CI/CD Pipeline: Developer's Quick Reference Guide

This guide provides practical information for developers working with the CI/CD pipeline, focusing on day-to-day operations and interactions with the pipeline.

## Branching Strategy

| Branch | Purpose | Deployment Target | Auto-Deploy |
|--------|---------|-------------------|------------|
| `dev`  | Development work, feature integration | Staging | Yes, on push |
| `main` | Production code | Production (canary) | Yes, on push |
| Feature branches | Individual feature development | None | No |

## Development Workflow

1. **Create Feature Branch**: 
   ```bash
   git checkout dev
   git pull
   git checkout -b feature/your-feature-name
   ```

2. **Develop and Test Locally**:
   ```bash
   # Start local Docker environment
   docker-compose -f docker-compose.yml -f docker-compose.override.yml --profile development up -d
   ```

3. **Push Changes to Feature Branch**:
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin feature/your-feature-name
   ```

4. **Create Pull Request to `dev`**: 
   - Create PR through GitHub interface
   - Ensure tests pass and code review is completed

5. **Merge to `dev`**: 
   - Merge PR to `dev` branch
   - CI/CD pipeline automatically deploys to staging

6. **Promote to Production**:
   - Create PR from `dev` to `main`
   - Merge PR to `main`
   - CI/CD pipeline automatically deploys canary to production

## Environment URLs

| Environment | URL | Notes |
|-------------|-----|-------|
| Local Development | http://localhost:3000 | Running via Docker Compose |
| Staging | http://staging-server-address | 100% of traffic gets latest `dev` code |
| Production | http://production-server-address | Canary receives 20% of traffic initially |

## Docker Images

| Image Tag | Purpose | Source Branch |
|-----------|---------|--------------|
| `ghcr.io/<repo>:staging-latest` | Staging deployment | `dev` |
| `ghcr.io/<repo>:live-latest` | Production stable | `main` (after promotion) |
| `ghcr.io/<repo>:live-<commit-sha>` | Production canary | `main` (before promotion) |

## Environment Variables

Add environment variables to the following locations:

- **Local Development**: `.env` file in project root
- **CI/CD Pipeline**: GitHub repository secrets
- **Specific to Workflows**: 
  - Staging: `deploy-staging.yml`
  - Production: `deploy-live-canary.yml`

## Monitoring Deployments

### Staging Deployments

1. Check GitHub Actions workflow status for `deploy-staging` job
2. SSH to staging server and check logs:
   ```bash
   ssh user@staging-server
   cd ~/app
   docker-compose logs -f app
   ```

### Production Deployments

1. Check GitHub Actions workflow status for `deploy-live-canary` job
2. Monitor canary performance:
   ```bash
   ssh user@production-server
   cd ~/app
   docker-compose logs -f app-canary
   ```
3. Check Nginx logs for traffic distribution:
   ```bash
   sudo tail -f /var/log/nginx/access.log | grep "X-Version"
   ```
4. Wait for canary promotion or rollback

## Canary Deployment

### How It Works

1. When you push to `main`, a new image is built with tag `live-<commit-sha>`
2. This canary version receives 20% of production traffic
3. The stable version (`live-latest`) continues to serve 80% of traffic
4. After verification, canary is promoted to stable automatically

### Manual Promotion

If automatic promotion is disabled, promote manually:

1. Go to GitHub Actions
2. Find the latest workflow run
3. Manually run the `promote-canary` workflow

### Dealing with Failed Canary

If a canary deployment fails:

1. Automatic rollback will trigger
2. Check logs for the reason:
   ```bash
   ssh user@production-server
   cd ~/app
   cat rollback-*.log
   ```
3. Fix the issue in your code
4. Push new changes to `dev` and test thoroughly before trying again on `main`

## Common Tasks

### Adding New Environment Variables

1. Add to your local `.env` file for testing
2. Add to GitHub repository secrets
3. Update workflow files that need access to the variable:
   - `deploy-staging.yml` for staging
   - `deploy-live-canary.yml` for production

### Testing Canary Manually

To specifically hit the canary version:

1. SSH to the production server
2. Access the canary directly:
   ```bash
   curl http://localhost:3002/health
   ```

### Redeploying Last Successful Build

For staging:
```bash
# Force workflow execution on dev branch
git checkout dev
git commit --allow-empty -m "Force redeploy to staging"
git push
```

For production:
```bash
# Force workflow execution on main branch
git checkout main
git commit --allow-empty -m "Force redeploy to production"
git push
```

## Troubleshooting

### Deployment Failures

1. Check GitHub Actions logs for errors
2. Verify server connection and SSH keys
3. Check Docker and Docker Compose installation on server
4. Examine server resources (disk space, memory)

### Container Issues

If containers are crashing:
```bash
# Check container status
docker-compose ps

# Check container logs
docker-compose logs app-stable
docker-compose logs app-canary

# Check for resource constraints
docker stats
```

### Nginx Issues

If traffic routing is not working correctly:
```bash
# Check Nginx configuration
sudo nginx -t

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

## CI/CD Pipeline Overview

```
┌─────────┐         ┌─────────┐         ┌────────────────┐
│  Build  │  ──────>│ Deploy  │  ──────>│ Deploy Canary  │
└─────────┘         │ Staging │         │  (if main)     │
                    └─────────┘         └───────┬────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                           ┌───success──┤ Verification  │
                           │            └───────────────┘
                           │                    │
                           │                    │failure
                           ▼                    ▼
                ┌────────────────────┐   ┌─────────────┐
                │ Promote to Stable  │   │  Rollback   │
                └────────────────────┘   └─────────────┘
```