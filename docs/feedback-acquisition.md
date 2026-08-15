# External feedback acquisition

This plan turns public-beta discovery into evidence for the next release. It does
not treat downloads, stars, or impressions as proof that BugBonsai works on real
projects.

## Baseline

Snapshot taken on 2026-08-08:

| Signal                                  | Value |
| --------------------------------------- | ----: |
| npm downloads, 2026-08-02 to 2026-08-08 |   143 |
| Downloads on publication day            |   124 |
| GitHub stars                            |     1 |
| GitHub forks                            |     0 |
| Repository topics                       |     0 |
| Public feedback observations            |     0 |

The initial spike is mostly publication-day package activity. The current
bottleneck is qualified discovery and a low-friction participation path, not a
shortage of additional reducer features.

## Fourteen-day target

The phase succeeds when it collects:

- 10 distinct aggregate observations from people outside the project;
- 3 useful reproductions whose intended failure survives recipient verification;
- evidence from 3 ecosystem combinations not already represented by synthetic
  fixtures;
- 2 repeatable gaps converted into license-safe corpus cases; and
- zero reports containing private source, logs, secrets, or environment values.

Record time to first useful reproduction where available. Use it to establish a
current-beta baseline rather than declaring a target before real-world evidence
exists.

## Channel sequence

1. Publish one detailed Show HN or relevant subreddit post and answer every
   substantive reply.
2. Invite a small number of maintainers on public issues that already ask for a
   reproduction. Personalize each invitation; never bulk-message.
3. Share one short post from the maintainer's own social account, linking to the
   five-minute guide rather than asking for stars.
4. Wait at least 48 hours before trying another community. Update the message from
   the questions and objections already received.

The prepared copy lives in [the launch kit](launch-kit.md). Before posting, check
current community rules and record the exact destination and date below.

| Date | Channel or issue | Link | Qualified replies | Reports | Useful reproductions |
| ---- | ---------------- | ---- | ----------------: | ------: | -------------------: |
|      |                  |      |                   |         |                      |

## Observation triage

For each observation:

1. Confirm it contains aggregate information only.
2. Classify it as useful, too large, wrong failure, unable to complete, or
   exploratory.
3. Record ecosystem names and versions without private project identity.
4. Reproduce the product behavior with a new license-safe fixture.
5. Promote a compatibility claim only after the case passes the full CI matrix.

Use the weekly evidence loop in [beta operations](beta-operations.md) for corpus
promotion.

## Release decision rules

Prioritize the next beta and eventual `latest` promotion from observations, not
reach metrics:

- Fix wrong-failure preservation before reduction-quality improvements.
- Fix crashes and unrecoverable sessions before performance work.
- Prioritize a compatibility gap after two independent reports, or one report
  with a small deterministic public reproduction.
- Improve onboarding when three people fail at the same step even if the engine
  itself succeeds.
- Defer isolated feature requests until the core reduction path has real-user
  evidence.

At the end of 14 days, publish an honest summary of outcomes, limitations, and the
specific evidence selected for the next beta. Promotion to `latest` additionally
requires every gate in [the public beta guide](public-beta.md#promotion-to-latest).
Do not publish private report contents or infer unique users from npm download
totals.
