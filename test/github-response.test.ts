import {
  assertGitSha,
  assertRelativeTreePath,
  gitBlobSha,
} from "../scripts/github-response";

describe("assertGitSha", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("returns a full lowercase hex SHA", () => {
    expect(assertGitSha(sha, "test")).toBe(sha);
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
    expect(() => assertGitSha(value, "test")).toThrow(/hex SHA/);
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

describe("gitBlobSha", () => {
  // Expected values from `printf <content> | git hash-object --stdin`.
  it.each([
    ["empty content", "", "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],
    ["a line", "hello\n", "ce013625030ba8dba906f756967f9e9ca394464a"],
    ["a NUL byte", "a\0b", "20b5be91886d0b6f26dc98a225c0dac05fe2c86e"],
  ])("hashes %s as git does", (_label, content, expected) => {
    expect(gitBlobSha(Buffer.from(content))).toBe(expected);
  });
});
