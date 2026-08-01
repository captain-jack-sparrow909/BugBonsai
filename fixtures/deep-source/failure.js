function reproduce() {
  const unrelated = "this declaration can disappear";
  const config = { unused: true, code: "BUGBONSAI_DEEP_SOURCE_SENTINEL" };
  const values = ["noise", config.code];

  if (values[1] === "BUGBONSAI_DEEP_SOURCE_SENTINEL") {
    throw new TypeError(config.code);
  } else {
    console.log(unrelated);
  }
}

reproduce();
