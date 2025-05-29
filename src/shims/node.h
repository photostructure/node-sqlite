#ifndef SRC_SHIMS_NODE_H_
#define SRC_SHIMS_NODE_H_

#include <napi.h>

// Node.js compatibility definitions
#define NODE_WANT_INTERNALS 1

namespace node {

// Basic Node.js environment stubs
class Environment;

} // namespace node

#endif // SRC_SHIMS_NODE_H_