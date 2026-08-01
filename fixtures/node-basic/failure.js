const unusedFixtureValue = "BugBonsai should prune this statement";

function calculatePayment() {
  throw new TypeError("BUGBONSAI_SENTINEL_BASIC");
}

calculatePayment();
