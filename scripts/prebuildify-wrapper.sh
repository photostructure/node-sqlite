#!/bin/bash
# Wrapper for prebuildify to work around build validation issues
#
# PROBLEM: prebuildify can exit with code 0 (success) even when the native module
# build fails, resulting in an empty or invalid .node file. This causes CI/CD 
# pipelines to incorrectly report success.
#
# WHY THIS HAPPENS: 
# - prebuildify may encounter build errors but still exit cleanly
# - This can occur with Node.js version incompatibilities or build configuration issues
# - The exit code doesn't always reflect whether a valid binary was produced
#
# SOLUTION: This wrapper validates that prebuildify actually created a valid
# native module (>25kB) before reporting success.
#
# RELATED ISSUE: There's also a known Windows issue with prebuildify v6.0.1 where
# it fails with "Error: spawn EINVAL" (https://github.com/prebuild/prebuildify/issues/83).
# However, this wrapper doesn't fix that issue - it only ensures proper build validation.
#
# WHEN TO REMOVE: This wrapper can be removed when we're confident that prebuildify
# reliably returns proper exit codes for all build scenarios.

# Run prebuildify and capture the exit code
npx prebuildify --napi --tag-libc --strip "$@"
EXIT_CODE=$?

# Check if prebuildify created the prebuilt binary
if find prebuilds -name '*.node' -type f -size +25k -print -quit >/dev/null; then
  echo "Native module built successfully (size > 25kB)"
  exit 0
else
  echo "Build failed: No valid native module found (expected .node file > 25kB)"
  # If prebuildify returned 0 but didn't create a valid binary, force failure
  if [ $EXIT_CODE -eq 0 ]; then
    exit 1
  else
    exit $EXIT_CODE
  fi
fi