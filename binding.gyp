{
  "targets": [
    {
        # We're prefixing with phstr to avoid conflicts with other SQLite addons.
      "target_name": "phstr_sqlite",
      "sources": [
        "src/binding.cpp",
        "src/async_pool_impl.cpp",
        "src/sqlite_impl.cpp",
        "src/user_function.cpp",
        "src/aggregate_function.cpp",
        "src/upstream/sqlite3.c"
      ],
      "include_dirs": [
        "src",
        "src/upstream",
        "src/shims"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets + ':node_addon_api_except'\")"
      ],
      # SQLite build flags - see doc/build-flags.md for comprehensive documentation
      # including comparison with Node.js configuration and rationale for our choices
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        # Pin the Node-API surface we compile against. 8 is the header default
        # and the broadest ABI floor; stating it explicitly keeps a future
        # node-addon-api bump from silently widening the surface we rely on.
        "NAPI_VERSION=8",
        "HAVE_STDINT_H=1",
        "HAVE_USLEEP=1",
        # "SQLITE_DEFAULT_CACHE_SIZE=-16000", # SQLite default is -2000 (2 MiB).
        "SQLITE_DEFAULT_FOREIGN_KEYS=1",
        "SQLITE_DEFAULT_MEMSTATUS=0", # See https://www.sqlite.org/forum/forumpost/c1cc8b057a
        "SQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
        "SQLITE_DQS=0",
        # Validate C-API arguments and return SQLITE_MISUSE instead of risking
        # undefined behavior when a caller (e.g. a loaded extension like
        # sqlite-vec) misuses the blob/payload API. Negligible runtime cost;
        # defense-in-depth for a library that hosts third-party extensions.
        "SQLITE_ENABLE_API_ARMOR",
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
        "SQLITE_ENABLE_PERCENTILE",
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
        # Keep SQLite's SQLITE_THREADSAFE=1 serialized default. Setting =2
        # would change every DatabaseSync connection but would not speed pool
        # handles, which explicitly request FULLMUTEX. See the threading-mode
        # rationale in doc/build-flags.md.
        # "SQLITE_THREADSAFE=2",
        "SQLITE_USE_URI=1" # https://www.sqlite.org/uri.html
      ],
      # GYP flag scoping (make generator):
      #   cflags    -> C *and* C++ TUs
      #   cflags_c  -> C only (here: just the vendored SQLite amalgamation)
      #   cflags_cc -> C++ only (our first-party code)
      #
      # Hardening baseline follows the OpenSSF Compiler Options Hardening Guide.
      # Flag choices are pinned to our OLDEST shipped toolchain: the glibc
      # prebuild is built in node:20-bullseye (Debian 11, GCC 10.2), so
      # _FORTIFY_SOURCE=3 (needs GCC 12+) would silently degrade to =2 there --
      # we ask for =2 honestly instead. See doc/build-flags.md.
      "cflags": [
        "-fvisibility=hidden",
        "-fPIC",
        # Stack canary + libc/buffer misuse checks. FORTIFY is a no-op without
        # -O1+ (the Release build supplies -O3); -U first because many distros
        # predefine _FORTIFY_SOURCE and would otherwise warn on redefinition.
        "-fstack-protector-strong",
        "-U_FORTIFY_SOURCE",
        "-D_FORTIFY_SOURCE=2",
        # -Werror=format-security is not just inert without -Wformat: GCC 10
        # *errors* ("ignored without -Wformat"). Keep these three together.
        "-Wformat",
        "-Wformat=2",
        "-Werror=format-security"
      ],
      # -Wno-implicit-fallthrough: SQLite uses intentional switch fallthroughs.
      # Scoped to C so it can no longer mask an unannotated fallthrough in our
      # own C++ (it previously sat in "cflags" and applied to both).
      "cflags_c": [
        "-Wno-implicit-fallthrough"
      ],
      "cflags_cc": [
        "-fexceptions",
        "-fPIC",
        "-Wall",
        "-Wextra",
        "-fvisibility-inlines-hidden"
      ],
      "xcode_settings": {
        "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15",
        # macOS gets the portable subset only: Apple clang does not support
        # -fstack-clash-protection, and ld64 has no -Wl,-z,* equivalents (PIE,
        # ASLR and W^X are platform defaults there).
        "OTHER_CFLAGS": [
          "-fstack-protector-strong",
          "-U_FORTIFY_SOURCE",
          "-D_FORTIFY_SOURCE=2",
          "-Wformat",
          "-Wformat=2",
          "-Werror=format-security"
        ],
        "OTHER_CPLUSPLUSFLAGS": [
          # "$(inherited)" is LOAD-BEARING, not boilerplate. gyp appends
          # OTHER_CFLAGS only in GetCflagsC() -- i.e. to C TUs -- and C++ picks
          # it up solely by expanding $(inherited) here (xcode_emulation.py:
          # GetCflagsCC defaults OTHER_CPLUSPLUSFLAGS to ["$(inherited)"]).
          # Setting this key WITHOUT it silently drops every OTHER_CFLAGS
          # hardening flag above from our C++ objects, leaving only the vendored
          # sqlite3.c hardened -- and the resulting Mach-O still shows
          # __stack_chk/__memcpy_chk, so it looks fine unless you check the
          # actual C++ compile line. Do not remove.
          "$(inherited)",
          "-Wall",
          "-Wextra",
          # Node's common.gypi pairs -Wall/-Wextra with -Wno-unused-parameter on
          # POSIX; xcode_settings does not inherit that, and without it the
          # deliberately-unused params in src/shims/* warn on every mac build.
          "-Wno-unused-parameter",
          "-fvisibility-inlines-hidden"
        ]
      },
      "conditions": [
        [
          "OS=='linux'",
          {
            "cflags": [
              # Probe each stack page so a large frame cannot leap the guard
              # page. Verified available on the GCC 10.2 floor for x64 AND
              # arm64; not supported by Apple clang, hence Linux-only.
              "-fstack-clash-protection"
            ],
            # Avoid the ELF procedure linkage table for the many Node-API calls
            # made while materializing result rows. This keeps the stable
            # Node-API ABI while removing one indirection from each call.
            "cflags_cc": [
              "-fno-plt",
              # libstdc++ bounds/precondition assertions. The libc++ equivalent
              # would be _LIBCPP_HARDENING_MODE, which Apple clang does not yet
              # support, so macOS goes without.
              "-D_GLIBCXX_ASSERTIONS"
            ],
            "ldflags": [
              # Full RELRO (GOT mapped read-only after load) + non-executable
              # stack. GNU-ld/ELF only: macOS ld64 rejects -z, so these must
              # never escape this branch.
              "-Wl,-z,relro",
              "-Wl,-z,now",
              "-Wl,-z,noexecstack"
            ],
            "conditions": [
              [
                # Intel CET (endbr + shadow-stack marking). x86-only: GCC
                # hard-errors with "not supported for this target" on aarch64.
                "target_arch=='x64' or target_arch=='ia32'",
                {
                  "cflags": [
                    "-fcf-protection=full"
                  ]
                }
              ],
              [
                # AArch64 PAC return-signing + BTI. arm64-only: an unknown
                # option (build error) on x86.
                "target_arch=='arm64'",
                {
                  "cflags": [
                    "-mbranch-protection=standard"
                  ]
                }
              ]
            ]
          }
        ],
        [
          "OS=='win'",
          {
            "conditions": [
              [
                "target_arch=='x64'",
                {
                  "defines": [
                    "_M_X64",
                    "_WIN64"
                  ],
                  "msvs_settings": {
                    "VCCLCompilerTool": {
                      "WarningLevel": 4,
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
              ],
              [
                "target_arch=='arm64'",
                {
                  "defines": [
                    "_M_ARM64",
                    "_WIN64"
                  ],
                  "msvs_settings": {
                    "VCCLCompilerTool": {
                      "WarningLevel": 4,
                      "AdditionalOptions": [
                        # /Qspectre is NOT x64-only -- MSVC supports it on
                        # ARM/ARM64 since VS 2017 15.7 and ships Spectre-
                        # mitigated ARM64 libs. Omitting it here under-hardened
                        # the ARM64 build.
                        "/Qspectre",
                        # Forward-edge CFI (same flag on both arches).
                        "/guard:cf",
                        # Backward-edge CFI for ARM64: return-address signing
                        # (hardware PAC). This is the ARM64 counterpart to x64's
                        # /CETCOMPAT + /guard:ehcont, which are x64-only. Without
                        # it ARM64 had NO backward-edge protection -- /guard:cf
                        # is forward-edge only. Verified accepted by MSVC
                        # 19.44 (VS 2022) targeting ARM64.
                        "/guard:signret",
                        "/ZH:SHA_256",
                        "/sdl"
                      ],
                      "ExceptionHandling": 1,
                      "RuntimeTypeInfo": "true"
                    },
                    "VCLinkerTool": {
                      # No /CETCOMPAT here: CET shadow-stack is an Intel/AMD
                      # x64-only feature. ARM64's backward-edge protection comes
                      # from /guard:signret on the compiler side (above).
                      "AdditionalOptions": [
                        "/guard:cf",
                        "/DYNAMICBASE"
                      ]
                    }
                  }
                }
              ]
            ]
          }
        ]
      ]
    }
  ]
}
