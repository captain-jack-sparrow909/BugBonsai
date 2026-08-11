import type { BuildProfile } from "bugbonsai-config";

const selectedLayout: BuildProfile["view"]["layout"] =
  "BUGBONSAI_DECLARATION_ORDER_SENTINEL";

console.log(selectedLayout);
