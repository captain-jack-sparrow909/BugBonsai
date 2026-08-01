describe("payment calculation", () => {
  it("contains unrelated passing behavior", () => {
    expect(1 + 1).toBe(2);
  });

  test("exposes the payment bug", () => {
    expect("BUGBONSAI_VITEST_SENTINEL").toBe("expected-payment-state");
  });
});
