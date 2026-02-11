import esbuild from "esbuild";

/** @type {esbuild.BuildOptions} */
const baseOptions = {
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  sourcemap: true,
  target: "es2020",
};

const watch = process.argv.includes("--watch");
const prod = process.argv.includes("--prod");

if (watch) {
  esbuild.context({
    ...baseOptions,
    minify: false,
  }).then((ctx) => ctx.watch());
} else {
  esbuild.build({
    ...baseOptions,
    minify: prod,
  });
}

