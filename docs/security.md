# Security and privacy

BugBonsai is local-only and has no telemetry. Existing source-project files are not changed; the requested reproduction directory is the only intentional write near the source project.

Common sensitive files such as `.env`, authenticated `.npmrc` files, private keys, and SSH material are omitted from inventory. The final candidate is scanned for private-key markers and high-confidence token formats before export.

## Boundary

Workspace isolation is not a security sandbox. The reproduction command can access anything the invoking user can access, including the network, environment, keychain, local databases, Docker, and cloud services. Use a disposable VM or OS-level sandbox for untrusted projects.

Configuration modules, custom oracle modules, and plugins are trusted in-process code with the same privileges as BugBonsai. Plugins are only loaded when named through configuration, the CLI, or the programmatic API; they are not discovered automatically. Review their source and dependency tree before use. Plugin source hashes protect cache and resume consistency, not system security.

Secret scanning is heuristic. Always inspect `bugbonsai-report.json` and the reproduction before sharing it.
