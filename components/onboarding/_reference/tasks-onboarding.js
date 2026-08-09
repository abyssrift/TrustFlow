async function _runFirstOpenOnboarding() {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/onboarding`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const state = await res.json();
    if (state.opened) return;

    await fetch(`${API_BASE}/api/tasks/onboarding`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
  } catch (e) {
    console.warn('Tasks onboarding failed:', e);
  }
}
