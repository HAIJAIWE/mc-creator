{
  "variables": {
    "//": "msvs_settings 而非 cflags_cc：gyp 不会把 cflags_cc 传给 MSVC（实测 /EHsc 与 /utf-8 都被静默丢弃，前者导致 C4530 异常展开警告）。node-pty 的 binding.gyp 用的是同一套 msvs_settings，仓内已验证。/EHsc 是必需的：本模块靠 ThrowAsJavaScriptException 抛错，缺展开语义会让异常路径行为不可靠。/utf-8 则是为了将来若要改回中文注释而留的保险（当前 src/binding.cc 刻意纯 ASCII，原因见该文件头部）。"
  },
  "targets": [
    {
      "target_name": "jobobject",
      "sources": ["src/binding.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "libraries": ["-lkernel32"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17", "/utf-8", "/W3", "/wd4996"]
        }
      }
    }
  ]
}
