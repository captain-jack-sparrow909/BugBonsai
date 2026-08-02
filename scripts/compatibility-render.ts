export interface CompatibilityMatrix {
  schemaVersion: 1;
  reviewed: string;
  sections: Array<{
    name: string;
    entries: Array<{
      target: string;
      status: "verified" | "partial" | "experimental";
      evidence: string;
    }>;
  }>;
}

const STATUS = {
  verified: "Verified",
  partial: "Partial",
  experimental: "Experimental",
} as const;

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderCompatibility(matrix: CompatibilityMatrix): string {
  if (matrix.schemaVersion !== 1)
    throw new Error("Unsupported compatibility matrix schema.");
  const names = new Set<string>();
  const sections = matrix.sections.map((section) => {
    if (
      !section.name ||
      names.has(section.name) ||
      section.entries.length === 0
    )
      throw new Error("Compatibility sections must be non-empty and unique.");
    names.add(section.name);
    const rows = section.entries
      .map(
        (entry) =>
          `| ${cell(entry.target)} | ${STATUS[entry.status]} | ${cell(entry.evidence)} |`,
      )
      .join("\n");
    return `## ${section.name}\n\n| Target | Status | Evidence |\n| --- | --- | --- |\n${rows}`;
  });
  return `# Compatibility\n\nThis scoreboard is generated from \`compatibility/matrix.json\`. “Verified” means the target executes a real reduction in automated tests; narrower evidence is labeled partial or experimental.\n\nLast reviewed: ${matrix.reviewed}\n\n${sections.join("\n\n")}\n\n## Status policy\n\n- **Verified:** automated real-command reduction and failure preservation.\n- **Partial:** meaningful automated coverage, but an important platform or lifecycle path is missing.\n- **Experimental:** detection or conservative planning exists without sufficient real-world reduction evidence.\n\nRun \`pnpm compatibility:check\` to detect scoreboard drift.\n`;
}
