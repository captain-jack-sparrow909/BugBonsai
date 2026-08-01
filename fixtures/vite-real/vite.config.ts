export default {
  plugins: [
    {
      name: "bugbonsai-fixture-failure",
      buildStart() {
        this.error("BUGBONSAI_VITE_SENTINEL");
      },
    },
  ],
};
