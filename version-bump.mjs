import fs from "fs";

const manifestPath = "./manifest.json";
const pkgPath = "./package.json";

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

if (manifest.version !== pkg.version) {
  console.error(
    `Version mismatch: manifest.json (${manifest.version}) vs package.json (${pkg.version})`,
  );
  process.exit(1);
}

const [major, minor, patch] = pkg.version.split(".").map(Number);
const newVersion = [major, minor, patch + 1].join(".");

manifest.version = newVersion;
pkg.version = newVersion;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

console.log(`Bumped version to ${newVersion}`);

