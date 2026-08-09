const NOTES_FIRST_OPEN_HINT_KEY = 'odysseus-notes-first-open-hint-v1';

function _showNotesFirstOpenHint(pane) {
  if (!pane || typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(NOTES_FIRST_OPEN_HINT_KEY)) return;
    localStorage.setItem(NOTES_FIRST_OPEN_HINT_KEY, '1');
  } catch {
    return;
  }

  document.getElementById('notes-first-open-hint')?.remove();
  const hint = document.createElement('div');
  hint.id = 'notes-first-open-hint';
  hint.className = 'tour-hint';
  hint.innerHTML = `
    <div class="tour-hint-text"><b>Notes</b> is your basic todo list, and also where reminders are managed.</div>
    <button type="button" class="tour-hint-dismiss">OK</button>
  `;
  document.body.appendChild(hint);

  const place = () => {
    const r = pane.getBoundingClientRect();
    const hw = hint.offsetWidth || 260;
    hint.style.top = Math.max(12, r.top + 58) + 'px';
    hint.style.left = Math.min(window.innerWidth - hw - 12, Math.max(12, r.left + 18)) + 'px';
  };
  const close = () => {
    window.removeEventListener('resize', place);
    hint.classList.add('tour-hint-out');
    setTimeout(() => hint.remove(), 180);
  };

  requestAnimationFrame(() => {
    place();
    hint.classList.add('tour-hint-in');
  });
  window.addEventListener('resize', place);
  hint.querySelector('.tour-hint-dismiss')?.addEventListener('click', close);
  setTimeout(close, 6500);
}