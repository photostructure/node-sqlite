{
  "targets": [
    {
        # We're prefixing with phstr to avoid conflicts with other SQLite addons.
      "target_name": "phstr_sqlite",
      "sources": [
        "src/binding.cpp",
        "src/sqlite_impl.cpp",
        "src/user_function.cpp",
        "src/aggregate_function.cpp",
        "src/upstream/sqlite3.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src",
        "src/upstream",
        "src/shims"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "HAVE_STDINT_H=1",
        "HAVE_USLEEP=1",
        "SQLITE_DEFAULT_CACHE_SIZE=-16000",
        "SQLITE_DEFAULT_FOREIGN_KEYS=1",
        # "SQLITE_DEFAULT_MEMSTATUS=0", https://www.sqlite.org/forum/forumpost/c1cc8b057a
        "SQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
        "SQLITE_DQS=0",
        "SQLITE_ENABLE_COLUMN_METADATA",
        "SQLITE_ENABLE_DBSTAT_VTAB",
        "SQLITE_ENABLE_FTS3_PARENTHESIS",
        "SQLITE_ENABLE_FTS3",
        "SQLITE_ENABLE_FTS4",
        "SQLITE_ENABLE_FTS5",
        "SQLITE_ENABLE_GEOPOLY",
        "SQLITE_ENABLE_JSON1",
        "SQLITE_ENABLE_MATH_FUNCTIONS",
        "SQLITE_ENABLE_NORMALIZE",
        "SQLITE_ENABLE_PREUPDATE_HOOK",
        "SQLITE_ENABLE_RBU",
        "SQLITE_ENABLE_RTREE",
        "SQLITE_ENABLE_SESSION",
        "SQLITE_ENABLE_SNAPSHOT",
        "SQLITE_ENABLE_STAT4",
        "SQLITE_ENABLE_UPDATE_DELETE_LIMIT",
        "SQLITE_LIKE_DOESNT_MATCH_BLOBS",
        "SQLITE_OMIT_DEPRECATED",
        "SQLITE_OMIT_SHARED_CACHE",
        "SQLITE_SOUNDEX",
        "SQLITE_THREADSAFE=2"
      ],
      # cflags apply only to C files (not C++), so these warnings suppressions
      # are specific to SQLite's C code and don't affect our C++ code:
      # -Wno-implicit-fallthrough: SQLite uses intentional switch fallthroughs
      "cflags": [
        "-fvisibility=hidden",
        "-fPIC",
        "-Wno-implicit-fallthrough"
      ],
      "cflags_cc": [
        "-fexceptions",
        "-fPIC"
      ],
      "xcode_settings": {
        "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/Qspectre",
            "/guard:cf",
            "/ZH:SHA_256",
            "/sdl"
          ],
          "ExceptionHandling": 1,
          "RuntimeTypeInfo": "true"
        },
        "VCLinkerTool": {
          "AdditionalOptions": [
            "/guard:cf",
            "/DYNAMICBASE",
            "/CETCOMPAT"
          ]
        }
      }
    }
  ]
}