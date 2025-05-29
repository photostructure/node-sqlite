{
  "targets": [
    {
      "target_name": "sqlite",
      "sources": [
        "src/binding.cpp",
        "src/sqlite_impl.cpp",
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
        "SQLITE_DEFAULT_MEMSTATUS=0",
        "SQLITE_ENABLE_COLUMN_METADATA",
        "SQLITE_ENABLE_DBSTAT_VTAB",
        "SQLITE_ENABLE_FTS3",
        "SQLITE_ENABLE_FTS3_PARENTHESIS",
        "SQLITE_ENABLE_FTS5",
        "SQLITE_ENABLE_GEOPOLY",
        "SQLITE_ENABLE_MATH_FUNCTIONS",
        "SQLITE_ENABLE_PREUPDATE_HOOK",
        "SQLITE_ENABLE_RBU",
        "SQLITE_ENABLE_RTREE",
        "SQLITE_ENABLE_SESSION"
      ],
      "cflags": [
        "-fvisibility=hidden",
        "-fPIC"
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