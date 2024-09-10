const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Helper to parse .env files
function parseDotenvFile(filePath, verbose = false) {
  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch (error) {
    if (verbose) {
      console.error('react-native-dotenv', error);
    }
    return {};
  }
  return dotenv.parse(content);
}

// Helper to assign non-undefined values from sourceObject to targetObject
function undefObjectAssign(targetObject, sourceObject) {
  const keys = Object.keys(sourceObject);
  keys.forEach((key) => {
    if (sourceObject[key]) {
      targetObject[key] = sourceObject[key];
    }
  });
  return targetObject;
}

// Modified function to handle whitelisting/blocklisting
function safeObjectAssign(targetObject, sourceObject, allowlist = [], blocklist = []) {
  const keys = Object.keys(sourceObject);
  keys.forEach((key) => {
    if (blocklist.includes(key)) {
      return;  // Skip if key is in blocklist
    }
    if (allowlist.length === 0 || allowlist.includes(key)) {
      targetObject[key] = sourceObject[key];
    }
  });
  return targetObject;
}

// Main plugin export
module.exports = (api, options) => {
  const t = api.types;
  let env = {};
  options = {
    envName: 'APP_ENV',
    moduleName: '@env',
    path: '.env',
    allowlist: null,  // New option to explicitly allow only certain vars
    blocklist: null,  // Option to block certain vars
    safe: false,
    allowUndefined: true,
    verbose: false,
    ...options,
  };

  // Define the mode for the environment
  const babelMode = process.env[options.envName] || process.env.BABEL_ENV || process.env.NODE_ENV || 'development';
  const localFilePath = options.path + '.local';
  const modeFilePath = options.path + '.' + babelMode;
  const modeLocalFilePath = options.path + '.' + babelMode + '.local';

  if (options.verbose) {
    console.log('dotenvMode', babelMode);
  }

  // Helper to get the file modification time
  function mtime(filePath) {
    try {
      return fs.statSync(filePath).mtimeMs; // Returns the modification time in milliseconds
    } catch {
      return null; // If the file doesn't exist, return null
    }
  }

  // Cache the file modification times
  api.cache.using(() => mtime(options.path));
  api.cache.using(() => mtime(modeFilePath));
  api.cache.using(() => mtime(localFilePath));
  api.cache.using(() => mtime(modeLocalFilePath));

  // Parse the various .env files
  const parsed = parseDotenvFile(options.path, options.verbose);
  const localParsed = parseDotenvFile(localFilePath, options.verbose);
  const modeParsed = parseDotenvFile(modeFilePath, options.verbose);
  const modeLocalParsed = parseDotenvFile(modeLocalFilePath, options.verbose);
  const blocklist = [...(options.blocklist || []), 'EXPO_PUBLIC_', 'EXPO_'];

  // Combine the parsed env variables, honoring whitelisting/blocklisting
  env = options.safe
    ? safeObjectAssign(
        undefObjectAssign(parsed, modeParsed),
        process.env,
        options.allowlist, 
        blocklist  // Default block Expo env variables
      )
    : undefObjectAssign(undefObjectAssign(parsed, modeParsed), process.env);

  // Add external dependencies for caching purposes
  api.addExternalDependency(path.resolve(options.path));
  api.addExternalDependency(path.resolve(modeFilePath));
  api.addExternalDependency(path.resolve(localFilePath));
  api.addExternalDependency(path.resolve(modeLocalFilePath));

  return {
    name: 'dotenv-import',
    visitor: {
      ImportDeclaration(path) {
        if (path.node.source.value === options.moduleName) {
          path.node.specifiers.forEach((specifier, index) => {
            const importedId = specifier.imported.name;
            const localId = specifier.local.name;

            if (
              Array.isArray(options.allowlist) && !options.allowlist.includes(importedId) ||
              Array.isArray(options.blocklist) && options.blocklist.includes(importedId)
            ) {
              throw path.get('specifiers')[index].buildCodeFrameError(`"${importedId}" is not allowed or is blocked.`);
            }

            if (!options.allowUndefined && !Object.hasOwn(env, importedId)) {
              throw path.get('specifiers')[index].buildCodeFrameError(`"${importedId}" is not defined in ${options.path}`);
            }

            const binding = path.scope.getBinding(localId);
            binding.referencePaths.forEach((referencePath) => {
              referencePath.replaceWith(t.valueToNode(env[importedId]));
            });
          });
          path.remove();
        }
      },
    },
  };
};
