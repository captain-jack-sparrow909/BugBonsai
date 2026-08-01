# Portability and sharing

Every successful reduction now contains `bugbonsai-manifest.json`. The manifest records the portable command, invocation directory, expected failure signature, Node and package-manager environment, required environment-variable names, and a SHA-256 digest for every exported file. Environment values are never recorded.

Verify an extracted reproduction before installing or running it:

```bash
npx bugbonsai verify ./bugbonsai-repro
```

Verification performs these operations in order:

1. parse and validate the manifest;
2. reject an invocation directory that escapes the reproduction;
3. hash the complete exported tree, excluding the manifest itself and ignored installation metadata;
4. optionally execute the recorded argument-array installation command;
5. execute the portable reproduction command without a shell;
6. compare the resulting structured failure with the exported signature.

Use `--no-install` when dependencies were prepared separately, `--timeout 2m` to change the command timeout, and `--json` in automation.

Verification executes repository code and package-manager commands. It establishes consistency with the exported manifest, not that the project is safe. Inspect untrusted reproductions and use an OS sandbox or disposable machine.

## Deterministic ZIP and checksum

Request a shareable archive explicitly:

```bash
npx bugbonsai \
  --archive ./artifacts/payment-repro.zip \
  -- npm test
```

BugBonsai writes a store-only ZIP with sorted paths, fixed ZIP timestamps, UTF-8 names, stable metadata, and no platform-dependent compression. It also writes `payment-repro.zip.sha256` in the format accepted by common checksum tools:

```bash
shasum -a 256 -c payment-repro.zip.sha256
mkdir payment-repro
unzip payment-repro.zip -d payment-repro
cd payment-repro
npx bugbonsai verify .
```

The checksum authenticates the complete archive only when it was received through a trusted channel. The internal tree hash detects accidental or subsequent changes after extraction.

## Container reproduction

Generate an optional container recipe:

```bash
npx bugbonsai --dockerfile -- npm test
docker build -f bugbonsai-repro/Dockerfile.bugbonsai bugbonsai-repro
docker run --rm <image>
```

The recipe pins the current Node major line, copies the reproduction, uses the recorded argument-array install command, preserves a nested invocation directory, and sets the reproduction command as an exec-form `CMD`. An absolute current Node executable is normalized to `node`. Other absolute executable or argument paths remain portability findings and may require manual editing.

## GitHub and CI

`--github-issue` adds `BUGBONSAI_GITHUB_ISSUE.md` with the reproduction command, observed failure, environment, reduction metrics, verification instructions, and an attachment reminder.

A GitHub Actions job can generate and upload the archive without uploading the original repository through BugBonsai:

```yaml
- name: Create minimal reproduction
  run: >-
    npx bugbonsai
    --archive "$RUNNER_TEMP/bugbonsai-repro.zip"
    --github-issue
    -- npm test

- uses: actions/upload-artifact@v4
  with:
    name: bugbonsai-reproduction
    path: |
      ${{ runner.temp }}/bugbonsai-repro.zip
      ${{ runner.temp }}/bugbonsai-repro.zip.sha256
```

`bugbonsai-report.json` remains the detailed machine-readable reduction report, while `bugbonsai-manifest.json` is the recipient-facing integrity and verification contract.
