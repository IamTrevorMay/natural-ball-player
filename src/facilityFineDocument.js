// ============================================================================
// FACILITY FINE DOCUMENT — SINGLE OFF SWITCH  (#378)
// ============================================================================
//
// READ THIS BEFORE FLIPPING ANYTHING.
//
// The facility fine signing flow ALREADY EXISTS: `src/FacilityFinePage.js`
// (#189), the `facility_fine_signatures` table, and the sidebar entry under
// Documents in App.js. This module does NOT re-implement any of that.
//
// There is deliberately NO policy text in this file. The facility fine
// document is NOT hard-coded copy — it is a PDF an admin uploads via
// Work Portal -> Admin -> Documents with a title beginning "Facility Fine",
// which FacilityFinePage renders in an iframe. Nobody should ever type the
// words of a binding fine policy into this repo; the uploaded PDF from
// Cordell is the one and only source of that text.
//
// WHAT #378 IS ACTUALLY ABOUT
// Emmett's photo showed athletes with no document to sign. The flow is built
// and routed for every role, but the document itself lives in
// `staff_documents` + the `staff-documents` Storage bucket, which CLAUDE.md
// (line 69, under "Work Portal tables ... Players cannot access these")
// documents as "admin write, staff read". So for a player the document lookup
// returns nothing and the page shows "No facility fine document uploaded yet"
// even when Trevor has uploaded it. The fix is the RLS migration
// `supabase/migrations/20260902_facility_fine_athlete_read.sql`, which lets
// every signed-in user read ONLY the Facility Fine row and its file.
//
// ---------------------------------------------------------------------------
// THE SWITCH
// ---------------------------------------------------------------------------
// FACILITY_FINE_ENABLED gates the new athlete-facing surfaces added by #378.
// It ships OFF so merging this cannot show a half-configured legal document to
// 1,009 real families. Flip it to `true` ONLY once ALL of the following are
// true, in this order:
//
//   1. Cordell has supplied the real facility fine PDF.
//   2. An admin has uploaded it in Work Portal -> Admin -> Documents with a
//      title that starts exactly "Facility Fine".
//   3. A human has reviewed and RUN
//      supabase/migrations/20260902_facility_fine_athlete_read.sql
//      (it widens read access — do not run it unreviewed).
//   4. Someone has logged in as a real athlete and confirmed the PDF renders
//      and a test signature saves.
//
// Turning it back to `false` hides the athlete-facing surfaces again. It does
// NOT revoke database access — that is the migration's reversal statement,
// which is written out at the bottom of the migration file.
// ---------------------------------------------------------------------------

// UPDATED 2 Sep 2026 after checking the live database, which changed the
// picture this flag was written for:
//   * The document EXISTS — "Facility Fine Document", a .docx uploaded
//     5 Jun 2026. No placeholder text is being invented by anyone.
//   * The signing flow EXISTS and has been live to every role since #189;
//     FacilityFinePage is already routed and already in the sidebar.
//   * The real bug was that athletes could not READ the document (staff-only
//     RLS on staff_documents), so their screen said "no document uploaded"
//     and App.js scored that as "signed". 3 signatures against 210 waivers.
// So this flag now guards only the NEW Profile "Documents" card, not the
// athlete-facing page, and it is ON. Set it to false to ship the RLS and
// viewer fixes without the extra Profile card.
export const FACILITY_FINE_ENABLED = true;

// Title prefix an admin must use when uploading the document. FacilityFinePage
// and App.js both match on this same prefix with .ilike('title', '<prefix>%').
// Keep this string and those queries in sync.
export const FACILITY_FINE_TITLE_PREFIX = 'Facility Fine';

// Label used wherever the document is listed to a user.
export const FACILITY_FINE_LABEL = 'Facility Fine Policy';
