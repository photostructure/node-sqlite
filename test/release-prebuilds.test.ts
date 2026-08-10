import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  expectedPrebuildPath,
  expectedPrebuildPaths,
  prebuildTargets,
  verifyPrebuilds,
} from "../scripts/release-prebuilds";
import { useTempDir } from "./test-utils";

const packageName = "@photostructure/sqlite";

describe("release prebuilds", () => {
  // The temp dir is created per test, so read it through the getter.
  const temp = useTempDir("sqlite-release-prebuilds-");

  async function writePrebuilds(
    projectRoot: string,
    files: readonly string[],
  ): Promise<void> {
    for (const file of files) {
      await mkdir(dirname(join(projectRoot, file)), { recursive: true });
      await writeFile(join(projectRoot, file), `binary:${file}`);
    }
  }

  test("names the prebuildify output for every release target", () => {
    expect(expectedPrebuildPaths(packageName)).toEqual([
      // scripts/build-native.ts passes --tag-libc everywhere, so macOS and
      // Windows carry a glibc tag too. node-gyp-build matches it there.
      "prebuilds/darwin-arm64/@photostructure+sqlite.glibc.node",
      "prebuilds/darwin-x64/@photostructure+sqlite.glibc.node",
      "prebuilds/linux-arm64/@photostructure+sqlite.glibc.node",
      "prebuilds/linux-arm64/@photostructure+sqlite.musl.node",
      "prebuilds/linux-x64/@photostructure+sqlite.glibc.node",
      "prebuilds/linux-x64/@photostructure+sqlite.musl.node",
      "prebuilds/win32-arm64/@photostructure+sqlite.glibc.node",
      "prebuilds/win32-x64/@photostructure+sqlite.glibc.node",
    ]);
  });

  test("covers both architectures on every supported platform", () => {
    expect(prebuildTargets).toHaveLength(8);
    expect(new Set(prebuildTargets.map((target) => target.id)).size).toBe(8);
    // The two Linux libc variants share a directory and differ only by tag.
    expect(
      new Set(
        prebuildTargets.map((target) =>
          expectedPrebuildPath(packageName, target),
        ),
      ).size,
    ).toBe(8);
  });

  test("accepts a complete set", async () => {
    const projectRoot = join(temp.tempDir, "complete");
    await writePrebuilds(projectRoot, expectedPrebuildPaths(packageName));

    await expect(
      verifyPrebuilds({ projectRoot, packageName }),
    ).resolves.toHaveLength(8);
  });

  test("names the platform whose build did not arrive", async () => {
    const projectRoot = join(temp.tempDir, "missing");
    const [absent, ...rest] = expectedPrebuildPaths(packageName);
    await writePrebuilds(projectRoot, rest);

    await expect(verifyPrebuilds({ projectRoot, packageName })).rejects.toThrow(
      `Expected 8 prebuilds, found 7. Missing: ${absent}`,
    );
  });

  // A second binary under prebuilds/ means a build wrote somewhere nobody
  // expected, and npm pack would ship it.
  test("rejects an unexpected binary", async () => {
    const projectRoot = join(temp.tempDir, "extra");
    await writePrebuilds(projectRoot, [
      ...expectedPrebuildPaths(packageName),
      "prebuilds/linux-x64/some-other-addon.node",
    ]);

    await expect(verifyPrebuilds({ projectRoot, packageName })).rejects.toThrow(
      /Unexpected: prebuilds\/linux-x64\/some-other-addon\.node/,
    );
  });

  test("rejects an empty or absent prebuilds directory", async () => {
    await expect(
      verifyPrebuilds({ projectRoot: join(temp.tempDir, "none"), packageName }),
    ).rejects.toThrow("Expected 8 prebuilds, found 0");
  });
});
