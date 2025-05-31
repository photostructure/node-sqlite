{
  "targets": [
    {
      "target_name": "test_extension",
      "type": "shared_library",
      "sources": ["test_extension.c"],
      "include_dirs": [
        "../../../src/upstream"
      ],
      "defines": [],
      "conditions": [
        ['OS=="mac"', {
          "link_settings": {
            "libraries": ["-undefined dynamic_lookup"]
          },
          "xcode_settings": {
            "OTHER_LDFLAGS": ["-undefined dynamic_lookup"]
          }
        }],
        ['OS=="win"', {
          "defines": ["SQLITE_API=__declspec(dllimport)"]
        }],
        ['OS=="linux"', {
          "cflags": ["-fPIC"]
        }]
      ]
    }
  ]
}