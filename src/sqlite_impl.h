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
};

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

  explicit DatabaseSync(const Napi::CallbackInfo &info);
  virtual ~DatabaseSync();

  // Database operations
  Napi::Value Open(const Napi::CallbackInfo &info);
  Napi::Value Close(const Napi::CallbackInfo &info);
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

  // Session support
  Napi::Value CreateSession(const Napi::CallbackInfo &info);
  Napi::Value ApplyChangeset(const Napi::CallbackInfo &info);

  // Backup support
  Napi::Value Backup(const Napi::CallbackInfo &info);

  // Session management
  void AddSession(Session *session);
  void RemoveSession(Session *session);
  void DeleteAllSessions();

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
  std::thread::id creation_thread_;
  napi_env env_; // Store for cleanup purposes

  bool ValidateThread(Napi::Env env) const;
  friend class Session;
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

  // Properties
  Napi::Value SourceSQLGetter(const Napi::CallbackInfo &info);
  Napi::Value ExpandedSQLGetter(const Napi::CallbackInfo &info);

  // Configuration methods
  Napi::Value SetReadBigInts(const Napi::CallbackInfo &info);
  Napi::Value SetReturnArrays(const Napi::CallbackInfo &info);
  Napi::Value SetAllowBareNamedParameters(const Napi::CallbackInfo &info);

  // Metadata methods
  Napi::Value Columns(const Napi::CallbackInfo &info);

private:
  void BindParameters(const Napi::CallbackInfo &info, size_t start_index = 0);
  void BindSingleParameter(int param_index, Napi::Value param);
  Napi::Value CreateResult();
  void Reset();

  DatabaseSync *database_;
  sqlite3_stmt *statement_ = nullptr;
  std::string source_sql_;
  bool finalized_ = false;
  std::thread::id creation_thread_;

  // Configuration options
  bool use_big_ints_ = false;
  bool return_arrays_ = false;
  bool allow_bare_named_params_ = false;

  // Bare named parameters mapping (bare name -> full name with prefix)
  std::optional<std::map<std::string, std::string>> bare_named_params_;

  bool ValidateThread(Napi::Env env) const;
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

  // Get the underlying SQLite session
  sqlite3_session *GetSession() const { return session_; }

private:
  void SetSession(DatabaseSync *database, sqlite3_session *session);
  void Delete();

  template <int (*sqliteChangesetFunc)(sqlite3_session *, int *, void **)>
  Napi::Value GenericChangeset(const Napi::CallbackInfo &info);

  sqlite3_session *session_ = nullptr;
  DatabaseSync *database_ = nullptr; // Direct pointer to database

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
  BackupJob(Napi::Env env, DatabaseSync *source,
            const std::string &destination_path, const std::string &source_db,
            const std::string &dest_db, int pages, Napi::Function progress_func,
            Napi::Promise::Deferred deferred);
  ~BackupJob();

  void Execute(const ExecutionProgress &progress) override;
  void OnOK() override;
  void OnError(const Napi::Error &error) override;
  void OnProgress(const BackupProgress *data, size_t count) override;

  Napi::Promise GetPromise() { return deferred_.Promise(); }

private:
  void Cleanup();

  DatabaseSync *source_;
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

  static std::atomic<int> active_jobs_;
  static std::mutex active_jobs_mutex_;
  static std::set<BackupJob *> active_job_instances_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_SQLITE_IMPL_H_