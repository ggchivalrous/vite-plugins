import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  scanMpaConfigFiles,
  defaultConfigNames,
  extractConfigArray,
  readConfig,
} from "../src/utils";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(__dirname, ".fixtures-scan");

describe("MPA Config File Scanning Utilities", () => {
  beforeEach(() => {
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
    mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  });

  describe("scanMpaConfigFiles", () => {
    it("should recursively scan directories and find all default config names", () => {
      // create dummy subdirectories and files
      mkdirSync(resolve(FIXTURES_DIR, "page-ts"));
      writeFileSync(resolve(FIXTURES_DIR, "page-ts/mpa.config.ts"), "");

      mkdirSync(resolve(FIXTURES_DIR, "page-js/sub"), { recursive: true });
      writeFileSync(resolve(FIXTURES_DIR, "page-js/sub/mpa.config.js"), "");

      mkdirSync(resolve(FIXTURES_DIR, "page-mjs"));
      writeFileSync(resolve(FIXTURES_DIR, "page-mjs/mpa.config.mjs"), "");

      mkdirSync(resolve(FIXTURES_DIR, "page-cjs"));
      writeFileSync(resolve(FIXTURES_DIR, "page-cjs/mpa.config.cjs"), "");

      // Add noise files
      writeFileSync(resolve(FIXTURES_DIR, "page-ts/random.ts"), "");
      mkdirSync(resolve(FIXTURES_DIR, "node_modules"));
      writeFileSync(resolve(FIXTURES_DIR, "node_modules/mpa.config.ts"), "");

      const files = scanMpaConfigFiles(FIXTURES_DIR, defaultConfigNames);

      expect(files.length).toBe(4);
      expect(files.some((f) => f.endsWith("mpa.config.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("mpa.config.js"))).toBe(true);
      expect(files.some((f) => f.endsWith("mpa.config.mjs"))).toBe(true);
      expect(files.some((f) => f.endsWith("mpa.config.cjs"))).toBe(true);
      expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    });

    it("should scan custom file names properly when strings or arrays are provided", () => {
      mkdirSync(resolve(FIXTURES_DIR, "custom-page"));
      writeFileSync(resolve(FIXTURES_DIR, "custom-page/my-mpa.ts"), "");

      const files1 = scanMpaConfigFiles(FIXTURES_DIR, "my-mpa.ts");
      expect(files1.length).toBe(1);
      expect(files1[0].endsWith("my-mpa.ts")).toBe(true);

      const files2 = scanMpaConfigFiles(FIXTURES_DIR, ["my-mpa.ts"]);
      expect(files2.length).toBe(1);
      expect(files2[0].endsWith("my-mpa.ts")).toBe(true);
    });
  });

  describe("extractConfigArray", () => {
    it("should correctly extract arrays", () => {
      expect(extractConfigArray([{ page: "home", title: "首页" }])).toHaveLength(1);
    });

    it("should correctly extract single object", () => {
      const result = extractConfigArray({ page: "home", title: "首页" });
      expect(result).toHaveLength(1);
      expect(result[0].page).toBe("home");
    });

    it("should correctly handle __viteMpaPluginConfig wrapped properties", () => {
      const result = extractConfigArray({ __viteMpaPluginConfig: [{ page: "foo", title: "foo" }] });
      expect(result).toHaveLength(1);
      expect(result[0].page).toBe("foo");
    });

    it("should gracefully handle invalid input", () => {
      expect(extractConfigArray(null)).toHaveLength(0);
      expect(extractConfigArray(undefined)).toHaveLength(0);
      expect(extractConfigArray("string")).toHaveLength(0);
    });
  });

  describe("readConfig edge cases", () => {
    const defaultEnv = { command: "build", mode: "production" } as any;

    it("should return configuration array if direct array is provided", async () => {
      const loggerMock = { info: vi.fn(), warn: vi.fn(), success: vi.fn() } as any;
      const configArr = [{ page: "about", title: "关于" }];

      const res = await readConfig({ config: configArr }, defaultEnv, __dirname, loggerMock);
      expect(res).toBe(configArr);
    });
  });
});
