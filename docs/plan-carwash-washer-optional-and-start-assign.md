# Plan: Washer optional at registration, required when washing starts

## Confirmed decisions
1. **Keep the current create form as-is** — do **not** remove the washer/participant
   fields. Only make the **primary washer optional** on registration (a user may
   still assign washers at registration when they want to).
2. **Make/model stays visible in the create form** (not removed) — the request to
   drop it changed; keep everything.
3. **Assignment at start:** when a QUEUED wash has no washer, clicking **Start
   washing** opens a **modal** (primary washer + optional participants); the wash
   is assigned and started. If a washer is already assigned, Start proceeds
   directly. Rationale: all washers may be busy washing, so the vehicle just waits
   and gets a washer when it is its turn.

## Scope
- Backend: `startWash` accepts an optional washer assignment and **requires** a
  washer (from the modal or an existing assignment); everything else unchanged.
- Frontend: washer optional in the create form; add the Start-washing assignment
  modal; no other UI removals.

---

## Superseded earlier draft (kept for context)

### Old goal (no longer pursued)
- Remove the make/model field from the create form; remove washer/participant
  fields from the create form.
- The start-washing flow, when no washer is assigned, **opens a modal** with a
  washer dropdown + participant washers to assign, then starts.

## Current state (verified)
- `CarWash.washerId` is already **nullable**; `CreateWashDto.washerId?` is already
  optional, and `createWash` stores `washerId: dto.washerId ?? null`. So the
  **backend already supports registration without a washer**.
- `CarWash.makeModel` is a column; the create form has a **make/model input**;
  `AiAutofillCapture`/`applyVehicleResult` sets `makeModel` from AI analysis.
- `startWash` today just flips status + stamps `startedAt` (no washer check).
- Frontend form: **primary washer** `SearchableSelect` + **participants** checkbox
  list (filters out the primary) both exist; the primary is currently part of the
  manual create form.

## Design (confirmed)

### 1. Backend — enforce a washer only at start
- **`startWash(id, userId, opts?: { washerId?; participantWasherIds? })`**:
  - If the wash **has no primary washer yet**, require one: accept an optional
    `washerId` (+ `participantWasherIds`) from the caller (the start modal). If
    none is provided **and** the wash has none → `BadRequestException`
    (`"Assign a washer before starting"`).
  - Persist the assignment in the **same transaction** as the status change:
    `washerId`, `participantWashers` (set), `status=IN_PROGRESS`, `startedAt`,
    queue renumber.
  - If the wash already has a washer (assigned at registration or via edit), start
    proceeds without requiring input.
- **DTO:** new `StartWashDto { washerId?: number; participantWasherIds?: number[] }`
  (all optional). Validate the washer(s) belong to the tenant.
- **`PATCH /carwash/washes/:id/start`** accepts the optional body.
- `createWash` keeps `washerId` **optional** (already is) — registration may omit
  it, and may still include it when a washer is available.
- `updateWash` can still set/clear the washer (unchanged).
- **Participants**: keep the rule that the primary is excluded from participants.

### 2. Frontend — registration form (minimal change)
- **Primary washer becomes optional** (label hint "optional / assign later"); the
  field and participants stay on the form. A wash may be registered with no washer.
- **No other fields removed** — make/model, vehicle type, plate, amount, notes,
  participants all stay. AI autofill keeps working.

### 3. Frontend — start-washing modal
- When **Start washing** is clicked:
  - If the wash **has a washer** → start immediately (current behavior).
  - If the wash **has no washer** → open a **Start wash modal** with:
    - **primary washer** `SearchableSelect` (required),
    - **participant washers** (optional, excludes the primary),
    - Confirm → `PATCH /washes/:id/start` with `{ washerId, participantWasherIds }`.
  - Wired in both places `statusActions` is used (table row + detail modal).
- Reuse `SearchableSelect` + `Button`/`Modal` and the existing busy pattern.

### 4. Detail view
- No change: `makeModel` and the assigned washers continue to display.

### 5. i18n
- New keys: `carwash.assignWasherTitle`, `carwash.assignWasherHint`,
  `carwash.washerRequired` (en + am). Reuse `carwash.primaryWasher`,
  `carwash.participants`, `carwash.actionStartWashing`.

## Files to touch
- **Backend**
  - `src/carwash/dto/carwash.dto.ts` — add `StartWashDto`.
  - `src/carwash/carwash.service.ts` — `startWash(id, userId, opts?)` requires a
    washer when none is set; persists assignment transactionally.
  - `src/carwash/carwash.controller.ts` — `PATCH washes/:id/start` accepts the body.
- **Frontend** `app/dashboard/carwash/washes/page.tsx`:
  - remove the make/model input and the manual primary/participant fields from the
    create form (keep state + payload for AI autofill);
  - add the Start-wash assignment modal; route Start through it when no washer.
- i18n `lib/locales/{en,am}/common.json`.
- Tests: `startWash` rejects when no washer and none provided; succeeds when a
  washer is passed or already set.

## Verification
- Register a wash with **no washer** (no make/model field shown) → it sits QUEUED.
- AI capture still fills plate/type/**make-model** (shows in detail) and saves.
- Click **Start washing** on a washer-less wash → modal asks for a washer (+
  participants) → confirm → status IN_PROGRESS with the washer, queue renumbered.
- Click **Start** on a wash that already has a washer → starts without a modal.
- Backend rejects a start with no washer and none supplied.
- `tsc` + jest + `next build` clean.

## Open questions
(none — all confirmed above)
