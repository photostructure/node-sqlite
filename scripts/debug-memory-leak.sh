#!/bin/bash
# Debug script to help identify memory leaks in CI

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Memory Leak Debug Information ===${NC}"
echo "Date: $(date)"
echo "Node version: $(node --version)"
echo "OS: $(uname -a)"
echo ""

# Only run on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${YELLOW}This script only runs on Linux. Exiting.${NC}"
    exit 0
fi

# Check valgrind
if command -v valgrind &> /dev/null; then
    echo "Valgrind version: $(valgrind --version | head -1)"
else
    echo "Valgrind: NOT FOUND"
fi

# Check build
if [ -d "$ROOT_DIR/dist" ]; then
    echo -e "${GREEN}✓ dist/ directory exists${NC}"
else
    echo -e "${RED}✗ dist/ directory missing${NC}"
fi

# Run minimal test to isolate the leak
echo -e "\n${YELLOW}Running minimal leak test...${NC}"
cat > "$ROOT_DIR/minimal-leak-test.js" << 'EOF'
const { DatabaseSync } = require('./dist/index.cjs');

// Minimal test case
console.log('Creating database...');
const db = new DatabaseSync(':memory:');

console.log('Creating table...');
db.exec('CREATE TABLE test (id INTEGER)');

console.log('Preparing statement...');
const stmt = db.prepare('INSERT INTO test VALUES (?)');

console.log('Running statement...');
stmt.run(1);

console.log('Finalizing statement...');
stmt.finalize();

console.log('Closing database...');
db.close();

console.log('Test completed successfully');
EOF

# Run with valgrind and more detailed output
echo -e "\n${YELLOW}Running valgrind with verbose output...${NC}"
VALGRIND_OPTS="--leak-check=full --show-leak-kinds=all --track-origins=yes --verbose"
VALGRIND_OPTS="$VALGRIND_OPTS --suppressions=$ROOT_DIR/.valgrind.supp"
VALGRIND_OPTS="$VALGRIND_OPTS --gen-suppressions=all"

valgrind $VALGRIND_OPTS node "$ROOT_DIR/minimal-leak-test.js" 2>&1 | tee "$ROOT_DIR/valgrind-debug.log"

# Analyze the log
echo -e "\n${YELLOW}Analyzing valgrind output...${NC}"
echo "=== LEAK SUMMARY ==="
grep -A 10 "LEAK SUMMARY" "$ROOT_DIR/valgrind-debug.log" || echo "No LEAK SUMMARY found"

echo -e "\n=== Definitely lost ==="
grep -B 5 -A 10 "definitely lost" "$ROOT_DIR/valgrind-debug.log" | grep -v "0 bytes in 0 blocks" || echo "No definitely lost leaks"

echo -e "\n=== Indirectly lost ==="
grep -B 5 -A 10 "indirectly lost" "$ROOT_DIR/valgrind-debug.log" | grep -v "0 bytes in 0 blocks" || echo "No indirectly lost leaks"

# Save artifacts
if [[ -n "${GITHUB_ACTIONS}" ]]; then
    echo -e "\n${BLUE}Saving debug artifacts...${NC}"
    cp "$ROOT_DIR/valgrind-debug.log" "$ROOT_DIR/valgrind-debug-$(date +%Y%m%d-%H%M%S).log"
    echo "Debug log saved for artifact upload"
fi

# Cleanup
rm -f "$ROOT_DIR/minimal-leak-test.js"

echo -e "\n${BLUE}Debug script completed${NC}"