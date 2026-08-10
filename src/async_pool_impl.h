#ifndef SRC_ASYNC_POOL_IMPL_H_
#define SRC_ASYNC_POOL_IMPL_H_

#include <napi.h>

namespace photostructure::sqlite {

struct AddonData;
class AsyncPoolEnvironment;

// Installs the per-environment cleanup coordinator, caches the hidden native
// connection constructor, and defines the non-enumerable open function.
bool InitializeAsyncPool(Napi::Env env, Napi::Object exports,
                         AddonData *addon_data);

// Called from the instance-data finalizer, after asynchronous environment
// cleanup has drained every pool worker and closed every SQLite handle.
void DestroyAsyncPoolEnvironment(AddonData *addon_data) noexcept;

} // namespace photostructure::sqlite

#endif // SRC_ASYNC_POOL_IMPL_H_
