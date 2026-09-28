import {
  assertCommitSha,
  assertRelativeTreePath,
} from "../scripts/github-response";

describe("assertCommitSha", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("returns a full lowercase hex commit SHA", () => {
    expect(assertCommitSha(sha, "test")).toBe(sha);
  });

  it.each([
    // sync-from-node.ts puts the first 7 characters into a shell command.
    ["a command substitution", "$(id)" + "0".repeat(35)],
    ["an abbreviated SHA", sha.slice(0, 7)],
    ["uppercase hex", sha.toUpperCase()],
    ["a trailing newline", sha + "\n"],
    ["a missing field", undefined],
    ["a number", 123],
  ])("rejects %s", (_label, value) => {
    expect(() => assertCommitSha(value, "test")).toThrow(/commit SHA/);
  });
});

describe("assertRelativeTreePath", () => {
  it.each([
    "test-sqlite-database-sync.js",
    "nested/dir/fixture.js",
    "a..b.js",
    ".hidden",
  ])("accepts %s", (name) => {
    expect(assertRelativeTreePath(name)).toBe(name);
  });

  it.each([
    "../../../package.json",
    "nested/../../package.json",
    "..",
    "/etc/passwd",
    // path.join treats a backslash as a separator on Windows.
    "..\\..\\package.json",
  ])("rejects %s", (name) => {
    expect(() => assertRelativeTreePath(name)).toThrow(/tree path/);
  });
});
