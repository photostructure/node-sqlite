#ifndef SRC_AGGREGATE_FUNCTION_H_
#define SRC_AGGREGATE_FUNCTION_H_

#include <napi.h>
#include <sqlite3.h>
#include <memory>

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
    Napi::Reference<Napi::Value> value;
    bool initialized;
    bool is_window;
  };

  // Helper methods
  static void xStepBase(sqlite3_context* ctx, int argc, sqlite3_value** argv, bool use_inverse);
  static void xValueBase(sqlite3_context* ctx, bool finalize);
  
  AggregateData* GetAggregate(sqlite3_context* ctx);
  Napi::Value SqliteValueToJS(sqlite3_value* value);
  void JSValueToSqliteResult(sqlite3_context* ctx, Napi::Value value);
  Napi::Value GetStartValue();

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
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_AGGREGATE_FUNCTION_H_