#!/bin/bash

# Check if valgrind is available
if ! command -v valgrind &> /dev/null; then
    echo "Error: valgrind is not installed"
    exit 1
fi

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Create a temporary file for valgrind output
VALGRIND_LOG=$(mktemp)

# Create a temporary directory for compiled JS
TEMP_DIR=$(mktemp -d)
COMPILED_JS="$TEMP_DIR/valgrind-test.js"

# Compile TypeScript to JavaScript
echo "Compiling TypeScript..."
npx tsc "$SCRIPT_DIR/valgrind-test.ts" --outDir "$TEMP_DIR" --module commonjs --target es2020 --skipLibCheck || {
    echo "Failed to compile TypeScript"
    rm -rf "$TEMP_DIR"
    rm -f "$VALGRIND_LOG"
    exit 1
}

# Run valgrind with the compiled JavaScript
valgrind \
    --leak-check=full \
    --show-leak-kinds=definite,indirect \
    --track-origins=yes \
    --suppressions="$PROJECT_ROOT/.valgrind.supp" \
    --log-file="$VALGRIND_LOG" \
    node "$COMPILED_JS"

# Check the exit code
EXIT_CODE=$?

# Display the valgrind output
echo "=== Valgrind Output ==="
cat "$VALGRIND_LOG"

# Check for memory leaks
if grep -q "definitely lost: 0 bytes in 0 blocks" "$VALGRIND_LOG" && \
   grep -q "indirectly lost: 0 bytes in 0 blocks" "$VALGRIND_LOG"; then
    echo "✓ No memory leaks detected"
    LEAK_EXIT_CODE=0
else
    echo "✗ Memory leaks detected"
    LEAK_EXIT_CODE=1
fi

# Clean up
rm -f "$VALGRIND_LOG"
rm -rf "$TEMP_DIR"

# Return the worst exit code
if [ $EXIT_CODE -ne 0 ] || [ $LEAK_EXIT_CODE -ne 0 ]; then
    exit 1
else
    exit 0
fi