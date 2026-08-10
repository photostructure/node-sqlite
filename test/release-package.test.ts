import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertPackedContents,
  assertPackedManifest,
  findTarball,
  packedFilename,
} from "../scripts/release-package";
import { useTempDir } from "./test-utils";

const identity = { name: "@photostructure/sqlite", version: "1.2.3" };
const filename = "photostructure-sqlite-1.2.3.tgz";

describe("release package", () => {
  // The temp dir is created per test, so read it through the getter.
  const temp = useTempDir("sqlite-release-package-");

  describe("identity", () => {
    test("accepts a matching pack record", () => {
      expect(packedFilename([{ ...identity, filename }], identity)).toBe(
        filename,
      );
    });

    test("rejects a version the release did not ask for", () => {
      expect(() =>
        packedFilename([{ ...identity, version: "9.9.9", filename }], identity),
      ).toThrow("expected @photostructure/sqlite@1.2.3");
    });

    test("rejects more than one pack record", () => {
      expect(() =>
        packedFilename(
          [
            { ...identity, filename },
            { ...identity, filename },
          ],
          identity,
        ),
      ).toThrow("Expected one npm pack record, found 2");
    });

    test("rejects a packed manifest that disagrees with the tag", () => {
      expect(() =>
        assertPackedManifest({ ...identity, version: "2.0.0" }, identity),
      ).toThrow("The packed manifest identifies");
    });
  });

  describe("packed contents", () => {
    const prebuild = "prebuilds/linux-x64/@photostructure+sqlite.glibc.node";

    test("accepts one copy of every promised prebuild", () => {
      expect(() =>
        assertPackedContents(
          ["package/package.json", `package/${prebuild}`],
          [prebuild],
        ),
      ).not.toThrow();
    });

    // The files allowlist dropping prebuilds/ is silent until a consumer without
    // a toolchain tries to install.
    test("rejects a missing prebuild", () => {
      expect(() =>
        assertPackedContents(["package/package.json"], [prebuild]),
      ).toThrow("contains 0 copies");
    });
  });

  describe("findTarball", () => {
    test("rejects an empty artifact directory", async () => {
      await expect(findTarball(temp.tempDir)).rejects.toThrow(
        "Expected exactly one tarball",
      );
    });

    test("rejects two tarballs", async () => {
      await writeFile(join(temp.tempDir, filename), "one");
      await writeFile(join(temp.tempDir, "other-1.2.3.tgz"), "two");

      await expect(findTarball(temp.tempDir)).rejects.toThrow(
        "Expected exactly one tarball",
      );
    });

    test("finds the only tarball", async () => {
      await writeFile(join(temp.tempDir, filename), "one");
      await writeFile(join(temp.tempDir, "PACK.json"), "[]");

      await expect(findTarball(temp.tempDir)).resolves.toBe(
        join(temp.tempDir, filename),
      );
    });
  });
});
