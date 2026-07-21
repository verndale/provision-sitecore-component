# TSX scaffold contract

The exact shape of the emitted handoff pair — `<Component>.types.ts` + `<Component>.tsx` — and the rules behind it. `src/emit-tsx.cjs` is authoritative; the golden fixtures under `test/fixtures/*/expected/` pin the bytes.

## Contents

- Why a pair
- Datasource mode
- Page-driven mode
- Rules the emitter follows
- Overwrite behavior

## Why a pair

The frontend pipeline's sitecore-ai adapter mandates that the public props contract live in `ComponentName.types.ts` and mirror the backend Sitecore contract exactly — names, optionality, SDK wrapper types. Because the same manifest creates the CMS template, the emitted types file mirrors the backend by construction; `/implement-build-pack` later fills the `.tsx` in place without touching the boundary.

## Datasource mode

Emitted when `rendering.datasourceTemplate` names a manifest template. Example (matches the current eng handoff contract):

```tsx
// AwardCard.types.ts
import type { Field, ImageField } from '@sitecore-content-sdk/nextjs';
import type { ComponentProps } from 'lib/component-props';

export type AwardCardFields = {
  mainImage: ImageField;
  awardYear?: Field<string>;
};

export type AwardCardProps = ComponentProps & {
  fields?: AwardCardFields;
};
```

```tsx
// AwardCard.tsx
import { NextImage, Text } from '@sitecore-content-sdk/nextjs';
import type { AwardCardProps } from './AwardCard.types';

const AwardCard = (props: AwardCardProps) => {
  const { page, fields } = props;
  const { isEditing } = page.mode;

  if (!fields && !isEditing) {
    return null;
  }

  const { mainImage, awardYear } = fields ?? {};

  return (
    <div data-component="award-card">
      <NextImage editable={isEditing} field={mainImage} />
      <Text editable={isEditing} field={awardYear} />
    </div>
  );
};

export default AwardCard;
```

## Page-driven mode

Emitted when the component has no datasource-backed rendering (fields live on the page item). The types file still carries the full field contract; the `.tsx` declares `const fields: <C>Fields | undefined = undefined;` under a `TODO(provision)` block — the page-item access pattern is app-specific and is wired during Implement. The scaffold compiles either way.

## Rules the emitter follows

- Field order, names, and `?` optionality come from the manifest (required → no `?`).
- Only the SDK types and renderers actually used are imported, alphabetically.
- `ComponentProps` imports from the config `componentPropsImport` (default `lib/component-props`).
- The `.tsx` imports its types with `import type` from `./<Component>.types`.
- Root element is a neutral `<div data-component="<slug>">` — landmark/semantic element choice belongs to Implement.
- Editing awareness via `page.mode.isEditing` from the props-supplied `page`; every SDK renderer gets `editable={isEditing}`; the component-level guard is `if (!fields && !isEditing) return null;`.
- SDK renderers render directly — no per-field ternaries or show-booleans (SDK fields self-null); `RichText` carries `className="rtf"`.
- Field types with no SDK renderer (Date, Checkbox, Number, references, unknown) appear as `{/* TODO(provision): … */}` comments naming the field and what to resolve.
- Every generated TODO is grep-able by the `TODO(provision)` prefix.

✅ Adding a field later: update the manifest, re-run `plan`, and merge the regenerated contract (or `--force-tsx` on an unimplemented scaffold).

❌ Hand-editing field names or optionality in `<Component>.types.ts` so it drifts from the CMS template the manifest created.

## Overwrite behavior

Emission is create-only: an existing file reports `skipped (exists)` and the run stays exit 0, so re-planning never clobbers an implemented component. `--force-tsx` overwrites both files; `--no-tsx` skips emission entirely.
