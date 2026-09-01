import { pathToFileURL } from "node:url";

const sourceRoot = pathToFileURL(`${process.cwd()}/src/`).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = specifier.slice(2);
    const extension = target.match(/\.[cm]?[jt]sx?$/u) ? "" : ".ts";
    return nextResolve(new URL(`${target}${extension}`, sourceRoot).href, context);
  }
  return nextResolve(specifier, context);
}
