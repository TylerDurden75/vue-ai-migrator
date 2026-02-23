/**
 * Cache for mixin → composable mapping (set by migrator, read by fix rule)
 */

import * as fs from "fs";
import * as path from "path";
import { mixinNameToComposable } from "./composable-gen";

export interface MixinComposableInfo {
  composableName: string;
  returnKeys: string[];
  composablePath: string;
}

let mixinMapCache: Map<string, MixinComposableInfo> | null = null;
let mixinMapProjectRoot: string | null = null;

export function setMixinComposablesMap(
  projectRoot: string,
  map: Map<string, MixinComposableInfo>
): void {
  mixinMapCache = map;
  mixinMapProjectRoot = projectRoot;
}

export function getMixinComposablesMap(
  projectRoot?: string
): Map<string, MixinComposableInfo> | null {
  if (!projectRoot) return null;
  if (mixinMapCache && mixinMapProjectRoot === projectRoot) {
    return mixinMapCache;
  }
  return null;
}

/** Extract return keys from composable: return { a, b, c } */
function parseComposableReturnKeys(content: string): string[] {
  const returnMatch = content.match(/return\s*\{([\s\S]*)\}\s*;/);
  if (!returnMatch) return [];
  const inner = returnMatch[1];
  const keys: string[] = [];
  const keyRegex = /^\s*(\w+)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = keyRegex.exec(inner)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

/** Build mixin composables map by scanning project (used when fix runs without migrate) */
export function buildMixinComposablesMapFromProject(
  projectRoot: string
): Map<string, MixinComposableInfo> {
  const map = new Map<string, MixinComposableInfo>();
  const composablesDir = path.join(projectRoot, "src", "composables");
  const mixinsDir = path.join(projectRoot, "src", "mixins");

  try {
    if (fs.existsSync(composablesDir)) {
      const files = fs.readdirSync(composablesDir);
      for (const file of files) {
        if (!file.match(/^use\w+\.(ts|js)$/)) continue;
        const composableName = file.replace(/\.(ts|js)$/, "");
        const filePath = path.join(composablesDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const returnKeys = parseComposableReturnKeys(content);
        map.set(path.resolve(filePath), {
          composableName,
          returnKeys,
          composablePath: filePath,
        });
      }
    }
    if (fs.existsSync(mixinsDir)) {
      const files = fs.readdirSync(mixinsDir);
      for (const file of files) {
        const filePath = path.join(mixinsDir, file);
        const mixinPath = path.resolve(filePath);
        if (map.has(mixinPath)) continue;
        const baseName = file.replace(/\.(ts|js)$/, "");
        const composableName = mixinNameToComposable(baseName);
        const composablePath = path.join(composablesDir, `${composableName}.ts`);
        const returnKeys = fs.existsSync(composablePath)
          ? parseComposableReturnKeys(fs.readFileSync(composablePath, "utf-8"))
          : [];
        map.set(mixinPath, {
          composableName,
          returnKeys,
          composablePath,
        });
      }
    }
  } catch {
    // Ignore
  }

  return map;
}

export function clearMixinComposablesMap(): void {
  mixinMapCache = null;
  mixinMapProjectRoot = null;
}
