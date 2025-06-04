#!/bin/bash
# AddressSanitizer and LeakSanitizer test runner for @photostructure/sqlite
# Runs comprehensive memory safety checks on native code

set -euo pipefail

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "AddressSanitizer tests are only supported on Linux"
    exit 0
fi

# Check for clang
if ! command -v clang &> /dev/null; then
    echo "Error: clang is required for AddressSanitizer tests"
    echo "Install with: sudo apt-get install clang"
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLEAN_BUILD=${CLEAN_BUILD:-1}
VERBOSE=${VERBOSE:-0}
OUTPUT_FILE="asan-output.log"

echo -e "${YELLOW}Running AddressSanitizer and LeakSanitizer tests...${NC}"

# Clean previous builds if requested
if [[ "$CLEAN_BUILD" == "1" ]]; then
    echo "Cleaning previous builds..."
    rm -rf build/
fi
rm -f "$OUTPUT_FILE"

# Set up build environment
export CC=clang
export CXX=clang++
export CFLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1"
export CXXFLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1"
export LDFLAGS="-fsanitize=address"

# Comprehensive ASAN options combining both implementations
export ASAN_OPTIONS="detect_leaks=1:halt_on_error=0:print_stats=1:check_initialization_order=1:strict_init_order=1:print_module_map=1"
export LSAN_OPTIONS="suppressions=$(pwd)/.lsan-suppressions.txt:print_suppressions=0"

# Increase Node.js heap size for ASan overhead
export NODE_OPTIONS="--max-old-space-size=8192"

# Find and set ASan runtime library
echo "Detecting ASan runtime library..."
ASAN_LIB=$(clang -print-file-name=libclang_rt.asan-x86_64.so 2>/dev/null || echo "")

if [[ -n "$ASAN_LIB" && "$ASAN_LIB" != *"not found"* && -f "$ASAN_LIB" ]]; then
    export LD_PRELOAD="$ASAN_LIB"
    echo -e "${BLUE}Using ASan library: $ASAN_LIB${NC}"
else
    # Try common paths as fallback
    for lib in /usr/lib/x86_64-linux-gnu/libasan.so.{8,6} /usr/lib64/libasan.so.{8,6}; do
        if [[ -f "$lib" ]]; then
            export LD_PRELOAD="$lib"
            echo -e "${BLUE}Using ASan library: $lib${NC}"
            break
        fi
    done
fi

if [[ -z "${LD_PRELOAD:-}" ]]; then
    echo -e "${YELLOW}Warning: Could not find ASan runtime library${NC}"
fi

# Build the native module
echo "Building with AddressSanitizer..."
npm run node-gyp-rebuild

# Build the distribution bundle
echo "Building distribution bundle..."
npm run build:dist

# Run tests and capture output
echo -e "${YELLOW}Running tests with AddressSanitizer...${NC}"
set +e  # Don't exit on test failure
npm test -- --no-coverage 2>&1 | tee "$OUTPUT_FILE"
TEST_EXIT_CODE=${PIPESTATUS[0]}
set -e

echo -e "${BLUE}\nFull ASAN output saved to: $OUTPUT_FILE${NC}"

# Analyze output for errors specific to our code
echo -e "\n${YELLOW}Analyzing ASAN output...${NC}"

# Count different types of issues
OUR_ERRORS=0
OUR_LEAKS=0
PYTHON_LEAKS=0
SYSTEM_LEAKS=0
TOTAL_LEAKS=0

# Check for ASAN errors in our code (not V8/Node internals)
if grep -E "(ERROR: AddressSanitizer|ERROR: LeakSanitizer)" "$OUTPUT_FILE" | grep -E "(phstr_sqlite\.node|/src/|aggregate_function|user_function|sqlite_impl)" > /dev/null; then
    OUR_ERRORS=1
fi

# Check for any leak summary
if grep -q "SUMMARY: AddressSanitizer.*leaked" "$OUTPUT_FILE"; then
    # Extract total number of leak allocations (not bytes)
    TOTAL_LEAKS=$(grep "SUMMARY: AddressSanitizer" "$OUTPUT_FILE" | grep -oE "[0-9]+ allocation\(s\)" | grep -oE "[0-9]+" | head -1 || echo "0")
    
    # Check for direct/indirect leaks in our code with context
    while IFS= read -r line_num; do
        # Get 5 lines before and 20 lines after for context
        start=$((line_num - 5))
        end=$((line_num + 20))
        context=$(sed -n "${start},${end}p" "$OUTPUT_FILE")
        
        # Check if this leak is from our code
        if echo "$context" | grep -E "(phstr_sqlite\.node|/src/|aggregate_function|user_function|sqlite_impl|photostructure)" > /dev/null && ! echo "$context" | grep -E "/node_modules/" > /dev/null; then
            OUR_LEAKS=$((OUR_LEAKS + 1))
        # Check if this leak is from Python
        elif echo "$context" | grep -iE "(python|libpython|\.py:|Py_|PyObject)" > /dev/null; then
            PYTHON_LEAKS=$((PYTHON_LEAKS + 1))
        # Check if this leak is from node_modules dependencies
        elif echo "$context" | grep -E "/node_modules/" > /dev/null; then
            SYSTEM_LEAKS=$((SYSTEM_LEAKS + 1))
        # Otherwise it's a system/Node.js leak
        else
            SYSTEM_LEAKS=$((SYSTEM_LEAKS + 1))
        fi
    done < <(grep -n "Direct leak\|Indirect leak" "$OUTPUT_FILE" | cut -d: -f1)
fi

# Report results
EXIT_CODE=0

if [[ "$OUR_ERRORS" -eq 1 ]]; then
    echo -e "${RED}\n✗ AddressSanitizer found errors in sqlite code:${NC}"
    grep -E "(ERROR: AddressSanitizer|ERROR: LeakSanitizer)" "$OUTPUT_FILE" | grep -E "(phstr_sqlite\.node|/src/)" | head -20
    EXIT_CODE=1
fi

if [[ "$OUR_LEAKS" -gt 0 ]]; then
    echo -e "${RED}\n✗ LeakSanitizer found $OUR_LEAKS memory leak(s) in sqlite code:${NC}"
    # Show leaks from our code
    while IFS= read -r line_num; do
        start=$((line_num - 2))
        end=$((line_num + 15))
        context=$(sed -n "${start},${end}p" "$OUTPUT_FILE")
        if echo "$context" | grep -E "(phstr_sqlite\.node|/src/|aggregate_function|user_function|sqlite_impl|photostructure)" > /dev/null; then
            echo "$context"
            echo "---"
        fi
    done < <(grep -n "Direct leak\|Indirect leak" "$OUTPUT_FILE" | cut -d: -f1)
    EXIT_CODE=1
fi

if [[ "$EXIT_CODE" -eq 0 ]]; then
    echo -e "${GREEN}\n✓ AddressSanitizer and LeakSanitizer tests passed (no issues in sqlite code)${NC}"
    
    # Report suppressed leaks if any
    if [[ "$TOTAL_LEAKS" -gt 0 ]]; then
        echo -e "${YELLOW}\n   Suppressed/Ignored leaks:${NC}"
        if [[ "$PYTHON_LEAKS" -gt 0 ]]; then
            echo -e "${YELLOW}   - Python/build tools: $PYTHON_LEAKS leak(s)${NC}"
        fi
        if [[ "$SYSTEM_LEAKS" -gt 0 ]]; then
            echo -e "${YELLOW}   - System/Node.js/Dependencies: $SYSTEM_LEAKS leak(s)${NC}"
        fi
        echo -e "${BLUE}   Total: $TOTAL_LEAKS leak(s) (not from our code)${NC}"
        
        # Don't show the SUMMARY line for non-our-code leaks
        echo -e "${BLUE}\n   Note: These leaks are from Python build tools, system libraries,${NC}"
        echo -e "${BLUE}   or npm dependencies - not from the @photostructure/sqlite code.${NC}"
    fi
else
    echo -e "${RED}\n✗ Memory safety issues detected in @photostructure/sqlite code!${NC}"
    echo -e "${YELLOW}See $OUTPUT_FILE for full details${NC}"
    
    # Still report other leaks for context
    if [[ "$PYTHON_LEAKS" -gt 0 ]] || [[ "$SYSTEM_LEAKS" -gt 0 ]]; then
        echo -e "${YELLOW}\nAdditional suppressed leaks:${NC}"
        if [[ "$PYTHON_LEAKS" -gt 0 ]]; then
            echo -e "${YELLOW}   - Python/build tools: $PYTHON_LEAKS leak(s)${NC}"
        fi
        if [[ "$SYSTEM_LEAKS" -gt 0 ]]; then
            echo -e "${YELLOW}   - System/Node.js/Dependencies: $SYSTEM_LEAKS leak(s)${NC}"
        fi
    fi
fi

# Show ASAN statistics if verbose
if [[ "$VERBOSE" -eq 1 ]] && grep -q "Stats:" "$OUTPUT_FILE"; then
    echo -e "\n${BLUE}ASAN Statistics:${NC}"
    grep -A 20 "Stats:" "$OUTPUT_FILE" | head -20
fi

# Debug: Check if ASAN was actually loaded
if [[ "$VERBOSE" -eq 1 ]] || [[ "$EXIT_CODE" -eq 0 ]]; then
    if ! grep -q "AddressSanitizer\|LeakSanitizer\|==[0-9]*==" "$OUTPUT_FILE"; then
        echo -e "${YELLOW}\nNote: No ASAN/LSAN output detected. This could mean:${NC}"
        echo -e "${YELLOW}  - No memory errors or leaks were found${NC}"
        echo -e "${YELLOW}  - ASAN might not be properly loaded${NC}"
        if [[ -n "${LD_PRELOAD:-}" ]]; then
            echo -e "${BLUE}  - LD_PRELOAD is set to: $LD_PRELOAD${NC}"
        fi
    fi
fi

# Clean up: Remove ASAN-instrumented build
echo -e "\n${YELLOW}Cleaning up ASAN build...${NC}"
npm run clean:native > /dev/null 2>&1 || true

exit $EXIT_CODE