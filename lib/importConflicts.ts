/**
 * Re-import name resolution.
 *
 * When a spreadsheet is dropped in a second time, some of its rows name
 * projects that already exist. The user answers each one with Update / rename
 * / skip, and afterwards the wizard has to write each row's extra columns onto
 * the right project. Three different names are in play for a single row:
 *
 *   - the name in the SHEET          — the only stable key across a rename,
 *                                      and what the row's cells are found by;
 *   - the name in the DATABASE       — differs for every renamed row;
 *   - no new project at all          — an Updated row's project predates this
 *                                      import and was never in its portfolio.
 *
 * Getting this wrong does not throw; it writes one project's figures onto
 * another one, quietly. So it lives here as two pure functions with a check
 * beside them, rather than inline in the wizard where the "sheet name vs db
 * name" distinction was duplicated at two call sites and free to drift.
 */

/** The name a row will be CREATED under: its rename if it has a usable one. */
export function effectiveName(sheetName: string, renames: Map<string, string>): string {
  // A rename that is blank or whitespace is not a rename. Falling back to the
  // sheet name keeps this total — the wizard blocks on blanks separately, and
  // this must not invent an empty project name if that guard ever moves.
  return (renames.get(sheetName) ?? '').trim() || sheetName;
}

/**
 * SHEET name -> project id, for every row that ended up with a project.
 *
 * `idByDbName` is what came back from the portfolio after the commit, keyed by
 * the name the project actually has. `replacements` is the sheet name -> id of
 * each existing project the user chose to update.
 *
 * A row that was skipped appears in neither and is simply absent, which is
 * what the caller's `if (!projectId) continue` expects.
 */
export function idsBySheetName(
  sheetNames: string[],
  renames: Map<string, string>,
  replacements: Map<string, string>,
  idByDbName: Map<string, string>,
): Map<string, string> {
  const out = new Map(replacements);
  for (const sheetName of sheetNames) {
    // An Update wins over a create with the same name: that row was removed
    // from the payload, so any db-name hit here belongs to a different row.
    if (out.has(sheetName)) continue;
    const id = idByDbName.get(effectiveName(sheetName, renames));
    if (id) out.set(sheetName, id);
  }
  return out;
}
