#ifndef SRC_AGGREGATE_FUNCTION_H_
#define SRC_AGGREGATE_FUNCTION_H_

#include <napi.h>
#include <sqlite3.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace photostructure {
namespace sqlite {

// Forward declarations
class DatabaseSync;

// Thread-safe external storage for N-API values
// This solves the problem of storing N-API objects in SQLite-allocated memory
class ValueStorage {
private:
  static std::unordered_map<int32_t, Napi::Reference<Napi::Value>> storage_;
  static std::mutex mutex_;
  static std::atomic<int32_t> next_id_;

public:
  static int32_t Store(Napi::Env env, Napi::Value value);
  static Napi::Value Get(Napi::Env env, int32_t id);
  static void Remove(int32_t id);
};

class CustomAggregate {
public:
  explicit CustomAggregate(Napi::Env env, DatabaseSync *db,
                           bool use_bigint_args, Napi::Value start,
                           Napi::Function step_fn, Napi::Function inverse_fn,
                           Napi::Function result_fn);
  ~CustomAggregate();

  // SQLite aggregate function callbacks
  static void xStep(sqlite3_context *ctx, int argc, sqlite3_value **argv);
  static void xInverse(sqlite3_context *ctx, int argc, sqlite3_value **argv);
  static void xFinal(sqlite3_context *ctx);
  static void xValue(sqlite3_context *ctx);
  static void xDestroy(void *self);

private:
  // Comprehensive aggregate value storage (no Napi::Reference)
  struct AggregateValue {
    enum Type {
      NUMBER,
      STRING,
      BIGINT,
      BOOLEAN,
      NULL_VAL,
      OBJECT_JSON,
      BUFFER
    };
    Type type;
    bool is_initialized;
    union {
      double number_value;
      bool bool_value;
      int64_t bigint_value;
    };
    char string_buffer[4096]; // Fixed-size buffer for string data (POD) -
                              // increased for complex JSON
    size_t string_length;     // Length of string data

    // No constructor needed - this must be POD for SQLite context
  };

  // Simplified aggregate data structure matching Node.js pattern
  // Uses external storage to avoid N-API object lifetime issues
  struct AggregateData {
    int32_t value_id; // Reference to external storage
    bool initialized;
    bool is_window;
  };

  // Helper methods - mirroring Node.js implementation exactly
  static void xStepBase(sqlite3_context *ctx, int argc, sqlite3_value **argv,
                        Napi::Reference<Napi::Function> CustomAggregate::*mptr);
  static void xValueBase(sqlite3_context *ctx, bool is_final);

  // Helper method for safe JSON serialization with circular reference handling
  static std::string SafeJsonStringify(Napi::Env env, Napi::Value value);
  static void DestroyAggregateData(sqlite3_context *ctx);

  AggregateData *GetAggregate(sqlite3_context *ctx);
  Napi::Value SqliteValueToJS(sqlite3_value *value);
  void JSValueToSqliteResult(sqlite3_context *ctx, Napi::Value value);
  Napi::Value GetStartValue();

  Napi::Env env_;
  bool use_bigint_args_;

  // Storage for start value - handle primitives and objects
  enum StartValueType {
    PRIMITIVE_NULL,
    PRIMITIVE_UNDEFINED,
    PRIMITIVE_NUMBER,
    PRIMITIVE_STRING,
    PRIMITIVE_BOOLEAN,
    PRIMITIVE_BIGINT,
    OBJECT,
    FUNCTION
  };
  StartValueType start_type_;
  double number_value_;
  std::string string_value_;
  bool boolean_value_;
  int64_t bigint_value_;
  Napi::Reference<Napi::Value> object_ref_;
  Napi::Reference<Napi::Function> start_fn_;

  // Function references
  Napi::Reference<Napi::Function> step_fn_;
  Napi::Reference<Napi::Function> inverse_fn_;
  Napi::Reference<Napi::Function> result_fn_;

  // Async context for callbacks (created lazily)
  napi_async_context async_context_;
  napi_async_context GetAsyncContext();
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_AGGREGATE_FUNCTION_H_