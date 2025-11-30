#ifndef SRC_SHIMS_ENV_INL_H_
#define SRC_SHIMS_ENV_INL_H_

// This header exists for Node.js source compatibility.
// src/upstream/node_sqlite.cc includes "env-inl.h", and we can't modify
// upstream files (they're auto-synced from Node.js). The actual Environment
// implementation is in util.h.
#include "util.h"

#endif // SRC_SHIMS_ENV_INL_H_
