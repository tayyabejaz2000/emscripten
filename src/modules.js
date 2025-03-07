/**
 * @license
 * Copyright 2011 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// "use strict";

// Various namespace-like modules

// Constructs an array ['a0', 'a1', 'a2', ..., 'a(n-1)']
function genArgSequence(n) {
  const args = [];
  for (let i = 0; i < n; ++i) {
    args.push('a' + i);
  }
  return args;
}

// List of symbols that were added from the library.
global.librarySymbols = [];

global.LibraryManager = {
  library: {},
  structs: {},
  loaded: false,
  libraries: [],

  has(name) {
    return this.libraries.includes(name);
  },

  load() {
    assert(!this.loaded);
    this.loaded = true;

    // Core system libraries (always linked against)
    let libraries = [
      'library_int53.js',
      'library.js',
      'library_sigs.js',
      'library_ccall.js',
      'library_addfunction.js',
      'library_formatString.js',
      'library_getvalue.js',
      'library_math.js',
      'library_path.js',
      'library_strings.js',
      'library_html5.js',
      'library_stack_trace.js',
      'library_wasi.js',
      'library_makeDynCall.js',
      'library_eventloop.js',
      'library_promise.js',
    ];

    if (LINK_AS_CXX) {
      if (DISABLE_EXCEPTION_THROWING && !WASM_EXCEPTIONS) {
        libraries.push('library_exceptions_stub.js');
      } else {
        libraries.push('library_exceptions.js');
      }
    }

    if (!MINIMAL_RUNTIME) {
      libraries.push('library_browser.js');
      libraries.push('library_wget.js');
    }

    if (EMSCRIPTEN_TRACING) {
      libraries.push('library_memoryprofiler.js');
    }

    if (AUTODEBUG) {
      libraries.push('library_autodebug.js');
    }

    if (!WASMFS) {
      libraries.push('library_syscall.js');
    }

    if (RELOCATABLE) {
      libraries.push('library_dylink.js');
    }

    if (FILESYSTEM) {
      libraries.push('library_fs_shared.js');
      if (WASMFS) {
        libraries = libraries.concat([
          'library_wasmfs.js',
          'library_wasmfs_js_file.js',
          'library_wasmfs_jsimpl.js',
          'library_wasmfs_fetch.js',
          'library_wasmfs_node.js',
          'library_wasmfs_opfs.js',
        ]);
      } else {
        // Core filesystem libraries (always linked against, unless -sFILESYSTEM=0 is specified)
        libraries = libraries.concat([
          'library_fs.js',
          'library_memfs.js',
          'library_tty.js',
          'library_pipefs.js', // ok to include it by default since it's only used if the syscall is used
          'library_sockfs.js', // ok to include it by default since it's only used if the syscall is used
        ]);

        if (NODERAWFS) {
          // NODERAWFS requires NODEFS
          if (!JS_LIBRARIES.includes('library_nodefs.js')) {
            libraries.push('library_nodefs.js');
          }
          libraries.push('library_noderawfs.js');
          // NODERAWFS overwrites library_path.js
          libraries.push('library_nodepath.js');
        }
      }
    }

    // Additional JS libraries (without AUTO_JS_LIBRARIES, link to these explicitly via -lxxx.js)
    if (AUTO_JS_LIBRARIES) {
      libraries = libraries.concat([
        'library_webgl.js',
        'library_html5_webgl.js',
        'library_openal.js',
        'library_glut.js',
        'library_xlib.js',
        'library_egl.js',
        'library_uuid.js',
        'library_glew.js',
        'library_idbstore.js',
        'library_async.js',
      ]);
      if (USE_SDL != 2) {
        libraries.push('library_sdl.js');
      }
    } else {
      if (ASYNCIFY) {
        libraries.push('library_async.js');
      }
      if (USE_SDL == 1) {
        libraries.push('library_sdl.js');
      }
      if (USE_SDL == 2) {
        libraries.push('library_egl.js', 'library_webgl.js', 'library_html5_webgl.js');
      }
    }

    if (USE_GLFW) {
      libraries.push('library_glfw.js');
    }

    if (LZ4) {
      libraries.push('library_lz4.js');
    }

    if (MAX_WEBGL_VERSION >= 2) {
      // library_webgl2.js must be included only after library_webgl.js, so if we are
      // about to include library_webgl2.js, first squeeze in library_webgl.js.
      libraries.push('library_webgl.js');
      libraries.push('library_webgl2.js');
    }

    if (GL_EXPLICIT_UNIFORM_LOCATION || GL_EXPLICIT_UNIFORM_BINDING) {
      libraries.push('library_c_preprocessor.js');
    }

    if (LEGACY_GL_EMULATION) {
      libraries.push('library_glemu.js');
    }

    if (USE_WEBGPU) {
      libraries.push('library_webgpu.js');
      libraries.push('library_html5_webgpu.js');
    }

    if (!STRICT) {
      libraries.push('library_legacy.js');
    }

    if (BOOTSTRAPPING_STRUCT_INFO) {
      libraries = [
        'library_bootstrap.js',
        'library_formatString.js',
        'library_strings.js',
        'library_int53.js',
      ];
    }

    if (SUPPORT_BIG_ENDIAN) {
      libraries.push('library_little_endian_heap.js');
    }

    // Add all user specified --js-library files to the link.
    // These must be added last after all Emscripten-provided system libraries
    // above, so that users can override built-in JS library symbols in their
    // own code.
    libraries = libraries.concat(JS_LIBRARIES);

    // Deduplicate libraries to avoid processing any library file multiple times
    libraries = libraries.filter((item, pos) => libraries.indexOf(item) == pos);

    // Save the list for has() queries later.
    this.libraries = libraries;

    for (const filename of libraries) {
      const isUserLibrary = nodePath.isAbsolute(filename);
      if (VERBOSE) {
        if (isUserLibrary) {
          printErr('processing user library: ' + filename);
        } else {
          printErr('processing system library: ' + filename);
        }
      }
      let origLibrary = undefined;
      let processed = undefined;
      // When we parse user libraries also set `__user` attribute
      // on each element so that we can distinguish them later.
      if (isUserLibrary) {
        origLibrary = this.library;
        this.library = new Proxy(this.library, {
          set(target, prop, value) {
            target[prop] = value;
            if (!isDecorator(prop)) {
              target[prop + '__user'] = true;
            }
            return true;
          },
        });
      }
      currentFile = filename;
      try {
        processed = processMacros(preprocess(filename));
        vm.runInThisContext(processed, { filename: filename.replace(/\.\w+$/, '.preprocessed$&') });
      } catch (e) {
        error(`failure to execute js library "${filename}":`);
        if (VERBOSE) {
          const orig = read(filename);
          if (processed) {
            error(`preprocessed source (you can run a js engine on this to get a clearer error message sometimes):\n=============\n${processed}\n=============`);
          } else {
            error(`original source:\n=============\n${orig}\n=============`);
          }
        } else {
          error('use -sVERBOSE to see more details');
        }
        throw e;
      } finally {
        currentFile = null;
        if (origLibrary) {
          this.library = origLibrary;
        }
      }
    }
  },
};

if (!BOOTSTRAPPING_STRUCT_INFO) {
  let structInfoFile = 'generated_struct_info32.json';
  if (MEMORY64) {
    structInfoFile = 'generated_struct_info64.json'
  }
  // Load struct and define information.
  const temp = JSON.parse(read(structInfoFile));
  C_STRUCTS = temp.structs;
  C_DEFINES = temp.defines;
} else {
  C_STRUCTS = {};
  C_DEFINES = {};
}

// Use proxy objects for C_DEFINES and C_STRUCTS so that we can give useful
// error messages.
C_STRUCTS = new Proxy(C_STRUCTS, {
  get(target, prop, receiver) {
    if (!(prop in target)) {
      throw new Error(`Missing C struct ${prop}! If you just added it to struct_info.json, you need to run ./tools/gen_struct_info.py`);
    }
    return target[prop]
  }
});

cDefs = C_DEFINES = new Proxy(C_DEFINES, {
  get(target, prop, receiver) {
    if (!(prop in target)) {
      throw new Error(`Missing C define ${prop}! If you just added it to struct_info.json, you need to run ./tools/gen_struct_info.py`);
    }
    return target[prop]
  }
});

// Legacy function that existed solely to give error message.  These are now
// provided by the cDefs proxy object above.
function cDefine(key) {
  return cDefs[key];
}

function isInternalSymbol(ident) {
  return ident + '__internal' in LibraryManager.library;
}

function getUnusedLibarySymbols() {
  const librarySymbolSet = new Set(librarySymbols);
  const missingSyms = new Set();
  for (const [ident, value] of Object.entries(LibraryManager.library)) {
    if (typeof value === 'function' || typeof value === 'number') {
      if (isJsOnlySymbol(ident) && !isDecorator(ident) && !isInternalSymbol(ident)) {
        const name = ident.substr(1);
        if (!librarySymbolSet.has(name)) {
          missingSyms.add(name);
        }
      }
    }
  }
  return missingSyms;
}

// When running with ASSERTIONS enabled we create stubs for each library
// function that that was not included in the build.  This gives useful errors
// when library dependencies are missing from `__deps` or depended on without
// being added to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE
// TODO(sbc): These errors could potentially be generated at build time via
// some kind of acorn pass that searched for uses of these missing symbols.
function addMissingLibraryStubs(unusedLibSymbols) {
  let rtn = '';
  rtn += 'var missingLibrarySymbols = [\n';
  for (const sym of unusedLibSymbols) {
    rtn += `  '${sym}',\n`;
  }
  rtn += '];\n';
  rtn += 'missingLibrarySymbols.forEach(missingLibrarySymbol)\n';
  return rtn;
}

// export parts of the JS runtime that the user asked for
function exportRuntime() {
  const EXPORTED_RUNTIME_METHODS_SET = new Set(EXPORTED_RUNTIME_METHODS);

  const legacyRuntimeElements = new Map([
    ['print', 'out'],
    ['printErr', 'err'],
  ]);

  // optionally export something.
  // in ASSERTIONS mode we show a useful error if it is used without
  // being exported. how we show the message depends on whether it's
  // a function (almost all of them) or a number.
  function maybeExport(name) {
    // if requested to be exported, export it
    if (EXPORTED_RUNTIME_METHODS_SET.has(name)) {
      let exported = name;
      // the exported name may differ from the internal name
      if (exported.startsWith('FS_')) {
        // this is a filesystem value, FS.x exported as FS_x
        exported = 'FS.' + exported.substr(3);
      } else if (legacyRuntimeElements.has(exported)) {
        exported = legacyRuntimeElements.get(exported);
      }
      return `Module['${name}'] = ${exported};`;
    }
  }

  // All possible runtime elements that can be exported
  let runtimeElements = [
    'run',
    'addOnPreRun',
    'addOnInit',
    'addOnPreMain',
    'addOnExit',
    'addOnPostRun',
    'addRunDependency',
    'removeRunDependency',
    'FS_createFolder',
    'FS_createPath',
    'FS_createLazyFile',
    'FS_createLink',
    'FS_createDevice',
    'FS_readFile',
    'out',
    'err',
    'callMain',
    'abort',
    'keepRuntimeAlive',
    'wasmMemory',
    'wasmTable',
    'wasmExports',
  ];

  // These are actually native wasm functions these days but we allow exporting
  // them via EXPORTED_RUNTIME_METHODS for backwards compat.
  runtimeElements = runtimeElements.concat(WASM_SYSTEM_EXPORTS);

  if (PTHREADS && ALLOW_MEMORY_GROWTH) {
    runtimeElements = runtimeElements.concat([
      'GROWABLE_HEAP_I8',
      'GROWABLE_HEAP_U8',
      'GROWABLE_HEAP_I16',
      'GROWABLE_HEAP_U16',
      'GROWABLE_HEAP_I32',
      'GROWABLE_HEAP_U32',
      'GROWABLE_HEAP_F32',
      'GROWABLE_HEAP_F64',
    ]);
  }
  if (USE_OFFSET_CONVERTER) {
    runtimeElements.push('WasmOffsetConverter');
  }

  if (LOAD_SOURCE_MAP) {
    runtimeElements.push('WasmSourceMap');
  }

  if (STACK_OVERFLOW_CHECK) {
    runtimeElements.push('writeStackCookie');
    runtimeElements.push('checkStackCookie');
  }

  if (SUPPORT_BASE64_EMBEDDING) {
    runtimeElements.push('intArrayFromBase64');
    runtimeElements.push('tryParseAsDataURI');
  }

  if (RETAIN_COMPILER_SETTINGS) {
    runtimeElements.push('getCompilerSetting')
  }

  if (RUNTIME_DEBUG) {
    runtimeElements.push('prettyPrint')
  }

  // dynCall_* methods are not hardcoded here, as they
  // depend on the file being compiled. check for them
  // and add them.
  for (const name of EXPORTED_RUNTIME_METHODS_SET) {
    if (/^dynCall_/.test(name)) {
      // a specific dynCall; add to the list
      runtimeElements.push(name);
    }
  }

  // Only export legacy runtime elements when explicitly
  // requested.
  for (const name of EXPORTED_RUNTIME_METHODS_SET) {
    if (legacyRuntimeElements.has(name)) {
      const newName = legacyRuntimeElements.get(name);
      warn(`deprecated item in EXPORTED_RUNTIME_METHODS: ${name} use ${newName} instead.`);
      runtimeElements.push(name);
    }
  }

  // Add JS library elements such as FS, GL, ENV, etc. These are prefixed with
  // '$ which indicates they are JS methods.
  let runtimeElementsSet = new Set(runtimeElements);
  for (const ident of Object.keys(LibraryManager.library)) {
    if (isJsOnlySymbol(ident) && !isDecorator(ident) && !isInternalSymbol(ident)) {
      const jsname = ident.substr(1);
      // Note that this assertion may be hit when a function is moved into the
      // JS library. In that case the function should be removed from the list
      // of runtime elements above.
      assert(!runtimeElementsSet.has(jsname), 'runtimeElements contains library symbol: ' + ident);
      runtimeElements.push(jsname);
    }
  }

  // check all exported things exist, warn about typos
  runtimeElementsSet = new Set(runtimeElements);
  for (const name of EXPORTED_RUNTIME_METHODS_SET) {
    if (!runtimeElementsSet.has(name)) {
      warn(`invalid item in EXPORTED_RUNTIME_METHODS: ${name}`);
    }
  }

  const exports = runtimeElements.map(maybeExport);
  const results = exports.filter((name) => name);

  if (ASSERTIONS && !EXPORT_ALL) {
    const unusedLibSymbols = getUnusedLibarySymbols();
    if (unusedLibSymbols.size) {
      results.push(addMissingLibraryStubs(unusedLibSymbols));
    }

    const unexported = [];
    for (const name of runtimeElements) {
      if (!EXPORTED_RUNTIME_METHODS_SET.has(name) && !unusedLibSymbols.has(name)) {
        unexported.push(name);
      }
    }

    if (unexported.length || unusedLibSymbols.size) {
      let unexportedStubs = 'var unexportedSymbols = [\n';
      for (const sym of unexported) {
        unexportedStubs += `  '${sym}',\n`;
      }
      unexportedStubs += '];\n';
      unexportedStubs += 'unexportedSymbols.forEach(unexportedRuntimeSymbol);\n';
      results.push(unexportedStubs);
    }
  }

  return results.join('\n') + '\n';
}
