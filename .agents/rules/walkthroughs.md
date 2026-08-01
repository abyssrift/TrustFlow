---
trigger: always_on
---

walthroughs should and must always include a series and a list of things i need to test mmanually to verify that everything worked correctly.

## Any UI-visible change: test at more than one width

A manual-test list for UI work must name **at least two viewport widths** —
~1400px (desktop) and 390px (mobile web) at minimum, plus ~1000px when the
change involves columns.

A single-width walkthrough structurally cannot see the two most common layout
failures in this codebase: a desktop modal that is really a narrow one-column
scroll (see `ux-consistency.md` §"Desktop density"), and a `flex-row` that
survives to mobile. Both look completely correct in one screenshot. #182 shipped
with the first because every walkthrough it produced described one width.

"Verified end-to-end" means the flow was **driven**, not that the diff was
re-read. If the app could not be run, say so plainly and state what was checked
instead — an honest gap is worth more than a confident "verified".
