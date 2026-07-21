# Authoring API contract

How `check` and `push` talk to the XM Cloud Authoring and Management GraphQL API: authentication, the operation set, placeholder binding, reconcile semantics, and the verification procedure for environment differences. The executor (`src/executor.cjs`) implements this contract; the plan JSON embeds every GraphQL document verbatim so a reviewer sees exactly what will run.

## Contents

- Authentication
- Endpoint
- Operations
- Placeholder binding
- Reconcile semantics (add-only)
- Required-field validation
- System items resolved by path
- Verify-against-docs procedure
- Failure classes and exits

## Authentication

OAuth2 client credentials against Sitecore Cloud. Create an automation client for the target (non-production) environment in the Sitecore Cloud Portal, then set:

- `SITECORE_AUTHORING_CLIENT_ID` / `SITECORE_AUTHORING_CLIENT_SECRET` — the automation client.
- `SITECORE_AUTHORING_ENDPOINT` — the environment's Authoring API URL, `https://<instance>/sitecore/api/authoring/graphql/v1`.
- `SITECORE_AUTHORING_TOKEN_URL` — optional; default `https://auth.sitecorecloud.io/oauth/token`.
- `SITECORE_AUTHORING_AUDIENCE` — optional; default `https://api.sitecorecloud.io`.

The CLI loads `./.env` for unset keys. Missing variables fail before any network call (exit 2). Values are never echoed into output, plans, or logs.

## Endpoint

All GraphQL traffic posts to `SITECORE_AUTHORING_ENDPOINT` with a bearer token. The token is fetched once per run. Transport retry: at most 3 attempts per request, only for network errors, HTTP 429, and 5xx; other 4xx and GraphQL-level errors never retry.

## Operations

The plan carries six documents (see `plan.graphql`): three queries — item by path, template by path with `ownFields { nodes { name type } }`, single field value — and three mutations — `createItemTemplate` (name, parent, sections with `{ name, type }` fields), `createItem` (name, templateId, parent, language, fields), `updateItem` (itemId, language, fields). Everything the tool does composes from these; there is no delete, rename, or move operation in the set by design.

## Placeholder binding

Plan variables contain `__NAME__` placeholders (`__TEMPLATE_0_ID__`, `__RENDERING_ID__`, `__REQUIRED_RULE_ID__`, …). The executor binds each from preflight query results before use — the plan never contains hardcoded item IDs, and every well-known item is resolved by path at run time. A placeholder that cannot be bound aborts the run with the remediation in its op.

## Reconcile semantics (add-only)

- Template exists → no-op on the item; the field diff runs. Template marked `existing: true` but absent → abort (conflict).
- Field in manifest, missing in CMS → created (section item created first when needed).
- Field in CMS, absent from manifest → reported in follow-ups; never deleted.
- Field type differs between CMS and manifest → conflict follow-up; the CMS type is never changed, and the field-config step skips writing `Type` for that field (Title/Source/help still apply).
- Field exists on the template but not at the manifest's section path → conflict follow-up; nothing is written to it and the run continues (fields are never moved between sections).
- Rendering bindings (`componentName`, `Datasource Template`, `Datasource Location`) → written on every push (idempotent set).
- List fields (`__Masters`, `Allowed Controls`, validation bars) → read-modify-write append, brace- and case-insensitive de-duplication; entries are never removed.

## Required-field validation

`required: true` appends the standard Required field rule — resolved by path from `/sitecore/system/Settings/Validation Rules/Field Rules/System/Required` — to the field item's `Validate Button` and `Workflow` validation bars. Existing rules on those bars are preserved. Other bars (`Quick Action Bar`, `Validation Rules`) are intentionally untouched in v1; add them manually if the project's authoring policy needs them.

## System items resolved by path

- Json Rendering template: `/sitecore/templates/Foundation/JavaScript Services/Json Rendering` — resolved and **introspected** before any rendering mutation: its `ownFields` must contain `componentName`, `Datasource Template`, and `Datasource Location`, or the run aborts with the mismatch named.
- Template section / Template field: `/sitecore/templates/System/Templates/Template section` and `…/Template field`.
- Placeholder settings template: `/sitecore/templates/System/Layout/Placeholder`.
- Required rule: path above.

These paths live in `plan.systemPaths` so a reviewer can see and, for a divergent environment, adjust them before pushing.

## Verify-against-docs procedure

The mutation input shapes follow the documented Sitecore examples but this repo cannot execute them against a live environment. On first use in a new environment:

1. Run `check` — it exercises every query path and the introspection preflights with zero mutations.
2. If a query or mutation errors with a schema mismatch, open the environment's GraphQL IDE (`…/sitecore/api/authoring/graphql/playground/`) and compare the failing document in `plan.graphql` against the live schema; consult the Sitecore docs MCP when available.
3. Fix the document/shape in `src/build-plan.cjs` (or the paths in `plan.systemPaths`/config) — never by hand-editing a plan file that then diverges from the tool.
4. Re-run `check` until clean, then `push`.

## Failure classes and exits

- Config (missing env, bad config file) → exit 2, before any network call.
- Auth (token rejected, 401/403) → exit 1, no retry.
- API (network after retries, 5xx after retries, GraphQL errors) → exit 1.
- Conflict (existing-template absent, unbindable placeholder, Json Rendering field mismatch) → exit 1 with remediation text; nothing was forced.
