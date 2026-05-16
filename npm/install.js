#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");
const { promisify } = require("util");
const { pipeline } = require("stream");

const pipelineAsync = promisify(pipeline);

const REPO = "av/skilled";
const BINARY = "skilled";
const VERSION = require("./package.json").version;

const PLATFORM_MAP = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ARCH_MAP = {
  x64: "amd64",
  arm64: "arm64",
};

function getPlatformArtifact() {
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];

  if (!platform) {
    throw new Error(
      `Unsupported platform: ${process.platform}. Supported: ${Object.keys(PLATFORM_MAP).join(", ")}`
    );
  }

  if (!arch) {
    throw new Error(
      `Unsupported architecture: ${process.arch}. Supported: ${Object.keys(ARCH_MAP).join(", ")}`
    );
  }

  const artifact = `${BINARY}-${platform}-${arch}`;
  const ext = platform === "windows" ? "zip" : "tar.gz";
  return { artifact, ext, platform };
}

function followRedirects(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "skilled-npm" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          followRedirects(res.headers.location).then(resolve, reject);
        } else if (res.statusCode === 200) {
          resolve(res);
        } else {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
      })
      .on("error", reject);
  });
}

async function downloadAndExtract(url, destDir, platform) {
  const res = await followRedirects(url);

  if (platform === "windows") {
    const zipPath = path.join(destDir, "download.zip");
    const fileStream = fs.createWriteStream(zipPath);
    await pipelineAsync(res, fileStream);
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`);
    fs.unlinkSync(zipPath);
  } else {
    const tarPath = path.join(destDir, "download.tar.gz");
    const fileStream = fs.createWriteStream(tarPath);
    await pipelineAsync(res, fileStream);
    execSync(`tar xzf "${tarPath}" -C "${destDir}"`);
    fs.unlinkSync(tarPath);
  }
}

async function main() {
  const binDir = path.join(__dirname, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const { artifact, ext, platform } = getPlatformArtifact();
  const tag = `v${VERSION}`;
  const url = `https://github.com/${REPO}/releases/download/${tag}/${artifact}.${ext}`;

  console.log(`Downloading ${BINARY} ${tag} for ${process.platform}-${process.arch}...`);

  try {
    await downloadAndExtract(url, binDir, platform);
  } catch (err) {
    console.error(`Failed to download ${BINARY}: ${err.message}`);
    console.error(`URL: ${url}`);
    console.error(
      "You can install manually: https://github.com/av/skilled#installation"
    );
    process.exit(1);
  }

  const binaryName = platform === "windows" ? `${BINARY}.exe` : BINARY;
  const binaryPath = path.join(binDir, binaryName);

  const indexName = platform === "windows" ? `${BINARY}-index.exe` : `${BINARY}-index`;
  const indexPath = path.join(binDir, indexName);

  if (platform !== "windows") {
    fs.chmodSync(binaryPath, 0o755);
    if (fs.existsSync(indexPath)) {
      fs.chmodSync(indexPath, 0o755);
    }
  }

  console.log(`Successfully installed ${BINARY} to ${binaryPath}`);
  if (fs.existsSync(indexPath)) {
    console.log(`Successfully installed ${BINARY}-index to ${indexPath}`);
  }
}

main();
