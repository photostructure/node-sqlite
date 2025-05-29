#ifndef SRC_AGGREGATE_FUNCTION_H_
#define SRC_AGGREGATE_FUNCTION_H_

#include <napi.h>
#include <sqlite3.h>
#include <memory>
#include <string>

namespace photostructure {
namespace sqlite {

// Forward declarations
class DatabaseSync;

class CustomAggregate {
 public:
  explicit CustomAggregate(Napi::Env env,
                          DatabaseSync* db,
                          bool use_bigint_args,
                          Napi::Value start,
                          Napi::Function step_fn,
                          Napi::Function inverse_fn,
                          Napi::Function result_fn);
  ~CustomAggregate();

  // SQLite aggregate function callbacks
  static void xStep(sqlite3_context* ctx, int argc, sqlite3_value** argv);
  static void xInverse(sqlite3_context* ctx, int argc, sqlite3_value** argv);
  static void xFinal(sqlite3_context* ctx);
  static void xValue(sqlite3_context* ctx);
  static void xDestroy(void* self);

 private:
  struct AggregateData {
    // Store value as raw C++ data instead of JavaScript objects
    enum ValueType {
      TYPE_NULL,
      TYPE_UNDEFINED,
      TYPE_NUMBER,
      TYPE_STRING,
      TYPE_BOOLEAN,
      TYPE_BIGINT,
      TYPE_OBJECT  // For complex objects, we'll need special handling
    } value_type;
    
    union {
      double number_val;
      bool boolean_val;
      int64_t bigint_val;
    };
    std::string string_val;  // For strings
    Napi::Reference<Napi::Value> object_ref;  // For complex objects (fallback)
    
    bool initialized;
    bool is_window;
    bool first_call;  // True if this is the first call and we need to initialize with start value
    
    // Default constructor
    AggregateData() : value_type(TYPE_NULL), number_val(0.0), initialized(false), is_window(false), first_call(false) {}
  };

  // Helper methods
  static void xStepBase(sqlite3_context* ctx, int argc, sqlite3_value** argv, bool use_inverse);
  static void xValueBase(sqlite3_context* ctx, bool finalize);
  
  AggregateData* GetAggregate(sqlite3_context* ctx);
  Napi::Value SqliteValueToJS(sqlite3_value* value);
  void JSValueToSqliteResult(sqlite3_context* ctx, Napi::Value value);
  Napi::Value GetStartValue();
  
  // New methods for raw C++ value handling
  void StoreJSValueAsRaw(AggregateData* agg, Napi::Value value);
  Napi::Value RawValueToJS(AggregateData* agg);

  Napi::Env env_;
  DatabaseSync* db_;
  bool use_bigint_args_;
  
  // Storage for start value - handle primitives differently
  enum StartValueType { PRIMITIVE_NULL, PRIMITIVE_UNDEFINED, PRIMITIVE_NUMBER, PRIMITIVE_STRING, PRIMITIVE_BOOLEAN, PRIMITIVE_BIGINT, OBJECT };
  StartValueType start_type_;
  double number_value_;
  std::string string_value_;
  bool boolean_value_;
  int64_t bigint_value_;
  Napi::Reference<Napi::Value> object_ref_;
  
  Napi::Reference<Napi::Function> step_fn_;
  Napi::Reference<Napi::Function> inverse_fn_;
  Napi::Reference<Napi::Function> result_fn_;
  
  // Async context for callbacks
  napi_async_context async_context_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_AGGREGATE_FUNCTION_H_