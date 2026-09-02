#include "async_pool_impl.h"

#include <sqlite3.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>

#include "shims/sqlite_errors.h"
#include "sqlite_impl.h"

namespace photostructure::sqlite {
namespace {

constexpr int64_t kJsMaxSafeInteger = 9007199254740991LL;
constexpr int64_t kJsMinSafeInteger = -9007199254740991LL;

enum class OperationKind { kRun, kGet, kAll };

using Blob = std::vector<uint8_t>;
using ValueData =
    std::variant<std::nullptr_t, int64_t, double, std::string, Blob>;

struct NativeValue {
  ValueData data = nullptr;
};

struct NativeParams {
  bool named = false;
  std::vector<std::pair<std::string, NativeValue>> values;
};

struct NativeOperation {
  OperationKind kind = OperationKind::kRun;
  std::string sql;
  std::optional<NativeParams> params;
};

enum class TransactionMode { kNone, kDeferred, kImmediate, kExclusive };

struct NativeRequest {
  std::vector<NativeOperation> operations;
  TransactionMode transaction = TransactionMode::kNone;
};

struct NativeColumn {
  std::string name;
  NativeValue value;
};

using NativeRow = std::vector<NativeColumn>;

struct NativeOperationResult {
  OperationKind kind = OperationKind::kRun;
  int64_t changes = 0;
  std::vector<NativeRow> rows;
};

struct NativeError {
  bool present = false;
  bool sqlite = false;
  bool range = false;
  bool fatal = false;
  std::string message;
  int sqlite_code = SQLITE_ERROR;
  int sqlite_extended_code = SQLITE_ERROR;
  std::string sqlite_error_string;
};

struct NativeResponse {
  std::vector<NativeOperationResult> results;
  NativeError error;
};

struct OpenConfiguration {
  std::string location;
  bool read_big_ints = false;
  bool return_arrays = false;
  bool strict_authorizer = true;
  bool allow_extension = false;
  std::vector<NativeOperation> setup;
};

bool AsciiEqualsIgnoreCase(const char *left, const char *right) noexcept {
  if (left == nullptr || right == nullptr) {
    return left == right;
  }
  while (*left != '\0' && *right != '\0') {
    char a = *left++;
    char b = *right++;
    if (a >= 'A' && a <= 'Z') {
      a = static_cast<char>(a - 'A' + 'a');
    }
    if (b >= 'A' && b <= 'Z') {
      b = static_cast<char>(b - 'A' + 'a');
    }
    if (a != b) {
      return false;
    }
  }
  return *left == *right;
}

class AsyncConnectionState {
public:
  explicit AsyncConnectionState(bool read_big_ints, bool return_arrays,
                                bool strict_authorizer)
      : read_big_ints_(read_big_ints), return_arrays_(return_arrays),
        strict_authorizer_(strict_authorizer) {}

  ~AsyncConnectionState() {
    std::lock_guard<std::mutex> lock(handle_mutex_);
    // The environment coordinator and close worker must have consumed the
    // handle before the last shared owner disappears.
    (void)CloseLocked();
  }

  AsyncConnectionState(const AsyncConnectionState &) = delete;
  AsyncConnectionState &operator=(const AsyncConnectionState &) = delete;
  AsyncConnectionState(AsyncConnectionState &&) = delete;
  AsyncConnectionState &operator=(AsyncConnectionState &&) = delete;

  void Publish(sqlite3 *db) noexcept {
    std::lock_guard<std::mutex> lock(handle_mutex_);
    db_ = db;
  }

  sqlite3 *HandleForWorker() const noexcept {
    std::lock_guard<std::mutex> lock(handle_mutex_);
    return db_;
  }

  bool IsOpen() const noexcept {
    std::lock_guard<std::mutex> lock(handle_mutex_);
    return db_ != nullptr;
  }

  int Close() noexcept {
    std::lock_guard<std::mutex> lock(handle_mutex_);
    return CloseLocked();
  }

  bool read_big_ints() const noexcept { return read_big_ints_; }
  bool return_arrays() const noexcept { return return_arrays_; }
  bool strict_authorizer() const noexcept { return strict_authorizer_; }
  bool strict_authorizer_installed() const noexcept {
    return strict_authorizer_installed_;
  }
  void set_strict_authorizer_installed(bool installed) noexcept {
    strict_authorizer_installed_ = installed;
  }

  bool trusted_transaction() const noexcept { return trusted_transaction_; }
  void set_trusted_transaction(bool trusted) noexcept {
    trusted_transaction_ = trusted;
  }

  void set_environment(AsyncPoolEnvironment *environment) noexcept {
    environment_.store(environment, std::memory_order_release);
  }
  AsyncPoolEnvironment *environment() const noexcept {
    return environment_.load(std::memory_order_acquire);
  }

  std::atomic<bool> close_requested{false};

private:
  int CloseLocked() noexcept {
    if (db_ == nullptr) {
      return SQLITE_OK;
    }
    int rc = sqlite3_close(db_);
    if (rc != SQLITE_OK) {
      // Extensions can retain statements, blobs, or backups that make the
      // legacy close report SQLITE_BUSY. close_v2 safely transfers the handle
      // to SQLite's zombie lifecycle so environment teardown can finish; the
      // handle is finally freed when the retained resource is released.
      rc = sqlite3_close_v2(db_);
    }
    if (rc == SQLITE_OK) {
      db_ = nullptr;
    }
    return rc;
  }
  mutable std::mutex handle_mutex_;
  sqlite3 *db_ = nullptr;
  const bool read_big_ints_;
  const bool return_arrays_;
  const bool strict_authorizer_;
  // Only read by SQLite callbacks synchronously on the connection's one
  // active worker thread.
  bool trusted_transaction_ = false;
  bool strict_authorizer_installed_ = false;
  std::atomic<AsyncPoolEnvironment *> environment_{nullptr};
};

class TrustedTransactionGuard {
public:
  explicit TrustedTransactionGuard(AsyncConnectionState *state) noexcept
      : state_(state) {
    state_->set_trusted_transaction(true);
  }
  ~TrustedTransactionGuard() { state_->set_trusted_transaction(false); }
  TrustedTransactionGuard(const TrustedTransactionGuard &) = delete;
  TrustedTransactionGuard &operator=(const TrustedTransactionGuard &) = delete;
  TrustedTransactionGuard(TrustedTransactionGuard &&) = delete;
  TrustedTransactionGuard &operator=(TrustedTransactionGuard &&) = delete;

private:
  AsyncConnectionState *state_;
};

bool IsTempMutation(int action, const char *param1,
                    const char *database_name) noexcept {
  switch (action) {
  case SQLITE_CREATE_TEMP_INDEX:
  case SQLITE_CREATE_TEMP_TABLE:
  case SQLITE_CREATE_TEMP_TRIGGER:
  case SQLITE_CREATE_TEMP_VIEW:
  case SQLITE_DROP_TEMP_INDEX:
  case SQLITE_DROP_TEMP_TABLE:
  case SQLITE_DROP_TEMP_TRIGGER:
  case SQLITE_DROP_TEMP_VIEW:
    return true;
  case SQLITE_INSERT:
  case SQLITE_UPDATE:
  case SQLITE_DELETE:
  case SQLITE_CREATE_INDEX:
  case SQLITE_CREATE_TABLE:
  case SQLITE_CREATE_TRIGGER:
  case SQLITE_CREATE_VIEW:
  case SQLITE_DROP_INDEX:
  case SQLITE_DROP_TABLE:
  case SQLITE_DROP_TRIGGER:
  case SQLITE_DROP_VIEW:
  case SQLITE_CREATE_VTABLE:
  case SQLITE_DROP_VTABLE:
  case SQLITE_REINDEX:
  case SQLITE_ANALYZE:
    return AsciiEqualsIgnoreCase(database_name, "temp");
  case SQLITE_ALTER_TABLE:
    // SQLITE_ALTER_TABLE is exceptional: its first callback string is the
    // database name, rather than the usual fifth callback argument.
    return AsciiEqualsIgnoreCase(param1, "temp");
  default:
    return false;
  }
}

int StrictAuthorizer(void *user_data, int action, const char *param1,
                     const char *param2, const char *database_name,
                     const char * /*trigger*/) noexcept {
  auto *state = static_cast<AsyncConnectionState *>(user_data);
  switch (action) {
  case SQLITE_PRAGMA:
  case SQLITE_ATTACH:
  case SQLITE_DETACH:
    return SQLITE_DENY;
  case SQLITE_TRANSACTION:
  case SQLITE_SAVEPOINT:
    return state->trusted_transaction() ? SQLITE_OK : SQLITE_DENY;
  case SQLITE_FUNCTION:
    if (AsciiEqualsIgnoreCase(param2, "load_extension") ||
        AsciiEqualsIgnoreCase(param2, "last_insert_rowid") ||
        AsciiEqualsIgnoreCase(param2, "changes") ||
        AsciiEqualsIgnoreCase(param2, "total_changes")) {
      return SQLITE_DENY;
    }
    break;
  default:
    break;
  }
  return IsTempMutation(action, param1, database_name) ? SQLITE_DENY
                                                       : SQLITE_OK;
}

int ValidationAuthorizer(void * /*user_data*/, int action,
                         const char * /*param1*/, const char * /*param2*/,
                         const char * /*database_name*/,
                         const char * /*trigger*/) noexcept {
  // Some PRAGMAs take effect during sqlite3_prepare_v2(), before step. Ignore
  // them while validating the complete SQL tail so a rejected multi-statement
  // operation cannot change connection state. The statement is prepared again
  // under the real authorizer before execution.
  return action == SQLITE_PRAGMA ? SQLITE_IGNORE : SQLITE_OK;
}

void SetPlainError(NativeError *error, std::string message) {
  if (error->present) {
    return;
  }
  error->present = true;
  error->message = std::move(message);
}

void SetRangeError(NativeError *error, int64_t value) {
  if (error->present) {
    return;
  }
  error->present = true;
  error->range = true;
  error->message = "Value is too large to be represented as a JavaScript "
                   "number: " +
                   std::to_string(value);
}

void SetSqliteError(sqlite3 *db, int rc, NativeError *error,
                    const char *fallback = nullptr) {
  if (error->present) {
    return;
  }
  error->present = true;
  error->sqlite = true;
  error->sqlite_code = db != nullptr ? sqlite3_errcode(db) : (rc & 0xff);
  error->sqlite_extended_code =
      db != nullptr ? sqlite3_extended_errcode(db) : rc;
  const char *message = db != nullptr ? sqlite3_errmsg(db) : nullptr;
  if (message != nullptr && std::strcmp(message, "not an error") != 0) {
    error->message = message;
  } else if (fallback != nullptr) {
    error->message = fallback;
  } else {
    const char *text = sqlite3_errstr(rc);
    error->message = text != nullptr ? text : "SQLite error";
  }
  const char *error_string = sqlite3_errstr(error->sqlite_code);
  if (error_string != nullptr) {
    error->sqlite_error_string = error_string;
  }
}

bool CopyViewBytes(Napi::Value value, Blob *out) {
  if (value.IsDataView()) {
    const Napi::DataView view = value.As<Napi::DataView>();
    Napi::ArrayBuffer buffer = view.ArrayBuffer();
    const size_t length = view.ByteLength();
    if (length == 0) {
      out->clear();
    } else {
      const auto *start =
          static_cast<const uint8_t *>(buffer.Data()) + view.ByteOffset();
      out->assign(start, start + length);
    }
    return true;
  }
  if (value.IsBuffer()) {
    const Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
    if (buffer.Length() == 0) {
      out->clear();
    } else {
      out->assign(buffer.Data(), buffer.Data() + buffer.Length());
    }
    return true;
  }
  if (value.IsTypedArray()) {
    const Napi::TypedArray view = value.As<Napi::TypedArray>();
    Napi::ArrayBuffer buffer = view.ArrayBuffer();
    const size_t length = view.ByteLength();
    if (length == 0) {
      out->clear();
    } else {
      const auto *start =
          static_cast<const uint8_t *>(buffer.Data()) + view.ByteOffset();
      out->assign(start, start + length);
    }
    return true;
  }
  return false;
}

bool ParseValue(Napi::Env env, Napi::Value value, NativeValue *out,
                std::string *message) {
  if (value.IsNull()) {
    out->data = nullptr;
    return true;
  }
  if (value.IsBigInt()) {
    bool lossless = false;
    const int64_t integer = value.As<Napi::BigInt>().Int64Value(&lossless);
    if (!lossless) {
      *message = "BigInt value is too large to bind to SQLite";
      return false;
    }
    out->data = integer;
    return true;
  }
  if (value.IsNumber()) {
    // Match node:sqlite and the stable DatabaseSync implementation: every
    // JavaScript Number binds as SQLite REAL. Callers use BigInt when they need
    // SQLite INTEGER semantics.
    out->data = value.As<Napi::Number>().DoubleValue();
    return true;
  }
  if (value.IsString()) {
    out->data = value.As<Napi::String>().Utf8Value();
    return true;
  }
  Blob blob;
  if (CopyViewBytes(value, &blob)) {
    out->data = std::move(blob);
    return true;
  }
  *message =
      "Bind parameter must be null, number, bigint, string, or ArrayBufferView";
  return false;
}

bool ParseParams(Napi::Env env, Napi::Value value,
                 std::optional<NativeParams> *out, std::string *message) {
  if (value.IsUndefined()) {
    out->reset();
    return true;
  }

  NativeParams params;
  if (value.IsArray()) {
    const Napi::Array array = value.As<Napi::Array>();
    params.values.reserve(array.Length());
    for (uint32_t index = 0; index < array.Length(); ++index) {
      NativeValue native;
      if (!ParseValue(env, array.Get(index), &native, message)) {
        return false;
      }
      params.values.emplace_back(std::string(), std::move(native));
    }
  } else if (value.IsObject() && !value.IsTypedArray() && !value.IsDataView() &&
             !value.IsBuffer() && !value.IsArrayBuffer()) {
    params.named = true;
    const Napi::Object object = value.As<Napi::Object>();
    const Napi::Array keys = object.GetPropertyNames();
    params.values.reserve(keys.Length());
    for (uint32_t index = 0; index < keys.Length(); ++index) {
      const std::string key = keys.Get(index).As<Napi::String>().Utf8Value();
      NativeValue native;
      if (!ParseValue(env, object.Get(key), &native, message)) {
        return false;
      }
      params.values.emplace_back(key, std::move(native));
    }
  } else {
    *message = "Parameters must be an array or plain object";
    return false;
  }

  *out = std::move(params);
  return true;
}

bool ParseOperation(Napi::Env env, Napi::Value value, NativeOperation *out,
                    std::string *message) {
  if (!value.IsObject() || value.IsArray()) {
    *message = "Operation descriptor must be an object";
    return false;
  }
  const Napi::Object object = value.As<Napi::Object>();
  const Napi::Value kind_value = object.Get("kind");
  const Napi::Value sql_value = object.Get("sql");
  if (!kind_value.IsString() || !sql_value.IsString()) {
    *message = "Operation descriptor requires string kind and sql fields";
    return false;
  }
  const std::string kind = kind_value.As<Napi::String>().Utf8Value();
  if (kind == "run") {
    out->kind = OperationKind::kRun;
  } else if (kind == "get") {
    out->kind = OperationKind::kGet;
  } else if (kind == "all") {
    out->kind = OperationKind::kAll;
  } else {
    *message = "Operation kind must be run, get, or all";
    return false;
  }
  out->sql = sql_value.As<Napi::String>().Utf8Value();
  return ParseParams(env, object.Get("params"), &out->params, message);
}

} // namespace

namespace {

class PoolWorker;
class AsyncPoolConnection;
NativeResponse
ExecuteRequest(const std::shared_ptr<AsyncConnectionState> &state,
               const NativeRequest &request);
bool RunSetup(sqlite3 *db, AsyncConnectionState *state,
              const std::vector<NativeOperation> &setup, NativeError *error);

} // namespace

class AsyncPoolEnvironment {
public:
  AsyncPoolEnvironment(napi_env env, AddonData *addon_data)
      : env_(env), addon_data_(addon_data) {}
  ~AsyncPoolEnvironment();

  AsyncPoolEnvironment(const AsyncPoolEnvironment &) = delete;
  AsyncPoolEnvironment &operator=(const AsyncPoolEnvironment &) = delete;
  AsyncPoolEnvironment(AsyncPoolEnvironment &&) = delete;
  AsyncPoolEnvironment &operator=(AsyncPoolEnvironment &&) = delete;

  bool Initialize();
  bool shutting_down() const noexcept { return shutting_down_; }
  napi_env env() const noexcept { return env_; }
  AddonData *addon_data() const noexcept { return addon_data_; }

  void AddState(const std::shared_ptr<AsyncConnectionState> &state);
  bool QueueWorker(PoolWorker *worker,
                   const std::shared_ptr<AsyncConnectionState> &state);
  bool AttachCloseDeferred(const std::shared_ptr<AsyncConnectionState> &state,
                           const Napi::Promise::Deferred &deferred);
  void WorkerDestroyed(const std::shared_ptr<AsyncConnectionState> &state,
                       bool was_close_worker) noexcept;
  void RequestClose(const std::shared_ptr<AsyncConnectionState> &state);

private:
  static void CleanupHook(napi_async_cleanup_hook_handle handle,
                          void *data) noexcept;

  void BeginCleanup(napi_async_cleanup_hook_handle handle) noexcept;
  void
  QueueCloseIfIdle(const std::shared_ptr<AsyncConnectionState> &state) noexcept;
  void RemoveClosedStates() noexcept;
  void TryFinishCleanup() noexcept;
  void FinishCleanup() noexcept;

  napi_env env_;
  AddonData *addon_data_;
  napi_async_cleanup_hook_handle cleanup_hook_ = nullptr;
  bool shutting_down_ = false;
  bool hook_started_ = false;
  bool hook_finished_ = false;
  std::vector<std::shared_ptr<AsyncConnectionState>> states_;
  std::unordered_map<AsyncConnectionState *, PoolWorker *> active_workers_;
};

namespace {

class PoolWorker {
public:
  PoolWorker(Napi::Env env, const char *resource_name,
             AsyncPoolEnvironment *environment,
             std::shared_ptr<AsyncConnectionState> state,
             std::optional<Napi::Promise::Deferred> deferred,
             bool close_worker = false)
      : env_(env), environment_(environment), state_(std::move(state)),
        close_worker_(close_worker) {
    if (deferred.has_value()) {
      deferreds_.push_back(*deferred);
    }
    napi_value resource = nullptr;
    napi_value name = nullptr;
    napi_status status = napi_create_object(env_, &resource);
    if (status == napi_ok) {
      status = napi_create_string_latin1(env_, resource_name, NAPI_AUTO_LENGTH,
                                         &name);
    }
    if (status == napi_ok) {
      status = napi_create_async_work(env_, resource, name, ExecuteThunk,
                                      CompleteThunk, this, &work_);
    }
    if (status != napi_ok) {
      throw Napi::Error::New(env, "Failed to create async SQLite work");
    }
  }

  virtual ~PoolWorker() {
    if (work_ != nullptr) {
      (void)napi_delete_async_work(env_, work_);
      work_ = nullptr;
    }
  }

  PoolWorker(const PoolWorker &) = delete;
  PoolWorker &operator=(const PoolWorker &) = delete;
  PoolWorker(PoolWorker &&) = delete;
  PoolWorker &operator=(PoolWorker &&) = delete;

  bool Queue() noexcept {
    return napi_queue_async_work(env_, work_) == napi_ok;
  }

  virtual bool
  AttachCloseDeferred(const Napi::Promise::Deferred & /*deferred*/) {
    return false;
  }

protected:
  virtual void Execute() = 0;
  virtual void OnOK() = 0;

  Napi::Env Env() const { return Napi::Env(env_); }

  void Resolve(Napi::Value value) {
    for (const Napi::Promise::Deferred &deferred : deferreds_) {
      deferred.Resolve(value);
    }
  }

  void Reject(Napi::Value value) {
    for (const Napi::Promise::Deferred &deferred : deferreds_) {
      deferred.Reject(value);
    }
  }

  bool has_deferred() const noexcept { return !deferreds_.empty(); }
  void AddDeferred(const Napi::Promise::Deferred &deferred) {
    deferreds_.push_back(deferred);
  }
  const std::shared_ptr<AsyncConnectionState> &state() const noexcept {
    return state_;
  }
  AsyncPoolEnvironment *environment() const noexcept { return environment_; }

private:
  static void ExecuteThunk(napi_env /*env*/, void *data) noexcept {
    auto *worker = static_cast<PoolWorker *>(data);
    try {
      worker->Execute();
    } catch (...) {
      // Native allocation and conversion can throw. Once execution has begun,
      // conservatively discard the connection rather than return a possibly
      // transactional or partially configured handle to the scheduler.
      worker->unexpected_error_ = true;
      worker->state_->close_requested.store(true, std::memory_order_release);
      (void)worker->state_->Close();
    }
  }

  static void CompleteThunk(napi_env env, napi_status status,
                            void *data) noexcept {
    auto *worker = static_cast<PoolWorker *>(data);
    if (!worker->environment_->shutting_down() && status != napi_cancelled) {
      try {
        Napi::HandleScope scope(env);
        if (worker->unexpected_error_) {
          Napi::Error error = Napi::Error::New(
              env, "Unexpected native error during async SQLite work");
          error.Set("fatal", Napi::Boolean::New(env, true));
          worker->Reject(error.Value());
        } else {
          worker->OnOK();
        }
      } catch (const Napi::Error &error) {
        try {
          worker->Reject(error.Value());
        } catch (...) {
        }
      } catch (...) {
        try {
          worker->Reject(
              Napi::Error::New(env, "Native async SQLite completion failed")
                  .Value());
        } catch (...) {
        }
      }
    }
    worker->DestroyAndNotify();
  }

  void DestroyAndNotify() noexcept {
    AsyncPoolEnvironment *environment = environment_;
    std::shared_ptr<AsyncConnectionState> state = state_;
    const bool close_worker = close_worker_;
    if (work_ != nullptr) {
      (void)napi_delete_async_work(env_, work_);
      work_ = nullptr;
    }
    delete this;
    environment->WorkerDestroyed(state, close_worker);
  }

  napi_env env_;
  napi_async_work work_ = nullptr;
  AsyncPoolEnvironment *environment_;
  std::shared_ptr<AsyncConnectionState> state_;
  std::vector<Napi::Promise::Deferred> deferreds_;
  bool close_worker_;
  bool unexpected_error_ = false;
};

Napi::Error CreateNativeError(Napi::Env env, const NativeError &native) {
  Napi::Error error =
      native.range ? Napi::Error(Napi::RangeError::New(env, native.message))
                   : Napi::Error::New(env, native.message);
  if (native.range) {
    error.Set("code", Napi::String::New(env, "ERR_OUT_OF_RANGE"));
  }
  if (native.sqlite) {
    error.Set("code", Napi::String::New(env, "ERR_SQLITE_ERROR"));
    error.Set("errcode", Napi::Number::New(env, native.sqlite_code));
    error.Set("errstr", Napi::String::New(env, native.sqlite_error_string));
    error.Set("sqliteCode", Napi::Number::New(env, native.sqlite_code));
    error.Set("sqliteExtendedCode",
              Napi::Number::New(env, native.sqlite_extended_code));
    error.Set("sqliteCodeName",
              Napi::String::New(
                  env, node::GetSqliteErrorCodeName(native.sqlite_code)));
    error.Set("sqliteErrorString",
              Napi::String::New(env, native.sqlite_error_string));
  }
  if (native.fatal) {
    error.Set("fatal", Napi::Boolean::New(env, true));
  }
  return error;
}

bool ToJsValue(Napi::Env env, const NativeValue &native, bool read_big_ints,
               napi_value *out, NativeError *error) {
  if (std::holds_alternative<std::nullptr_t>(native.data)) {
    *out = env.Null();
    return true;
  }
  if (const auto *integer = std::get_if<int64_t>(&native.data)) {
    if (read_big_ints) {
      *out = Napi::BigInt::New(env, *integer);
      return true;
    }
    if (*integer > kJsMaxSafeInteger || *integer < kJsMinSafeInteger) {
      SetRangeError(error, *integer);
      return false;
    }
    *out = Napi::Number::New(env, static_cast<double>(*integer));
    return true;
  }
  if (const auto *number = std::get_if<double>(&native.data)) {
    *out = Napi::Number::New(env, *number);
    return true;
  }
  if (const auto *text = std::get_if<std::string>(&native.data)) {
    *out = Napi::String::New(env, text->data(), text->size());
    return true;
  }
  const auto *blob = std::get_if<Blob>(&native.data);
  if (blob == nullptr) {
    SetPlainError(error, "Cannot convert SQLite value");
    return false;
  }
  Napi::ArrayBuffer array_buffer = Napi::ArrayBuffer::New(env, blob->size());
  if (!blob->empty()) {
    std::memcpy(array_buffer.Data(), blob->data(), blob->size());
  }
  *out = Napi::Uint8Array::New(env, blob->size(), array_buffer, 0);
  return true;
}

bool ToJsRow(Napi::Env env, const NativeRow &row,
             const AsyncConnectionState &state, napi_value *out,
             NativeError *error) {
  if (state.return_arrays()) {
    Napi::Array array = Napi::Array::New(env, row.size());
    for (size_t index = 0; index < row.size(); ++index) {
      napi_value value;
      if (!ToJsValue(env, row[index].value, state.read_big_ints(), &value,
                     error)) {
        return false;
      }
      array.Set(static_cast<uint32_t>(index), value);
    }
    *out = array;
    return true;
  }

  Napi::Object object = CreateObjectWithNullPrototype(env);
  for (const NativeColumn &column : row) {
    napi_value value;
    if (!ToJsValue(env, column.value, state.read_big_ints(), &value, error)) {
      return false;
    }
    object.Set(column.name, value);
  }
  *out = object;
  return true;
}

bool ToJsResults(Napi::Env env, const NativeResponse &response,
                 const AsyncConnectionState &state, Napi::Array *out,
                 NativeError *error) {
  *out = Napi::Array::New(env, response.results.size());
  for (size_t index = 0; index < response.results.size(); ++index) {
    const NativeOperationResult &native = response.results[index];
    napi_value result;
    if (native.kind == OperationKind::kRun) {
      Napi::Object run = Napi::Object::New(env);
      if (state.read_big_ints()) {
        run.Set("changes", Napi::BigInt::New(env, native.changes));
      } else {
        run.Set("changes",
                Napi::Number::New(env, static_cast<double>(native.changes)));
      }
      result = run;
    } else if (native.kind == OperationKind::kGet) {
      if (native.rows.empty()) {
        result = env.Undefined();
      } else if (!ToJsRow(env, native.rows.front(), state, &result, error)) {
        return false;
      }
    } else {
      Napi::Array rows = Napi::Array::New(env, native.rows.size());
      for (size_t row_index = 0; row_index < native.rows.size(); ++row_index) {
        napi_value row;
        if (!ToJsRow(env, native.rows[row_index], state, &row, error)) {
          return false;
        }
        rows.Set(static_cast<uint32_t>(row_index), row);
      }
      result = rows;
    }
    out->Set(static_cast<uint32_t>(index), result);
  }
  return true;
}

class AsyncPoolConnection : public Napi::ObjectWrap<AsyncPoolConnection> {
public:
  static Napi::Function CreateConstructor(Napi::Env env) {
    return DefineClass(
        env, "AsyncPoolConnection",
        {InstanceMethod("execute", &AsyncPoolConnection::Execute),
         InstanceMethod("close", &AsyncPoolConnection::Close)});
  }

  static Napi::Object
  NewInstance(const std::shared_ptr<AsyncConnectionState> &state,
              AddonData *addon_data) {
    Napi::Object object = addon_data->asyncPoolConnectionConstructor.New(
        {addon_data->asyncPoolConnectionToken.Value()});
    AsyncPoolConnection *connection = Unwrap(object);
    connection->state_ = state;
    return object;
  }

  explicit AsyncPoolConnection(const Napi::CallbackInfo &info)
      : Napi::ObjectWrap<AsyncPoolConnection>(info) {
    AddonData *addon_data = GetAddonData(info.Env());
    if (info.Length() != 1 || addon_data == nullptr ||
        addon_data->asyncPoolConnectionToken.IsEmpty() ||
        !info[0].StrictEquals(addon_data->asyncPoolConnectionToken.Value())) {
      throw Napi::Error::New(info.Env(), "Illegal constructor");
    }
  }

  ~AsyncPoolConnection() override {
    if (state_ != nullptr && state_->IsOpen()) {
      AsyncPoolEnvironment *environment = state_->environment();
      if (environment != nullptr) {
        environment->RequestClose(state_);
      }
    }
  }

  AsyncPoolConnection(const AsyncPoolConnection &) = delete;
  AsyncPoolConnection &operator=(const AsyncPoolConnection &) = delete;
  AsyncPoolConnection(AsyncPoolConnection &&) = delete;
  AsyncPoolConnection &operator=(AsyncPoolConnection &&) = delete;

private:
  Napi::Value Execute(const Napi::CallbackInfo &info);
  Napi::Value Close(const Napi::CallbackInfo &info);

  std::shared_ptr<AsyncConnectionState> state_;
};

class OpenWorker final : public PoolWorker {
public:
  OpenWorker(Napi::Env env, AsyncPoolEnvironment *environment,
             std::shared_ptr<AsyncConnectionState> state,
             OpenConfiguration configuration, Napi::Promise::Deferred deferred)
      : PoolWorker(env, "photostructure.sqlite.pool.open", environment,
                   std::move(state), deferred),
        configuration_(std::move(configuration)) {}

  void Execute() override {
    sqlite3 *db = nullptr;
    int rc = sqlite3_open_v2(configuration_.location.c_str(), &db,
                             SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE |
                                 SQLITE_OPEN_URI | SQLITE_OPEN_FULLMUTEX,
                             nullptr);
    if (db != nullptr) {
      state()->Publish(db);
      sqlite3_extended_result_codes(db, 1);
    }
    if (rc != SQLITE_OK) {
      SetSqliteError(db, rc, &response_.error);
      state()->close_requested.store(true, std::memory_order_release);
      (void)state()->Close();
      return;
    }
    bool extension_enabled = false;
    if (configuration_.allow_extension) {
      rc = sqlite3_enable_load_extension(db, 1);
      if (rc != SQLITE_OK) {
        SetSqliteError(db, rc, &response_.error,
                       "Failed to enable extension loading");
      } else {
        extension_enabled = true;
      }
    }

    if (!response_.error.present &&
        !RunSetup(db, state().get(), configuration_.setup, &response_.error)) {
      // Error is already captured.
    }

    if (extension_enabled) {
      rc = sqlite3_enable_load_extension(db, 0);
      if (rc != SQLITE_OK && !response_.error.present) {
        SetSqliteError(db, rc, &response_.error,
                       "Failed to disable extension loading");
      }
    }

    if (!response_.error.present && sqlite3_get_autocommit(db) == 0) {
      SetPlainError(&response_.error,
                    "Connection setup left a transaction open; autocommit is "
                    "required");
    }

    if (!response_.error.present && configuration_.strict_authorizer) {
      rc = sqlite3_set_authorizer(db, StrictAuthorizer, state().get());
      if (rc != SQLITE_OK) {
        SetSqliteError(db, rc, &response_.error,
                       "Failed to install strict authorizer");
      } else {
        state()->set_strict_authorizer_installed(true);
      }
    }

    if (response_.error.present) {
      state()->close_requested.store(true, std::memory_order_release);
      (void)state()->Close();
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    if (response_.error.present) {
      Reject(CreateNativeError(env, response_.error).Value());
      return;
    }
    try {
      Napi::Object connection = AsyncPoolConnection::NewInstance(
          state(), environment()->addon_data());
      Resolve(connection);
    } catch (...) {
      // A completed open has published a live sqlite3 handle. If allocating its
      // JavaScript wrapper fails, close it after this worker is destroyed
      // instead of retaining an unreachable connection until environment exit.
      state()->close_requested.store(true, std::memory_order_release);
      throw;
    }
  }

private:
  OpenConfiguration configuration_;
  NativeResponse response_;
};

class RequestWorker final : public PoolWorker {
public:
  RequestWorker(Napi::Env env, AsyncPoolEnvironment *environment,
                std::shared_ptr<AsyncConnectionState> state,
                NativeRequest request, Napi::Promise::Deferred deferred)
      : PoolWorker(env, "photostructure.sqlite.pool.request", environment,
                   std::move(state), deferred),
        request_(std::move(request)) {}

  void Execute() override { response_ = ExecuteRequest(state(), request_); }

  void OnOK() override {
    Napi::Env env = Env();
    if (response_.error.present) {
      Reject(CreateNativeError(env, response_.error).Value());
      return;
    }
    Napi::Array results;
    NativeError conversion_error;
    if (!ToJsResults(env, response_, *state(), &results, &conversion_error)) {
      Reject(CreateNativeError(env, conversion_error).Value());
      return;
    }
    Resolve(results);
  }

private:
  NativeRequest request_;
  NativeResponse response_;
};

class CloseWorker final : public PoolWorker {
public:
  CloseWorker(Napi::Env env, AsyncPoolEnvironment *environment,
              std::shared_ptr<AsyncConnectionState> state,
              std::optional<Napi::Promise::Deferred> deferred)
      : PoolWorker(env, "photostructure.sqlite.pool.close", environment,
                   std::move(state), deferred, true) {}

  bool AttachCloseDeferred(const Napi::Promise::Deferred &deferred) override {
    AddDeferred(deferred);
    return true;
  }

  void Execute() override {
    const int rc = state()->Close();
    if (rc != SQLITE_OK) {
      SetPlainError(&error_,
                    "Failed to close SQLite connection: outstanding native "
                    "resources remain");
    }
  }

  void OnOK() override {
    if (!has_deferred()) {
      return;
    }
    if (error_.present) {
      Reject(CreateNativeError(Env(), error_).Value());
    } else {
      Resolve(Env().Undefined());
    }
  }

private:
  NativeError error_;
};

} // namespace

namespace {

class StatementHolder {
public:
  StatementHolder() = default;
  ~StatementHolder() {
    if (statement_ != nullptr) {
      sqlite3_finalize(statement_);
    }
  }
  StatementHolder(const StatementHolder &) = delete;
  StatementHolder &operator=(const StatementHolder &) = delete;
  StatementHolder(StatementHolder &&) = delete;
  StatementHolder &operator=(StatementHolder &&) = delete;

  sqlite3_stmt **Out() { return &statement_; }
  sqlite3_stmt *get() const { return statement_; }

  int Finalize() noexcept {
    if (statement_ == nullptr) {
      return SQLITE_OK;
    }
    sqlite3_stmt *statement = statement_;
    statement_ = nullptr;
    return sqlite3_finalize(statement);
  }

private:
  sqlite3_stmt *statement_ = nullptr;
};

class ValidationAuthorizerGuard {
public:
  ValidationAuthorizerGuard(sqlite3 *db, AsyncConnectionState *state,
                            NativeError *error)
      : db_(db), state_(state) {
    const int rc = sqlite3_set_authorizer(db_, ValidationAuthorizer, nullptr);
    if (rc == SQLITE_OK) {
      installed_ = true;
    } else {
      SetSqliteError(db_, rc, error,
                     "Failed to install SQL validation authorizer");
    }
  }

  ~ValidationAuthorizerGuard() {
    if (installed_) {
      (void)Restore();
    }
  }

  ValidationAuthorizerGuard(const ValidationAuthorizerGuard &) = delete;
  ValidationAuthorizerGuard &
  operator=(const ValidationAuthorizerGuard &) = delete;
  ValidationAuthorizerGuard(ValidationAuthorizerGuard &&) = delete;
  ValidationAuthorizerGuard &operator=(ValidationAuthorizerGuard &&) = delete;

  bool installed() const noexcept { return installed_; }

  int Restore() noexcept {
    if (!installed_) {
      return SQLITE_OK;
    }
    installed_ = false;
    return state_->strict_authorizer_installed()
               ? sqlite3_set_authorizer(db_, StrictAuthorizer, state_)
               : sqlite3_set_authorizer(db_, nullptr, nullptr);
  }

private:
  sqlite3 *db_;
  AsyncConnectionState *state_;
  bool installed_ = false;
};

bool PrepareExactlyOne(sqlite3 *db, AsyncConnectionState *state,
                       const std::string &sql, StatementHolder *first,
                       NativeError *error) {
  if (sql.find('\0') != std::string::npos) {
    SetPlainError(error, "SQL must not contain null bytes");
    return false;
  }
  const char *cursor = sql.c_str();
  bool found = false;
  ValidationAuthorizerGuard validation_authorizer(db, state, error);
  if (!validation_authorizer.installed()) {
    return false;
  }

  while (cursor != nullptr && *cursor != '\0') {
    const char *tail = nullptr;
    StatementHolder candidate;
    const int rc = sqlite3_prepare_v2(db, cursor, -1, candidate.Out(), &tail);
    if (rc != SQLITE_OK) {
      SetSqliteError(db, rc, error);
      return false;
    }
    if (candidate.get() != nullptr) {
      if (found) {
        SetPlainError(error,
                      "Operation contains multiple statements; exactly one "
                      "SQL statement is required");
        return false;
      }
      // StatementHolder is deliberately non-movable. Transfer the raw pointer
      // through finalize-safe ownership by preparing the first statement once
      // more after the tail has been validated below.
      found = true;
    }
    if (tail == nullptr || tail <= cursor) {
      break;
    }
    cursor = tail;
  }

  if (!found) {
    SetPlainError(error,
                  "Each operation must contain exactly one SQL statement");
    return false;
  }

  const int restore_rc = validation_authorizer.Restore();
  if (restore_rc != SQLITE_OK) {
    SetSqliteError(db, restore_rc, error,
                   "Failed to restore SQLite authorizer after SQL validation");
    error->fatal = true;
    state->close_requested.store(true, std::memory_order_release);
    return false;
  }

  const char *tail = nullptr;
  const int rc = sqlite3_prepare_v2(db, sql.c_str(), -1, first->Out(), &tail);
  if (rc != SQLITE_OK) {
    SetSqliteError(db, rc, error);
    return false;
  }
  // The first prepare can yield no statement when SQL begins with comments.
  // Walk to the first executable statement while retaining only that one.
  cursor = tail;
  while (first->get() == nullptr && cursor != nullptr && *cursor != '\0') {
    const char *next = nullptr;
    const int next_rc = sqlite3_prepare_v2(db, cursor, -1, first->Out(), &next);
    if (next_rc != SQLITE_OK) {
      SetSqliteError(db, next_rc, error);
      return false;
    }
    if (next == nullptr || next <= cursor) {
      break;
    }
    cursor = next;
  }
  if (first->get() == nullptr) {
    SetPlainError(error,
                  "Each operation must contain exactly one SQL statement");
    return false;
  }
  return true;
}

int BindValue(sqlite3_stmt *statement, int index, const NativeValue &value) {
  if (std::holds_alternative<std::nullptr_t>(value.data)) {
    return sqlite3_bind_null(statement, index);
  }
  if (const auto *integer = std::get_if<int64_t>(&value.data)) {
    return sqlite3_bind_int64(statement, index,
                              static_cast<sqlite3_int64>(*integer));
  }
  if (const auto *number = std::get_if<double>(&value.data)) {
    return sqlite3_bind_double(statement, index, *number);
  }
  if (const auto *text = std::get_if<std::string>(&value.data)) {
    return sqlite3_bind_text64(statement, index, text->data(), text->size(),
                               SQLITE_TRANSIENT, SQLITE_UTF8);
  }
  const auto *blob = std::get_if<Blob>(&value.data);
  if (blob == nullptr) {
    return SQLITE_MISUSE;
  }
  const void *data = blob->empty() ? static_cast<const void *>("")
                                   : static_cast<const void *>(blob->data());
  return sqlite3_bind_blob64(statement, index, data, blob->size(),
                             SQLITE_TRANSIENT);
}

bool BindParameters(sqlite3 *db, sqlite3_stmt *statement,
                    const std::optional<NativeParams> &params,
                    NativeError *error) {
  if (!params.has_value()) {
    return true;
  }

  if (!params->named) {
    int index = 1;
    for (const auto &[unused, value] : params->values) {
      (void)unused;
      while (true) {
        const char *name = sqlite3_bind_parameter_name(statement, index);
        if (name == nullptr || name[0] == '?') {
          break;
        }
        ++index;
      }
      const int rc = BindValue(statement, index++, value);
      if (rc != SQLITE_OK) {
        SetSqliteError(db, rc, error);
        return false;
      }
    }
    return true;
  }

  std::unordered_map<std::string, std::string> bare_names;
  const int parameter_count = sqlite3_bind_parameter_count(statement);
  for (int index = 1; index <= parameter_count; ++index) {
    const char *name = sqlite3_bind_parameter_name(statement, index);
    if (name == nullptr || (*name != ':' && *name != '$' && *name != '@')) {
      continue;
    }
    const std::string bare(name + 1);
    const auto [entry, inserted] = bare_names.emplace(bare, name);
    if (!inserted && entry->second != name) {
      SetPlainError(error, "Cannot bind bare named parameter '" + bare +
                               "' because of conflicting names '" +
                               entry->second + "' and '" + name + "'");
      return false;
    }
  }

  for (const auto &[key, value] : params->values) {
    int index = sqlite3_bind_parameter_index(statement, key.c_str());
    if (index == 0) {
      const auto found = bare_names.find(key);
      if (found != bare_names.end()) {
        index = sqlite3_bind_parameter_index(statement, found->second.c_str());
      }
    }
    if (index == 0) {
      SetPlainError(error, "Unknown named parameter '" + key + "'");
      return false;
    }
    const int rc = BindValue(statement, index, value);
    if (rc != SQLITE_OK) {
      SetSqliteError(db, rc, error);
      return false;
    }
  }
  return true;
}

bool ReadRow(sqlite3 *db, sqlite3_stmt *statement,
             const AsyncConnectionState *state, NativeRow *row,
             NativeError *error) {
  const int count = sqlite3_column_count(statement);
  row->reserve(static_cast<size_t>(count));
  for (int index = 0; index < count; ++index) {
    const char *column_name = sqlite3_column_name(statement, index);
    if (column_name == nullptr) {
      SetSqliteError(db, SQLITE_NOMEM, error, "Cannot read column name");
      return false;
    }

    NativeColumn column;
    column.name = column_name;
    switch (sqlite3_column_type(statement, index)) {
    case SQLITE_NULL:
      column.value.data = nullptr;
      break;
    case SQLITE_INTEGER: {
      const int64_t value =
          static_cast<int64_t>(sqlite3_column_int64(statement, index));
      column.value.data = value;
      if (!state->read_big_ints()) {
        if (value > kJsMaxSafeInteger || value < kJsMinSafeInteger) {
          SetRangeError(error, value);
          return false;
        }
      }
      break;
    }
    case SQLITE_FLOAT:
      column.value.data = sqlite3_column_double(statement, index);
      break;
    case SQLITE_TEXT: {
      const unsigned char *text = sqlite3_column_text(statement, index);
      const int bytes = sqlite3_column_bytes(statement, index);
      if (text == nullptr && bytes != 0) {
        SetSqliteError(db, SQLITE_NOMEM, error, "Cannot read text column");
        return false;
      }
      column.value.data = std::string(
          text != nullptr ? reinterpret_cast<const char *>(text) : "",
          static_cast<size_t>(bytes));
      break;
    }
    case SQLITE_BLOB: {
      const void *data = sqlite3_column_blob(statement, index);
      const int bytes = sqlite3_column_bytes(statement, index);
      Blob blob(static_cast<size_t>(bytes));
      if (bytes > 0) {
        if (data == nullptr) {
          SetSqliteError(db, SQLITE_NOMEM, error, "Cannot read blob column");
          return false;
        }
        std::memcpy(blob.data(), data, static_cast<size_t>(bytes));
      }
      column.value.data = std::move(blob);
      break;
    }
    default:
      column.value.data = nullptr;
      break;
    }
    row->push_back(std::move(column));
  }
  return true;
}

bool ExecuteOperation(sqlite3 *db, AsyncConnectionState *state,
                      const NativeOperation &operation,
                      NativeOperationResult *result, NativeError *error) {
  StatementHolder statement;
  if (!PrepareExactlyOne(db, state, operation.sql, &statement, error) ||
      !BindParameters(db, statement.get(), operation.params, error)) {
    return false;
  }

  result->kind = operation.kind;
  const sqlite3_int64 changes_before = sqlite3_total_changes64(db);

  if (operation.kind == OperationKind::kGet) {
    const int rc = sqlite3_step(statement.get());
    if (rc == SQLITE_ROW) {
      NativeRow row;
      if (!ReadRow(db, statement.get(), state, &row, error)) {
        return false;
      }
      result->rows.push_back(std::move(row));
    } else if (rc != SQLITE_DONE) {
      SetSqliteError(db, rc, error);
      return false;
    }
  } else {
    while (true) {
      const int rc = sqlite3_step(statement.get());
      if (rc == SQLITE_ROW) {
        if (operation.kind == OperationKind::kAll) {
          NativeRow row;
          if (!ReadRow(db, statement.get(), state, &row, error)) {
            return false;
          }
          result->rows.push_back(std::move(row));
        }
        continue;
      }
      if (rc == SQLITE_DONE) {
        break;
      }
      SetSqliteError(db, rc, error);
      return false;
    }
  }

  const int finalize_rc = statement.Finalize();
  if (finalize_rc != SQLITE_OK) {
    SetSqliteError(db, finalize_rc, error);
    return false;
  }

  if (operation.kind == OperationKind::kRun &&
      sqlite3_total_changes64(db) != changes_before) {
    result->changes = static_cast<int64_t>(sqlite3_changes64(db));
  }
  return true;
}

bool ExecuteControl(sqlite3 *db, AsyncConnectionState *state, const char *sql,
                    NativeError *error) {
  TrustedTransactionGuard trusted(state);
  StatementHolder statement;
  if (!PrepareExactlyOne(db, state, sql, &statement, error)) {
    return false;
  }
  int rc = sqlite3_step(statement.get());
  if (rc != SQLITE_DONE) {
    SetSqliteError(db, rc, error);
    return false;
  }
  rc = statement.Finalize();
  if (rc != SQLITE_OK) {
    SetSqliteError(db, rc, error);
    return false;
  }
  return true;
}

bool RollbackAndVerify(sqlite3 *db, AsyncConnectionState *state) {
  if (sqlite3_get_autocommit(db) != 0) {
    return true;
  }
  NativeError ignored;
  if (!ExecuteControl(db, state, "ROLLBACK", &ignored)) {
    return false;
  }
  return sqlite3_get_autocommit(db) != 0;
}

const char *BeginSql(TransactionMode mode) {
  switch (mode) {
  case TransactionMode::kDeferred:
    return "BEGIN DEFERRED";
  case TransactionMode::kImmediate:
    return "BEGIN IMMEDIATE";
  case TransactionMode::kExclusive:
    return "BEGIN EXCLUSIVE";
  case TransactionMode::kNone:
    return nullptr;
  }
  return nullptr;
}

NativeResponse
ExecuteRequest(const std::shared_ptr<AsyncConnectionState> &state,
               const NativeRequest &request) {
  NativeResponse response;
  sqlite3 *db = state->HandleForWorker();
  if (db == nullptr) {
    SetPlainError(&response.error, "Database connection is closed");
    return response;
  }

  const char *begin = BeginSql(request.transaction);
  if (begin != nullptr &&
      !ExecuteControl(db, state.get(), begin, &response.error)) {
    return response;
  }

  response.results.reserve(request.operations.size());
  for (const NativeOperation &operation : request.operations) {
    NativeOperationResult result;
    if (!ExecuteOperation(db, state.get(), operation, &result,
                          &response.error)) {
      break;
    }
    response.results.push_back(std::move(result));
  }

  if (response.error.present) {
    if (sqlite3_get_autocommit(db) == 0 &&
        !RollbackAndVerify(db, state.get())) {
      state->close_requested.store(true, std::memory_order_release);
      response.error.fatal = true;
    }
    return response;
  }

  if (begin != nullptr) {
    if (!ExecuteControl(db, state.get(), "COMMIT", &response.error)) {
      if (!RollbackAndVerify(db, state.get())) {
        state->close_requested.store(true, std::memory_order_release);
        response.error.fatal = true;
      }
      return response;
    }
  }

  if (sqlite3_get_autocommit(db) == 0) {
    const bool clean = RollbackAndVerify(db, state.get());
    SetPlainError(&response.error,
                  "Operation left the connection in a transaction; it was "
                  "rolled back to restore autocommit");
    if (!clean) {
      state->close_requested.store(true, std::memory_order_release);
      response.error.fatal = true;
    }
  }
  return response;
}

bool RunSetup(sqlite3 *db, AsyncConnectionState *state,
              const std::vector<NativeOperation> &setup, NativeError *error) {
  for (const NativeOperation &operation : setup) {
    NativeOperationResult ignored;
    if (!ExecuteOperation(db, state, operation, &ignored, error)) {
      return false;
    }
    if (sqlite3_get_autocommit(db) == 0) {
      SetPlainError(error,
                    "Connection setup left a transaction open; autocommit is "
                    "required");
      return false;
    }
  }
  return true;
}

} // namespace

AsyncPoolEnvironment::~AsyncPoolEnvironment() {
  for (const auto &state : states_) {
    state->set_environment(nullptr);
  }
  if (cleanup_hook_ != nullptr && !hook_started_) {
    napi_async_cleanup_hook_handle handle = cleanup_hook_;
    cleanup_hook_ = nullptr;
    napi_remove_async_cleanup_hook(handle);
  }
}

bool AsyncPoolEnvironment::Initialize() {
  const napi_status status =
      napi_add_async_cleanup_hook(env_, CleanupHook, this, &cleanup_hook_);
  return status == napi_ok;
}

void AsyncPoolEnvironment::AddState(
    const std::shared_ptr<AsyncConnectionState> &state) {
  state->set_environment(this);
  states_.push_back(state);
}

bool AsyncPoolEnvironment::QueueWorker(
    PoolWorker *worker, const std::shared_ptr<AsyncConnectionState> &state) {
  const auto [entry, inserted] = active_workers_.emplace(state.get(), worker);
  if (!inserted) {
    delete worker;
    return false;
  }
  try {
    if (worker->Queue()) {
      return true;
    }
    active_workers_.erase(entry);
    delete worker;
    return false;
  } catch (...) {
    active_workers_.erase(entry);
    delete worker;
    return false;
  }
}

bool AsyncPoolEnvironment::AttachCloseDeferred(
    const std::shared_ptr<AsyncConnectionState> &state,
    const Napi::Promise::Deferred &deferred) {
  const auto found = active_workers_.find(state.get());
  return found != active_workers_.end() &&
         found->second->AttachCloseDeferred(deferred);
}

void AsyncPoolEnvironment::WorkerDestroyed(
    const std::shared_ptr<AsyncConnectionState> &state,
    bool was_close_worker) noexcept {
  active_workers_.erase(state.get());

  if (!was_close_worker && (shutting_down_ || state->close_requested.load(
                                                  std::memory_order_acquire))) {
    QueueCloseIfIdle(state);
  }
  RemoveClosedStates();
  TryFinishCleanup();
}

void AsyncPoolEnvironment::RequestClose(
    const std::shared_ptr<AsyncConnectionState> &state) {
  state->close_requested.store(true, std::memory_order_release);
  QueueCloseIfIdle(state);
  RemoveClosedStates();
}

void AsyncPoolEnvironment::QueueCloseIfIdle(
    const std::shared_ptr<AsyncConnectionState> &state) noexcept {
  if (!state->IsOpen() || active_workers_.count(state.get()) != 0) {
    return;
  }
  if (shutting_down_) {
    // Cleanup hooks run without a V8 HandleScope and JavaScript execution is
    // disallowed. Do not construct new napi_async_work here. With no active
    // worker, Close() either closes immediately or transfers a handle with
    // extension-owned resources to SQLite's close_v2 zombie lifecycle.
    (void)state->Close();
    return;
  }
  try {
    auto *worker = new CloseWorker(Napi::Env(env_), this, state, std::nullopt);
    (void)QueueWorker(worker, state);
  } catch (...) {
    // Keep the state registered and the async cleanup hook alive. Silently
    // dropping or zombie-closing the handle would hide a teardown failure.
  }
}

void AsyncPoolEnvironment::RemoveClosedStates() noexcept {
  states_.erase(std::remove_if(states_.begin(), states_.end(),
                               [this](const auto &state) {
                                 if (active_workers_.count(state.get()) != 0 ||
                                     state->IsOpen()) {
                                   return false;
                                 }
                                 state->set_environment(nullptr);
                                 return true;
                               }),
                states_.end());
}

void AsyncPoolEnvironment::CleanupHook(napi_async_cleanup_hook_handle handle,
                                       void *data) noexcept {
  static_cast<AsyncPoolEnvironment *>(data)->BeginCleanup(handle);
}

void AsyncPoolEnvironment::BeginCleanup(
    napi_async_cleanup_hook_handle handle) noexcept {
  hook_started_ = true;
  shutting_down_ = true;
  cleanup_hook_ = handle;

  for (const auto &state : states_) {
    state->close_requested.store(true, std::memory_order_release);
  }

  // Node drains every queued napi_async_work completion before invoking
  // environment cleanup hooks. TryFinishCleanup retains the hook and all state
  // if that ordering invariant changes.
  TryFinishCleanup();
}

void AsyncPoolEnvironment::TryFinishCleanup() noexcept {
  if (!hook_started_ || hook_finished_) {
    return;
  }
  if (!active_workers_.empty()) {
    return;
  }

  for (const auto &state : states_) {
    (void)state->Close();
  }
  RemoveClosedStates();
  if (states_.empty()) {
    FinishCleanup();
  }
}

void AsyncPoolEnvironment::FinishCleanup() noexcept {
  if (hook_finished_ || cleanup_hook_ == nullptr) {
    return;
  }
  hook_finished_ = true;
  napi_async_cleanup_hook_handle handle = cleanup_hook_;
  cleanup_hook_ = nullptr;
  (void)napi_remove_async_cleanup_hook(handle);
}

namespace {

TransactionMode ParseTransaction(Napi::Value value, std::string *message) {
  if (value.IsUndefined()) {
    return TransactionMode::kNone;
  }
  if (!value.IsString()) {
    *message = "Transaction must be deferred, immediate, or exclusive";
    return TransactionMode::kNone;
  }
  const std::string transaction = value.As<Napi::String>().Utf8Value();
  if (transaction == "deferred") {
    return TransactionMode::kDeferred;
  }
  if (transaction == "immediate") {
    return TransactionMode::kImmediate;
  }
  if (transaction == "exclusive") {
    return TransactionMode::kExclusive;
  }
  *message = "Transaction must be deferred, immediate, or exclusive";
  return TransactionMode::kNone;
}

Napi::Value AsyncPoolConnection::Execute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (state_ == nullptr || !state_->IsOpen() ||
      state_->close_requested.load(std::memory_order_acquire)) {
    throw Napi::Error::New(env, "Database connection is closed");
  }
  AsyncPoolEnvironment *environment = state_->environment();
  if (environment == nullptr || environment->shutting_down()) {
    throw Napi::Error::New(env, "Database environment is shutting down");
  }
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "Request must be an object");
  }

  const Napi::Object object = info[0].As<Napi::Object>();
  const Napi::Value operations_value = object.Get("operations");
  if (!operations_value.IsArray()) {
    throw Napi::TypeError::New(env, "Request operations must be an array");
  }
  const Napi::Array operations = operations_value.As<Napi::Array>();
  NativeRequest request;
  request.operations.reserve(operations.Length());
  std::string message;
  for (uint32_t index = 0; index < operations.Length(); ++index) {
    NativeOperation operation;
    if (!ParseOperation(env, operations.Get(index), &operation, &message)) {
      throw Napi::TypeError::New(env, message);
    }
    request.operations.push_back(std::move(operation));
  }
  request.transaction = ParseTransaction(object.Get("transaction"), &message);
  if (!message.empty()) {
    throw Napi::TypeError::New(env, message);
  }

  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  Napi::Promise promise = deferred.Promise();
  auto *worker =
      new RequestWorker(env, environment, state_, std::move(request), deferred);
  if (!environment->QueueWorker(worker, state_)) {
    deferred.Reject(
        Napi::Error::New(env, "Database connection is busy").Value());
  }
  return promise;
}

Napi::Value AsyncPoolConnection::Close(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  Napi::Promise promise = deferred.Promise();
  if (state_ == nullptr) {
    deferred.Resolve(env.Undefined());
    return promise;
  }
  AsyncPoolEnvironment *environment = state_->environment();
  if (environment == nullptr || environment->shutting_down()) {
    deferred.Resolve(env.Undefined());
    return promise;
  }

  if (environment->AttachCloseDeferred(state_, deferred)) {
    return promise;
  }
  if (!state_->IsOpen()) {
    deferred.Resolve(env.Undefined());
    return promise;
  }

  state_->close_requested.store(true, std::memory_order_release);
  auto *worker = new CloseWorker(env, environment, state_, deferred);
  if (!environment->QueueWorker(worker, state_)) {
    deferred.Reject(
        Napi::Error::New(env, "Cannot close a busy database connection")
            .Value());
  }
  return promise;
}

bool ParseOpenConfiguration(Napi::Env env, Napi::Value location_value,
                            Napi::Value options_value,
                            OpenConfiguration *configuration) {
  const std::optional<std::string> location =
      ValidateDatabasePath(env, location_value, "location");
  if (!location.has_value()) {
    return false;
  }
  configuration->location = *location;
  if (!options_value.IsObject() || options_value.IsArray()) {
    throw Napi::TypeError::New(env, "Pool options must be an object");
  }
  const Napi::Object options = options_value.As<Napi::Object>();

  const Napi::Value read_big_ints = options.Get("readBigInts");
  const Napi::Value return_arrays = options.Get("returnArrays");
  const Napi::Value authorizer = options.Get("authorizer");
  const Napi::Value allow_extension = options.Get("allowExtension");
  const Napi::Value setup_value = options.Get("connectionSetup");
  if (!read_big_ints.IsBoolean() || !return_arrays.IsBoolean() ||
      !authorizer.IsString() || !allow_extension.IsBoolean() ||
      !setup_value.IsArray()) {
    throw Napi::TypeError::New(env, "Invalid native async pool options");
  }
  configuration->read_big_ints = read_big_ints.As<Napi::Boolean>().Value();
  configuration->return_arrays = return_arrays.As<Napi::Boolean>().Value();
  configuration->allow_extension = allow_extension.As<Napi::Boolean>().Value();
  const std::string authorizer_name = authorizer.As<Napi::String>().Utf8Value();
  if (authorizer_name == "strict") {
    configuration->strict_authorizer = true;
  } else if (authorizer_name == "none") {
    configuration->strict_authorizer = false;
  } else {
    throw Napi::TypeError::New(env, "Authorizer must be strict or none");
  }

  const Napi::Array setup = setup_value.As<Napi::Array>();
  configuration->setup.reserve(setup.Length());
  std::string message;
  for (uint32_t index = 0; index < setup.Length(); ++index) {
    NativeOperation operation;
    if (!ParseOperation(env, setup.Get(index), &operation, &message)) {
      throw Napi::TypeError::New(env, message);
    }
    operation.kind = OperationKind::kRun;
    configuration->setup.push_back(std::move(operation));
  }
  return true;
}

Napi::Value OpenAsyncPoolConnection(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  AddonData *addon_data = GetAddonData(env);
  if (addon_data == nullptr || addon_data->async_pool_environment == nullptr) {
    throw Napi::Error::New(env, "Async pool environment is unavailable");
  }
  if (info.Length() < 2) {
    throw Napi::TypeError::New(env, "Location and options are required");
  }

  OpenConfiguration configuration;
  if (!ParseOpenConfiguration(env, info[0], info[1], &configuration)) {
    return env.Undefined();
  }

  AsyncPoolEnvironment *environment = addon_data->async_pool_environment;
  if (environment->shutting_down()) {
    throw Napi::Error::New(env, "Database environment is shutting down");
  }
  auto state = std::make_shared<AsyncConnectionState>(
      configuration.read_big_ints, configuration.return_arrays,
      configuration.strict_authorizer);
  environment->AddState(state);

  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  Napi::Promise promise = deferred.Promise();
  auto *worker = new OpenWorker(env, environment, state,
                                std::move(configuration), deferred);
  if (!environment->QueueWorker(worker, state)) {
    environment->RequestClose(state);
    deferred.Reject(
        Napi::Error::New(env, "Failed to queue database open").Value());
  }
  return promise;
}

} // namespace

bool InitializeAsyncPool(Napi::Env env, Napi::Object exports,
                         AddonData *addon_data) {
  try {
    auto *environment = new AsyncPoolEnvironment(env, addon_data);
    addon_data->async_pool_environment = environment;
    if (!environment->Initialize()) {
      Napi::Error::New(env, "Failed to register async pool cleanup")
          .ThrowAsJavaScriptException();
      return false;
    }

    Napi::Function constructor = AsyncPoolConnection::CreateConstructor(env);
    addon_data->asyncPoolConnectionConstructor =
        Napi::Reference<Napi::Function>::New(constructor, 1);
    addon_data->asyncPoolConnectionToken = Napi::Reference<Napi::Value>::New(
        Napi::Symbol::New(env, "AsyncPoolConnection token"), 1);

    Napi::Function open = Napi::Function::New(env, OpenAsyncPoolConnection,
                                              "_openAsyncPoolConnection");
    exports.DefineProperty(Napi::PropertyDescriptor::Value(
        "_openAsyncPoolConnection", open, napi_default));
    return true;
  } catch (const Napi::Error &error) {
    error.ThrowAsJavaScriptException();
    return false;
  } catch (const std::exception &error) {
    Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
    return false;
  }
}

void DestroyAsyncPoolEnvironment(AddonData *addon_data) noexcept {
  if (addon_data == nullptr || addon_data->async_pool_environment == nullptr) {
    return;
  }
  AsyncPoolEnvironment *environment = addon_data->async_pool_environment;
  addon_data->async_pool_environment = nullptr;
  delete environment;
}

} // namespace photostructure::sqlite
