#ifndef SRC_SQLITE_IMPL_H_
#define SRC_SQLITE_IMPL_H_

#include <napi.h>
#include <sqlite3.h>

#include <array>
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
#include <unordered_map>
#include <vector>

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

  // Public diagnostics_channel Channel supplied by the TypeScript entrypoint.
  // Keeping the JS object here makes it available to SQLite's native profile
  // callback without relying on Node-internal diagnostics_channel APIs.
  Napi::ObjectReference queryDiagnosticsChannel;

  // Cached Object.create function for creating objects with null prototype
  Napi::FunctionReference objectCreateFn;

  // ValueStorage data
  std::mutex value_storage_mutex;
  std::unordered_map<int32_t, Napi::Reference<Napi::Value>> value_storage;
  std::atomic<int32_t> next_value_id{0};
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

  static constexpr size_t kNumLimits = 11;
  void set_initial_limit(int sqlite_limit_id, int value) {
    initial_limits_.at(sqlite_limit_id) = value;
  }
  const std::array<std::optional<int>, kNumLimits> &initial_limits() const {
    return initial_limits_;
  }

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
  std::array<std::optional<int>, kNumLimits> initial_limits_{};
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

  // Native statement-call reentrancy tracking. While sqlite3_prepare_v2(),
  // sqlite3_step(), or sqlite3_exec() is on the stack, callbacks run with this
  // depth raised. close() and deserialize() use it to protect the running VM
  // from user-function reentry. Authorizers have a stricter, connection-wide
  // contract and use AuthorizerGuard below.
  // Single-threaded by construction (statements only run on their creation
  // thread), so no synchronization is needed.
  void EnterStatementStep() { ++statements_in_progress_; }
  void LeaveStatementStep() { --statements_in_progress_; }
  bool IsExecutingStatement() const { return statements_in_progress_ > 0; }

  void EnterTraceSuppression() { ++trace_suppression_depth_; }
  void LeaveTraceSuppression() { --trace_suppression_depth_; }
  bool AreTraceEventsSuppressed() const { return trace_suppression_depth_ > 0; }

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

  // Serialization
  Napi::Value Serialize(const Napi::CallbackInfo &info);
  Napi::Value Deserialize(const Napi::CallbackInfo &info);

  // Limits API
  Napi::Value GetLimit(const Napi::CallbackInfo &info);
  Napi::Value SetLimit(const Napi::CallbackInfo &info);

  // Authorization API
  Napi::Value SetAuthorizer(const Napi::CallbackInfo &info);

  // Static callback for SQLite authorization
  static int AuthorizerCallback(void *user_data, int action_code,
                                const char *param1, const char *param2,
                                const char *param3, const char *param4);

  // SQLite profile callback used to publish sqlite.db.query diagnostics.
  static int QueryTraceCallback(unsigned int type, void *user_data,
                                void *statement, void *duration);

  // Session management
  void AddSession(Session *session);
  void RemoveSession(Session *session);
  void DeleteAllSessions();
  // Clears the back-pointer every surviving Session holds to this database.
  // Must run during ~DatabaseSync: Session wrappers are independent JS objects
  // whose finalization order relative to this one is unspecified.
  void DetachAllSessions();

  // Backup management - prevents use-after-free when database is closed
  // during an active backup operation
  void AddBackup(BackupJob *backup);
  void RemoveBackup(BackupJob *backup);
  void FinalizeBackups();

  // Statement tracking - lets us finalize all live StatementSync instances
  // before operations like deserialize() that must run on a connection with
  // no open statements. The set holds raw pointers; statements remove
  // themselves on destruction (when database_ is still non-null) and
  // FinalizeStatements() nulls each tracked statement's database_ pointer
  // before clearing the set, so destructors run safely after teardown.
  void TrackStatement(StatementSync *stmt);
  void UntrackStatement(StatementSync *stmt);
  void FinalizeStatements();

  // Error handling for user functions
  void SetIgnoreNextSQLiteError(bool ignore) {
    ignore_next_sqlite_error_ = ignore;
  }
  bool ShouldIgnoreSQLiteError() const { return ignore_next_sqlite_error_; }

  // SQLite forbids an authorizer callback from modifying the connection that
  // invoked it; prepare and step explicitly count as modification. Track the
  // callback itself (rather than whichever SQLite entry point happened to
  // invoke it) so every SQLite-backed operation on that connection can enforce
  // the contract. A depth counter keeps the RAII scopes balanced if callback
  // entry is ever nested.
  class AuthorizerGuard {
  public:
    explicit AuthorizerGuard(DatabaseSync *database) noexcept
        : database_(database) {
      ++database_->in_authorizer_callback_depth_;
    }
    ~AuthorizerGuard() noexcept { --database_->in_authorizer_callback_depth_; }
    AuthorizerGuard(const AuthorizerGuard &) = delete;
    AuthorizerGuard &operator=(const AuthorizerGuard &) = delete;

  private:
    DatabaseSync *database_;
  };

  AuthorizerGuard EnterAuthorizerCallback() { return AuthorizerGuard(this); }
  bool IsInAuthorizerCallback() const {
    return in_authorizer_callback_depth_ > 0;
  }
  bool ThrowIfInAuthorizerCallback(Napi::Env env, const char *action) const;

  // Deferred exception handling for authorizer callbacks
  void SetDeferredAuthorizerException(const Napi::Error &error) {
    // Reconstruct rather than assign: Napi::Error's copy assignment unwraps a
    // primitive throw before creating its reference, which fails on Node-API.
    // emplace() uses the safe copy constructor and retains Node's observable
    // last-authorizer-exception-wins behavior when SQLite invokes the callback
    // more than once during a single outer call.
    deferred_authorizer_exception_.emplace(error);
  }
  void ClearDeferredAuthorizerException() {
    deferred_authorizer_exception_.reset();
  }
  bool HasDeferredAuthorizerException() const {
    return deferred_authorizer_exception_.has_value();
  }
  const Napi::Error &GetDeferredAuthorizerException() const {
    return *deferred_authorizer_exception_;
  }
  void RethrowDeferredAuthorizerException();

private:
  void InternalOpen(DatabaseOpenConfiguration config);
  void InternalClose();

  sqlite3 *connection_ = nullptr;
  std::string location_;
  bool read_only_ = false;
  bool allow_load_extension_ = false;
  bool enable_load_extension_ = false;
  std::set<Session *> sessions_;         // Track all active sessions
  mutable std::mutex sessions_mutex_;    // Protect sessions_ for thread safety
  std::set<BackupJob *> backups_;        // Track all active backup jobs
  mutable std::mutex backups_mutex_;     // Protect backups_ for thread safety
  std::set<StatementSync *> statements_; // Track all live prepared statements
  mutable std::mutex statements_mutex_;
  std::thread::id creation_thread_;
  napi_env env_;                          // Store for cleanup purposes
  bool ignore_next_sqlite_error_ = false; // For user function error handling

  // Depth of nested sqlite3_step()/sqlite3_exec() calls currently on the
  // stack for this connection. Raised by StatementSync::StepGuard and around
  // Exec()'s sqlite3_exec(); see EnterStatementStep()/IsExecutingStatement().
  int statements_in_progress_ = 0;

  // sqlite3_finalize() may deliver a final SQLITE_TRACE_PROFILE callback for
  // unfinished work. Suppress those callbacks: finalization is cleanup, not a
  // completed query, and may run while V8 is collecting the JS wrapper.
  int trace_suppression_depth_ = 0;

  // Depth of authorizer callbacks currently on this connection's stack. This
  // is separate from statements_in_progress_: authorizers forbid all
  // same-connection prepare/step work, while user functions may use a
  // different statement on the same connection.
  int in_authorizer_callback_depth_ = 0;

  // The exact JavaScript value thrown by an authorizer callback, held as
  // Napi::Error's persistent reference until the surrounding SQLite call
  // returns. This preserves identity, subclass, code, stack, custom fields,
  // and node-addon-api's wrapper for thrown primitive values.
  //
  // LOAD-BEARING INVARIANT: this MUST be empty whenever a native method returns
  // to JavaScript. It holds a Napi::Reference, and destroying a live reference
  // during GC finalization of this ObjectWrap corrupts V8's JIT pages on
  // Alpine/musl (the crash that removed database_ref_ in commits 0691ae5 /
  // 4da0638). Every authorizer-invoking operation must therefore clear it
  // before returning — via RethrowDeferredAuthorizerException(), or an explicit
  // post-call check for SQLite entry points that swallow the error
  // (serialize/deserialize/changeset). CleanupHook covers environment teardown.
  std::optional<Napi::Error> deferred_authorizer_exception_;

  // Authorization callback storage
  std::unique_ptr<Napi::FunctionReference> authorizer_callback_;

  // Environment cleanup hook - called before environment teardown
  static void CleanupHook(void *arg);

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

  // Called by DatabaseSync::FinalizeStatements() to finalize the underlying
  // sqlite3_stmt and detach from the database before the database is torn
  // down or its content replaced (e.g., by deserialize()). After this call
  // any further methods on the StatementSync throw "statement has been
  // finalized".
  void FinalizeFromDatabase();

  // Statement operations
  Napi::Value Run(const Napi::CallbackInfo &info);
  Napi::Value Get(const Napi::CallbackInfo &info);
  Napi::Value All(const Napi::CallbackInfo &info);
  Napi::Value Iterate(const Napi::CallbackInfo &info);
  // node:sqlite's StatementSync.prototype.close(): throws if the statement was
  // already finalized. Symbol.dispose maps to Dispose(), which is idempotent.
  Napi::Value Close(const Napi::CallbackInfo &info);
  Napi::Value Dispose(const Napi::CallbackInfo &info);

  // Properties
  Napi::Value SourceSQLGetter(const Napi::CallbackInfo &info);
  Napi::Value ExpandedSQLGetter(const Napi::CallbackInfo &info);

  // Configuration methods
  Napi::Value SetReadBigInts(const Napi::CallbackInfo &info);
  Napi::Value SetReturnArrays(const Napi::CallbackInfo &info);
  Napi::Value SetAllowBareNamedParameters(const Napi::CallbackInfo &info);
  Napi::Value SetAllowUnknownNamedParameters(const Napi::CallbackInfo &info);

  // Metadata methods
  Napi::Value Columns(const Napi::CallbackInfo &info);

private:
  // Finalizes the underlying sqlite3_stmt and stops the database tracking it.
  // Idempotent; shared by close() and Symbol.dispose().
  void CloseStatement();
  void BindParameters(const Napi::CallbackInfo &info, size_t start_index = 0);
  void BindSingleParameter(int param_index, Napi::Value param);
  Napi::Value CreateResult();
  // Builds one JS row (object or array, per return_arrays_) from the current
  // step. `keys` (nullable) holds reused per-column property-key handles for
  // the multi-row paths; pass nullptr on single-row paths to set properties
  // straight from column names. May set a pending exception (e.g. integer out
  // of safe range); callers must check env.IsExceptionPending() afterward.
  Napi::Value BuildRow(Napi::Env env, int column_count,
                       const std::vector<napi_value> *keys);
  // Writes the current row's column `i` (already known to be `column_type`) as
  // a JS value into `*out`. Returns false with a pending exception set ONLY for
  // the integer-out-of-safe-range case; every other branch writes `*out` and
  // returns true. Lets BuildRow skip a per-column env.IsExceptionPending()
  // call. Callers must stop building the row the instant this returns false and
  // issue no further N-API calls: with NAPI_CPP_EXCEPTIONS a pending exception
  // turns the next N-API call into a thrown C++ Napi::Error.
  bool GetColumnValue(Napi::Env env, int i, int column_type, napi_value *out);
  // Builds the per-column property-key strings for object-mode results into
  // `out_keys` (local handles). Callers build these once per operation and
  // reuse them for every row so we don't recreate a V8 string per column per
  // row. Returns false with a pending exception if a column name could not be
  // read. NOTE: deliberately does NOT persist the keys in a Napi::Reference:
  // an ObjectWrap member reference would call napi_delete_reference during GC
  // finalization, which corrupts V8's JIT pages on Alpine/musl (see commit
  // 4da0638 and nodejs/node-addon-api#660).
  bool BuildColumnKeys(Napi::Env env, int column_count,
                       std::vector<napi_value> *out_keys);
  void Reset();

  DatabaseSync *database_ = nullptr;
  sqlite3_stmt *statement_ = nullptr;
  std::string source_sql_;
  bool finalized_ = false;
  std::thread::id creation_thread_;

  // True while a sqlite3_step() on this statement is on the stack. Checked by
  // Run/Get/All/Iterate and the iterator's next() so that re-entering the
  // *currently executing* statement from a user-defined function callback
  // throws ERR_INVALID_STATE rather than resetting/re-stepping the live VM
  // (which loops forever) or finalizing memory the outer step still reads.
  bool stepping_ = false;

  // RAII guard held across the sqlite3_step() call(s) of a single
  // Run/Get/All/iterate operation. Sets stepping_ for this statement and
  // raises the owning database's user-callback depth for the duration, so
  // both per-statement reentry and connection-level close()/deserialize()
  // are guarded. The database pointer is captured at construction to keep
  // Enter/Leave balanced even if database_ changes.
  class StepGuard {
  public:
    explicit StepGuard(StatementSync *stmt)
        : stmt_(stmt), database_(stmt->database_) {
      stmt_->stepping_ = true;
      if (database_) {
        database_->EnterStatementStep();
      }
    }
    ~StepGuard() {
      stmt_->stepping_ = false;
      if (database_) {
        database_->LeaveStatementStep();
      }
    }
    StepGuard(const StepGuard &) = delete;
    StepGuard &operator=(const StepGuard &) = delete;

  private:
    StatementSync *stmt_;
    DatabaseSync *database_;
  };

  // Configuration options
  bool use_big_ints_ = false;
  bool return_arrays_ = false;
  bool allow_bare_named_params_ = false;
  bool allow_unknown_named_params_ = false;

  // Bare named parameters mapping (bare name -> full name with prefix)
  std::optional<std::map<std::string, std::string>> bare_named_params_;

  // Generation counter for iterator invalidation
  uint64_t reset_generation_ = 0;
  inline int ResetStatement();

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
  uint64_t statement_reset_generation_ = 0;
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
  BackupJob(Napi::Env env, DatabaseSync *source, Napi::Object source_object,
            std::string destination_path, std::string source_db,
            std::string dest_db, int pages, Napi::Function progress_func,
            Napi::Promise::Deferred deferred);
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
  // Strong reference to the source DatabaseSync's JS object, held for the
  // lifetime of the job so the source cannot be garbage-collected (and its
  // connection closed) while the backup is still reading from it on the
  // worker thread. Released by ~BackupJob on normal completion and by
  // CleanupHook during environment teardown. Without this, a caller that
  // drops its last reference to the source mid-backup would see the backup
  // fail (the source connection is torn down underneath it) or crash.
  Napi::ObjectReference source_ref_;
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
  // Snapshot of "is there a progress callback?" captured at construction.
  // Read on the worker thread to decide whether to call progress.Send(),
  // avoiding a data race with CleanupHook's progress_func_.Reset() on the
  // main thread. progress_func_ itself must only be touched on the main
  // thread.
  const bool has_progress_callback_;
  Napi::Promise::Deferred deferred_;

  // Error from progress callback (set on main thread, checked in OnOK)
  std::optional<std::string> progress_error_;

  // Environment cleanup hook - called before environment teardown
  static void CleanupHook(void *arg);
  napi_env env_;

  // Set from CleanupHook on the main thread; observed from Execute() on the
  // worker thread to break out of the backup loop, and from OnOK/OnError to
  // avoid touching deferred_ once the env is going away.
  std::atomic<bool> shutting_down_{false};

  static std::atomic<int> active_jobs_;
  static std::mutex active_jobs_mutex_;
  static std::set<BackupJob *> active_job_instances_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_SQLITE_IMPL_H_
