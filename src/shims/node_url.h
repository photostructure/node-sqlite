#ifndef SRC_SHIMS_NODE_URL_H_
#define SRC_SHIMS_NODE_URL_H_

#include <string>

namespace node {
namespace url {

// URL utilities - minimal implementation
class URL {
public:
  explicit URL(const std::string &input) : href_(input) {}

  const std::string &href() const { return href_; }

private:
  std::string href_;
};

} // namespace url
} // namespace node

#endif // SRC_SHIMS_NODE_URL_H_