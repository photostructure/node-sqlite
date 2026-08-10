#!/bin/bash
# Test the addon in Alpine (musl) Docker containers
# This validates that cleanup hooks work correctly in musl libc environments
#
# Usage:
#   ./test-docker-alpine.sh           # Test all versions (22, 24, 26)
#   ./test-docker-alpine.sh 22        # Test only Node 22
#   NODE_VERSION=22 ./test-docker-alpine.sh  # Test only Node 22 (via env var)
#
# Caching:
#   REUSE_CONTAINER=1 ./test-docker-alpine.sh  # Reuse container between runs (faster)
#   REUSE_BUILD=1 ./test-docker-alpine.sh      # Reuse build artifacts (much faster)
#
# The REUSE_BUILD option mounts node_modules and build directories as volumes,
# avoiding full rebuilds on every run. Great for local development iteration.

set -euo pipefail

# Test with multiple Node.js versions on Alpine (musl)
if [ -n "${NODE_VERSION:-}" ]; then
  NODE_VERSIONS=("$NODE_VERSION")
elif [ $# -eq 1 ]; then
  NODE_VERSIONS=("$1")
else
  NODE_VERSIONS=("22" "24" "26")
fi

echo "Testing @photostructure/sqlite in Alpine (musl) Docker containers..."
echo "This validates cleanup hooks work in musl libc environments"
echo ""

for NODE_VERSION in "${NODE_VERSIONS[@]}"; do
  echo "========================================"
  echo "Testing Node.js $NODE_VERSION (Alpine musl)"
  echo "========================================"

  CONTAINER_NAME="node-sqlite-test-alpine-$NODE_VERSION"

  # Check if we should reuse an existing container
  if [ "${REUSE_CONTAINER:-0}" = "1" ]; then
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      echo "Reusing existing container: $CONTAINER_NAME"
      docker start "$CONTAINER_NAME" 2>/dev/null || true
    fi
  fi

  # If container doesn't exist, create it
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Creating new container: $CONTAINER_NAME"

    # Build docker run command with optional platform flag and volume mounts
    DOCKER_CMD="docker run -d --name $CONTAINER_NAME"
    if [ -n "${DOCKER_PLATFORM:-}" ]; then
      DOCKER_CMD="$DOCKER_CMD --platform $DOCKER_PLATFORM"
      echo "Using platform: $DOCKER_PLATFORM"
    fi

    # If REUSE_BUILD is set, mount build cache directory as volume
    if [ "${REUSE_BUILD:-0}" = "1" ]; then
      echo "Using persistent build cache (rebuilds only when source changes)"
      # Create cache directory if it doesn't exist
      mkdir -p ".cache/alpine-$NODE_VERSION/build"
      # Only cache build/ directory - node_modules has issues with bind mounts
      # The native build is the slow part anyway (~2 min vs ~30 sec for npm ci)
      DOCKER_CMD="$DOCKER_CMD -v $(pwd)/.cache/alpine-$NODE_VERSION/build:/tmp/project/build"
    fi

    DOCKER_CMD="$DOCKER_CMD node:$NODE_VERSION-alpine sleep 3600"
    eval $DOCKER_CMD
  fi

  # Copy project files into container (excluding cached directories)
  echo "Copying project files..."
  if [ "${REUSE_BUILD:-0}" = "1" ]; then
    # Exclude build and prebuilds when using cache
    # (prebuilds may be incompatible with container's libc)
    tar --exclude='node_modules' --exclude='build' --exclude='prebuilds' --exclude='.cache' --exclude='dist' -c . | docker exec -i "$CONTAINER_NAME" sh -c "cd /tmp/project && tar -xf -"
  else
    docker cp . "$CONTAINER_NAME:/tmp/project"
  fi

  # Run tests inside container with smart rebuild detection
  echo "Running tests in container..."
  docker exec "$CONTAINER_NAME" sh -c "
    set -ex  # Exit on error and print commands
    cd /tmp/project
    apk add --no-cache build-base python3 git

    # Check if we need to rebuild native code
    NEEDS_REBUILD=0

    # If prebuilds directory exists from CI, use those
    if [ -d prebuilds ] && [ \"\$(ls -A prebuilds 2>/dev/null)\" ]; then
      echo '✓ Using CI prebuilt binaries'
      NEEDS_REBUILD=0
    # Check if cached build exists
    elif [ -f build/Release/phstr_sqlite.node ]; then
      # Check if any native source files are newer than the build
      if find src/ binding.gyp -type f \( -name '*.cpp' -o -name '*.h' -o -name '*.c' -o -name 'binding.gyp' \) -newer build/Release/phstr_sqlite.node 2>/dev/null | grep -q .; then
        echo '⚠ Native source changed, rebuilding...'
        NEEDS_REBUILD=1
      else
        echo '✓ Using cached build (no source changes)'
        NEEDS_REBUILD=0
      fi
    else
      echo '⚠ No build found, building from source...'
      NEEDS_REBUILD=1
    fi

    # Install dependencies (always needed for tests)
    echo 'Installing npm dependencies...'
    npm ci --ignore-scripts

    # Rebuild only if needed
    if [ \$NEEDS_REBUILD -eq 1 ]; then
      echo 'Running native build...'
      # Use 'node-gyp build' instead of 'rebuild' to avoid removing mounted volume
      # Split configure and build to work around node-gyp v12 cleanup bug
      npx node-gyp configure
      npx node-gyp build
      # Verify the build succeeded
      if [ ! -f build/Release/phstr_sqlite.node ]; then
        echo '❌ Native build failed - binary not found'
        exit 1
      fi
      echo 'Native build completed'
    fi

    # Build TypeScript
    echo 'Building TypeScript...'
    npm run build:dist

    # Run tests
    echo 'Running tests...'
    npm test
  " || {
    echo "❌ Tests FAILED on Node.js $NODE_VERSION (Alpine musl)"
    docker rm -f "$CONTAINER_NAME" >/dev/null
    exit 1
  }

  # Fix ownership of files created by Docker (which runs as root)
  # Only fix the mounted cache directory if REUSE_BUILD is enabled
  if [ "${REUSE_BUILD:-0}" = "1" ]; then
    echo "Fixing ownership of cached build files..."
    docker exec "$CONTAINER_NAME" chown -R "$(id -u):$(id -g)" /tmp/project/build 2>/dev/null || true
  fi

  # Clean up container (unless reusing)
  if [ "${REUSE_CONTAINER:-0}" != "1" ]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null
  else
    docker stop "$CONTAINER_NAME" >/dev/null
    echo "Container $CONTAINER_NAME kept for reuse (run 'docker rm -f $CONTAINER_NAME' to clean up)"
  fi

  echo "✅ Tests PASSED on Node.js $NODE_VERSION (Alpine musl)"
  echo ""
done

echo "========================================"
echo "✅ All Alpine (musl) Docker tests passed!"
echo "========================================"
