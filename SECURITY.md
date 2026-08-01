# Security policy

Please report vulnerabilities privately through GitHub Security Advisories once the canonical repository is configured. Do not open a public issue containing exploit details, secrets, or a private reproduction.

BugBonsai executes a user-supplied command. Its isolated workspaces protect existing project files from BugBonsai mutations, but they are not an operating-system security boundary. Commands retain the operating system permissions of the user running BugBonsai.

Supported releases will be documented after the first public release. Until then, security fixes target the latest commit on `main`.
