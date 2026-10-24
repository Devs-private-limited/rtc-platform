// Copy the native Android/iOS SDK sources into the Flutter plugin and the
// React Native package so the packages published to pub.dev and npm are
// self-contained. The native SDK folders stay the source of truth; run this
// after changing them.
//   node scripts/sync-native-sdks.mjs          copy
//   node scripts/sync-native-sdks.mjs --check  fail if the copies are stale
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = p => path.join(root, 'packages', p);
const androidSdk = pkg('mobile-android/sdk/src/main/java/com/rtcexpress/sdk');
const iosSdk = pkg('mobile-ios/Sources/RTCExpress');
const copies = [
  { from: androidSdk, to: pkg('mobile-flutter/android/src/main/kotlin/com/rtcexpress/sdk'), ext: '.kt' },
  { from: iosSdk, to: pkg('mobile-flutter/ios/Classes/RTCExpress'), ext: '.swift' },
  { from: androidSdk, to: pkg('mobile-react-native/android/src/main/java/com/rtcexpress/sdk'), ext: '.kt' },
  { from: iosSdk, to: pkg('mobile-react-native/ios/RTCExpress'), ext: '.swift' },
];
const files = [
  { from: pkg('mobile-android/sdk/src/main/AndroidManifest.xml'), to: pkg('mobile-flutter/android/src/main/AndroidManifest.xml') },
];
const check = process.argv.includes('--check');

const read = p => readFile(p, 'utf8').catch(() => null);
const stale = [];
for (const { from, to, ext } of copies) {
  const wanted = (await readdir(from)).filter(f => f.endsWith(ext));
  const existing = (await readdir(to).catch(() => [])).filter(f => f.endsWith(ext));
  for (const f of wanted) files.push({ from: path.join(from, f), to: path.join(to, f) });
  for (const f of existing.filter(f => !wanted.includes(f))) {
    stale.push(path.join(to, f));
    if (!check) await rm(path.join(to, f));
  }
}
for (const { from, to } of files) {
  const source = await read(from);
  if (source === await read(to)) continue;
  stale.push(to);
  if (!check) {
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, source);
  }
}

const rel = p => path.relative(root, p).replaceAll('\\', '/');
if (check && stale.length) {
  console.error('Bundled native SDK sources are out of date. Run: node scripts/sync-native-sdks.mjs');
  for (const p of stale) console.error('  ' + rel(p));
  process.exit(1);
}
console.log(check ? 'Bundled native SDK sources are in sync' : `Synced ${stale.length} native SDK file(s)`);
