# Plan: loading feedback when navigating from the mobile nav (drawer disappears instantly)

> **STATUS: IMPLEMENTED (Option B).** The mobile drawer now stays open until the
> tapped route commits, so the in-link spinner is actually seen; it closes on
> `pathname` change (with an 8 s safety timeout). A small "Loading…" hint shows
> in the drawer while it waits. Desktop is unaffected.

## Symptom / root cause
On mobile, tapping a routing item in the sidebar drawer:
1. `NavItemLink.onClick` → `onNavigate()` → `setSidebarOpen(false)` — the drawer
   slides away **immediately**, before the new route is ready.
2. `useLinkStatus()`'s `pending` is rendered by `PendingIndicator` **inside the
   link**, which just unmounted with the drawer — so the spinner-in-place is
   never seen. The user is left on the old page with a closed drawer and no
   feedback until the new page paints.

So the problem is not that the spinner is wrong — it's that the spinner lives in
a surface that vanishes on tap. Feedback must survive the drawer closing.

## Options

### A. Full-page overlay spinner (what you proposed)
Render a centered full-area spinner overlay (reuse `<Loading size="lg" />`) while
the route is committing, e.g. from a global "is navigating" flag, on top of the
current page.
- **Pros:** unmistakable feedback; simple mental model.
- **Cons:** blocks the whole screen on every navigation; feels heavy for fast
  transitions (flash of spinner); can double up with the existing top
  `LoadingBar`; harder to scope to "nav-triggered" only.

### B. Keep the drawer open until the new route commits (my recommendation)
When a nav item is tapped **on mobile**, don't close the drawer immediately —
close it when the route actually changes (or after the link settles). The
existing spinner-in-place then stays visible inside the drawer while the page
loads, which is exactly the feedback that's missing today.
- Implementation: give the drawer a "navigating" state. `NavItemLink.onClick`
  calls `onNavigate()` only on the **desktop** sidebar (where the drawer isn't a
  drawer) OR `onNavigate` becomes a no-op that defers closing. Drive the close
  from an effect that fires when `pathname` changes (route committed), plus a
  safety timeout in case navigation is cancelled/slow.
- **Pros:** keeps the current, lightweight spinner UX; no full-screen block;
  the drawer visibly acknowledges the tap ("still working"), then closes as the
  new page appears. No new visual language.
- **Cons:** drawer lingers ~100–500 ms longer (which is the point). Needs a
  robust "close on pathname change + timeout fallback" to avoid a stuck drawer.

### C. Hybrid: optimistic close + page-level spinner
Close the drawer immediately (current behavior) but show a **page-level** busy
indicator (either the top `LoadingBar`, already global, made more prominent, or a
small centered spinner in the content area) so feedback survives the drawer
closing.
- **Pros:** immediate drawer dismiss (feels responsive) + visible feedback.
- **Cons:** two things happen at once (drawer closes, spinner appears); slightly
  more moving parts; the top LoadingBar already covers "request in flight" but is
  a thin line that's easy to miss.

### D. Keep spinner-in-place AND delay the drawer close (B + keep A out)
Same as B. This is the tightest fix.

## Recommendation
**Option B (delay the mobile drawer close until the route commits)**, with the
top `LoadingBar` as the existing coarse fallback. Reasons:
- It fixes the exact defect (feedback vanishing with the drawer) without adding a
  full-screen overlay for every navigation.
- It preserves the spinner-in-place decision you already approved — the spinner
  just needs to stay on screen long enough to be seen.
- Fast navigations still feel fast (the close fires the instant `pathname`
  changes); only genuinely slow loads keep the drawer up, which is the right
  moment to show a spinner.

If a full-page overlay is still preferred, **Option C** gives that without
blocking: close the drawer and show a page-level spinner. Pure **Option A**
(full-page overlay, drawer closes immediately) is the most intrusive and I'd
avoid it unless you specifically want the whole screen to signal "loading".

## Implementation sketch (Option B)
1. `layout.tsx`:
   - Add `navPending` state.
   - Pass `onNavigate={() => { if (desktop) setSidebarOpen(false); else setNavPending(true); }}`
     — or simpler: always set `navPending(true)` on mobile and let the effect
     close it.
   - Add an effect: when `pathname` changes, `setSidebarOpen(false)` and
     `setNavPending(false)`.
   - Add a safety timeout (e.g. 8 s) that clears `navPending` and closes the
     drawer if `pathname` never changes (cancelled nav).
   - Optionally show a small "loading" hint in the drawer (reuse `Loading`).
2. `NavItemLink` / `SidebarMenu`: unchanged — the spinner-in-place keeps working
   because the drawer is still mounted.
3. Quick nav (`MobileQuickNav`) already stays put and its own spinner works; no
   change (or align it to the same pattern if needed).

## Verification
- Mobile viewport: tap a sidebar item → drawer stays, shows a spinner on that
  item, then closes exactly when the new page appears.
- Slow-throttled network (DevTools) → spinner clearly visible before close.
- Cancelled/instant nav → drawer still closes (timeout fallback), no stuck state.
- Desktop sidebar unaffected (items are always visible; no drawer to close).
- `tsc` + `next build --webpack` clean.

## Open questions
1. Go with **Option B** (delay drawer close) or **C** (close + page-level
   spinner), or still prefer **A** (full-page overlay)?
2. If A/C: should the overlay/spinner cover the whole viewport or just the content
   area below the header?
3. Is a small inline "Loading…" label inside the drawer desirable while it waits,
   or is the per-item spinner alone enough?
