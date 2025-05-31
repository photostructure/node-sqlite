/*
** Simple SQLite extension for testing extension loading functionality
**
** This extension adds a custom function called "test_extension_version"
** that returns a version string to verify the extension was loaded.
*/

#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1

#include <string.h>

/* Custom function that returns the extension version */
static void test_extension_version(sqlite3_context *context, int argc,
                                   sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  sqlite3_result_text(context, "test-extension-1.0.0", -1, SQLITE_STATIC);
}

/* Custom function that adds two numbers */
static void test_extension_add(sqlite3_context *context, int argc,
                               sqlite3_value **argv) {
  if (argc != 2) {
    sqlite3_result_error(
        context, "test_extension_add() requires exactly 2 arguments", -1);
    return;
  }

  double a = sqlite3_value_double(argv[0]);
  double b = sqlite3_value_double(argv[1]);
  sqlite3_result_double(context, a + b);
}

/* Custom function that reverses a string */
static void test_extension_reverse(sqlite3_context *context, int argc,
                                   sqlite3_value **argv) {
  if (argc != 1) {
    sqlite3_result_error(
        context, "test_extension_reverse() requires exactly 1 argument", -1);
    return;
  }

  const unsigned char *input = sqlite3_value_text(argv[0]);
  if (!input) {
    sqlite3_result_null(context);
    return;
  }

  /* Get byte length of UTF-8 string */
  int byte_len = sqlite3_value_bytes(argv[0]);
  unsigned char *output = sqlite3_malloc(byte_len + 1);
  if (!output) {
    sqlite3_result_error_nomem(context);
    return;
  }

  /* Simple byte reversal - this won't handle multi-byte UTF-8 correctly */
  /* For test purposes, we'll just copy the string as-is to avoid complexity */
  memcpy(output, input, byte_len);
  output[byte_len] = '\0';

  /* For ASCII strings, do simple reversal */
  int is_ascii = 1;
  for (int i = 0; i < byte_len; i++) {
    if (input[i] > 127) {
      is_ascii = 0;
      break;
    }
  }

  if (is_ascii) {
    for (int i = 0; i < byte_len / 2; i++) {
      unsigned char temp = output[i];
      output[i] = output[byte_len - 1 - i];
      output[byte_len - 1 - i] = temp;
    }
  }

  sqlite3_result_text(context, (const char *)output, byte_len, sqlite3_free);
}

/* Extension entry point */
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_testextension_init(
  sqlite3 *db,
  char **pzErrMsg,
  const sqlite3_api_routines *pApi
){
  int rc = SQLITE_OK;
  SQLITE_EXTENSION_INIT2(pApi);

  /* Register our custom functions */
  rc = sqlite3_create_function(db, "test_extension_version", 0,
                               SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0,
                               test_extension_version, 0, 0);
  if (rc != SQLITE_OK)
    return rc;

  rc = sqlite3_create_function(db, "test_extension_add", 2,
                               SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0,
                               test_extension_add, 0, 0);
  if (rc != SQLITE_OK)
    return rc;

  rc = sqlite3_create_function(db, "test_extension_reverse", 1,
                               SQLITE_UTF8 | SQLITE_DETERMINISTIC, 0,
                               test_extension_reverse, 0, 0);

  return rc;
}

/* Alternative entry point with standard name */
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_extension_init(
  sqlite3 *db,
  char **pzErrMsg,
  const sqlite3_api_routines *pApi
){
  return sqlite3_testextension_init(db, pzErrMsg, pApi);
}