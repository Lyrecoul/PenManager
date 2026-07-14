import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binaries = join(root, "src-tauri", "binaries");
const platform = process.platform;
const arch = process.arch;

const platforms = {
  linux: { archive: "linux", executable: "adb", extension: "" },
  darwin: { archive: "darwin", executable: "adb", extension: "" },
  win32: { archive: "windows", executable: "adb.exe", extension: ".exe" },
};
const triples = {
  "linux:x64": "x86_64-unknown-linux-gnu",
  "linux:arm64": "aarch64-unknown-linux-gnu",
  "darwin:x64": "x86_64-apple-darwin",
  "darwin:arm64": "aarch64-apple-darwin",
  "win32:x64": "x86_64-pc-windows-msvc",
  "win32:arm64": "aarch64-pc-windows-msvc",
};

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || triples[`${platform}:${arch}`];
const targetPlatform = triple?.includes("-windows-")
  ? "win32"
  : triple?.includes("-apple-")
    ? "darwin"
    : triple?.includes("-linux-")
      ? "linux"
      : platform;
const config = platforms[targetPlatform];
if (!config || !triple) throw new Error(`Unsupported ADB build host: ${platform}/${arch}`);
const companionFiles = targetPlatform === "win32"
  ? ["AdbWinApi.dll", "AdbWinUsbApi.dll"]
  : [];

await mkdir(binaries, { recursive: true });
const destination = join(binaries, `adb-${triple}${config.extension}`);
try {
  await chmod(destination, 0o755);
  await Promise.all(companionFiles.map((file) => access(join(binaries, file))));
  process.stdout.write(`Using cached ADB sidecar: ${destination}\n`);
  process.exit(0);
} catch {
  // Download below.
}

const url = `https://dl.google.com/android/repository/platform-tools-latest-${config.archive}.zip`;
const response = await fetch(url);
if (!response.ok) throw new Error(`ADB download failed: ${response.status} ${response.statusText}`);
const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
const executable = files[`platform-tools/${config.executable}`];
if (!executable) throw new Error(`ADB executable missing from ${url}`);
await writeFile(destination, executable);
if (targetPlatform !== "win32") await chmod(destination, 0o755);
if (targetPlatform === "win32") {
  for (const dll of companionFiles) {
    const contents = files[`platform-tools/${dll}`];
    if (!contents) throw new Error(`${dll} missing from ${url}`);
    await writeFile(join(binaries, dll), contents);
  }
}
process.stdout.write(`Prepared ADB sidecar: ${destination}\n`);
