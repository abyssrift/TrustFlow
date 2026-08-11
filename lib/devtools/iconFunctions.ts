// Curated icon → function labels for the Icon Control dev tool's "by function"
// grouping. Semantics are editorial (what the glyph is *for* in this app), not
// technical. Icons without an entry fall back to "Other".
//
// Keep in sync with lib/icons.ts when new canonical glyphs are added.

const ICON_FUNCTION: Record<string, string> = {
  // ── Create / add ──────────────────────────────────────────────────────────
  'plus': 'Create / Add',
  'plus-circle': 'Create / Add',
  'user-plus': 'Add person',

  // ── Remove / delete ──────────────────────────────────────────────────────
  'trash-o': 'Delete',
  'minus': 'Remove',
  'minus-circle': 'Remove',
  'user-times': 'Remove person',
  'eraser': 'Clear / Reset',

  // ── Edit / configure ──────────────────────────────────────────────────────
  'pencil-square-o': 'Edit',
  'wrench': 'Configure',
  'magic': 'Auto / Magic',
  'paint-brush': 'Design / Style',

  // ── Confirm / state ───────────────────────────────────────────────────────
  'check': 'Confirm / Done',
  'check-circle': 'Success / Done',
  'check-square-o': 'Select / Done',
  'ban': 'Blocked / Banned',

  // ── Close / cancel ────────────────────────────────────────────────────────
  'times': 'Close',
  'times-circle': 'Cancel / Close',
  'chain-broken': 'Broken link',

  // ── Navigate / expand ─────────────────────────────────────────────────────
  'chevron-up': 'Expand / Navigate',
  'chevron-down': 'Expand / Navigate',
  'chevron-left': 'Navigate',
  'chevron-right': 'Navigate',
  'angle-double-up': 'Collapse / Navigate',
  'angle-double-down': 'Collapse / Navigate',
  'arrow-up': 'Navigate',
  'arrow-down': 'Navigate',
  'arrow-left': 'Navigate',
  'arrow-right': 'Navigate',
  'long-arrow-down': 'Navigate',
  'long-arrow-right': 'Navigate',
  'level-down': 'Navigate',
  'map-signs': 'Directions / Navigate',

  // ── View / layout ─────────────────────────────────────────────────────────
  'bars': 'Menu',
  'ellipsis-h': 'More options',
  'list': 'List view',
  'list-ul': 'List view',
  'list-alt': 'List view',
  'table': 'Table / Grid view',
  'th-large': 'Dashboard / Grid view',
  'th-list': 'List view',
  'columns': 'Layout / Columns',
  'eye': 'View / Reveal',
  'eye-slash': 'Hide',

  // ── Access / security ─────────────────────────────────────────────────────
  'lock': 'Locked / Private',
  'key': 'Key / Access',
  'shield': 'Security',
  'id-badge': 'Identity / Badge',

  // ── Settings / config ─────────────────────────────────────────────────────
  'gear': 'Settings',
  'cog': 'Settings',
  'sliders': 'Config / Controls',

  // ── Transfer / share ──────────────────────────────────────────────────────
  'download': 'Download',
  'upload': 'Upload',
  'cloud-upload': 'Upload',
  'refresh': 'Refresh',
  'undo': 'Undo',
  'save': 'Save',
  'paper-plane-o': 'Send',
  'send': 'Send',
  'share': 'Share',
  'share-alt': 'Share',
  'link': 'Link / Reference',
  'external-link': 'Open external',
  'paperclip': 'Attach',
  'copy': 'Copy / Duplicate',
  'clone': 'Duplicate / Clone',
  'files-o': 'Files / Copy',
  'envelope-o': 'Email / Message',
  'envelope-open': 'Read message',
  'envelope-open-o': 'Read message',
  'at': 'Mention',
  'reply': 'Reply',
  'print': 'Print',
  'export': 'Export',

  // ── Files / folders ───────────────────────────────────────────────────────
  'folder-o': 'Project / Folder',
  'folder-open-o': 'Files / Folder',
  'file-o': 'File',
  'file-pdf-o': 'PDF / Report',
  'file-word-o': 'Word document',
  'file-excel-o': 'Spreadsheet',
  'file-image-o': 'Image',
  'file-audio-o': 'Audio',
  'file-video-o': 'Video',
  'file-text-o': 'Text / Document',
  'file-zip-o': 'Archive / Zip',
  'archive': 'Archive',
  'inbox': 'Inbox',
  'clipboard': 'Clipboard / Tasks',
  'sticky-note-o': 'Note',
  'tag': 'Tag / Label',
  'tags': 'Tags / Labels',
  'bookmark-o': 'Bookmark',
  'thumb-tack': 'Pin',

  // ── Priority / flag / favorite ────────────────────────────────────────────
  'star': 'Favorite / Priority',
  'star-o': 'Favorite / Priority',
  'flag': 'Flag / Priority',
  'flag-o': 'Flag',
  'flag-checkered': 'Flag / Milestone',
  'certificate': 'Certification',

  // ── Time / date ───────────────────────────────────────────────────────────
  'calendar-o': 'Date / Calendar',
  'clock-o': 'Time',
  'hourglass-o': 'Time / Wait',
  'hourglass-half': 'Time / Progress',
  'hourglass-end': 'Time / Deadline',
  'history': 'History',

  // ── Notifications / activity ──────────────────────────────────────────────
  'bell-o': 'Notifications',
  'bell-slash': 'Mute',
  'comment-o': 'Comment',
  'comments-o': 'Comments / Chat',

  // ── People / corporate ────────────────────────────────────────────────────
  'user': 'Person',
  'user-circle': 'Person / Profile',
  'user-secret': 'Admin / Private',
  'users': 'People / Team',
  'briefcase': 'Corporate / Company',
  'building': 'Building / Company',
  'handshake-o': 'Deal / Partnership',
  'gavel': 'Rules / Legal',
  'balance-scale': 'Legal / Balance',

  // ── Devices / media ───────────────────────────────────────────────────────
  'phone': 'Phone / Call',
  'mobile': 'Mobile / Device',
  'laptop': 'Device / Laptop',
  'camera': 'Camera / Photo',
  'image': 'Image / Photo',
  'volume-up': 'Sound',
  'music': 'Music',
  'play': 'Play',
  'pause-circle': 'Pause',
  'stop': 'Stop',

  // ── Pipeline / structure ──────────────────────────────────────────────────
  'bolt': 'Pipeline / Fast',
  'sitemap': 'Pipeline / Structure',
  'random': 'Shuffle / Random',
  'exchange': 'Exchange / Swap',
  'server': 'Server / Infrastructure',
  'database': 'Database / Data',
  'code': 'Code',
  'code-fork': 'Pipeline / Branch',
  'cube': 'Object / Item',
  'cubes': 'Portfolio / Bundle',
  'trello': 'Kanban / Board',
  'tasks': 'Tasks',
  'atlassian': 'Atlassian / Brand',

  // ── Analytics / metrics ───────────────────────────────────────────────────
  'bar-chart': 'Analytics',
  'line-chart': 'Analytics / Trend',
  'area-chart': 'Analytics / Trend',
  'tachometer': 'Speed / Performance',
  'crosshairs': 'Target / Radar',
  'bullseye': 'Target',
  'calculator': 'Calculate / Math',
  'credit-card': 'Payment / Billing',
  'diamond': 'Diamond / Premium',
  'trophy': 'Achievement / Reward',
  'rocket': 'Launch / Fast',
  'signal': 'Signal / Connectivity',
  'wifi': 'Wireless / Connectivity',
  'plug': 'Plug / Connect',

  // ── Alerts / info / help ──────────────────────────────────────────────────
  'exclamation': 'Alert',
  'exclamation-circle': 'Danger / Alert',
  'exclamation-triangle': 'Warning / Alert',
  'question-circle': 'Help / Question',
  'info-circle': 'Info',
  'lightbulb-o': 'Idea / Insight',
  'leaf': 'Growth / Health',
  'heartbeat': 'Health / Vitality',

  // ── System ────────────────────────────────────────────────────────────────
  'home': 'Home',
  'globe': 'Global / Web',
  'sign-in': 'Sign in',
  'sign-out': 'Sign out',
  'hand-paper-o': 'Hold / Block',
};

export function iconFunction(icon: string): string {
  return ICON_FUNCTION[icon] ?? 'Other';
}

export function iconFunctions(): string[] {
  return [...new Set(Object.values(ICON_FUNCTION))].sort((a, b) => a.localeCompare(b));
}
