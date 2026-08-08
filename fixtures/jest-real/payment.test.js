describe("payment state", () => {
  test("keeps unrelated passing behavior out of the reproduction", () => {
    expect("unrelated passing behavior").toContain("passing");
  });

  test("exposes the bug", () => {
    expect("BUGBONSAI_JEST_SENTINEL").toBe("expected-payment-state");
  });
});
