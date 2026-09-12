import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

function resolve(name) {
  return path.isAbsolute(name) ? name : path.join(config.dataDir, name);
}

export async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function readJson(name, fallback = null) {
  try {
    const raw = await fs.readFile(resolve(name), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) {
      throw new Error(`${resolve(name)} bozuk JSON iceriyor: ${error.message}`);
    }
    throw error;
  }
}

/** Once .tmp dosyasina yazip rename eder: yarim kalan yazma veriyi bozmaz. */
export async function writeJson(name, data) {
  await ensureDataDir();
  const target = resolve(name);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, target);
  return target;
}

export async function writeText(name, text) {
  await ensureDataDir();
  const target = resolve(name);
  await fs.writeFile(target, text, "utf8");
  return target;
}

export const paths = {
  listings: "listings.json",
  newListings: "new-listings.json",
  optimized: "optimized.json",
  plan: "optimization-plan.md",
  applied: "applied.json",
  pinned: "pinned.json",
};
