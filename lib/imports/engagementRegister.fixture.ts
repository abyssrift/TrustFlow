// The anonymised engagement register that motivated the Phase 9 redesign
// (plan §18). Extracted from spreadsheetMapping.check.ts so the classifier
// check and the import-plan check measure themselves against the SAME file —
// two fixtures would drift, and the whole point of §18.5 is "measured against
// the real file, not a fixture we wrote to pass".
//
// The real file is a Qatari audit firm's 2025 register: 22 columns, real
// company names, personal mobile numbers and personal email addresses. It is
// NOT in this repo and must not be — this repo is pushed to GitHub. Every
// company, person, phone number and email below is invented; every STRUCTURAL
// trap is preserved:
//
//   * the 22 headers verbatim, including the misleading ones — "Follow -up
//     Status" (holds dates), "Expected date" (half prose), "Name of focal
//     Point " (a contact person, and the column that used to name every project)
//   * their real trailing spaces ("Service ", "Emails ", "Position ")
//   * row 8 is a CONTINUATION row: only the company column populated, wrapping
//     the previous row's name
//   * row 21 is a blank SEPARATOR row
//   * multi-valued email cells in display-name form, comma separated
//   * a malformed email with a trailing apostrophe, and one with a leading space
//   * money as text ("8,000")
//   * a row whose fee components do not reconcile with its stated TOTAL
//   * two date columns with different resolvability: "Follow -up Status" is
//     decidably DD/MM (a 25 and a 26 in first position), "Expected date" is
//     genuinely ambiguous (1/2/26, 8/2/26, 2/3/26 — nothing over 12)
//   * Excel serial dates mixed into both of those columns
//   * a case-variant person name ("Fadi Haddad" / "Fadi haddad")
//   * an entirely empty column with a real header ("Proposed fee")

import type { SheetCell } from './spreadsheetMapping';

export const ENGAGEMENT_REGISTER_HEADER_ROW = 0;

export const ENGAGEMENT_REGISTER: SheetCell[][] = [
  // 0 — header row
  ['SL No.', 'Company Name', 'Group / Individual ', 'Year', 'Audit status', 'Service ', 'Planned auditor', 'AUDIT 2025', 'ARABIC3 2025', 'TAX', 'TOTAL A&T 2025', 'Status', 'EL Status 2025', 'Name of focal Point ', 'Position ', 'Mobile number ', 'Emails ', 'Inventory Count Needed', 'Proposed fee', 'Expected date', 'Comment', 'Follow -up Status'],
  // 1 — money as TEXT ("8,000"); phone stored as a number; prose in Expected date
  [38, 'Marlin Bitumen Supplies', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', '8,000', 1000, 3000, 12000, 'Active', 'Signed by client', 'Rami , Tarek Nasser ', 'FM', 33506040, 'rami@marlinbitumen.example', 'YES', '', '1st week of January ', 'Sent our Requirements', '25/1/2026'],
  [41, 'Calaris Ventures', 'Mr. Lorenzo ', 2025, 'issued', 'Audit & Tax', 'Fadi Haddad', 0, 0, 0, 0, 'Active', 'To be discussed with Mr. Lorenzo', 'Mr Lorenzo Baptista', 'Our Managing Partner', '', '', 'NO', '', '', '', ''],
  // 3 — components 4000 + 0 + 1000 = 5000 but TOTAL says 3000. Import both. Never reconcile.
  [42, 'Calla Lily Florists', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4000, 0, 1000, 3000, 'Active', 'Signed by client', 'Tarek Nasser ', '', '', 'Tarek Nasser <tarek@nasserpartners.example>', 'NO', '', 'still pending', "On hold from Nasser's Side ", ''],
  // 4 — Excel serial dates in both date columns
  [68, 'Jareth Sports W.L.L', 'Individual', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4000, 1000, 1000, 5000, 'Active', 'Signed by client', 'Tarek Nasser', '', '', 'cjareth@example.com', 'NO', '', 46236, 'Requested the AGM, KYC and ID copies - sent a reminder', 46024],
  // 5 — multi-valued email, display-name form, comma separated; two phones in one cell
  [69, 'Kestrel Trading Contracting', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 5500, 1000, 2000, 5500, 'Active', 'Signed by client', 'Sunder ', 'Accountant ', '4340117 / +974 7743 3004 (shafeeq)', 'accounts& HR department Bay Ridge Building Co <administration@bayridgebuild.example> , Sunder Bay Ridge <sunder@bayridgebuild.example>', 'YES', '', '', '', '25/1/2026'],
  [74, 'Lamplight Electrical & Trading', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 7000, 0, 2000, 8500, 'Active', 'Signed by client', 'Tarek Nasser', '', '', 'nrbeiz@lamplight.example', 'NO', '', '8/2/26', 'Requested the AGM, KYC and ID copies - sent a reminder', 46024],
  // 7 — CONTINUATION: only the company column, wrapping row 7's name
  ['', 'Contracting W.L.L.', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  [86, 'Nocturne Catering Services', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 5500, 0, 1000, 6500, 'Active', 'Signed by client', 'Hasheer Padikkal', '', '7470 6599', 'h.padikkal@nocturne.example', 'NO', '', 46083, 'START AUDIT ON SUNDAY', 46358],
  [90, 'OXFORD SMART TRADING AND SERVICES', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4500, '', 1500, 3000, 'Active', 'Signed by client', 'Tarek Nasser', '', '', 'support@oxfordsmart.example', 'NO', '', 46297, "Waiting for Nasser's confirmation", 46327],
  [97, 'Rosanna Fashion', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4000, 0, 1000, 5000, 'Active', 'Signed by client', 'Elias', 'Owner', 55560156, 'accountant@dolphinsupply.example', 'NO', '', '', '', ''],
  [98, 'Salon Nail It (Glow Spot Salon)', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 2500, 0, 500, 3000, 'Active', 'Signed by client', 'Tarek Nasser', '', '', 'Tarek Nasser <tarek@nasserpartners.example>', 'NO', '', '', "On hold from Nasser's Side", ''],
  [101, 'Sparrow Mind Education Center ', 'Sparrow Q', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 5000, 0, 1500, 6500, 'Active', 'Signed by client', 'Tarek Nasser ', '', '', 'h.ali@sparrowmind.example', 'YES', '', '1/2/26', 'waiting for AGM, KYC and IDs Copies', 46267],
  [103, 'Spedmore Electronic Programmes-', 'Sparrow Q', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 5000, 0, 1500, 5000, 'Active', 'Signed by client', 'Tarek Nasser ', '', '', 'h.ali@sparrowmind.example', 'YES', '', '2/3/26', 'waiting for AGM, KYC and IDs Copies', 46267],
  [104, 'Silverline Lift Boutique ', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4500, 0, 1500, 4000, 'Active', 'Signed by client', 'Tarek Nasser', '', '', 'r.semaan@silverlinelifts.example', 'YES', '', '', "On hold from Nasser's Side", ''],
  [105, 'The Baby Manual Etiquette Training Center', 'Individual', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4000, 1000, 1000, 5000, 'Active', 'Signed by client', 'Tarek Nasser', '', '', 'aladkani@example.com', 'NO', '', '12/2/26', "Waiting for Nasser's confirmation", '13/1/2026'],
  [109, 'Q Nice Center Car Wash & Services', 'Nice Group', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', '', '', '', 2500, 'Active', 'Signed by client', 'Rajesh', '', '', 'rajesh@niceqatar.example', '', '', 'started', '', '17/2/2026'],
  [110, 'Al Ranan Jewellery W.L.L', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4800, 0, 1200, 6000, 'Active', 'Signed by client', 'Nishad', '', '+974 5590 2695 / +974 3387 0057 ', 'alranan2022@example.com', 'NO', '', 'started', 'Waiting for the final TB', '26/1/2026'],
  [111, 'JTOG Middle East  (QFC)', 'Individual ', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 1000, 0, 6000, 7000, 'Active', 'Signed by client', 'Tarek Nasser/ Syeda Hajera Fatima ', '', '', 'syeda@nasserpartners.example', '', '', 'started', 'Sent the Requirements', '17/2/2026'],
  // 19 — leading space before the email address
  [112, 'PINNACLE INTERNATIONAL LLP - QFC BRANCH', 'Individual ', 2026, 'Not yet started', 'Audit & Tax', 'Fadi Haddad', 13000, '', 2000, 15000, 'Active', 'Signed by client', 'Julia Davis', '', 'Mob:+44 (0)7973 771 043', ' Julia@pinnacleintl.example', '', '', '', '', ''],
  // 20 — blank SEPARATOR row
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  // 21 — malformed email (trailing apostrophe)
  [113, 'Thematrix Design', 'Individual', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 5000, '', 1000, 6000, 'Active', 'Signed by client', 'Tarek Nasser', '', '', "n.azzam@thematrix.example'", 'NO', '', '3/2/26', 'Requested the AGM, KYC and ID copies - sent a reminder', 46024],
  // 22 — CASE VARIANT of the planned auditor
  [115, 'Topcliff Consultancy', 'Mr. Lorenzo ', 2025, 'Issued', 'Audit & Tax', 'Fadi haddad', 0, '', 0, 0, 'Active', 'To be discussed with Mr. Lorenzo', 'Mr Lorenzo Baptista', 'Our Managing Partner', '', '', 'NO', '', '', '', ''],
  [153, 'Dar Al Khebra (QFC)', 'Individual', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', '', '', '', 5000, 'Active', 'Signed by client', 'Khaled ', '', '+974 66028879', 'en_khaled2004@example.com', '', '', '', '', ''],
];

