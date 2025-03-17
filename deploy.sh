#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if terraform is installed
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}Terraform not found. Please install Terraform first.${NC}"
    exit 1
fi

# Check for required files
if [ ! -f "terraform.tfvars" ]; then
    echo -e "${YELLOW}terraform.tfvars file not found. Creating from example...${NC}"
    if [ -f "terraform.tfvars.example" ]; then
        cp terraform.tfvars.example terraform.tfvars
        echo -e "${YELLOW}Please edit terraform.tfvars with your actual values before continuing.${NC}"
        exit 1
    else
        echo -e "${RED}terraform.tfvars.example not found. Cannot continue.${NC}"
        exit 1
    fi
fi

# Create scripts directory if it doesn't exist
if [ ! -d "scripts" ]; then
    mkdir -p scripts
fi

# Check if we have a Digital Ocean token
DO_TOKEN=$(grep do_token terraform.tfvars | cut -d '=' -f2 | tr -d ' "')
if [ -z "$DO_TOKEN" ] || [ "$DO_TOKEN" == "your_digital_ocean_api_token" ]; then
    echo -e "${RED}Please set your Digital Ocean API token in terraform.tfvars${NC}"
    exit 1
fi

# Check if setup.sh exists
if [ ! -f "scripts/setup.sh" ]; then
    echo -e "${RED}scripts/setup.sh not found. Cannot continue.${NC}"
    exit 1
fi

# Make setup.sh executable
chmod +x scripts/setup.sh

# Function to run terraform commands with error handling
run_terraform() {
    command=$1
    echo -e "${GREEN}Running: terraform $command${NC}"
    
    if ! terraform $command; then
        echo -e "${RED}Terraform $command failed.${NC}"
        exit 1
    fi
}

# Main deployment logic
case "$1" in
    init)
        run_terraform "init"
        ;;
    plan)
        run_terraform "plan -out=tfplan"
        ;;
    apply)
        if [ -f "tfplan" ]; then
            run_terraform "apply tfplan"
        else
            echo -e "${YELLOW}No plan file found. Run './deploy.sh plan' first.${NC}"
            exit 1
        fi
        ;;
    destroy)
        echo -e "${RED}WARNING: This will destroy all created infrastructure.${NC}"
        read -p "Are you sure? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            run_terraform "destroy -auto-approve"
        fi
        ;;
    output)
        run_terraform "output"
        ;;
    *)
        echo -e "Usage: $0 {init|plan|apply|destroy|output}"
        echo -e "  init    - Initialize Terraform"
        echo -e "  plan    - Create a Terraform plan"
        echo -e "  apply   - Apply the created plan"
        echo -e "  destroy - Destroy all created infrastructure"
        echo -e "  output  - Show output values"
        exit 1
esac

echo -e "${GREEN}Command completed successfully!${NC}"