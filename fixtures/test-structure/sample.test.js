describe("payment suite", () => {
  it("unrelated behavior", () => {
    console.log("this test is unrelated");
  });

  test.each([[1]])("preserves the bug", () => {
    throw new TypeError("BUGBONSAI_TEST_STRUCTURE_SENTINEL");
  });
});
