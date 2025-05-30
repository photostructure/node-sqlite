#!/bin/bash
set -e

echo "Setting up security scanning tools..."

# Check if Go is installed
if command -v go &> /dev/null; then
    echo "✓ Go is installed: $(go version)"
    
    # Install OSV Scanner
    if ! command -v osv-scanner &> /dev/null; then
        echo "Installing OSV Scanner..."
        go install github.com/google/osv-scanner/cmd/osv-scanner@latest
        echo "✓ OSV Scanner installed"
    else
        echo "✓ OSV Scanner is already installed: $(osv-scanner --version)"
    fi
else
    echo "⚠️  Go is not installed. OSV Scanner requires Go."
    echo "   Install Go from: https://golang.org/dl/"
fi

echo ""
echo "Security tools setup complete!"
echo ""
echo "To run security scans:"
echo "  npm run security         # Run all security checks"