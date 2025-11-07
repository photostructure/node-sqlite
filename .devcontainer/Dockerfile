# Use the official Node.js dev container base image
FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

# Install additional dependencies for building native modules
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    python3-dev \
    cmake \
    ninja-build \
    ccache \
    clang-tidy \
    clang-format \
    valgrind \
    gdb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install node-gyp globally
RUN npm install -g node-gyp@latest

# Set up ccache for faster C++ compilation
ENV PATH="/usr/lib/ccache:${PATH}"
ENV CCACHE_DIR="/workspaces/.ccache"

# Configure git to trust the workspace directory
RUN git config --global --add safe.directory /workspaces/*

# Set the default shell to zsh
ENV SHELL=/bin/zsh