---
name: writeup
description: >-
  Turn a confirmed bug-bounty finding from on-disk submission state into a redacted,
  PRIVATE, shareable write-up via claude-artifacts. Use at the end of the hunt loop
  to produce a report URL the researcher can attach to the platform submission.
argument-hint: "[case-id]"
allowed-tools: >-
  Read, Grep, Glob, Bash(submission-shots*), Bash(pihunt-triage report*),
  Bash(hunt-brief*), mcp__claude-artifacts__*
---

# writeup — publish a redacted finding report

Produce a finding write-up for a confirmed case and publish it as a **private**
artifact. This is legitimate security documentation for an authorized program — a
redacted vulnerability report, never a page that imitates the target.

## Inputs
- `$ARGUMENTS` = the case id (e.g. `case_b01db43fec`). If absent, list recent
  submissions from `reports/<program>/` and ask which case (or use the one in the
  brief).

## Flow

1. **Gather.** Read the case from `reports/<program>/`: the submission record, the
   chain in `gadget-graph.jsonl`, the relevant rows of `authz-differential.jsonl`,
   and `pihunt-triage report`. Reconstruct: title, severity (CVSS), affected
   endpoint(s), the exploitation chain, impact, and remediation.

2. **REDACT (mandatory — do this before anything leaves the machine).** The hunt
   state contains live/sensitive material. Replace, do not publish verbatim:
   - access/session tokens, API keys, bearer values → `<REDACTED-TOKEN>`
   - victim identifiers, emails, team/account IDs, `sha256` of victim data → placeholders
   - presigned / re-signed URLs → `<REDACTED-PRESIGNED-URL>`
   - any third-party PII
   Keep enough to prove the bug (method, path shape, status codes, the authz
   differential) without exposing a real victim or a reusable credential.

3. **Evidence.** Attach the already-redacted PNGs from `submission-shots` (render
   them if missing). Do not embed raw API responses that still contain secrets.

4. **Publish (private).** Call `mcp__claude-artifacts__guide` (pages topic) **before
   the first publish of the session**, then publish the write-up as a **private**
   artifact. Hand the researcher the URL. Do **not** share, publish-to-web, or
   unshare — widening access is always the researcher's explicit choice.

## Guardrails (fail closed)
- **If you cannot confirm the content is redacted, do NOT publish.** State what is
  unredacted and stop.
- Publish only legitimate, redacted vulnerability documentation. Never dress the
  report as the target's official page, reproduce its branding deceptively, or
  fabricate records — claude-artifacts will refuse these, and so should you.
- Private by default; the artifact is finished work for the platform reviewer.
