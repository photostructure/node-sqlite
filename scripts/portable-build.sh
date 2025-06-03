#!/bin/bash
# Build native module with portable GLIBC compatibility
# Uses Debian 11 Bullseye (GLIBC 2.31) for broad compatibility

set -euo pipefail

# Allow architecture override (for CI cross-compilation)
TARGET_ARCH="${TARGET_ARCH:-}"

# If no target architecture specified, detect from host
if [ -z "$TARGET_ARCH" ]; then
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ]; then
    TARGET_ARCH="x64"
  elif [ "$ARCH" = "aarch64" ]; then
    TARGET_ARCH="arm64"
  else
    echo "Unsupported architecture: $ARCH"
    exit 1
  fi
fi

# Map to Docker platform architecture
if [ "$TARGET_ARCH" = "x64" ]; then
  DOCKER_ARCH="amd64"
elif [ "$TARGET_ARCH" = "arm64" ]; then
  DOCKER_ARCH="arm64"
else
  echo "Unsupported target architecture: $TARGET_ARCH"
  exit 1
fi

# Determine which build command to use
BUILD_CMD="${BUILD_CMD:-npm run build:native}"

# Check if we're already in a compatible environment
if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [[ "${ID:-}" == "debian" && "${VERSION_ID:-}" == "11" ]]; then
    echo "Already in Debian 11 Bullseye, building directly..."
    $BUILD_CMD
    exit 0
  fi
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo "Docker not found, falling back to local build"
  echo "Warning: Binary may not be portable due to GLIBC version"
  $BUILD_CMD
  exit 0
fi

echo "Building native module in Debian 11 Bullseye container for GLIBC 2.31 compatibility..."
echo "Target architecture: $TARGET_ARCH (Docker platform: linux/$DOCKER_ARCH)"

# Run build in Docker container as non-root user
USER_ID=$(id -u)
GROUP_ID=$(id -g)

docker run --rm \
  -v "$(pwd):/tmp/project" \
  -w /tmp/project \
  --platform "linux/$DOCKER_ARCH" \
  node:20-bullseye \
  sh -c "
    # Install dependencies as root
    apt-get update -qq && \
    apt-get install -y -qq build-essential python3 && \
    # Run build and fix permissions in one go
    cd /tmp/project && \
    $BUILD_CMD && \
    # Fix ownership of any generated files
    chown -R $USER_ID:$GROUP_ID /tmp/project/build /tmp/project/prebuilds 2>/dev/null || true
  "

echo "Portable build complete!"