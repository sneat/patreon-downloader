const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  // Vendored third-party libraries are not ours to lint.
  {
    ignores: ["src/js/bootstrap.bundle.min.js", "src/js/*.min.map", "src/css/**", "src/fflate/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // The export guard in utils.js; absent in the browser.
        module: "readonly",
        // Provided by the bundled fflate library.
        Zip: "readonly",
        ZipDeflate: "readonly",
        AsyncZipDeflate: "readonly",
        ZipPassThrough: "readonly",
        strToU8: "readonly",
      },
    },
  },
  {
    // Cross-file symbols are globals only in the scripts that consume them,
    // so the files that define them aren't flagged as redeclaring a global.
    files: ["src/contentScript.js", "src/js/popup.js"],
    languageOptions: {
      globals: {
        Compressor: "readonly",
        Downloader: "readonly",
        makeUniqueFilename: "readonly",
        escapeHtml: "readonly",
        contentJsonToHtml: "readonly",
        formatLocalDateTime: "readonly",
        HumanFileSize: "readonly",
        slugify: "readonly",
        getPatreonMediaDownloadCandidates: "readonly",
        isDuplicatePatreonPostImage: "readonly",
        decodeFilenameSafely: "readonly",
      },
    },
  },
  {
    files: ["src/background.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        findOrphanedTabKeys: "readonly",
      },
    },
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
];
