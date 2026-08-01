# Failure oracles

Failure equivalence is more important than raw reduction size. The default oracle normalizes unstable paths, timestamps, durations, process identifiers, UUIDs, and ANSI styling while retaining error codes and source identity.

It then evaluates:

1. failure versus success;
2. exit, signal, and timeout behavior;
3. explicit text or regex constraints;
4. introduced setup-failure categories;
5. error-name compatibility;
6. stack-frame overlap;
7. deterministic token similarity.

When a baseline is unstable, stop and provide a distinctive `--match` value rather than lowering the oracle threshold blindly.
