#!/bin/bash
# AddressSanitizer + LeakSanitizer + UndefinedBehaviorSanitizer test runner for
# @photostructure/sqlite. Runs comprehensive memory- and UB-safety checks on the
# native code.
#
# ASan/LSan/UBSan legally share one binary. ThreadSanitizer cannot join them
# (it is mutually exclusive with ASan) and is not currently wired up -- see
# "Race detection" in doc/internal/testing-philosophy.md for why, and what we
# rely on instead.
#
# Two things here are load-bearing and easy to break:
#
#   1. _FORTIFY_SOURCE MUST be OFF under AddressSanitizer (OpenSSF guidance):
#      FORTIFY's libc interceptors collide with ASan's and yield false
#      positives/negatives. The release build sets -D_FORTIFY_SOURCE=2 in
#      binding.gyp, so we undefine it here. This works because gyp's make rule
#      is "$(GYP_CFLAGS) ... $(CFLAGS)" -- our env CFLAGS land LAST and win.
#
#   2. UBSan is recoverable by default (prints and exits 0). We build with
#      -fno-sanitize-recover=undefined so undefined behavior in OUR code aborts
#      hard. The vendored SQLite amalgamation is excluded from UB instrumentation
#      via .ubsan-ignorelist.txt (it is still fully ASan-instrumented).

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

# Set up build environment.
#
# -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0 cancels binding.gyp's release FORTIFY
# (see header). These env flags are appended after GYP_CFLAGS, so they win.
SANITIZE_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined"
SANITIZE_FLAGS="$SANITIZE_FLAGS -fsanitize-ignorelist=$(pwd)/.ubsan-ignorelist.txt"
SANITIZE_FLAGS="$SANITIZE_FLAGS -fno-omit-frame-pointer -g -O1"
SANITIZE_FLAGS="$SANITIZE_FLAGS -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0"

export CC=clang
export CXX=clang++
export CFLAGS="$SANITIZE_FLAGS"
export CXXFLAGS="$SANITIZE_FLAGS"
export LDFLAGS="-fsanitize=address,undefined"

# Comprehensive ASAN options combining both implementations. Keep leak
# detection off while node-gyp runs: LD_PRELOAD also instruments its Node and
# Python helper processes, and LeakSanitizer cannot inspect those helpers in
# ptrace-based CI/sandbox environments. Leave it disabled for Jest and enable
# it only for the focused lifecycle process below.
ASAN_OPTIONS_BASE="halt_on_error=0:symbolize=0:print_stats=1:check_initialization_order=1:strict_init_order=1:print_module_map=1:suppressions=$(pwd)/.asan-suppressions.txt"
export ASAN_OPTIONS="detect_leaks=0:$ASAN_OPTIONS_BASE"

# print_suppressions=1 lists which LSan rules actually fired, so dead ones can be
# pruned. It is VERBOSE-only on purpose: LSan writes that summary to *stderr*,
# these env vars are inherited by child processes, and multi-process.test.ts
# asserts that a spawned child's stderr is empty. Leaving it on breaks that test.
# Run `VERBOSE=1 npm run memory:asan` when auditing the suppression list.
LSAN_PRINT_SUPPRESSIONS=0
if [[ "$VERBOSE" == "1" ]]; then
    LSAN_PRINT_SUPPRESSIONS=1
fi
# The suppressions file must never wildcard napi_/Napi:: frames -- see its header.
export LSAN_OPTIONS="suppressions=$(pwd)/.lsan-suppressions.txt:print_suppressions=$LSAN_PRINT_SUPPRESSIONS"
# The focused pool probe is small enough to run without suppressions. In
# particular, broad Node/V8/libuv patterns can otherwise match beneath an
# addon's allocation frame and hide exactly the leaks this probe targets.
LSAN_POOL_OPTIONS="print_suppressions=$LSAN_PRINT_SUPPRESSIONS"
export UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1"

# Increase Node.js heap size for ASan overhead
export NODE_OPTIONS="--max-old-space-size=8192"

# Find and set ASan runtime library.
#
# We preload a runtime into an *uninstrumented* node, and not every runtime
# survives that. clang's compiler-rt build wedges in LeakSanitizer's
# StopTheWorld on some clang/kernel combinations (seen with clang 21 on Linux
# 7.x): node starts, runs, prints its output, then hangs forever at exit while
# the tracer attaches, fails to suspend node's threads, detaches, and retries.
# The symptom is an apparent build hang, because LD_PRELOAD is inherited by
# every child -- including the npm/node-gyp invocations below.
#
# GCC's libasan drives the same node binary to completion, and clang-instrumented
# objects resolve against it (both implement the same __asan_* interface), so
# probe each candidate and use the first that can finish a leak check. Mixing
# clang instrumentation with GCC's runtime is not an officially supported
# configuration; it is a deliberate fallback, taken only when the matching
# runtime cannot complete.
echo "Detecting ASan runtime library..."

# Exits 0 (clean) or 1 (leaks found) when usable; 124/137 when it hangs.
probe_asan_runtime() {
    local lib="$1" rc=0
    timeout -k 1 -s KILL 30 env LD_PRELOAD="$lib" ASAN_OPTIONS=detect_leaks=1 \
        node -e '' >/dev/null 2>&1 || rc=$?
    [[ $rc -eq 0 || $rc -eq 1 ]]
}

ASAN_CANDIDATES=()
CLANG_ASAN=$(clang -print-file-name=libclang_rt.asan-x86_64.so 2>/dev/null || echo "")
if [[ -n "$CLANG_ASAN" && "$CLANG_ASAN" != *"not found"* && -f "$CLANG_ASAN" ]]; then
    ASAN_CANDIDATES+=("$CLANG_ASAN")
fi
for lib in /usr/lib/x86_64-linux-gnu/libasan.so.{8,6} /usr/lib64/libasan.so.{8,6}; do
    [[ -f "$lib" ]] && ASAN_CANDIDATES+=("$lib")
done

# NOTE: the winner is kept in ASAN_RUNTIME and applied to the test command
# only -- never exported. LD_PRELOAD is inherited by every child process, and
# binding.gyp shells out to `node -p "require('node-addon-api').targets ..."`
# during configure. Under a preloaded ASan, LeakSanitizer reports a leak in
# that throwaway node and exits 1, so gyp reads the helper as failed and
# aborts with "Call to 'node -p ...' returned exit status 1".
ASAN_RUNTIME=""
for lib in "${ASAN_CANDIDATES[@]}"; do
    echo -e "${BLUE}Probing ASan runtime: $lib${NC}"
    if probe_asan_runtime "$lib"; then
        ASAN_RUNTIME="$lib"
        echo -e "${BLUE}Using ASan library: $lib${NC}"
        break
    fi
    echo -e "${YELLOW}  unusable (hung during leak check) -- trying next${NC}"
done

# UBSan ships as its own runtime. The addon is compiled -fsanitize=undefined
# with -fno-sanitize-recover, so it references the *_abort handlers; without a
# matching libubsan every test suite dies at load with
# "undefined symbol: __ubsan_handle_type_mismatch_v1_abort". Pick the one that
# goes with whichever ASan runtime won the probe above.
UBSAN_RUNTIME=""
case "$ASAN_RUNTIME" in
    *libclang_rt.asan*)
        cand=$(clang -print-file-name=libclang_rt.ubsan_standalone-x86_64.so 2>/dev/null || echo "")
        [[ -n "$cand" && "$cand" != *"not found"* && -f "$cand" ]] && UBSAN_RUNTIME="$cand"
        ;;
    ?*)
        for cand in "${ASAN_RUNTIME%/*}"/libubsan.so.{1,0} \
                    /usr/lib/x86_64-linux-gnu/libubsan.so.1 /usr/lib64/libubsan.so.1; do
            [[ -f "$cand" ]] && { UBSAN_RUNTIME="$cand"; break; }
        done
        ;;
esac

SAN_PRELOAD="$ASAN_RUNTIME"
if [[ -n "$UBSAN_RUNTIME" ]]; then
    SAN_PRELOAD="$SAN_PRELOAD:$UBSAN_RUNTIME"
    echo -e "${BLUE}Using UBSan library: $UBSAN_RUNTIME${NC}"
fi

if [[ -z "$ASAN_RUNTIME" ]]; then
    echo -e "${YELLOW}Warning: no usable ASan runtime library found${NC}"
    if (( ${#ASAN_CANDIDATES[@]} > 0 )); then
        echo -e "${YELLOW}  Candidates were tried but all hung in LeakSanitizer.${NC}"
        echo -e "${YELLOW}  Install GCC's libasan (apt install libasan8), or run${NC}"
        echo -e "${YELLOW}  with ASAN_OPTIONS=detect_leaks=0 and use${NC}"
        echo -e "${YELLOW}  'npm run memory:valgrind' for leak coverage.${NC}"
    fi
fi

# Build the native module via the same path as a normal rebuild.
#
# Do NOT use `npx node-gyp` here. Invoked through npx, make dies with
#   fatal error: opening dependency file
#   ./Release/.deps/.../<unit>.o.d.raw: No such file or directory
# and the unit that fails changes between runs, so it is a race creating the
# .deps subdirectories rather than anything about a particular source file.
# The same node-gyp version driven by `npm run` builds cleanly from scratch.
# Reproducible with no sanitizer flags set -- this is not an ASan interaction.
echo "Building with AddressSanitizer..."
npm run build:native:rebuild

# Build the distribution bundle
echo "Building distribution bundle..."
npm run build:dist

# Run tests and capture output. Sanitizer instrumentation is deliberately run
# in-band: a default Jest worker fan-out can saturate the machine with dozens of
# instrumented Node processes and make unrelated fixed-timeout multi-process
# tests fail from scheduler contention. Leak-at-exit is disabled for Jest: its
# retained VM graph is noisy and too broad for first-party attribution.
# LD_PRELOAD is scoped to the Node processes that load the instrumented addon;
# exporting it would also instrument npm, node-gyp, and shell helpers.
echo -e "${YELLOW}Running tests with AddressSanitizer...${NC}"
ASAN_TEST_OPTIONS="detect_leaks=0:$ASAN_OPTIONS_BASE"
LSAN_TEST_OPTIONS="detect_leaks=1:$ASAN_OPTIONS_BASE"
set +e  # Don't exit on test failure
LD_PRELOAD="$SAN_PRELOAD" ASAN_OPTIONS="$ASAN_TEST_OPTIONS" \
    node --expose-gc node_modules/jest/bin/jest.js --runInBand --no-coverage --forceExit 2>&1 | tee "$OUTPUT_FILE"
ASAN_TEST_EXIT_CODE=${PIPESTATUS[0]}

# A minimal process gives LSan an attributable native ownership graph without
# Jest/TypeScript/compiler state. This loop covers open, transport, batches,
# errors, and close often enough to expose per-connection leaks.
echo -e "${YELLOW}Running focused LeakSanitizer lifecycle loop...${NC}"
LD_PRELOAD="$SAN_PRELOAD" ASAN_OPTIONS="$LSAN_TEST_OPTIONS" \
    LSAN_OPTIONS="$LSAN_POOL_OPTIONS" node scripts/lsan-pool-test.cjs 2>&1 | tee -a "$OUTPUT_FILE"
LSAN_TEST_EXIT_CODE=${PIPESTATUS[0]}
set -e

TEST_EXIT_CODE=0
if [[ "$ASAN_TEST_EXIT_CODE" -ne 0 ]] || [[ "$LSAN_TEST_EXIT_CODE" -ne 0 ]]; then
    TEST_EXIT_CODE=1
fi

# Do not instrument the shell utilities used to classify the captured report.
export ASAN_OPTIONS="$ASAN_TEST_OPTIONS"

echo -e "${BLUE}\nFull ASAN output saved to: $OUTPUT_FILE${NC}"

# Analyze output for errors specific to our code
echo -e "\n${YELLOW}Analyzing ASAN output...${NC}"

# Count different types of issues
OUR_ERRORS=0
OUR_UB=0
OUR_LEAKS=0
PYTHON_LEAKS=0
SYSTEM_LEAKS=0
TOTAL_LEAKS=0

# Check for ASAN errors in our code (not V8/Node internals)
if grep -E "(ERROR: AddressSanitizer|ERROR: LeakSanitizer)" "$OUTPUT_FILE" | grep -E "(phstr_sqlite\.node|/src/|aggregate_function|user_function|sqlite_impl|async_pool_impl)" > /dev/null; then
    OUR_ERRORS=1
fi

# Check for UBSan findings in our first-party sources. UBSan formats these as
# "<file>:<line>:<col>: runtime error: <description>". The vendored SQLite
# amalgamation is excluded from UB instrumentation (.ubsan-ignorelist.txt), so
# anything here is ours. We build with -fno-sanitize-recover=undefined, so this
# should already have aborted the run -- this catches it either way.
if grep -E "runtime error:" "$OUTPUT_FILE" | grep -E "(sqlite_impl|async_pool_impl|user_function|aggregate_function|binding)\.(cpp|h)" > /dev/null; then
    OUR_UB=1
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
        if echo "$context" | grep -E "(phstr_sqlite\.node|/src/|aggregate_function|user_function|sqlite_impl|async_pool_impl|photostructure)" > /dev/null && ! echo "$context" | grep -E "/node_modules/" > /dev/null; then
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

# First check if tests themselves failed
if [[ "$TEST_EXIT_CODE" -ne 0 ]]; then
    echo -e "${RED}\n✗ Tests failed with exit code: $TEST_EXIT_CODE${NC}"
    EXIT_CODE=1
fi

if [[ "$OUR_ERRORS" -eq 1 ]]; then
    echo -e "${RED}\n✗ AddressSanitizer found errors in sqlite code:${NC}"
    grep -E "(ERROR: AddressSanitizer|ERROR: LeakSanitizer)" "$OUTPUT_FILE" | grep -E "(phstr_sqlite\.node|/src/)" | head -20
    EXIT_CODE=1
fi

if [[ "$OUR_UB" -eq 1 ]]; then
    echo -e "${RED}\n✗ UndefinedBehaviorSanitizer found undefined behavior in sqlite code:${NC}"
    grep -E "runtime error:" "$OUTPUT_FILE" | grep -E "(sqlite_impl|async_pool_impl|user_function|aggregate_function|binding)\.(cpp|h)" | head -20
    EXIT_CODE=1
fi

if [[ "$OUR_LEAKS" -gt 0 ]]; then
    echo -e "${RED}\n✗ LeakSanitizer found $OUR_LEAKS memory leak(s) in sqlite code:${NC}"
    # Show leaks from our code
    while IFS= read -r line_num; do
        start=$((line_num - 2))
        end=$((line_num + 15))
        context=$(sed -n "${start},${end}p" "$OUTPUT_FILE")
        if echo "$context" | grep -E "(phstr_sqlite\.node|/src/|aggregate_function|user_function|sqlite_impl|async_pool_impl|photostructure)" > /dev/null; then
            echo "$context"
            echo "---"
        fi
    done < <(grep -n "Direct leak\|Indirect leak" "$OUTPUT_FILE" | cut -d: -f1)
    EXIT_CODE=1
fi

# Check if we detected actual memory issues in our code
if [[ "$OUR_ERRORS" -eq 1 ]] || [[ "$OUR_LEAKS" -gt 0 ]] || [[ "$OUR_UB" -eq 1 ]]; then
    # We found actual memory safety / UB issues in our code
    echo -e "${RED}\n✗ Memory safety or undefined-behavior issues detected in @photostructure/sqlite code!${NC}"
    echo -e "${YELLOW}See $OUTPUT_FILE for full details${NC}"
elif [[ "$TEST_EXIT_CODE" -ne 0 ]]; then
    # Tests failed but no memory issues in our code
    echo -e "${YELLOW}\n⚠ Tests failed, but no memory safety issues found in @photostructure/sqlite code${NC}"
    echo -e "${YELLOW}Check test output above for test failures${NC}"
else
    # Everything passed
    echo -e "${GREEN}\n✓ AddressSanitizer and LeakSanitizer tests passed (no issues in sqlite code)${NC}"
fi

# Report suppressed leaks regardless of outcome
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
        if [[ -n "$ASAN_RUNTIME" ]]; then
            echo -e "${BLUE}  - tests ran with LD_PRELOAD=$SAN_PRELOAD${NC}"
        fi
    fi
fi

# Clean up: Remove ASAN-instrumented build
echo -e "\n${YELLOW}Cleaning up ASAN build...${NC}"
npm run clean:native > /dev/null 2>&1 || true

exit $EXIT_CODE
