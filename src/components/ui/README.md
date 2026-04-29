# UI primitives

Canonical components. Every surface in Henri ships from this folder — never re-implement a button, card, or dialog from scratch. If a needed primitive doesn't exist, extend this set rather than inlining Tailwind classes on a raw `div`.

- **Brand rules** (quoted from `CLAUDE.md`):
  - Primary color: `#D4886A` (darker terracotta). Never `#E8916A`.
  - Typography: **Fraunces** (`font-heading`, weights 300/400/500, + italic) for headings. **DM Sans** for body. Never `font-bold` on Fraunces headings.
  - No emojis anywhere. Use `lucide-react` SVG icons or text labels.
  - Google OAuth only — no GitHub, no Apple.

- **Design tokens** live in `src/app/globals.css` under `:root` + `.dark` + `.dusk` theme blocks. Hex values never live in component files; reference the token via Tailwind utility (`bg-primary`, `text-muted-foreground`) or CSS var (`hsl(var(--primary))`).

---

## Inventory

| Primitive | File | Purpose |
|---|---|---|
| Button | `button.tsx` | Actionable element. 7 variants × 4 sizes + loading state. |
| Card | `card.tsx` | Panel/module container. 5 variants. |
| Badge | `badge.tsx` | Compact status pill. 9 semantic variants. |
| Dialog | `dialog.tsx` | Modal overlay with focus trap + ARIA. |
| Input | `input.tsx` | Text input with error state + `aria-invalid`. |
| Select | `select.tsx` | Native `<select>` with error state + `aria-invalid`. |
| Skeleton | `skeleton.tsx` | Loading placeholder with shimmer. |
| Toast | `toast.tsx` | Transient notification. 4 severities. Provider + hook. |
| FocusTrap | `focus-trap.tsx` | Tab/Shift+Tab wrapping for modal content. |
| ExpandableBanner | `expandable-banner.tsx` | Collapsible alert/info strip. 5 tones. |
| Tooltip | `tooltip.tsx` | Hover/focus hint. |

---

## Button

```tsx
import { Button } from "@/components/ui/button";

<Button>Start free trial</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="danger" loading>Deleting…</Button>
<Button asChild><Link href="/pricing">See plans</Link></Button>
```

### Variants

| Variant | Use when |
|---|---|
| `primary` (default) | Primary action on a surface — "Save", "Submit", "Start trial". |
| `secondary` | Supporting action paired with a primary. |
| `ghost` | Low-emphasis action in dense UI (filter chips, row actions). |
| `outline` | Neutral action where the bg would compete with content. |
| `danger` | Destructive action — "Delete", "Revoke". Confirmation is the caller's job. |
| `link` | Inline text-link styling that inherits button semantics. |
| `glow` | Rare, marketing-only hero CTA with terracotta halo. |

### Sizes

| Size | Height | Use when |
|---|---|---|
| `sm` | 32 px (h-8) | Tight inline UI (tables, filter bars) **only when another 44px affordance exists for the same action**. |
| `md` (default) | **44 px** | Everything else. Meets WCAG 2.5.5 / iOS HIG. |
| `lg` | 48 px | Hero CTAs, full-width primary forms. |
| `icon` | 44 × 44 px | Icon-only buttons. |

### States

| State | Behavior |
|---|---|
| default | Renders per variant. |
| hover | bg-opacity adjust per variant. |
| active | Inherits browser default. |
| disabled | Pointer-events off, 50% opacity. |
| loading | Renders spinner, sets `aria-busy`, `<span class="sr-only">Loading</span>` announced. Original label stays in DOM but `aria-hidden`. |

### Accessibility

- `:focus-visible` renders a 2 px primary-color ring.
- `loading` → `aria-busy="true"` + SR-announced "Loading" (override via `loadingText`).
- When used with `asChild`, the child element becomes the semantic element (usually `<a>`). The Slot composition does **not** compose with loading — loading forces a `<button>`.

### Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| `<Button variant="primary">` for the main action | Stack two `primary` buttons side-by-side |
| `<Button size="sm">` in data-dense rows | Use `sm` as the only tap target on a mobile surface |
| `<Button asChild><Link>...</Link></Button>` for nav CTAs | Style a plain `<a>` with `bg-primary px-4 py-2` — use `Button` |

---

## Card

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

<Card variant="default">
  <CardHeader>
    <CardTitle>Monthly spend</CardTitle>
    <CardDescription>Last 30 days</CardDescription>
  </CardHeader>
  <CardContent>$1,420</CardContent>
</Card>
```

### Variants

| Variant | Visual | Use when |
|---|---|---|
| `default` | Opaque bg + 1 px border + subtle shadow | Standard panel — dashboard modules, settings sections. |
| `elevated` | Opaque bg + no border + stronger shadow | Floating surface (context menu, preview card). |
| `translucent` | Semi-opaque + backdrop-blur + border | Overlays over hero imagery. Renamed from `glass`. |
| `bordered` | Transparent + 2 px border | Empty states, summary groupings. |
| `gradient` | Soft terracotta → accent gradient | Emphasis moments (featured pricing). |

### Hover flag

`hover` prop lifts the card 2 px with a deeper shadow on hover — use on clickable cards only.

### Accessibility

Card is a presentation element (a `<div>`) with no default role. If the whole card is clickable, add `role="button"` + `tabIndex={0}` + keyboard handlers, or wrap the content in a `<Link>` / `<Button asChild>`.

---

## Badge

```tsx
import { Badge } from "@/components/ui/badge";

<Badge>New</Badge>
<Badge variant="hot">Urgent</Badge>
<Badge variant="destructive">Deleted</Badge>
```

### Variants (semantic)

| Variant | Tone | Use when |
|---|---|---|
| `default` | terracotta on white | Neutral tag, brand-primary accent. |
| `secondary` | muted bg | Low-emphasis tag. |
| `outline` | border-only | Chip with minimal visual weight. |
| `destructive` | red-tinted | Action with destructive intent ("Will delete"). |
| `success` | green-tinted | Positive outcome ("Verified", "Paid"). |
| `warning` | gold-tinted | Attention needed ("Expires in 3 days"). |
| `hot` | terracotta-tinted | Lead-score 75+. Sales vocabulary. |
| `warm` | gold-tinted | Lead-score 50–74. |
| `cold` | cool-blue-tinted | Lead-score <50. Industry-standard sales term — kept even though color token is `--cool`. |

### Note: `destructive` vs Toast `error`

Badge `destructive` = *action intent* ("this will destroy data").
Toast `error` = *outcome* ("save failed").
Same red color, different semantic. Both are intentional.

---

## Dialog

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Confirm release</DialogTitle>
      <DialogDescription>This will release the lead to the next contractor.</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="danger" onClick={confirm}>Release</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### States

| State | Behavior |
|---|---|
| closed | Not rendered. |
| opening | `animate-slide-up-panel` animation. |
| open | FocusTrap active, Escape closes, click-outside closes. |
| closing | Reverse animation, focus restored to the element that opened it. |

### Accessibility

- `aria-modal="true"`, `aria-labelledby` → DialogTitle id, `aria-describedby` → DialogDescription id.
- FocusTrap cycles Tab / Shift+Tab through focusable children, restores focus on close.
- Escape key closes.

---

## Input & Select

```tsx
<Input
  placeholder="Email"
  error={!!formErrors.email}
  errorMessageId="email-error"
/>
{formErrors.email && <p id="email-error" role="alert">{formErrors.email}</p>}
```

### Error state

- `error` prop → destructive border + destructive focus ring + `aria-invalid="true"`.
- `errorMessageId` prop → `aria-errormessage` + `aria-describedby` point at your error-copy element so screen readers announce the message on focus.

---

## Skeleton

```tsx
<Skeleton className="h-8 w-32" />
```

Use while `isLoading`. Inherit size from `className`. Shimmer animation via `::after` pseudo-element.

---

## Toast

```tsx
import { useToast } from "@/components/ui/toast";

const { addToast } = useToast();
addToast({ type: "success", title: "Saved", description: "Changes synced." });
```

### Severity (ToastType)

| Severity | Tone | Use when |
|---|---|---|
| `success` | green | Confirmed outcome. |
| `error` | red | Something failed. |
| `warning` | gold | Attention needed. |
| `info` | primary-tinted | Neutral status. |

Auto-dismisses after 5 s (override with `duration`). Rendered in an `aria-live="polite"` region so screen readers announce without stealing focus.

---

## FocusTrap

Used by Dialog internally. Standalone usage when you have a custom modal-like overlay:

```tsx
<FocusTrap active={isOpen}>
  <div>…</div>
</FocusTrap>
```

Snapshot-based focus restoration — captures the element that was focused when `active` flipped true, returns focus there on deactivate.

---

## ExpandableBanner

```tsx
<ExpandableBanner tone="warning" title="Your license expires in 3 days">
  <p>Renew at …</p>
</ExpandableBanner>
```

### Tones

`error`, `warning`, `info`, `success`, `storm` (the last is a Storm-Center-specific red with left border).

### States

Expandable detail block with `aria-expanded` + `aria-hidden` on the collapsed content.

---

## Tooltip

Hover / focus hint. Renders via Radix under the hood. Defer to Radix docs for full API.

---

## Common patterns

### Form with error handling

```tsx
<label htmlFor="email">Email</label>
<Input
  id="email"
  type="email"
  error={!!errors.email}
  errorMessageId="email-error"
  {...register("email")}
/>
{errors.email && (
  <p id="email-error" className="text-xs text-destructive" role="alert">
    {errors.email.message}
  </p>
)}
```

### Card-gated action

```tsx
<Card className="p-6 space-y-4">
  <CardHeader className="p-0">
    <CardTitle>Your territories</CardTitle>
    <CardDescription>3 of 5 claimed</CardDescription>
  </CardHeader>
  <CardContent className="p-0">
    <ul>…</ul>
  </CardContent>
  <CardFooter className="p-0">
    <Button>Claim another</Button>
  </CardFooter>
</Card>
```

### Confirm-before-destroy flow

```tsx
const [confirming, setConfirming] = useState(false);
<Button variant="danger" onClick={() => setConfirming(true)}>Delete</Button>
<Dialog open={confirming} onOpenChange={setConfirming}>
  …
  <Button variant="danger" onClick={async () => {
    await api.delete();
    addToast({ type: "success", title: "Deleted" });
    setConfirming(false);
  }}>Confirm delete</Button>
</Dialog>
```

---

## Adding a new primitive

1. Check the audit in `~/.claude/plans/composed-questing-lighthouse.md` — confirm the gap isn't covered by composition.
2. Name it in the file form `kebab-case.tsx`.
3. If it has variants, use `class-variance-authority` (CVA) — see `button.tsx` / `card.tsx` / `badge.tsx`.
4. Add it to this README.
5. Export via default OR named, match existing primitives (most are named).
6. If it's interactive, wire ARIA + focus handling. Non-interactive → semantic `<div>` is fine.

## Adding a new token

1. Add the CSS var in all three theme blocks (`:root` + `.dark` + `.dusk`) in `src/app/globals.css`.
2. Expose via `@theme inline` as `--color-*` or `--shadow-*` so Tailwind generates the utility.
3. Document in this file if it's semantically meaningful (e.g. trade palette, score colors).
4. Never use the raw hex in a component — always the token.

---

_Last updated: 2026-04-23 after design-system audit + fixes._
