#ifndef SRC_SQLITE_EXCEPTION_H_
#define SRC_SQLITE_EXCEPTION_H_

#include <exception>
#include <sqlite3.h>
#include <string>

namespace photostructure {
namespace sqlite {

// Custom exception that captures SQLite error information at the point of error
class SqliteException : public std::exception {
public:
  SqliteException(sqlite3 *db, int result_code, const std::string &message)
      : message_(message), sqlite_code_(result_code), extended_code_(0),
        system_errno_(0) {

    if (db) {
      // Capture error codes immediately while they're still valid
      extended_code_ = sqlite3_extended_errcode(db);
      system_errno_ = sqlite3_system_errno(db);
    }

    // Get the error string for the code
    const char *err_str = sqlite3_errstr(result_code);
    if (err_str) {
      error_string_ = err_str;
    }
  }

  const char *what() const noexcept override { return message_.c_str(); }

  int sqlite_code() const { return sqlite_code_; }
  int extended_code() const { return extended_code_; }
  int system_errno() const { return system_errno_; }
  const std::string &error_string() const { return error_string_; }

private:
  std::string message_;
  std::string error_string_;
  int sqlite_code_;
  int extended_code_;
  int system_errno_;
};

} // namespace sqlite
} // namespace photostructure

#endif // SRC_SQLITE_EXCEPTION_H_