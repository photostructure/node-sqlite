#ifndef SRC_SQLITE_IMPL_H_
#define SRC_SQLITE_IMPL_H_

#include <napi.h>
#include <sqlite3.h>

#include <atomic>
#include <climits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>

// Include our shims
#include "shims/base_object.h"
#include "shims/napi_extensions.h"
#include "shims/node_errors.h"
#include "shims/promise_resolver.h"
// Removed threadpoolwork-inl.h - using Napi::AsyncWorker instead
#include "shims/util.h"

namespace photostructure {
namespace sqlite {

// Forward declarations
class DatabaseSync;
class StatementSync;
class StatementSyncIterator;
class Session;
class BackupJob;

// Per-worker instance data
struct AddonData {
  std::mutex mutex;
  // Track all database instances for proper cleanup
  std::set<DatabaseSync *> databases;

  // Store constructors per-instance instead of globally
  Napi::FunctionReference databaseSyncConstructor;
  Napi::FunctionReference statementSyncConstructor;
  Napi::FunctionReference statementSyncIteratorConstructor;
  Napi::FunctionReference sessionConstructor;

  // Cached Object.create function for creating objects with null prototype
  Napi::FunctionReference objectCreateFn;
};

// Helper to create an object with null prototype (matches Node.js behavior)
Napi::Object CreateObjectWithNullPrototype(Napi::Env env);

// Worker thread support functions
void RegisterDatabaseInstance(Napi::Env env, DatabaseSync *database);
void UnregisterDatabaseInstance(Napi::Env env, DatabaseSync *database);
AddonData *GetAddonData(napi_env env);

// Path validation function
std::optional<std::string> ValidateDatabasePath(Napi::Env env, Napi::Value path,
                                                const std::string &field_name);

// Safe integer cast with bounds checking
inline int SafeCastToInt(size_t value) {
  if (value > static_cast<size_t>(INT_MAX)) {
    throw std::overflow_error("Value too large to safely cast to int");
  }
  return static_cast<int>(value);
}

// Database configuration
class DatabaseOpenConfiguration {
public:
  explicit DatabaseOpenConfiguration(std::string &&location)
      : location_(std::move(location)) {}

  const std::string &location() const { return location_; }

  bool get_read_only() const { return read_only_; }
  void set_read_only(bool flag) { read_only_ = flag; }

  bool get_enable_foreign_keys() const { return enable_foreign_keys_; }
  void set_enable_foreign_keys(bool flag) { enable_foreign_keys_ = flag; }

  bool get_enable_dqs() const { return enable_dqs_; }
  void set_enable_dqs(bool flag) { enable_dqs_ = flag; }

  void set_timeout(int timeout) { timeout_ = timeout; }
  int get_timeout() const { return timeout_; }

  bool get_read_big_ints() const { return read_big_ints_; }
  void set_read_big_ints(bool flag) { read_big_ints_ = flag; }

  bool get_return_arrays() const { return return_arrays_; }
  void set_return_arrays(bool flag) { return_arrays_ = flag; }

  bool get_allow_bare_named_params() const { return allow_bare_named_params_; }
  void set_allow_bare_named_params(bool flag) {
    allow_bare_named_params_ = flag;
  }

  bool get_allow_unknown_named_params() const {
    return allow_unknown_named_params_;
  }
  void set_allow_unknown_named_params(bool flag) {
    allow_unknown_named_params_ = flag;
  }

  bool get_enable_defensive() const { return defensive_; }
  void set_enable_defensive(bool flag) { defensive_ = flag; }

  bool get_open_uri() const { return open_uri_; }
  void set_open_uri(bool flag) { open_uri_ = flag; }

private:
  std::string location_;
  bool read_only_ = false;
  bool enable_foreign_keys_ = true;
  bool enable_dqs_ = false;
  int timeout_ = 0;
  bool read_big_ints_ = false;
  bool return_arrays_ = false;
  bool allow_bare_named_params_ = true;
  bool allow_unknown_named_params_ = false;
  bool defensive_ = true; // Node.js v25+ defaults to true
  bool open_uri_ = false;
};

// Main database class
class DatabaseSync : public Napi::ObjectWrap<DatabaseSync> {
public:
  static constexpr int kInternalFieldCount = 1;

  static Napi::Object Init(Napi::Env env, Napi::Object exports);

  explicit DatabaseSync(const Napi::CallbackInfo &info);
  virtual ~DatabaseSync();

  // Database operations
  Napi::Value Open(const Napi::CallbackInfo &info);
  Napi::Value Close(const Napi::CallbackInfo &info);
  Napi::Value Dispose(const Napi::CallbackInfo &info);
  Napi::Value Prepare(const Napi::CallbackInfo &info);
  Napi::Value Exec(const Napi::CallbackInfo &info);

  // Properties
  Napi::Value LocationMethod(const Napi::CallbackInfo &info);
  Napi::Value IsOpenGetter(const Napi::CallbackInfo &info);
  Napi::Value IsTransactionGetter(const Napi::CallbackInfo &info);

  // SQLite handle access
  sqlite3 *connection() const { return connection_; }
  bool IsOpen() const { return connection_ != nullptr; }

  // User-defined functions
  Napi::Value CustomFunction(const Napi::CallbackInfo &info);

  // Aggregate functions
  Napi::Value AggregateFunction(const Napi::CallbackInfo &info);

  // Extension loading
  Napi::Value EnableLoadExtension(const Napi::CallbackInfo &info);
  Napi::Value LoadExtension(const Napi::CallbackInfo &info);

  // Defensive mode
  Napi::Value EnableDefensive(const Napi::CallbackInfo &info);

  // Session support
  Napi::Value CreateSession(const Napi::CallbackInfo &info);
  Napi::Value ApplyChangeset(const Napi::CallbackInfo &info);

  // Backup support
  Napi::Value Backup(const Napi::CallbackInfo &info);

  // Authorization API
  Napi::Value SetAuthorizer(const Napi::CallbackInfo &info);

  // Static callback for SQLite authorization
  static int AuthorizerCallback(void *user_data, int action_code,
                                const char *param1, const char *param2,
                                const char *param3, const char *param4);

  // Session management
  void AddSession(Session *session);
  void RemoveSession(Session *session);
  void DeleteAllSessions();

  // Backup management - prevents use-after-free when database is closed
  // during an active backup operation
  void AddBackup(BackupJob *backup);
  void RemoveBackup(BackupJob *backup);
  void FinalizeBackups();

  // Error handling for user functions
  void SetIgnoreNextSQLiteError(bool ignore) {
    ignore_next_sqlite_error_ = ignore;
  }
  bool ShouldIgnoreSQLiteError() const { return ignore_next_sqlite_error_; }

  // Deferred exception handling for authorizer callbacks
  void SetDeferredAuthorizerException(const std::string &message) {
    deferred_authorizer_exception_ = message;
  }
  void ClearDeferredAuthorizerException() {
    deferred_authorizer_exception_.reset();
  }
  bool HasDeferredAuthorizerException() const {
    return deferred_authorizer_exception_.has_value();
  }
  const std::string &GetDeferredAuthorizerException() const {
    return deferred_authorizer_exception_.value();
  }

private:
  void InternalOpen(DatabaseOpenConfiguration config);
  void InternalClose();

  sqlite3 *connection_ = nullptr;
  std::string location_;
  bool read_only_ = false;
  bool allow_load_extension_ = false;
  bool enable_load_extension_ = false;
  std::map<std::string, std::unique_ptr<StatementSync>> prepared_statements_;
  std::set<Session *> sessions_;      // Track all active sessions
  mutable std::mutex sessions_mutex_; // Protect sessions_ for thread safety
  std::set<BackupJob *> backups_;     // Track all active backup jobs
  mutable std::mutex backups_mutex_;  // Protect backups_ for thread safety
  std::thread::id creation_thread_;
  napi_env env_;                          // Store for cleanup purposes
  bool ignore_next_sqlite_error_ = false; // For user function error handling

  // Deferred exception from authorizer callback - stored when exception occurs
  // in callback context, thrown after SQLite operation completes
  std::optional<std::string> deferred_authorizer_exception_;

  // Authorization callback storage
  std::unique_ptr<Napi::FunctionReference> authorizer_callback_;

  // Store database-level defaults for statement options
  DatabaseOpenConfiguration config_;

  bool ValidateThread(Napi::Env env) const;
  friend class Session;
  friend class StatementSync;
  friend class BackupJob;
};

// Statement class
class StatementSync : public Napi::ObjectWrap<StatementSync> {
public:
  static constexpr int kInternalFieldCount = 1;

  static Napi::Object Init(Napi::Env env, Napi::Object exports);

  explicit StatementSync(const Napi::CallbackInfo &info);
  virtual ~StatementSync();

  // Internal constructor for DatabaseSync to use
  void InitStatement(DatabaseSync *database, const std::string &sql);

  // Statement operations
  Napi::Value Run(const Napi::CallbackInfo &info);
  Napi::Value Get(const Napi::CallbackInfo &info);
  Napi::Value All(const Napi::CallbackInfo &info);
  Napi::Value Iterate(const Napi::CallbackInfo &info);
  Napi::Value FinalizeStatement(const Napi::CallbackInfo &info);
  Napi::Value Dispose(const Napi::CallbackInfo &info);

  // Properties
  Napi::Value SourceSQLGetter(const Napi::CallbackInfo &info);
  Napi::Value ExpandedSQLGetter(const Napi::CallbackInfo &info);
  Napi::Value FinalizedGetter(const Napi::CallbackInfo &info);

  // Configuration methods
  Napi::Value SetReadBigInts(const Napi::CallbackInfo &info);
  Napi::Value SetReturnArrays(const Napi::CallbackInfo &info);
  Napi::Value SetAllowBareNamedParameters(const Napi::CallbackInfo &info);
  Napi::Value SetAllowUnknownNamedParameters(const Napi::CallbackInfo &info);

  // Metadata methods
  Napi::Value Columns(const Napi::CallbackInfo &info);

private:
  void BindParameters(const Napi::CallbackInfo &info, size_t start_index = 0);
  void BindSingleParameter(int param_index, Napi::Value param);
  Napi::Value CreateResult();
  void Reset();

  DatabaseSync *database_ = nullptr;
  // Strong reference to database object to prevent GC while statement exists.
  // This fixes use-after-free when database is GC'd before its statements.
  // See: https://github.com/nodejs/node/pull/56840
  Napi::ObjectReference database_ref_;
  sqlite3_stmt *statement_ = nullptr;
  std::string source_sql_;
  bool finalized_ = false;
  std::thread::id creation_thread_;

  // Configuration options
  bool use_big_ints_ = false;
  bool return_arrays_ = false;
  bool allow_bare_named_params_ = false;
  bool allow_unknown_named_params_ = false;

  // Bare named parameters mapping (bare name -> full name with prefix)
  std::optional<std::map<std::string, std::string>> bare_named_params_;

  bool ValidateThread(Napi::Env env) const;
  friend class DatabaseSync;
  friend class StatementSyncIterator;
};

// Iterator class for StatementSync
class StatementSyncIterator : public Napi::ObjectWrap<StatementSyncIterator> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  static Napi::Object Create(Napi::Env env, StatementSync *stmt);

  explicit StatementSyncIterator(const Napi::CallbackInfo &info);
  virtual ~StatementSyncIterator();

  // Iterator methods
  Napi::Value Next(const Napi::CallbackInfo &info);
  Napi::Value Return(const Napi::CallbackInfo &info);
  Napi::Value ToArray(const Napi::CallbackInfo &info);

private:
  void SetStatement(StatementSync *stmt);

  StatementSync *stmt_;
  bool done_;
};

// Session class for SQLite changesets
class Session : public Napi::ObjectWrap<Session> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  static Napi::Object Create(Napi::Env env, DatabaseSync *database,
                             sqlite3_session *session);

  explicit Session(const Napi::CallbackInfo &info);
  virtual ~Session();

  // Session methods
  Napi::Value Changeset(const Napi::CallbackInfo &info);
  Napi::Value Patchset(const Napi::CallbackInfo &info);
  Napi::Value Close(const Napi::CallbackInfo &info);
  Napi::Value Dispose(const Napi::CallbackInfo &info);

  // Get the underlying SQLite session
  sqlite3_session *GetSession() const { return session_; }

private:
  void SetSession(DatabaseSync *database, sqlite3_session *session);
  void Delete();

  template <int (*sqliteChangesetFunc)(sqlite3_session *, int *, void **)>
  Napi::Value GenericChangeset(const Napi::CallbackInfo &info);

  sqlite3_session *session_ = nullptr;
  DatabaseSync *database_ = nullptr; // Direct pointer to database
  // Strong reference to database object to prevent GC while session exists.
  // This fixes use-after-free when database is GC'd before its sessions.
  // See: https://github.com/nodejs/node/pull/56840 (similar fix for statements)
  Napi::ObjectReference database_ref_;

  friend class DatabaseSync;
};

// Progress data structure for backup progress updates
struct BackupProgress {
  int current;
  int total;
};

// Backup job for asynchronous database backup
class BackupJob : public Napi::AsyncProgressWorker<BackupProgress> {
public:
  BackupJob(Napi::Env env, DatabaseSync *source, std::string destination_path,
            std::string source_db, std::string dest_db, int pages,
            Napi::Function progress_func, Napi::Promise::Deferred deferred);
  ~BackupJob();

  void Execute(const ExecutionProgress &progress) override;
  void OnOK() override;
  void OnError(const Napi::Error &error) override;
  void OnProgress(const BackupProgress *data, size_t count) override;

  Napi::Promise GetPromise() { return deferred_.Promise(); }

public:
  // Cleanup is called by FinalizeBackups when database is closing
  void Cleanup();
  // Called by FinalizeBackups to prevent double-unregistration in destructor
  void ClearSource() { source_ = nullptr; }

private:
  DatabaseSync *source_;
  sqlite3 *source_connection_; // Captured at construction to avoid race
  std::string destination_path_;
  std::string source_db_;
  std::string dest_db_;
  int pages_;

  // These are only accessed in Execute() on worker thread
  int backup_status_ = SQLITE_OK;
  sqlite3 *dest_ = nullptr;
  sqlite3_backup *backup_ = nullptr;
  int total_pages_ = 0;

  Napi::FunctionReference progress_func_;
  Napi::Promise::Deferred deferred_;

  // Error from progress callback (set on main thread, checked in OnOK)
  std::optional<std::string> progress_error_;

  static std::atomic<int> active_jobs_;
  static std::mutex active_jobs_mutex_;
  static std::set<BackupJob *> active_job_instances_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_SQLITE_IMPL_H_