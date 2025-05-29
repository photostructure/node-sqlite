#ifndef SRC_SQLITE_IMPL_H_
#define SRC_SQLITE_IMPL_H_

#include <napi.h>
#include <sqlite3.h>
#include <string>
#include <memory>
#include <map>
#include <optional>

// Include our shims
#include "shims/base_object.h"
#include "shims/util.h"
#include "shims/node_errors.h"
#include "shims/napi_extensions.h"

namespace photostructure {
namespace sqlite {

// Forward declarations
class StatementSync;
class StatementSyncIterator;

// Database configuration
class DatabaseOpenConfiguration {
 public:
  explicit DatabaseOpenConfiguration(std::string&& location)
      : location_(std::move(location)) {}

  const std::string& location() const { return location_; }
  
  bool get_read_only() const { return read_only_; }
  void set_read_only(bool flag) { read_only_ = flag; }
  
  bool get_enable_foreign_keys() const { return enable_foreign_keys_; }
  void set_enable_foreign_keys(bool flag) { enable_foreign_keys_ = flag; }
  
  bool get_enable_dqs() const { return enable_dqs_; }
  void set_enable_dqs(bool flag) { enable_dqs_ = flag; }
  
  void set_timeout(int timeout) { timeout_ = timeout; }
  int get_timeout() const { return timeout_; }

 private:
  std::string location_;
  bool read_only_ = false;
  bool enable_foreign_keys_ = true;
  bool enable_dqs_ = false;
  int timeout_ = 0;
};

// Main database class
class DatabaseSync : public Napi::ObjectWrap<DatabaseSync> {
 public:
  static constexpr int kInternalFieldCount = 1;
  
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  
  explicit DatabaseSync(const Napi::CallbackInfo& info);
  virtual ~DatabaseSync();
  
  // Database operations
  Napi::Value Open(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value Prepare(const Napi::CallbackInfo& info);
  Napi::Value Exec(const Napi::CallbackInfo& info);
  
  // Properties
  Napi::Value LocationGetter(const Napi::CallbackInfo& info);
  Napi::Value IsOpenGetter(const Napi::CallbackInfo& info);
  Napi::Value IsTransactionGetter(const Napi::CallbackInfo& info);
  
  // SQLite handle access
  sqlite3* connection() const { return connection_; }
  bool IsOpen() const { return connection_ != nullptr; }
  
  // User-defined functions
  Napi::Value CustomFunction(const Napi::CallbackInfo& info);
  
  // Aggregate functions
  Napi::Value AggregateFunction(const Napi::CallbackInfo& info);
  
 private:
  static Napi::FunctionReference constructor_;
  
  void InternalOpen(DatabaseOpenConfiguration config);
  void InternalClose();
  
  sqlite3* connection_ = nullptr;
  std::string location_;
  bool read_only_ = false;
  std::map<std::string, std::unique_ptr<StatementSync>> prepared_statements_;
};

// Statement class  
class StatementSync : public Napi::ObjectWrap<StatementSync> {
 public:
  static constexpr int kInternalFieldCount = 1;
  static Napi::FunctionReference constructor_;
  
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  
  explicit StatementSync(const Napi::CallbackInfo& info);
  virtual ~StatementSync();
  
  // Internal constructor for DatabaseSync to use
  void InitStatement(DatabaseSync* database, const std::string& sql);
  
  // Statement operations
  Napi::Value Run(const Napi::CallbackInfo& info);
  Napi::Value Get(const Napi::CallbackInfo& info);
  Napi::Value All(const Napi::CallbackInfo& info);
  Napi::Value Iterate(const Napi::CallbackInfo& info);
  Napi::Value FinalizeStatement(const Napi::CallbackInfo& info);
  
  // Properties
  Napi::Value SourceSQLGetter(const Napi::CallbackInfo& info);
  Napi::Value ExpandedSQLGetter(const Napi::CallbackInfo& info);
  
  // Configuration methods
  Napi::Value SetReadBigInts(const Napi::CallbackInfo& info);
  Napi::Value SetReturnArrays(const Napi::CallbackInfo& info);
  Napi::Value SetAllowBareNamedParameters(const Napi::CallbackInfo& info);
  
  // Metadata methods
  Napi::Value Columns(const Napi::CallbackInfo& info);
  
 private:
  
  void BindParameters(const Napi::CallbackInfo& info, size_t start_index = 0);
  void BindSingleParameter(int param_index, Napi::Value param);
  Napi::Value CreateResult();
  void Reset();
  
  DatabaseSync* database_;
  sqlite3_stmt* statement_ = nullptr;
  std::string source_sql_;
  bool finalized_ = false;
  
  // Configuration options
  bool use_big_ints_ = false;
  bool return_arrays_ = false;
  bool allow_bare_named_params_ = false;
  
  // Bare named parameters mapping (bare name -> full name with prefix)
  std::optional<std::map<std::string, std::string>> bare_named_params_;
  
  friend class StatementSyncIterator;
};

// Iterator class for StatementSync
class StatementSyncIterator : public Napi::ObjectWrap<StatementSyncIterator> {
 public:
  static Napi::FunctionReference constructor_;
  
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  static Napi::Object Create(Napi::Env env, StatementSync* stmt);
  
  explicit StatementSyncIterator(const Napi::CallbackInfo& info);
  virtual ~StatementSyncIterator();
  
  // Iterator methods
  Napi::Value Next(const Napi::CallbackInfo& info);
  Napi::Value Return(const Napi::CallbackInfo& info);
  
 private:
  void SetStatement(StatementSync* stmt);
  
  StatementSync* stmt_;
  bool done_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_SQLITE_IMPL_H_