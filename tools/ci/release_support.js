// AUT-073: pure, dependency-free helpers for the Android release build and its safety checks.
//
// Everything here is deterministic and testable without Cocos / Gradle / a device: release configuration resolution,
// version identity, signing-input classification, AdMob ID classification, ZIP + ELF (16 KB) inspection, the
// AndroidManifest decoders (AAB proto format and `aapt2 dump xmltree` text), the R8 mapping check and the release-safety
// evaluation. Secrets (store password / key password) are never read into any returned value or message.

const zlib = require('node:zlib');

const REQUIRED_TARGET_SDK = 36;
/** minSdk recorded from the pinned dependencies (see docs/AUT-073): build_android.js enforces this exact value in gradle.properties. */
const RECORDED_MIN_SDK = 23;
const DEFAULT_PACKAGE_NAME = 'com.projectautomata.androidbaseline';
const DEFAULT_GAME_VERSION = '0.1.0-dev';
const SAMPLE_ADMOB_PUBLISHER = 'ca-app-pub-3940256099942544';
const ADMOB_APP_ID_PATTERN = /^ca-app-pub-\d{16}~\d{10}$/u;
const ADMOB_UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/u;
const MAX_VERSION_CODE = 2100000000;
const PAGE_SIZE_16KB = 16384;

const ADMOB_ENV_NAMES = ['ADMOB_APP_ID', 'ADMOB_UNIT_OFFLINE_DOUBLE', 'ADMOB_UNIT_EXTENDED_OVERCLOCK'];
const ADMOB_META_KEYS = {
  ADMOB_APP_ID: 'com.google.android.gms.ads.APPLICATION_ID',
  ADMOB_UNIT_OFFLINE_DOUBLE: 'com.projectautomata.ads.unit.offline_double',
  ADMOB_UNIT_EXTENDED_OVERCLOCK: 'com.projectautomata.ads.unit.extended_overclock',
};

// ------------------------------------------------------------------ identity / configuration

/** Android application id: at least two dot-separated segments, each starting with a letter. */
function isValidPackageName(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/u.test(value) && value.length <= 150;
}

function resolvePackageName(env) {
  const value = (env.AUTOMATA_PACKAGE_NAME || '').trim() || DEFAULT_PACKAGE_NAME;
  if (!isValidPackageName(value)) throw new Error(`AUTOMATA_PACKAGE_NAME is not a valid Android application id: ${value}`);
  return value;
}

/**
 * versionName = AUTOMATA_GAME_VERSION (same validation as write_build_info.js) or the BuildInfo default;
 * versionCode = AUTOMATA_VERSION_CODE override or the git commit-count build number (AUT-072).
 */
function resolveVersionIdentity(env, identity) {
  const versionName = (env.AUTOMATA_GAME_VERSION || '').trim() || DEFAULT_GAME_VERSION;
  if (!/^[0-9A-Za-z._+-]{1,40}$/u.test(versionName)) throw new Error(`invalid game version: ${versionName}`);
  const override = (env.AUTOMATA_VERSION_CODE || '').trim();
  let versionCode;
  let source;
  if (override) {
    if (!/^\d+$/u.test(override)) throw new Error(`AUTOMATA_VERSION_CODE must be a positive integer: ${override}`);
    versionCode = Number.parseInt(override, 10);
    source = 'AUTOMATA_VERSION_CODE';
  } else {
    versionCode = identity.buildNumber;
    source = 'git-commit-count';
  }
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) {
    throw new Error(`versionCode ${versionCode} is out of range 1..${MAX_VERSION_CODE} (source ${source}; git history unavailable? set AUTOMATA_VERSION_CODE)`);
  }
  return { versionName, versionCode, source };
}

/** Classifies one AdMob value. */
function classifyAdmobId(value, kind) {
  const text = (value || '').trim();
  if (!text) return 'empty';
  const pattern = kind === 'app' ? ADMOB_APP_ID_PATTERN : ADMOB_UNIT_ID_PATTERN;
  if (!pattern.test(text)) return 'invalid';
  return text.startsWith(SAMPLE_ADMOB_PUBLISHER) ? 'sample' : 'production';
}

/** Per-ID classification of a `{ADMOB_APP_ID, ADMOB_UNIT_*}` map. */
function classifyAdmobValues(values) {
  const result = {};
  for (const name of ADMOB_ENV_NAMES) result[name] = classifyAdmobId(values[name], name === 'ADMOB_APP_ID' ? 'app' : 'unit');
  return result;
}

/**
 * Decides whether the AdMob configuration may be built. `classes` is classifyAdmobValues().
 * Returns { ok, adsMode: 'production' | 'not-configured' | 'sample', problems[] }.
 */
function evaluateAdmobPolicy(classes, flags) {
  const values = Object.values(classes);
  const problems = [];
  const sample = values.includes('sample');
  const invalid = values.includes('invalid');
  const allProduction = values.every((value) => value === 'production');
  const allEmpty = values.every((value) => value === 'empty');
  if (invalid) problems.push('an ADMOB_* value is not a valid AdMob id');
  if (sample && !flags.allowSampleIds) problems.push('a release build must not carry Google sample AdMob ids (pass --allow-sample-ids only for a local proof)');
  if (flags.requireProductionIds && !allProduction) problems.push('--require-production-ids: ADMOB_APP_ID, ADMOB_UNIT_OFFLINE_DOUBLE and ADMOB_UNIT_EXTENDED_OVERCLOCK must all be production ids');
  const partial = !allProduction && !allEmpty && !sample && !invalid;
  if (partial) problems.push('ADMOB_* ids are partially configured: supply all three or none');
  let adsMode = 'not-configured';
  if (allProduction) adsMode = 'production';
  else if (sample) adsMode = 'sample';
  return { ok: problems.length === 0, adsMode, problems };
}

/** Signing inputs come only from the environment. Returns { state: 'configured' | 'unsigned' | 'incomplete', missing[] } (never the values). */
function classifySigningInputs(env, fileExists) {
  const names = ['RELEASE_STORE_FILE', 'RELEASE_STORE_PASSWORD', 'RELEASE_KEY_ALIAS', 'RELEASE_KEY_PASSWORD'];
  const present = names.filter((name) => (env[name] || '').length > 0);
  if (present.length === 0) return { state: 'unsigned', missing: [], problems: [] };
  const missing = names.filter((name) => !present.includes(name));
  const problems = [];
  if (missing.length) problems.push(`incomplete signing inputs, missing: ${missing.join(', ')}`);
  const storeFile = env.RELEASE_STORE_FILE || '';
  if (storeFile) {
    const normalized = storeFile.replace(/\\/gu, '/').toLowerCase();
    if (normalized.endsWith('/keystore/debug.keystore') || (env.RELEASE_KEY_ALIAS || '') === 'debug_keystore') problems.push('RELEASE_STORE_FILE points at the Cocos debug keystore; supply an upload keystore');
    else if (!fileExists(storeFile)) problems.push('RELEASE_STORE_FILE does not exist');
  }
  return { state: problems.length ? 'incomplete' : 'configured', missing, problems };
}

/** Resolved Cocos config for a release build: package id, SDK/NDK/Java paths; keystore fields stay empty (signing is Gradle/env only). */
function resolveReleaseCocosConfig(baseConfig, options) {
  const config = JSON.parse(JSON.stringify(baseConfig));
  config.packages = config.packages || {};
  config.packages.android = config.packages.android || {};
  const android = config.packages.android;
  android.packageName = options.packageName;
  android.sdkPath = options.sdkPath;
  android.ndkPath = options.ndkPath;
  android.javaHome = options.javaHome;
  android.javaPath = options.javaPath;
  android.useDebugKeystore = false;
  android.keystorePath = '';
  android.keystorePassword = '';
  android.keystoreAlias = '';
  android.keystoreAliasPassword = '';
  return config;
}

/** Static validation of the tracked release config (used by tests and the check script). */
function validateReleaseConfigShape(config) {
  const problems = [];
  if (config.debug !== false) problems.push('debug must be false');
  if (config.platform !== 'android') problems.push('platform must be android');
  if (config.startScene !== 'b0330000-0000-4000-8000-000000000010') problems.push('startScene must be FactoryWorld');
  if (!Array.isArray(config.scenes) || config.scenes.length !== 1 || config.scenes[0].uuid !== config.startScene) problems.push('scenes must contain only FactoryWorld');
  const android = config.packages?.android || {};
  if (android.apiLevel !== REQUIRED_TARGET_SDK) problems.push(`apiLevel must be ${REQUIRED_TARGET_SDK}`);
  if (!Array.isArray(android.appABIs) || android.appABIs.length !== 1 || android.appABIs[0] !== 'arm64-v8a') problems.push('appABIs must be [arm64-v8a]');
  if (android.useDebugKeystore !== false) problems.push('useDebugKeystore must be false');
  for (const field of ['keystorePath', 'keystorePassword', 'keystoreAlias', 'keystoreAliasPassword']) {
    if (android[field]) problems.push(`${field} must stay empty (signing is injected via env only)`);
  }
  if (!isValidPackageName(android.packageName)) problems.push('packageName must be a valid application id');
  return problems;
}

/** versionCode must strictly increase between different commits; the same commit may be rebuilt with the same code. */
function checkVersionCodeMonotonic(current, previous) {
  if (!previous) return { ok: true, note: 'no previous versionCode recorded (set AUTOMATA_PREVIOUS_VERSION_CODE to the last uploaded code to enforce)' };
  if (current.versionCode > previous.versionCode) return { ok: true, note: `greater than previous ${previous.versionCode}` };
  if (current.versionCode === previous.versionCode && previous.gitSha && previous.gitSha === current.gitSha) return { ok: true, note: `same commit rebuilt (${previous.versionCode})` };
  return { ok: false, note: `versionCode ${current.versionCode} is not greater than previous ${previous.versionCode}` };
}

// ------------------------------------------------------------------ ZIP / ELF

function findEndOfCentralDirectory(zipBuffer) {
  const minOffset = Math.max(0, zipBuffer.length - 0xffff - 22);
  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Could not find ZIP central directory.');
}

function readZipEntries(zipBuffer) {
  const eocdOffset = findEndOfCentralDirectory(zipBuffer);
  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  let offset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP central directory is malformed.');
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    entries.push({
      name: zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      method: zipBuffer.readUInt16LE(offset + 10),
      compressedSize: zipBuffer.readUInt32LE(offset + 20),
      uncompressedSize: zipBuffer.readUInt32LE(offset + 24),
      localHeaderOffset: zipBuffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function extractZipEntry(zipBuffer, entry) {
  const offset = entry.localHeaderOffset;
  if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`ZIP local header is malformed for ${entry.name}.`);
  const dataOffset = offset + 30 + zipBuffer.readUInt16LE(offset + 26) + zipBuffer.readUInt16LE(offset + 28);
  const compressed = zipBuffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
}

function readUInt(buffer, offset, size, littleEndian) {
  if (size === 2) return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  if (size === 4) return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (size === 8) {
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`ELF integer at offset ${offset} is too large to inspect safely.`);
    return Number(value);
  }
  throw new Error(`Unsupported integer size ${size}.`);
}

/** PT_LOAD p_align values of an ELF image. */
function getLoadSegmentAlignments(elfBuffer, entryName) {
  if (elfBuffer.length < 64 || elfBuffer[0] !== 0x7f || elfBuffer[1] !== 0x45 || elfBuffer[2] !== 0x4c || elfBuffer[3] !== 0x46) throw new Error(`${entryName} is not an ELF file.`);
  const elfClass = elfBuffer[4];
  const elfData = elfBuffer[5];
  const littleEndian = elfData === 1;
  if (!littleEndian && elfData !== 2) throw new Error(`${entryName} has unsupported ELF data encoding ${elfData}.`);
  const isElf64 = elfClass === 2;
  if (!isElf64 && elfClass !== 1) throw new Error(`${entryName} has unsupported ELF class ${elfClass}.`);
  const phoff = isElf64 ? readUInt(elfBuffer, 32, 8, littleEndian) : readUInt(elfBuffer, 28, 4, littleEndian);
  const phentsize = readUInt(elfBuffer, isElf64 ? 54 : 42, 2, littleEndian);
  const phnum = readUInt(elfBuffer, isElf64 ? 56 : 44, 2, littleEndian);
  const minPhentsize = isElf64 ? 56 : 32;
  if (phentsize < minPhentsize) throw new Error(`${entryName} has invalid ELF program-header entry size ${phentsize}.`);
  const alignments = [];
  for (let index = 0; index < phnum; index += 1) {
    const headerOffset = phoff + (index * phentsize);
    if (headerOffset + minPhentsize > elfBuffer.length) throw new Error(`${entryName} has a program header outside the file.`);
    if (readUInt(elfBuffer, headerOffset, 4, littleEndian) === 1) {
      alignments.push(readUInt(elfBuffer, isElf64 ? headerOffset + 48 : headerOffset + 28, isElf64 ? 8 : 4, littleEndian));
    }
  }
  return alignments;
}

/**
 * 16 KB page-size check of every arm64-v8a native library in an APK (`lib/arm64-v8a/x.so`) or AAB (`base/lib/arm64-v8a/x.so`).
 * Returns { libraries: [{name, alignments}], violations: [string] }.
 */
function check16KbAlignment(zipBuffer) {
  const entries = readZipEntries(zipBuffer).filter((entry) => /^(?:base\/)?lib\/arm64-v8a\/.+\.so$/u.test(entry.name));
  const libraries = [];
  const violations = [];
  if (entries.length === 0) violations.push('no arm64-v8a native libraries were found');
  for (const entry of entries) {
    const extracted = extractZipEntry(zipBuffer, entry);
    if (extracted.length !== entry.uncompressedSize) throw new Error(`Extracted ${entry.name} size ${extracted.length}; expected ${entry.uncompressedSize}.`);
    const alignments = getLoadSegmentAlignments(extracted, entry.name);
    libraries.push({ name: entry.name, alignments });
    if (alignments.length === 0) violations.push(`${entry.name}: no LOAD segments`);
    for (const align of alignments) {
      if (align < PAGE_SIZE_16KB) violations.push(`${entry.name}: LOAD alignment 0x${align.toString(16)} < 0x4000`);
    }
  }
  return { libraries, violations };
}

/** ABIs present in an APK/AAB. */
function listNativeAbis(entries) {
  const abis = new Set();
  for (const entry of entries) {
    const match = /^(?:base\/)?lib\/([^/]+)\/.+\.so$/u.exec(entry.name);
    if (match) abis.add(match[1]);
  }
  return [...abis].sort();
}

/** JAR/v1 signature files (AAB signing) or v2/v3 block presence for an APK is verified separately by apksigner. */
function hasJarSignature(entries) {
  return entries.some((entry) => /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/u.test(entry.name));
}

// ------------------------------------------------------------------ manifest decoding

function readVarint(buffer, state) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (state.offset >= buffer.length) throw new Error('truncated protobuf varint');
    const byte = buffer[state.offset];
    state.offset += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7n;
  }
}

/** Minimal protobuf reader: returns [{field, wire, value(BigInt|Buffer)}]. */
function readProtoFields(buffer) {
  const state = { offset: 0 };
  const fields = [];
  while (state.offset < buffer.length) {
    const key = Number(readVarint(buffer, state));
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) fields.push({ field, wire, value: readVarint(buffer, state) });
    else if (wire === 2) {
      const length = Number(readVarint(buffer, state));
      if (state.offset + length > buffer.length) throw new Error('truncated protobuf field');
      fields.push({ field, wire, value: buffer.subarray(state.offset, state.offset + length) });
      state.offset += length;
    } else if (wire === 5) {
      fields.push({ field, wire, value: buffer.subarray(state.offset, state.offset + 4) });
      state.offset += 4;
    } else if (wire === 1) {
      fields.push({ field, wire, value: buffer.subarray(state.offset, state.offset + 8) });
      state.offset += 8;
    } else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
  return fields;
}

function protoItemToString(itemBuffer) {
  for (const field of readProtoFields(itemBuffer)) {
    if (field.field === 3 && field.wire === 2) { // raw_str { value = 1 }
      const inner = readProtoFields(field.value).find((candidate) => candidate.field === 1);
      return inner ? inner.value.toString('utf8') : '';
    }
    if (field.field === 2 && field.wire === 2) { // str { value = 1 }
      const inner = readProtoFields(field.value).find((candidate) => candidate.field === 1);
      return inner ? inner.value.toString('utf8') : '';
    }
    if (field.field === 7 && field.wire === 2) { // prim
      for (const prim of readProtoFields(field.value)) {
        if (prim.field === 6) return String(BigInt.asIntN(32, prim.value)); // int_decimal_value
        if (prim.field === 7) return String(BigInt.asUintN(32, prim.value)); // int_hexadecimal_value
        if (prim.field === 8) return prim.value === 1n ? 'true' : 'false'; // boolean_value
      }
    }
  }
  return '';
}

function protoNodeToTree(nodeBuffer) {
  const element = readProtoFields(nodeBuffer).find((field) => field.field === 1 && field.wire === 2);
  if (!element) return null;
  const tree = { name: '', attrs: {}, children: [] };
  for (const field of readProtoFields(element.value)) {
    if (field.field === 3 && field.wire === 2) tree.name = field.value.toString('utf8');
    else if (field.field === 4 && field.wire === 2) {
      let name = '';
      let value = '';
      let compiled = '';
      for (const attributeField of readProtoFields(field.value)) {
        if (attributeField.field === 2 && attributeField.wire === 2) name = attributeField.value.toString('utf8');
        else if (attributeField.field === 3 && attributeField.wire === 2) value = attributeField.value.toString('utf8');
        else if (attributeField.field === 6 && attributeField.wire === 2) compiled = protoItemToString(attributeField.value);
      }
      if (name) tree.attrs[name] = value !== '' ? value : compiled;
    } else if (field.field === 5 && field.wire === 2) {
      const child = protoNodeToTree(field.value);
      if (child) tree.children.push(child);
    }
  }
  return tree;
}

/** Decodes `base/manifest/AndroidManifest.xml` of an AAB (aapt2 proto XmlNode) into { name, attrs, children } (android: prefix dropped). */
function decodeProtoManifest(buffer) {
  const tree = protoNodeToTree(buffer);
  if (!tree) throw new Error('manifest protobuf has no root element');
  return tree;
}

/** Parses the text of `aapt2 dump xmltree <apk> --file AndroidManifest.xml` into the same tree. */
function parseXmlTreeText(text) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const rawLine of text.replace(/\r\n/gu, '\n').split('\n')) {
    const match = /^(\s*)([NEA]): (.*)$/u.exec(rawLine);
    if (!match) continue;
    const indent = match[1].length;
    const kind = match[2];
    const rest = match[3];
    if (kind === 'E') {
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      const node = { name: /^([^\s(]+)/u.exec(rest)[1], attrs: {}, children: [] };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ indent, node });
    } else if (kind === 'A') {
      const attr = /^(?:https?:\/\/schemas\.android\.com\/apk\/res\/android:|android:)?([A-Za-z0-9_.:-]+?)(?:\(0x[0-9a-fA-F]+\))?=(.*)$/u.exec(rest);
      if (!attr || stack.length < 2) continue;
      let value = attr[2].replace(/\s+\(Raw: .*\)$/u, '').trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (/^\(type 0x12\)0x0$/u.test(value)) value = 'false';
      else if (/^\(type 0x12\)0x[0-9a-fA-F]+$/u.test(value)) value = 'true';
      stack[stack.length - 1].node.attrs[attr[1]] = value;
    }
  }
  return root.children[0] || null;
}

function findNodes(tree, name) {
  const found = [];
  const visit = (node) => {
    if (node.name === name) found.push(node);
    node.children.forEach(visit);
  };
  visit(tree);
  return found;
}

function attr(node, name) {
  if (!node) return undefined;
  return node.attrs[name] ?? node.attrs[`android:${name}`];
}

/** Flat facts from a decoded manifest tree. */
function summarizeManifest(tree) {
  const sdk = findNodes(tree, 'uses-sdk')[0];
  const application = findNodes(tree, 'application')[0];
  const metaData = {};
  for (const node of findNodes(tree, 'meta-data')) {
    const name = attr(node, 'name');
    if (name !== undefined) metaData[name] = attr(node, 'value') ?? '';
  }
  const int = (value) => (value !== undefined && /^-?\d+$/u.test(value) ? Number.parseInt(value, 10) : undefined);
  return {
    packageName: tree.attrs.package ?? attr(tree, 'package'),
    versionCode: int(attr(tree, 'versionCode')),
    versionName: attr(tree, 'versionName'),
    minSdk: int(attr(sdk, 'minSdkVersion')),
    targetSdk: int(attr(sdk, 'targetSdkVersion')),
    debuggable: attr(application, 'debuggable') === 'true',
    usesCleartextTraffic: attr(application, 'usesCleartextTraffic') === 'true',
    allowBackup: attr(application, 'allowBackup') !== 'false',
    metaData,
    permissions: findNodes(tree, 'uses-permission').map((node) => attr(node, 'name')).filter(Boolean).sort(),
  };
}

// ------------------------------------------------------------------ R8 / ProGuard

/** Public static method names declared in AutomataPlatformBridge.java (the JNI-by-name surface called from JS). */
function listBridgeEntryPoints(javaSource) {
  const names = new Set();
  for (const match of javaSource.matchAll(/^\s*public\s+static\s+(?:final\s+)?[\w<>[\].]+\s+(\w+)\s*\(/gmu)) names.add(match[1]);
  return [...names].sort();
}

/** Verifies that R8's mapping.txt kept the bridge class and each entry point under its original name. */
function checkR8MappingKeepsBridge(mappingText, entryPoints, className = 'com.cocos.game.AutomataPlatformBridge') {
  const problems = [];
  const lines = mappingText.replace(/\r\n/gu, '\n').split('\n');
  const classIndex = lines.findIndex((line) => line.startsWith(`${className} -> `));
  if (classIndex < 0) return { ok: false, problems: [`${className} is missing from mapping.txt`], keptMethods: [] };
  const target = /^\S+ -> (\S+):$/u.exec(lines[classIndex]);
  if (!target || target[1] !== className) problems.push(`${className} was renamed${target ? ` to ${target[1]}` : ''}`);
  const keptMethods = [];
  const mapped = new Map();
  // R8 mapping files interleave `# {...}` metadata comments (sourceFile, ...) with the indented member lines: skip them, stop at the next class entry.
  for (let index = classIndex + 1; index < lines.length && (lines[index].startsWith(' ') || lines[index].startsWith('#')); index += 1) {
    const method = /^\s+(?:\d+:\d+:)?[\w$.<>[\]]+ (\w+)\(.*\)(?::\d+:\d+)? -> (\w+)$/u.exec(lines[index]);
    if (method) mapped.set(method[1], method[2]);
  }
  for (const entry of entryPoints) {
    if (!mapped.has(entry)) problems.push(`${className}.${entry} is missing from mapping.txt (removed or inlined)`);
    else if (mapped.get(entry) !== entry) problems.push(`${className}.${entry} was renamed to ${mapped.get(entry)}`);
    else keptMethods.push(entry);
  }
  return { ok: problems.length === 0, problems, keptMethods };
}

// ------------------------------------------------------------------ release safety evaluation

const LOCAL_ENDPOINT_PATTERN = /\b(?:localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0)\b|\b192\.168\.\d{1,3}\.\d{1,3}\b/u;
const FORBIDDEN_PACKED_FILES = [/(^|\/)debug_(?:command|ads|billing)[^/]*\.json$/u, /\.(?:keystore|jks|p12)$/u, /(^|\/)\.env(?:\.|$)/u, /(^|\/)local\.properties$/u];

/** First local/test endpoint in a text, or ''. */
function findLocalEndpoint(text) {
  const match = LOCAL_ENDPOINT_PATTERN.exec(text);
  return match ? match[0] : '';
}

function findForbiddenPackedFiles(entryNames) {
  return entryNames.filter((name) => FORBIDDEN_PACKED_FILES.some((pattern) => pattern.test(name)));
}

/**
 * Evaluates a manifest summary against the release expectations. Returns [{ id, status: PASS|FAIL|WARN|INFO, message }].
 * expectations: { packageName, versionCode, versionName?, targetSdk, minSdk, requireProductionIds, allowSampleIds }.
 */
function evaluateManifestSafety(summary, expectations) {
  const findings = [];
  const add = (id, status, message) => findings.push({ id, status, message });
  add('not_debuggable', summary.debuggable ? 'FAIL' : 'PASS', summary.debuggable ? 'android:debuggable is true' : 'android:debuggable is not set');
  add('target_sdk', summary.targetSdk === expectations.targetSdk ? 'PASS' : 'FAIL', `targetSdkVersion ${summary.targetSdk} (expected ${expectations.targetSdk})`);
  add('min_sdk', summary.minSdk === expectations.minSdk ? 'PASS' : 'FAIL', `minSdkVersion ${summary.minSdk} (recorded ${expectations.minSdk})`);
  add('package_id', summary.packageName === expectations.packageName ? 'PASS' : 'FAIL', `package ${summary.packageName} (expected ${expectations.packageName})`);
  add('version_code', summary.versionCode === expectations.versionCode ? 'PASS' : 'FAIL', `versionCode ${summary.versionCode} (expected ${expectations.versionCode})`);
  if (expectations.versionName) add('version_name', summary.versionName === expectations.versionName ? 'PASS' : 'FAIL', `versionName ${summary.versionName} (expected ${expectations.versionName})`);
  add('cleartext_traffic', summary.usesCleartextTraffic ? 'FAIL' : 'PASS', summary.usesCleartextTraffic ? 'usesCleartextTraffic is true' : 'cleartext HTTP traffic is not allowed');

  const values = {};
  for (const name of ADMOB_ENV_NAMES) values[name] = summary.metaData[ADMOB_META_KEYS[name]] ?? '';
  const classes = classifyAdmobValues(values);
  const policy = evaluateAdmobPolicy(classes, expectations);
  add('admob_ids', policy.ok ? 'PASS' : 'FAIL', policy.ok ? `ads mode: ${policy.adsMode} (${Object.entries(classes).map(([key, value]) => `${key}=${value}`).join(', ')})` : policy.problems.join('; '));
  if (policy.ok && policy.adsMode === 'not-configured') add('ads_mode', 'WARN', 'ADMOB_* not supplied: rewarded ads stay hidden (x2 / Extended Overclock not offered)');
  if (summary.allowBackup) add('allow_backup', 'INFO', 'android:allowBackup is true (unchanged baseline value; product/privacy decision)');
  return findings;
}

function findDebugBuildFlags() { return { ok: true, message: 'placeholder' }; }

module.exports = {
  findDebugBuildFlags,
  ADMOB_ENV_NAMES,
  ADMOB_META_KEYS,
  DEFAULT_GAME_VERSION,
  DEFAULT_PACKAGE_NAME,
  MAX_VERSION_CODE,
  PAGE_SIZE_16KB,
  RECORDED_MIN_SDK,
  REQUIRED_TARGET_SDK,
  SAMPLE_ADMOB_PUBLISHER,
  check16KbAlignment,
  checkR8MappingKeepsBridge,
  checkVersionCodeMonotonic,
  classifyAdmobId,
  classifyAdmobValues,
  classifySigningInputs,
  decodeProtoManifest,
  evaluateAdmobPolicy,
  evaluateManifestSafety,
  extractZipEntry,
  findForbiddenPackedFiles,
  findLocalEndpoint,
  getLoadSegmentAlignments,
  hasJarSignature,
  isValidPackageName,
  listBridgeEntryPoints,
  listNativeAbis,
  parseXmlTreeText,
  readProtoFields,
  readZipEntries,
  resolvePackageName,
  resolveReleaseCocosConfig,
  resolveVersionIdentity,
  summarizeManifest,
  validateReleaseConfigShape,
};
