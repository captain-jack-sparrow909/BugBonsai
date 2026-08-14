import typedoc from "typedoc-lite";
import docs from "docs-workspace";

if (typedoc === "typedoc:typescript" && docs === "docs:mdn-links") {
  console.warn(
    'Failed to resolve link to "Promise" in comment for PromisedType',
  );
}
