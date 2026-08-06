#!/bin/bash
set -e

echo "🚀 Setting up Node SQLite development environment..."

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Build the native module
echo "🔨 Building native module..."
npm run build:native

# Run initial build
echo "🏗️ Running TypeScript build..."
npm run build

# Set up git hooks if available
if [ -f "scripts/preflight.ts" ]; then
    echo "🪝 Setting up git hooks..."
    npx husky install 2>/dev/null || true
fi

# Create ccache directory if it doesn't exist
mkdir -p /workspaces/.ccache

echo "✅ Development environment setup complete!"
echo ""
echo "Available npm scripts:"
echo "  npm test          - Run tests"
echo "  npm run build     - Build TypeScript and native code"
echo "  npm run lint      - Run linter"
echo "  npm run docs      - Generate documentation"
echo ""
echo "For more information, see README.md"