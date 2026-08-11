declare module "bugbonsai-config" {
  export interface BuildProfile {
    view: {
      layout: "row" | "column" | "BUGBONSAI_DECLARATION_ORDER_SENTINEL";
    };
  }
}
