# Field type mapping

How Sitecore field types map to TypeScript types and SDK renderers, and how BA-spec vocabulary maps to Sitecore types when drafting a manifest. `src/type-map.cjs` is authoritative for the first table; this document is its readable mirror plus the drafting guidance the code cannot carry.

## Use when

- Drafting a manifest from a spec's field table (BA vocabulary → `sitecoreType`).
- Reviewing what the scaffold will emit for a given `sitecoreType`.
- Skip when: editing the emitted TSX by hand — `tsx-template.md` covers the output shape.

## Sitecore type → TypeScript → renderer (mirror of `src/type-map.cjs`)

| `sitecoreType` | TS type | Scaffold emits |
| --- | --- | --- |
| Single-Line Text | `Field<string>` | `<Text editable={isEditing} field={…} />` |
| Multi-Line Text | `Field<string>` | `<Text editable={isEditing} field={…} />` |
| Rich Text | `RichTextField` | `<RichText className="rtf" editable={isEditing} field={…} />` |
| Image | `ImageField` | `<NextImage editable={isEditing} field={…} />` |
| General Link | `LinkField` | `<Link editable={isEditing} field={…} />` |
| Date / Datetime | `Field<string>` | TODO comment (render/format is design-driven) |
| Checkbox | `Field<boolean>` | TODO comment (markup is design-driven) |
| Number / Integer | `Field<number>` | TODO comment (markup is design-driven) |
| Droptree / Droplink | `unknown` | TODO comment (verify the SDK's referenced-item type against the app's package surface) |
| Multilist / Treelist | `unknown[]` | TODO comment (same verification, array shape) |
| anything else | `Field<unknown>` | TODO comment naming the unmapped type |

Reference-field TS types are deliberately conservative: the Content SDK's referenced-item shape must be verified against the consuming app's installed SDK version before tightening them — the scaffold compiles either way and Implement resolves the final type.

## BA-spec vocabulary → `sitecoreType` (drafting guidance)

Specs vary in vocabulary. Map common phrasings; anything not clearly one of these becomes a review question, never a guess:

| Spec says | Draft as |
| --- | --- |
| Text, Heading, Label, Title, Eyebrow | Single-Line Text |
| Description, Summary, Short Text (multi-line) | Multi-Line Text |
| Body, Rich Text, Biography, WYSIWYG | Rich Text |
| Image, Photo, Thumbnail, Portrait, Logo | Image |
| Link, CTA, Button (with URL) | General Link |
| Date, Start Date, Publish Date | Date |
| Toggle, Flag, Boolean, Yes/No | Checkbox |
| Page Reference, Content Reference (single) | Droptree or Droplink — ask which picker the authors expect |
| Related Items, Tags, Categories (multiple) | Multilist or Treelist — ask which picker the authors expect |

## Source restrictions

Specs state selection restrictions as intent — "Restrict to eligible page templates inheriting the shared base template". The manifest `source` value must be the concrete Sitecore Source string (a path, a `query:…`, or parameterized syntax with template filters). Translating intent → string is a review decision:

✅ Surface the spec's restriction sentence as a review question and record the developer's exact answer in `source`.

❌ Invent a plausible `query:`/`Datasource=` string from the intent sentence and push it.
