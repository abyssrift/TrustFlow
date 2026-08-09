// ── Demo ──

async function _cmdDemo(args, ctx) {
  const hasModels = await _hasConfiguredModels();
  if (!hasModels) {
    await typewriterReply('Before the tour, add your first AI endpoint with /setup or in /settings.');
    return true;
  }

  // ── Interactive guided tour ──
  // Highlights elements with red outline, shows tooltip with pointer arrow.
  // Navigation: ← back, skip tour, → next.

  // _onTyped / _draftPoll / _draftObserver get bound below; declare so they
  // can be cleaned up here.
  let _onTyped = null;
  let _msgEl = null;
  let _draftObserver = null;
  let _draftPoll = null;
  const _clearTour = () => {
    document.querySelectorAll('.odysseus-highlight, .odysseus-highlight-click').forEach(e => {
      e.classList.remove('odysseus-highlight', 'odysseus-highlight-click');
    });
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
    document.getElementById('tour-tooltip')?.remove();
    document.body.classList.remove('tour-active');
    // Keep the draft-restore mechanism alive for a few seconds AFTER the
    // tour visually ends, because the closing `typewriterReply` and any
    // async stragglers can clear #message in between resolve('next') and
    // the user actually reading the text. Hand-off to a deferred cleanup.
    setTimeout(() => {
      if (_msgEl && _onTyped) _msgEl.removeEventListener('input', _onTyped);
      if (_draftObserver) _draftObserver.disconnect();
      if (_draftPoll) clearInterval(_draftPoll);
    }, 3000);
  };
  // Body flag lets CSS lift overflow:hidden on parents (e.g. .sidebar) so
  // the highlight halo isn't clipped while the tour is running.
  document.body.classList.add('tour-active');

  // Persist anything the user types during the tour. Several actions inside
  // the flow (createDirectChat, slash-command handling) intentionally clear
  // #message, which would also wipe what the user typed for the final step.
  // We watch the textarea for non-tour-driven mutations and restore on the
  // next tick.
  let _typedDraft = '';
  _msgEl = document.getElementById('message');
  _onTyped = () => { if (_msgEl) _typedDraft = _msgEl.value; };
  const _restoreIfCleared = () => {
    if (!_msgEl || !_typedDraft) return;
    if (_msgEl.value === '' && _typedDraft) {
      _msgEl.value = _typedDraft;
      _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  if (_msgEl) _msgEl.addEventListener('input', _onTyped);
  _draftObserver = new MutationObserver(() => _restoreIfCleared());
  if (_msgEl) _draftObserver.observe(_msgEl, { attributes: true, attributeFilter: ['value'] });
  // Polling fallback — MutationObserver doesn't catch assignment to `.value`.
  _draftPoll = setInterval(_restoreIfCleared, 200);

  // Inject styles once
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent = `
      #tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);
        border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;
        font-family:inherit;font-size:0.8rem;line-height:1.5;
        box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;
        opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}
      #tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}
      #tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}
      .tour-arrow{position:absolute;width:10px;height:10px;background:var(--bg);
        border:1px solid var(--border);transform:rotate(45deg);pointer-events:none}
      .tour-nav{display:flex;align-items:center;justify-content:space-between}
      .tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);
        cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}
      .tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}
      .tour-nav button:active{background:color-mix(in srgb,var(--fg) 16%,transparent);transform:scale(0.95)}
      .tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}
      .tour-btn-arrow:hover{opacity:1}
      .tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}
      .tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}
      .tour-btn-skip:hover{opacity:0.6}
      .tour-btn-arrow-pulse{opacity:1;border-color:var(--accent,var(--red));color:var(--accent,var(--red));
        animation:tour-arrow-pulse 1.2s ease-in-out infinite}
      @keyframes tour-arrow-pulse{
        0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent,var(--red)) 50%,transparent)}
        50%    {box-shadow:0 0 0 6px color-mix(in srgb,var(--accent,var(--red)) 0%,transparent)}
      }
    `;
    document.head.appendChild(s);
  }

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let cancelled = false;

  function positionTooltip(target) {
    // Remove old arrow
    tooltip.querySelector('.tour-arrow')?.remove();
    const r = target.getBoundingClientRect();
    const ttW = 280;
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const ttH = tooltip.offsetHeight || 100;

    const arrow = document.createElement('div');
    arrow.className = 'tour-arrow';

    const gap = 12;
    let top, left, arrowSide;

    // Prefer below
    if (r.bottom + gap + ttH < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - ttW / 2;
      arrowSide = 'top';
    // Try above
    } else if (r.top - gap - ttH > 10) {
      top = r.top - gap - ttH;
      left = r.left + r.width / 2 - ttW / 2;
      arrowSide = 'bottom';
    // Try right
    } else {
      top = r.top + r.height / 2 - ttH / 2;
      left = r.right + gap;
      arrowSide = 'left';
    }

    // Clamp to viewport
    if (left + ttW > window.innerWidth - 10) left = window.innerWidth - ttW - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';

    // Position arrow pointing at target
    if (arrowSide === 'top') {
      arrow.style.cssText = `top:-6px;left:${Math.min(Math.max(r.left + r.width / 2 - left - 5, 10), ttW - 20)}px;border-right:none;border-bottom:none`;
    } else if (arrowSide === 'bottom') {
      arrow.style.cssText = `bottom:-6px;left:${Math.min(Math.max(r.left + r.width / 2 - left - 5, 10), ttW - 20)}px;border-left:none;border-top:none`;
    } else {
      arrow.style.cssText = `left:-6px;top:${Math.min(Math.max(r.top + r.height / 2 - top - 5, 10), ttH - 20)}px;border-right:none;border-top:none`;
    }
    tooltip.appendChild(arrow);
    tooltip.style.visibility = '';
  }

  // Stream HTML into an element character by character, skipping tag
  // boundaries instantly so <b>, <i> etc stay intact. Returns a handle so we
  // can cancel if the step ends before the stream finishes.
  function streamHTML(el, html, speedMs = 14) {
    el.innerHTML = '';
    let i = 0, out = '';
    let timer = setInterval(() => {
      if (i >= html.length) { clearInterval(timer); timer = null; return; }
      if (html[i] === '<') {
        const end = html.indexOf('>', i);
        if (end === -1) { out += html.slice(i); i = html.length; }
        else { out += html.slice(i, end + 1); i = end + 1; }
      } else {
        out += html[i];
        i++;
      }
      el.innerHTML = out;
    }, speedMs);
    return { cancel: () => { if (timer) { clearInterval(timer); el.innerHTML = html; } } };
  }

  // Floating halo overlay — positioned over a target via getBoundingClientRect.
  // Returns a handle with .update() and .destroy(). We use this instead of a
  // CSS class on the target because per-target styles (outline, box-shadow)
  // and clipping ancestors otherwise eat the glow.
  function makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return {
      el: halo,
      update,
      destroy() {
        window.removeEventListener('resize', update);
        window.removeEventListener('scroll', update, true);
        halo.remove();
      },
    };
  }

  function showStep(sel, text, mode = 'next', isFirst = false, stepOpts = {}) {
    return new Promise(resolve => {
      if (cancelled) return resolve('cancel');
      document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
      document.querySelectorAll('.tour-halo').forEach(e => e.remove());

      // Support multiple selectors (comma-separated)
      const sels = sel.split(',').map(s => s.trim());
      const targets = sels.map(s => document.querySelector(s)).filter(Boolean);
      if (!targets.length) return resolve('skip');

      const clickMode = mode === 'click';
      // Steps that advance on a domain event (message submitted) also get the
      // click-style "breathing" halo so they feel inviting. We intentionally
      // exclude `#model-picker-btn` from this list — the model-picker step
      // used to hide its arrows AND not click-advance, leaving the user with
      // a halo that did nothing if they didn't actually pick a model. It now
      // renders with normal arrows + `advanceOnClick`, see the steps array.
      const waitsForEvent = sels.includes('#message');
      const breathing = clickMode || waitsForEvent;
      const advanceOnClick = !!stepOpts.advanceOnClick;
      const pulseNext = !!stepOpts.pulseNext;

      targets.forEach(t => t.classList.add('odysseus-highlight'));
      const halos = breathing ? targets.map(makeHalo) : [];
      // Reset tooltip into the "pre-fade" state so the new step phases in.
      tooltip.classList.remove('tour-fade-in');
      targets[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      tooltip.innerHTML = `<div class="tour-text">${text}</div>
        ${breathing ? '<div style="font-size:0.72rem;opacity:0.35;margin-bottom:6px">Click the highlighted element to continue</div>' : ''}
        <div class="tour-nav" style="${breathing ? 'justify-content:center' : ''}">
          ${breathing ? '' : `<button class="tour-btn-arrow${isFirst ? ' disabled' : ''}" data-act="back">\u2190</button>`}
          <button class="tour-btn-skip" data-act="skip">${stepOpts.finishLabel ? 'finish tour' : 'skip tour'}</button>
          ${breathing ? '' : `<button class="tour-btn-arrow${pulseNext ? ' tour-btn-arrow-pulse' : ''}" data-act="next">\u2192</button>`}
        </div>`;

      // Position based on the fully-rendered tooltip so it doesn't jump as
      // text streams in, then stream the text into .tour-text and fade
      // everything in so the transition between steps isn't jarring.
      let streamHandle = null;
      requestAnimationFrame(() => {
        positionTooltip(targets[0]);
        tooltip.classList.add('tour-fade-in');
        halos.forEach(h => h.el.classList.add('tour-fade-in'));
        const textEl = tooltip.querySelector('.tour-text');
        if (textEl) streamHandle = streamHTML(textEl, text);
      });

      let messageInputListener = null;
      let modelListener = null;

      const onClick = (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        cleanup();
        if (act === 'skip') { cancelled = true; resolve('cancel'); }
        else resolve(act);
      };
      // Document-level capture so we hear the click before any inner handler
      // that might preventDefault / stopPropagation. We walk up from e.target
      // via .closest(selector) — more robust than t.contains(e.target) when
      // the click lands on a SVG/path child or a textNode wrapper. Guarded so
      // the multiple bound event types (click/pointerdown/mousedown) can't
      // double-resolve.
      let _advanced = false;
      const onDocClickCapture = (e) => {
        if (_advanced) return;
        const t = e.target;
        const matches = sels.some(s => {
          try { return t.closest && t.closest(s); } catch { return false; }
        });
        if (!matches) return;
        _advanced = true;
        // resolve first — if anything in cleanup throws we still advance.
        resolve('clicked');
        try { cleanup(); } catch (err) { console.warn('tour cleanup:', err); }
      };
      // Advance on Enter so the user can hit "send" naturally to finish
      // the tour. We deliberately do NOT advance on every input event —
      // doing so used to tear down the tooltip's click handler the moment
      // the user typed a single character, leaving the `→` button visible
      // but unclickable, and the typed draft vulnerable to later clears.
      // We also stopPropagation+preventDefault on the Enter so it can't
      // ALSO submit the chat form — otherwise the message would get sent
      // (and the input cleared) the moment the user finishes the tour.
      const onMessageInput = (e) => {
        if (e.type !== 'keydown') return;
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        const ta = document.getElementById('message');
        if (!ta || !ta.value.trim()) return;
        // Snapshot what the user typed. If anything async clears the
        // textarea between now and the next paint (typewriterReply, the
        // submit-debounce reset, etc.), we explicitly put it back.
        const saved = ta.value;
        e.preventDefault();
        e.stopImmediatePropagation();
        cleanup();
        resolve('next');
        const _restore = () => {
          if (ta && !ta.value && saved) {
            ta.value = saved;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        // Multiple ticks — synchronous, micro-task, and a couple frames
        // out — to catch whatever is clearing it.
        _restore();
        Promise.resolve().then(_restore);
        requestAnimationFrame(_restore);
        setTimeout(_restore, 50);
        setTimeout(_restore, 200);
      };
      const onModelPicked = () => { cleanup(); resolve('next'); };

      const cleanup = () => {
        tooltip.removeEventListener('click', onClick);
        ['click', 'pointerdown', 'mousedown'].forEach(evt => {
          document.removeEventListener(evt, onDocClickCapture, true);
          targets.forEach(t => t.removeEventListener(evt, onDocClickCapture, true));
        });
        if (messageInputListener) document.removeEventListener('keydown', messageInputListener, true);
        if (modelListener) document.removeEventListener('odysseus:model-picked', modelListener);
        if (streamHandle) streamHandle.cancel();
        halos.forEach(h => h.destroy());
      };

      if (sels.includes('#message')) {
        const msg = document.getElementById('message');
        if (msg) {
          // Listen on `document` in CAPTURE phase so we fire BEFORE
          // chat.js's bubble-phase Enter handler on #message (which sends
          // the message and clears the input). Listeners on the same
          // element fire in insertion order regardless of phase, so we
          // have to attach a level up to win the race.
          messageInputListener = (e) => {
            if (e.target !== msg) return;
            onMessageInput(e);
          };
          document.addEventListener('keydown', messageInputListener, true);
        }
      }
      if (sels.includes('#model-picker-btn')) {
        modelListener = onModelPicked;
        document.addEventListener('odysseus:model-picked', modelListener, { once: true });
      }

      tooltip.addEventListener('click', onClick);
      if (clickMode || advanceOnClick) {
        // Listen on click + pointerdown + mousedown in capture phase, at both
        // document and target, so we still catch even if any handler upstream
        // calls preventDefault/stopPropagation. We resolve only once via the
        // resolved guard inside cleanup().
        ['click', 'pointerdown', 'mousedown'].forEach(evt => {
          document.addEventListener(evt, onDocClickCapture, true);
          targets.forEach(t => t.addEventListener(evt, onDocClickCapture, true));
        });
      }
    });
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ── Welcome ──
  await typewriterReply('Welcome to Odysseus! Lets begin the tour!');
  // Beat between the welcome line and the first hint so it doesn't snap in.
  await delay(900);

  // Reset to a known starting state so the interactive steps (switch to Agent,
  // turn Web on) actually have something to do.
  try {
    const _agentBtn = document.getElementById('mode-agent-btn');
    const _chatBtn  = document.getElementById('mode-chat-btn');
    if (_agentBtn && _chatBtn) {
      _agentBtn.classList.remove('active');
      _chatBtn.classList.add('active');
      const _t = _agentBtn.closest('.mode-toggle');
      if (_t) _t.classList.add('mode-chat');
    }
    // Web is persisted per-mode under web_chat / web_agent. Zero both so the
    // toggle is genuinely off when the user reaches the "turn it on" step.
    const _st = Storage.getJSON(Storage.KEYS.TOGGLES, {});
    _st.mode = 'chat';
    _st.web_chat = false;
    _st.web_agent = false;
    Storage.setJSON(Storage.KEYS.TOGGLES, _st);
    // If the web button is currently on, click it to fully unwind it via the
    // existing handler (covers any state the click handler tracks that we
    // can't see from here).
    const _wbtn = document.getElementById('web-toggle-btn');
    if (_wbtn && _wbtn.classList.contains('active')) _wbtn.click();
    _wbtn?.classList.remove('active');
    const _webCb = document.getElementById('web-toggle');
    if (_webCb) _webCb.checked = false;
  } catch {}

  const sidebar = document.getElementById('sidebar');

  const steps = [
    { sel: '#sidebar-new-chat-btn', text: 'Start a new chat here. <b>Click it.</b> You can do it!', mode: 'click',
      before() { if (sidebar?.classList.contains('hidden')) sidebar.classList.remove('hidden'); } },
    { sel: '#model-picker-btn',   text: 'Pick your LLM, Local or API.', advanceOnClick: true },
    { sel: '#mode-agent-btn',     text: '<b>Agent mode</b> gives Odysseus more control of the app when your model supports tools: create a theme, download a model, make a daily task, organize things, and more.', mode: 'click' },
    { sel: '#web-toggle-btn',     text: 'Toggle tools like <b>web search</b>. Odysseus comes with private built-in <b>SearXNG</b> search.', mode: 'click' },
    { sel: '#overflow-plus-btn',  text: 'More tools can be found here, or in your sidebar. <b>Click to peek.</b>',
      advanceOnClick: true, pulseNext: true, afterDelay: 2200 },
    { sel: '#message',            text: 'Write your prompt here. Drag and drop files to attach them. <b>/prompt</b> for random prompt, <b>/help</b> for more.',
      finishLabel: true,
      before() { document.getElementById('overflow-menu')?.classList.add('hidden'); } },
  ];

  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.before) step.before();
    const res = await showStep(step.sel, step.text, step.mode || 'next', i === 0, step);
    if (res === 'cancel') { _clearTour(); return true; }
    if (res === 'back') { if (i > 0) i--; continue; }
    i++;
    // Breather between steps so the tour doesn't feel like it's racing ahead.
    await delay(step.afterDelay || 750);
    // After the message input step, wait for any active stream to finish
    if (step.sel === '#message' && _isStreamingFn()) {
      document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
      tooltip.style.display = 'none';
      await new Promise(r => {
        const check = setInterval(() => { if (!_isStreamingFn()) { clearInterval(check); r(); } }, 300);
      });
      await delay(400);
    }
  }

  _clearTour();
  await typewriterReply('Odysseus is yours to explore, enjoy the voyage!');
  return true;
}

// ── Compare tour ──
async function _cmdTourCompare(args, ctx) {
  // The slash dispatcher doesn't auto-clear the input, so explicitly
  // wipe it — otherwise "/tour-compare" stays parked in the textarea
  // and visually competes with the tour walkthrough.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  let overlay = document.getElementById('compare-model-overlay');
  if (!overlay) {
    const opener = document.getElementById('tool-compare-btn') || document.getElementById('rail-compare');
    if (opener) opener.click();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 80));
      overlay = document.getElementById('compare-model-overlay');
      if (overlay) break;
    }
  }
  if (!overlay) {
    slashReply('Could not open Model Comparison. Try clicking the Compare tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  // Track halos so we can destroy them between steps. Halos sit on the
  // body (above modals) so the outline isn't clipped by modal-content's
  // overflow:auto — same pattern as _cmdDemo's makeHalo.
  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return {
      destroy() {
        window.removeEventListener('resize', update);
        window.removeEventListener('scroll', update, true);
        halo.remove();
      },
    };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }

  const _clear = () => {
    document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target) {
    const r = target.getBoundingClientRect();
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const advanceOnClick = !!opts.advanceOnClick;
    return new Promise(resolve => {
      _clearHalos();
      const target = document.querySelector(sel);
      if (!target) return resolve('skip');
      _halos.push(_makeHalo(target));
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      tooltip.classList.remove('tour-fade-in');
      const hint = advanceOnClick
        ? '<div style="font-size:0.72rem;opacity:0.45;margin-bottom:6px;">Click the highlighted element to continue.</div>'
        : '';
      tooltip.innerHTML =
        '<div class="tour-text">' + text + '</div>' + hint +
        '<div class="tour-nav">' +
          '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
          '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
          '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
        '</div>';
      requestAnimationFrame(() => {
        _positionTooltip(target);
        tooltip.classList.add('tour-fade-in');
      });

      let resolved = false;
      const onClick = (e) => {
        const hit = e.target.closest && e.target.closest('[data-act]');
        const act = hit && hit.dataset.act;
        if (!act) return;
        if (resolved) return;
        resolved = true;
        tooltip.removeEventListener('click', onClick);
        if (advanceOnClick) document.removeEventListener('click', onTargetClick, true);
        resolve(act);
      };
      // Capture-phase listener so we hear the target click before any
      // child handler that might stopPropagation.
      const onTargetClick = (e) => {
        if (resolved) return;
        if (!target.contains(e.target) && e.target !== target) return;
        resolved = true;
        tooltip.removeEventListener('click', onClick);
        document.removeEventListener('click', onTargetClick, true);
        resolve('next');
      };
      tooltip.addEventListener('click', onClick);
      if (advanceOnClick) {
        document.addEventListener('click', onTargetClick, true);
      }
    });
  }

  // ── Phase 1: model-selector modal ──
  // Scope every selector to #compare-model-overlay so we don't accidentally
  // match the Group Chat panel's .compare-parallel-toggle (line 1053 of
  // index.html), which has the same class name and is hidden — its zero
  // bounding-rect was putting the tooltip in the top-left corner.
  const phase1 = [
    { sel: '#compare-model-overlay .modal-body',
      text: 'Pick what type of test you want to run. <b>Chat</b>, <b>Agent</b>, <b>Search</b> or <b>Deep Research</b>.',
      placement: 'center-above',
      before: () => {
        const modalBody = document.querySelector('#compare-model-overlay .modal-body');
        if (modalBody) modalBody.scrollTop = 0;
      } },
    { sel: '#compare-model-overlay .compare-blind-toggle',
      text: '<b>Blind Mode</b> hides model names so you don’t know which model gives what output.' },
    { sel: '#compare-model-overlay .compare-parallel-toggle',
      text: '<b>Parallel</b> runs side by side, toggle to <b>Sequential</b> as well.' },
    { sel: '#compare-model-overlay .compare-dice-toggle',
      text: '<b>Shuffle</b> picks the models in your entire list of endpoints. Combine with <b>Blind Mode</b> and you get the cleanest evaluation.' },
  ];

  for (let i = 0; i < phase1.length; i++) {
    const step = phase1[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: false,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  // ── Wait for the modal to close and the compare panes to come up ──
  _clearHalos();
  tooltip.innerHTML =
    '<div class="tour-text">Click <b>Start</b> when ready — it will probe the models before beginning.</div>' +
    '<div class="tour-nav">' +
      '<button class="tour-btn-skip" data-act="skip">skip</button>' +
    '</div>';
  // Anchor the tooltip next to the actual "Start" button so
  // the user's eye is drawn to the next click. Halo on it too so it
  // glows the same way as the previous steps.
  const startBtn = document.querySelector('#compare-model-overlay .research-start-btn');
  if (startBtn) {
    _halos.push(_makeHalo(startBtn));
    requestAnimationFrame(() => _positionTooltip(startBtn));
  } else {
    // Fallback: park near the top if the start button isn't around (yet).
    tooltip.style.left = ((window.innerWidth / 2) - 140) + 'px';
    tooltip.style.top  = '20px';
  }

  const skipDuringWait = new Promise(resolve => {
    const onClick = (e) => {
      const hit = e.target.closest && e.target.closest('[data-act="skip"]');
      if (!hit) return;
      tooltip.removeEventListener('click', onClick);
      resolve('skip');
    };
    tooltip.addEventListener('click', onClick);
  });
  const modalClosed = new Promise(resolve => {
    const tick = () => {
      if (!document.getElementById('compare-model-overlay')
          && (document.getElementById('compare-check-btn') || document.getElementById('cmp-eval-btn'))) {
        resolve('ready');
      } else {
        setTimeout(tick, 200);
      }
    };
    tick();
  });
  const waitRes = await Promise.race([skipDuringWait, modalClosed]);
  if (waitRes === 'skip') { _clear(); return true; }

  // Small breather so any entry animation finishes before we measure.
  await new Promise(r => setTimeout(r, 300));

  // ── Phase 2: compare panes (post-modal) ──
  // Note: the Probe button (`#compare-check-btn`) is dynamic — only
  // visible when there's at least one unverified model — so we don't
  // tour it here; the user will discover it naturally when needed.
  const phase2 = [
    { sel: '#compare-add-btn',
      text: 'Add more <b>Models</b> here, keep stacking, who’s stopping ya? (you can also remove btw).' },
    { sel: '#compare-shuffle-btn',
      text: 'After adding, <b>Shuffle</b> to randomize the order again.' },
    { sel: '#cmp-eval-btn',
      text: 'When you’re ready to test, feel free to use curated <b>evaluation prompts</b>.',
      advanceOnClick: true },
  ];

  for (let i = 0; i < phase2.length; i++) {
    const step = phase2[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === phase2.length - 1,
      advanceOnClick: !!step.advanceOnClick,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  _clear();
  await typewriterReply('That’s it, you’ll figure out the rest! Have fun!');
  return true;
}

// ── Cookbook tour ──
async function _cmdTourCookbook(args, ctx) {
  // Clear the chat input so "/tour-cookbook" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Idempotent tour-styles injection (shared with /tour and /tour-compare).
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the cookbook modal if it's not already up.
  let modal = document.getElementById('cookbook-modal');
  if (!modal || modal.classList.contains('hidden')) {
    const opener = document.getElementById('tool-cookbook-btn') || document.getElementById('rail-cookbook');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      modal = document.getElementById('cookbook-modal');
      if (modal && !modal.classList.contains('hidden')) break;
    }
  }
  if (!modal || modal.classList.contains('hidden')) {
    slashReply('Could not open Cookbook. Try clicking the Cookbook tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      // Centered horizontally, sitting in the upper third of the viewport.
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      const target = document.querySelector(sel);
      if (!target) return resolve('skip');
      _halos.push(_makeHalo(target));
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      tooltip.classList.remove('tour-fade-in');
      tooltip.innerHTML =
        '<div class="tour-text">' + text + '</div>' +
        '<div class="tour-nav">' +
          '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
          '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
          '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
        '</div>';
      requestAnimationFrame(() => {
        _positionTooltip(target, placement);
        tooltip.classList.add('tour-fade-in');
      });

      const onClick = (e) => {
        const hit = e.target.closest && e.target.closest('[data-act]');
        const act = hit && hit.dataset.act;
        if (!act) return;
        tooltip.removeEventListener('click', onClick);
        resolve(act);
      };
      tooltip.addEventListener('click', onClick);
    });
  }

  function _clickTab(name) {
    const tab = modal.querySelector('.cookbook-tab[data-backend="' + name + '"]');
    if (tab) tab.click();
  }

  // ── Steps ──
  // Tabs auto-switch via `before()` so the user sees the relevant section
  // without having to navigate manually. Keep copy tight — no walls of text.
  const steps = [
    { sel: '#cookbook-modal .modal-content',
      text: '<b>Welcome to Cookbook!</b> Download / Cook / Serve models here!',
      placement: 'center-above' },
    { sel: '#cookbook-modal .cookbook-tab[data-backend="Settings"]',
      text: 'Hosting on another machine? Configure it under <b>Settings</b>.' },
    { sel: '#cookbook-dl-repo',
      text: 'Paste a HuggingFace URL or <code>org/model-name</code> to download. Quantizations like <code>org/model:Q4_K_M</code> work too.',
      before: () => _clickTab('Search') },
    { sel: '#cookbook-modal .admin-card:has(> #hwfit-list)',
      text: '<b>Scan / Download</b> — reads your hardware and lists every model that\'ll run on it.',
      before: () => _clickTab('Search') },
    { sel: '#hwfit-hw-manual-btn',
      text: 'Your detected hardware appears here. You can also manually edit it to see what would fit on other setups.',
      before: () => _clickTab('Search') },
    { sel: '#cookbook-hf-latest-toggle',
      text: 'Check <b>latest trending models</b> here.',
      before: () => _clickTab('Search') },
    { sel: '#cookbook-modal .cookbook-tab[data-backend="Serve"]',
      text: '<b>Serve</b> — fire up downloaded models with vLLM, Ollama, llama.cpp, and diffusion models too.',
      before: () => _clickTab('Serve') },
    { sel: '#cookbook-modal .cookbook-tab[data-backend="Dependencies"]',
      text: '<b>Dependencies</b> — install missing Python packages or check GPU drivers.',
      before: () => _clickTab('Dependencies') },
  ];

  // Running tab is only present when there are active tasks. If it exists,
  // tack it on as the final stop.
  const runTab = modal.querySelector('.cookbook-tab[data-backend="Running"]');
  if (runTab) {
    steps.push({
      sel: '#cookbook-modal .cookbook-tab[data-backend="Running"]',
      text: '<b>Running</b> — live status, tail logs, downloads, kill.',
      before: () => _clickTab('Running'),
    });
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  // Leave Cookbook on the Download tab so the user can start downloading immediately.
  _clickTab('Search');
  _clear();
  await typewriterReply('That’s Cookbook. Pick a model that catches your eye and let it cook.');
  return true;
}

// ── Theme tour ──
async function _cmdTourTheme(args, ctx) {
  // Clear the chat input so "/tour-theme" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Idempotent tour-styles injection (shared with other tours).
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the theme modal if it isn't already up. Same hamburger / rail
  // opener pattern as the other tours.
  let modal = document.getElementById('theme-modal');
  if (!modal || modal.classList.contains('hidden')) {
    const opener = document.getElementById('tool-theme-btn')
      || document.getElementById('rail-theme')
      || document.getElementById('open-theme-btn');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      modal = document.getElementById('theme-modal');
      if (modal && !modal.classList.contains('hidden')) break;
    }
  }
  if (!modal || modal.classList.contains('hidden')) {
    slashReply('Could not open Theme. Try clicking the Theme tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  // Interactive step — show tooltip + halo over one or more targets and
  // resolve 'next' when the user actually clicks one of the highlighted
  // elements. Skip button still exits. `extraSel` (optional) adds a
  // second highlight target whose click also advances the step.
  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    const extraSel = opts.extraSel;
    const interactive = !!opts.interactive;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      setTimeout(() => {
        const target = document.querySelector(sel);
        if (!target) return resolve('skip');
        _halos.push(_makeHalo(target));
        const extra = extraSel ? document.querySelector(extraSel) : null;
        if (extra) _halos.push(_makeHalo(extra));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        tooltip.classList.remove('tour-fade-in');
        tooltip.innerHTML =
          '<div class="tour-text">' + text + '</div>' +
          '<div class="tour-nav">' +
            '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
            '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
            '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
          '</div>';
        requestAnimationFrame(() => {
          _positionTooltip(target, placement);
          tooltip.classList.add('tour-fade-in');
        });

        let _onTarget;
        const cleanup = () => {
          tooltip.removeEventListener('click', onClick);
          if (_onTarget) {
            target.removeEventListener('click', _onTarget, true);
            if (extra) extra.removeEventListener('click', _onTarget, true);
          }
        };
        const onClick = (e) => {
          const hit = e.target.closest && e.target.closest('[data-act]');
          const act = hit && hit.dataset.act;
          if (!act) return;
          cleanup();
          resolve(act);
        };
        tooltip.addEventListener('click', onClick);
        // Interactive: clicking the highlighted target advances. We let
        // the original click propagate so the user's real action (apply
        // theme, switch tab, etc.) actually happens.
        if (interactive) {
          _onTarget = () => { cleanup(); resolve('next'); };
          target.addEventListener('click', _onTarget, true);
          if (extra) extra.addEventListener('click', _onTarget, true);
        }
      }, before ? 160 : 0);
    });
  }

  // Clicks one of the theme modal's top-level tabs by data-tab id.
  function _clickTab(tabId) {
    const tab = modal.querySelector('.admin-tab[data-tab="' + tabId + '"]');
    if (tab) tab.click();
  }

  // ── Steps ──
  // Interactive flow: the user actually clicks each highlighted element
  // to progress. Skip button exits at any point; arrow buttons still
  // work as a fallback (read past without touching anything).
  const steps = [
    { sel: '#theme-popup',
      text: '<b>Welcome to Theme.</b> Odysseus is yours to customize!',
      placement: 'center-above',
      before: () => _clickTab('theme-tab-browse') },
    { sel: '#themeGrid',
      text: 'Try a <b>default theme</b> — or build your own with <b>Customize</b>.',
      extraSel: '#theme-tabs .admin-tab[data-tab="theme-tab-customize"]',
      interactive: true },
    { sel: '#theme-harmony-card',
      text: 'Build a quick theme with <b>color harmony</b> — pick one accent color, hit Generate, and a matching palette falls out.',
      before: () => _clickTab('theme-tab-customize'),
      interactive: true },
    { sel: '#themeCustom',
      text: 'Want finer control? <b>Edit each color individually</b> here — the page updates live.',
      before: () => _clickTab('theme-tab-customize'),
      interactive: true },
    { sel: '#theme-bg-pattern-select',
      text: 'Add a <b>background animation</b> — rain, petals, constellations, sparkles, embers…',
      before: () => _clickTab('theme-tab-customize'),
      interactive: true },
    { sel: '#theme-opacity-wrap',
      text: '<b>Peek</b> fades this window so you can see the page behind it while you tweak.',
      before: () => _clickTab('theme-tab-customize'),
      interactive: true },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
      extraSel: step.extraSel,
      interactive: step.interactive,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  _clear();
  await typewriterReply('That’s Theme. Make it yours.');
  return true;
}

// ── Settings tour ──
async function _cmdTourSettings(args, ctx) {
  // Clear the chat input so "/tour-settings" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Idempotent tour-styles injection.
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the settings modal.
  let modal = document.getElementById('settings-modal');
  if (!modal || modal.classList.contains('hidden')) {
    const opener = document.getElementById('rail-settings')
      || document.getElementById('tool-settings-btn');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      modal = document.getElementById('settings-modal');
      if (modal && !modal.classList.contains('hidden')) break;
    }
  }
  if (!modal || modal.classList.contains('hidden')) {
    slashReply('Could not open Settings. Try clicking the gear icon first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    // Track the modal-enter scale animation (see task-tour notes).
    const _tStart = performance.now();
    let _rafId = 0;
    const tick = () => {
      update();
      if (performance.now() - _tStart < 500) _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      if (_rafId) cancelAnimationFrame(_rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      setTimeout(() => {
        const target = document.querySelector(sel);
        if (!target) return resolve('skip');
        _halos.push(_makeHalo(target));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        tooltip.classList.remove('tour-fade-in');
        tooltip.innerHTML =
          '<div class="tour-text">' + text + '</div>' +
          '<div class="tour-nav">' +
            '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
            '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
            '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
          '</div>';
        requestAnimationFrame(() => {
          _positionTooltip(target, placement);
          tooltip.classList.add('tour-fade-in');
        });

        const onClick = (e) => {
          const hit = e.target.closest && e.target.closest('[data-act]');
          const act = hit && hit.dataset.act;
          if (!act) return;
          tooltip.removeEventListener('click', onClick);
          resolve(act);
        };
        tooltip.addEventListener('click', onClick);
      }, before ? 160 : 0);
    });
  }

  function _clickNav(tab) {
    const btn = modal.querySelector('.settings-nav-item[data-settings-tab="' + tab + '"]');
    if (btn) btn.click();
  }

  const steps = [
    { sel: '#settings-modal .modal-content',
      text: '<b>Welcome to Settings.</b> HOW EXCITING.',
      placement: 'center-above' },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="services"]',
      text: '<b>Add Models</b> — add a local endpoint first, like Ollama, vLLM, or llama.cpp. Cloud providers are optional.',
      before: () => _clickNav('services') },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="ai"]',
      text: '<b>AI Defaults</b> — three roles share the work. Let\'s walk through them.',
      before: () => _clickNav('ai') },
    { sel: '#settings-modal .admin-card:has(#set-defaultModelSelect)',
      text: '<b>Default Chat Model</b> — your main model. The one Odysseus reaches for whenever you start a new chat.',
      before: () => _clickNav('ai') },
    { sel: '#settings-modal .admin-card:has(#set-utilityModelSelect)',
      text: '<b>Utility Model</b> — your hard-working sidekick. Runs background tasks (compaction, cleanup, auto-naming, summarization) so your chat model doesn\'t burn cycles on chores. <b>Recommend a small local model</b> here — it\'s free and always on.',
      before: () => _clickNav('ai') },
    { sel: '#settings-modal .admin-card:has(#set-vlModelSelect)',
      text: '<b>Vision</b> — powers any image-recognition feature: drop a photo in chat, ask what\'s in it, OCR, etc.',
      before: () => _clickNav('ai') },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="integrations"]',
      text: '<b>Integrations</b> — wire up email, calendar, contacts here (per-account).',
      before: () => _clickNav('integrations') },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="search"]',
      text: '<b>Search</b> — plug in your own search provider, or use the bundled <b>SearXNG</b> out of the box.',
      before: () => _clickNav('search') },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="appearance"]',
      text: '<b>Appearance</b> — too many tools you don\'t need? Adjust them here! Toggle sidebar buttons, tool icons, and section visibility.',
      before: () => _clickNav('appearance') },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="email"]',
      text: '<b>Email</b> — sync schedule, drafts, snooze defaults — everything email-flow related.',
      before: () => _clickNav('email') },
    { sel: '#settings-modal .settings-nav-item[data-settings-tab="reminders"]',
      text: '<b>Reminders</b> — quiet hours and how Odysseus nudges you about calendar + urgent email.',
      before: () => _clickNav('reminders') },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  // Land on the first tab so the user has a familiar starting point.
  _clickNav('services');
  _clear();
  await typewriterReply('See? Not so bad. Tweak away.');
  return true;
}

// ── Gallery tour ──
async function _cmdTourGallery(args, ctx) {
  // Clear the chat input so "/tour-gallery" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  try { localStorage.setItem('odysseus-notes-first-open-hint-v1', '1'); } catch (_) {}
  document.getElementById('notes-first-open-hint')?.remove();

  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the gallery modal.
  let modal = document.getElementById('gallery-modal');
  if (!modal || modal.classList.contains('hidden')) {
    const opener = document.getElementById('tool-gallery-btn')
      || document.getElementById('rail-gallery');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      modal = document.getElementById('gallery-modal');
      if (modal && !modal.classList.contains('hidden')) break;
    }
  }
  if (!modal || modal.classList.contains('hidden')) {
    slashReply('Could not open Gallery. Try clicking the Gallery tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    const _tStart = performance.now();
    let _rafId = 0;
    const tick = () => {
      update();
      if (performance.now() - _tStart < 500) _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      if (_rafId) cancelAnimationFrame(_rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      setTimeout(() => {
        const target = document.querySelector(sel);
        if (!target) return resolve('skip');
        _halos.push(_makeHalo(target));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        tooltip.classList.remove('tour-fade-in');
        tooltip.innerHTML =
          '<div class="tour-text">' + text + '</div>' +
          '<div class="tour-nav">' +
            '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
            '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
            '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
          '</div>';
        requestAnimationFrame(() => {
          _positionTooltip(target, placement);
          tooltip.classList.add('tour-fade-in');
        });

        const onClick = (e) => {
          const hit = e.target.closest && e.target.closest('[data-act]');
          const act = hit && hit.dataset.act;
          if (!act) return;
          tooltip.removeEventListener('click', onClick);
          resolve(act);
        };
        tooltip.addEventListener('click', onClick);
      }, before ? 160 : 0);
    });
  }

  function _clickTab(tab) {
    const btn = modal.querySelector('.gallery-tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
  }

  const steps = [
    { sel: '#gallery-modal .modal-content',
      text: '<b>Welcome to Gallery.</b> Photos and albums live here.',
      placement: 'center-above',
      before: () => _clickTab('images') },
    { sel: '#gallery-modal .gallery-tab[data-tab="images"]',
      text: '<b>Photos</b> — every image you\'ve uploaded, in one grid.',
      before: () => _clickTab('images') },
    { sel: '#gallery-upload-tile',
      text: 'Drop or click this tile to <b>upload</b> photos and videos.',
      before: () => _clickTab('images') },
    { sel: '#gallery-modal .gallery-tab[data-tab="albums"]',
      text: '<b>Albums</b> — group images into collections.',
      before: () => _clickTab('albums') },
    { sel: '#gallery-modal .gallery-tab[data-tab="editor"]',
      text: '<b>Editor</b> — honestly still WIP, so explore as you want.',
      before: () => _clickTab('editor') },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  // Land on Photos so the user has a familiar starting point.
  _clickTab('images');
  _clear();
  await typewriterReply('That\'s Gallery. Editor is rough — feedback welcome.');
  return true;
}

// ── Notes tour ──
async function _cmdTourNotes(args, ctx) {
  // Clear the chat input so "/tour-notes" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the notes pane (it's a side sheet, not a .modal).
  let pane = document.getElementById('notes-pane');
  if (!pane) {
    const opener = document.getElementById('tool-notes-btn')
      || document.getElementById('rail-notes');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      pane = document.getElementById('notes-pane');
      if (pane) break;
    }
  }
  if (!pane) {
    slashReply('Could not open Notes. Try clicking the Notes tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    const _tStart = performance.now();
    let _rafId = 0;
    const tick = () => {
      update();
      if (performance.now() - _tStart < 500) _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      if (_rafId) cancelAnimationFrame(_rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      setTimeout(() => {
        const target = document.querySelector(sel);
        if (!target) return resolve('skip');
        _halos.push(_makeHalo(target));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        tooltip.classList.remove('tour-fade-in');
        tooltip.innerHTML =
          '<div class="tour-text">' + text + '</div>' +
          '<div class="tour-nav">' +
            '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
            '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
            '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
          '</div>';
        requestAnimationFrame(() => {
          _positionTooltip(target, placement);
          tooltip.classList.add('tour-fade-in');
        });

        const onClick = (e) => {
          const hit = e.target.closest && e.target.closest('[data-act]');
          const act = hit && hit.dataset.act;
          if (!act) return;
          tooltip.removeEventListener('click', onClick);
          resolve(act);
        };
        tooltip.addEventListener('click', onClick);
      }, before ? 160 : 0);
    });
  }

  const steps = [
    { sel: '#notes-pane',
      text: '<b>Notes</b> is your basic todo list, and also where reminders are managed.',
      placement: 'center-above' },
    { sel: '#notes-pane .notes-pane-body',
      text: 'Your notes show up here. You can also <b>ask Odysseus in chat</b> to take a note for you.' },
    { sel: '#notes-search',
      text: '<b>Search</b> across every note — title, body, tags, the works.' },
    { sel: '#notes-view-toggle',
      text: 'Switch between <b>grid</b> and <b>list</b> views — pick whichever fits your brain.' },
    { sel: '#notes-archive-toggle',
      text: '<b>Archive</b> stashes old notes you don\'t want cluttering the active view but still want to keep.' },
    { sel: '#notes-select-btn',
      text: '<b>Select</b> drops you into multi-select mode for bulk archive or delete.' },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  _clear();
  await typewriterReply('That\'s Notes. Write down whatever you want to remember.');
  return true;
}

// ── Tour: Brain ──
async function _cmdTourBrain(args, ctx) {
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  let modal = document.getElementById('memory-modal');
  if (!modal || modal.classList.contains('hidden')) {
    const opener = document.getElementById('tool-memory-btn') || document.getElementById('rail-memory');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      modal = document.getElementById('memory-modal');
      if (modal && !modal.classList.contains('hidden')) break;
    }
  }
  if (!modal || modal.classList.contains('hidden')) {
    slashReply('Could not open Brain. Try clicking the Brain tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    const _tStart = performance.now();
    let _rafId = 0;
    const tick = () => {
      update();
      if (performance.now() - _tStart < 500) _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      if (_rafId) cancelAnimationFrame(_rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      setTimeout(() => {
        const target = document.querySelector(sel);
        if (!target) return resolve('skip');
        _halos.push(_makeHalo(target));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        tooltip.classList.remove('tour-fade-in');
        tooltip.innerHTML =
          '<div class="tour-text">' + text + '</div>' +
          '<div class="tour-nav">' +
            '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
            '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
            '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
          '</div>';
        requestAnimationFrame(() => {
          _positionTooltip(target, placement);
          tooltip.classList.add('tour-fade-in');
        });

        const onClick = (e) => {
          const hit = e.target.closest && e.target.closest('[data-act]');
          const act = hit && hit.dataset.act;
          if (!act) return;
          tooltip.removeEventListener('click', onClick);
          resolve(act);
        };
        tooltip.addEventListener('click', onClick);
      }, before ? 180 : 0);
    });
  }

  const _tab = (name) => document.querySelector(`.memory-tab[data-memory-tab="${name}"]`)?.click();
  const steps = [
    { sel: '#memory-modal .memory-modal-content',
      text: '<b>Brain</b> is where your memories are. You can edit them, or add new ones under <b>Add</b>. Wow.',
      before: () => _tab('browse'),
      placement: 'center-above' },
    { sel: '#memory-tidy-btn',
      text: '<b>Tidy</b> runs your model to clear out irrelevant memories and duplicates. It also triggers automatically from Tasks.',
      before: () => _tab('browse') },
    { sel: '.memory-tab-panel[data-memory-panel="skills"]',
      text: '<b>Skills</b> are basically your AI’s memory for improving its abilities.',
      before: () => _tab('skills') },
    { sel: '.memory-tab-panel[data-memory-panel="settings"]',
      text: '<b>Settings</b> lets you turn off auto extraction and set how strong skills need to be before they are tagged.',
      before: () => _tab('settings') },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  _clear();
  await typewriterReply('That’s Brain — memories, skills, tidy, and settings in one place.');
  return true;
}

// ── Task tours ──
async function _openTasksForTour() {
  let modal = document.getElementById('tasks-modal');
  if (!modal) {
    const opener = document.getElementById('tool-tasks-btn') || document.getElementById('rail-tasks');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      modal = document.getElementById('tasks-modal');
      if (modal) break;
    }
  }
  return modal;
}

async function _runTaskTour(steps, doneText, opts) {
  opts = opts || {};
  // When `continueLabel` is set, the tour ends with a centered "continue?"
  // tooltip instead of going straight to doneText. The user can pick to
  // keep going (returns 'continue') or stop here.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  const modal = await _openTasksForTour();
  if (!modal) {
    slashReply('Could not open Tasks. Try clicking the Tasks tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);
  let halos = [];

  function clearHalos() {
    halos.forEach(h => h.destroy());
    halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  function makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top = (r.top - 4) + 'px';
      halo.style.left = (r.left - 4) + 'px';
      halo.style.width = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    // The tasks modal-content runs a 250ms `modal-enter` scale animation
    // when it first opens. A one-shot getBoundingClientRect() captures
    // the mid-animation (scaled-down) rect and the halo gets locked to
    // a "cropped" version. Re-sync every animation frame for ~500ms so
    // we track the entrance to its final size.
    const _tStart = performance.now();
    let _rafId = 0;
    const tick = () => {
      update();
      if (performance.now() - _tStart < 500) _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      if (_rafId) cancelAnimationFrame(_rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function clear() {
    clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  }
  function positionTooltip(target) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top = r.bottom + gap;
    let left = r.left + r.width / 2 - tw / 2;
    if (top + th > window.innerHeight - 10) top = r.top - gap - th;
    if (top < 10) top = 10;
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }
  function showStep(step, i) {
    return new Promise(resolve => {
      clearHalos();
      if (step.before) { try { step.before(); } catch (_) {} }
      setTimeout(() => {
        const target = document.querySelector(step.sel);
        if (!target) return resolve('skip');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        halos.push(makeHalo(target));
        tooltip.classList.remove('tour-fade-in');
        tooltip.innerHTML =
          '<div class="tour-text">' + step.text + '</div>' +
          '<div class="tour-nav">' +
            '<button class="tour-btn-arrow' + (i === 0 ? ' disabled' : '') + '" data-act="back">←</button>' +
            '<button class="tour-btn-skip" data-act="skip">' + (i === steps.length - 1 ? 'done' : 'skip tour') + '</button>' +
            '<button class="tour-btn-arrow" data-act="next">' + (i === steps.length - 1 ? '✓' : '→') + '</button>' +
          '</div>';
        requestAnimationFrame(() => {
          positionTooltip(target);
          tooltip.classList.add('tour-fade-in');
        });
        const onClick = (e) => {
          const hit = e.target.closest && e.target.closest('[data-act]');
          if (!hit) return;
          tooltip.removeEventListener('click', onClick);
          // Always fire step.after when leaving the step, regardless of
          // direction — it's the symmetric pair to `before` (undo the
          // temporary state change), and a user clicking "back" on the
          // chat-input step still needs the tasks modal restored.
          if (step.after) { try { step.after(); } catch (_) {} }
          resolve(hit.dataset.act);
        };
        tooltip.addEventListener('click', onClick);
      }, step.before ? 160 : 0);
    });
  }

  for (let i = 0; i < steps.length; i++) {
    const res = await showStep(steps[i], i);
    if (res === 'skip') { clear(); return 'skipped'; }
    if (res === 'back' && i > 0) i -= 2;
  }
  // Optional "Continue to part X?" prompt — show a centered tooltip
  // with two buttons before tearing down the tour overlay.
  if (opts.continueLabel) {
    clearHalos();
    tooltip.classList.remove('tour-fade-in');
    tooltip.innerHTML =
      '<div class="tour-text">' + (opts.continueText || 'Want to keep going?') + '</div>' +
      '<div class="tour-nav">' +
        '<button class="tour-btn-skip" data-act="stop">no thanks</button>' +
        '<button class="tour-btn-arrow" data-act="continue">' + opts.continueLabel + '</button>' +
      '</div>';
    // Centered in the upper third of the viewport.
    tooltip.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      const tw = tooltip.offsetWidth || 260;
      const th = tooltip.offsetHeight || 100;
      tooltip.style.top = Math.max(10, window.innerHeight * 0.32 - th / 2) + 'px';
      tooltip.style.left = Math.max(10, window.innerWidth / 2 - tw / 2) + 'px';
      tooltip.style.visibility = '';
      tooltip.classList.add('tour-fade-in');
    });
    const choice = await new Promise(resolve => {
      const onClick = (e) => {
        const hit = e.target.closest && e.target.closest('[data-act]');
        if (!hit) return;
        tooltip.removeEventListener('click', onClick);
        resolve(hit.dataset.act);
      };
      tooltip.addEventListener('click', onClick);
    });
    clear();
    if (choice === 'continue') return 'continue';
  } else {
    clear();
  }
  if (doneText) await typewriterReply(doneText);
  return 'done';
}

async function _cmdTourTask1(args, ctx) {
  const result = await _runTaskTour([
    { sel: '#tasks-modal .modal-content',
      text: '<b>Welcome to Tasks.</b> Manage all your AI background work here.' },
    { sel: '#tasks-pause-all-btn',
      text: 'Tasks are <b>paused by default</b> — resume whichever ones make sense for you. (Or pause anything that\'s running.)' },
    { sel: '#tasks-modal .modal-body',
      text: 'When enabled, Tasks use the <b>utility model configured in Settings</b> for cleanup and organization jobs.' },
  ], 'Use Tasks when you want Odysseus to handle background housekeeping.', {
    continueLabel: 'continue →',
    continueText: '<b>Part 1 done.</b> Want to keep going into <b>adding & managing tasks</b>?',
  });
  if (result === 'continue') return _cmdTourTask2(args, ctx);
  return true;
}

async function _cmdTourTask2(args, ctx) {
  return _runTaskTour([
    { sel: '#tasks-modal .tasks-tab[data-tab="new"]',
      text: '<b>Add</b> creates scheduled prompts, research jobs, actions, event triggers, or webhooks.',
      before: () => document.querySelector('#tasks-modal .tasks-tab[data-tab="new"]')?.click() },
    { sel: '#task-ai-input',
      text: 'You can just describe the task in plain chat language. Example: “weekday mornings summarize unread email”.' },
    { sel: '#tasks-modal .memory-item[data-idx="0"]',
      text: 'Or pick a template and fill out the form manually.' },
    { sel: '#task-form-save, #tasks-modal .tasks-tab[data-tab="tasks"]',
      text: 'Tasks can be edited, paused, resumed, run now, or deleted from their cards.',
      before: () => document.querySelector('#tasks-modal .tasks-tab[data-tab="tasks"]')?.click() },
    // Tuck the modal out of the way so the chatbox is unmistakable, then
    // re-show it when the user moves past this step so the tour lands
    // back where it started.
    { sel: '#message',
      text: 'You can also <b>just ask in chat</b> — say "every weekday at 9am check for urgent emails" and Odysseus will create the task for you.',
      before: () => document.getElementById('tasks-modal')?.classList.add('hidden'),
      after:  () => document.getElementById('tasks-modal')?.classList.remove('hidden') },
  ], 'That\'s Tasks. Have it run the background bits so you can stay in chat.');
}

// ── Tour: Deep Research ──

async function _cmdTourResearch(args, ctx) {
  // Clear the chat input so "/tour-research" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Shared tour-styles injection (same block as /tour, /tour-compare, /tour-cookbook).
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the research overlay if it's not already up.
  let overlay = document.getElementById('research-overlay');
  if (!overlay) {
    const opener = document.getElementById('tool-research-btn') || document.getElementById('rail-research');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      overlay = document.getElementById('research-overlay');
      if (overlay) break;
    }
  }
  if (!overlay) {
    slashReply('Could not open Deep Research. Try clicking the Deep Research tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      const target = document.querySelector(sel);
      if (!target) return resolve('skip');
      _halos.push(_makeHalo(target));
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      tooltip.classList.remove('tour-fade-in');
      tooltip.innerHTML =
        '<div class="tour-text">' + text + '</div>' +
        '<div class="tour-nav">' +
          '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
          '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
          '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
        '</div>';
      requestAnimationFrame(() => {
        _positionTooltip(target, placement);
        tooltip.classList.add('tour-fade-in');
      });

      const onClick = (e) => {
        const hit = e.target.closest && e.target.closest('[data-act]');
        const act = hit && hit.dataset.act;
        if (!act) return;
        tooltip.removeEventListener('click', onClick);
        resolve(act);
      };
      tooltip.addEventListener('click', onClick);
    });
  }

  function _ensureSettingsOpen() {
    const body = document.getElementById('research-settings-body');
    const toggle = document.getElementById('research-settings-toggle');
    if (body && toggle && body.style.display === 'none') toggle.click();
  }

  const steps = [
    { sel: '#research-pane',
      text: '<b>Welcome to Deep Research!</b> An LLM-in-the-loop agent that plans the search, queries the web, extracts findings, and writes you a full report.',
      placement: 'center-above' },
    { sel: '#research-query',
      text: 'Type what you want to researched here. Be specific — <i>"compare X vs Y for Z"</i> beats <i>"tell me about X"</i>.' },
    { sel: '#research-settings-body',
      text: '<b>Rounds</b> is how long the model will keep searching for. You can set to <b>Auto</b>, or go deeper/quicker depending on preference.',
      before: _ensureSettingsOpen },
    { sel: '#research-pane',
      text: 'When a report finishes you can <b>discuss the results with the LLM</b> in chat, or open the full <b>visual HTML report</b> — sources, images, the works.',
      placement: 'center-above' },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: i === steps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  _clear();
  {
    const _body = await typewriterReply('That’s Deep Research — hit Start or queue up many. You can also view past research in your ');
    const libLink = document.createElement('button');
    libLink.type = 'button';
    libLink.textContent = 'Library';
    libLink.style.cssText = 'background:none;border:none;padding:0;margin:0;color:var(--accent,var(--red));font:inherit;text-decoration:underline;cursor:pointer;';
    libLink.addEventListener('click', () => {
      if (window.documentModule && window.documentModule.openLibrary) {
        window.documentModule.openLibrary({ tab: 'research' });
      } else {
        document.getElementById('tool-library-btn')?.click();
      }
    });
    _body.appendChild(libLink);
    _body.appendChild(document.createTextNode('.'));
  }
  return true;
}

// ── Tour: Library + Document editor ──

async function _cmdTourLibrary(args, ctx) {
  // Clear the chat input so "/tour-library" doesn't linger.
  const _msgEl = document.getElementById('message');
  if (_msgEl) {
    _msgEl.value = '';
    _msgEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Shared tour-styles injection.
  if (!document.getElementById('tour-styles')) {
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent =
      '#tour-tooltip{position:fixed;z-index:10001;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--border);border-radius:8px;padding:12px 14px;max-width:280px;' +
      'font-family:inherit;font-size:0.8rem;line-height:1.5;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:auto;' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.3s ease-out,transform 0.3s ease-out}' +
      '#tour-tooltip.tour-fade-in{opacity:1;transform:translateY(0)}' +
      '#tour-tooltip .tour-text{margin-bottom:8px;opacity:0.8}' +
      '.tour-nav{display:flex;align-items:center;justify-content:space-between}' +
      '.tour-nav button{background:none;border:1px solid var(--border);color:var(--fg);' +
      'cursor:pointer;font-family:inherit;border-radius:4px;transition:all .1s}' +
      '.tour-nav button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}' +
      '.tour-btn-arrow{font-size:1rem;padding:4px 12px;opacity:0.6}' +
      '.tour-btn-arrow:hover{opacity:1}' +
      '.tour-btn-arrow.disabled{opacity:0.15;pointer-events:none}' +
      '.tour-btn-skip{font-size:0.72rem;padding:3px 10px;opacity:0.35;border-color:transparent!important}' +
      '.tour-btn-skip:hover{opacity:0.6}';
    document.head.appendChild(s);
  }

  // Open the library modal if it's not already up.
  let libModal = document.getElementById('doclib-modal');
  if (!libModal) {
    const opener = document.getElementById('tool-library-btn') || document.getElementById('rail-archive');
    if (opener) opener.click();
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 80));
      libModal = document.getElementById('doclib-modal');
      if (libModal) break;
    }
  }
  if (!libModal) {
    slashReply('Could not open Library. Try clicking the Library tool first.');
    return true;
  }

  document.body.classList.add('tour-active');
  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  document.body.appendChild(tooltip);

  let _halos = [];
  function _makeHalo(target) {
    const halo = document.createElement('div');
    halo.className = 'tour-halo';
    document.body.appendChild(halo);
    const update = () => {
      const r = target.getBoundingClientRect();
      halo.style.top    = (r.top - 4) + 'px';
      halo.style.left   = (r.left - 4) + 'px';
      halo.style.width  = (r.width + 8) + 'px';
      halo.style.height = (r.height + 8) + 'px';
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    requestAnimationFrame(() => halo.classList.add('tour-fade-in'));
    return { destroy() {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      halo.remove();
    } };
  }
  function _clearHalos() {
    _halos.forEach(h => h.destroy());
    _halos = [];
    document.querySelectorAll('.tour-halo').forEach(e => e.remove());
  }
  const _clear = () => {
    document.querySelectorAll('.odysseus-highlight').forEach(e => e.classList.remove('odysseus-highlight'));
    _clearHalos();
    tooltip.remove();
    document.body.classList.remove('tour-active');
  };

  function _positionTooltip(target, placement) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = '';
    const tw = tooltip.offsetWidth || 260;
    const th = tooltip.offsetHeight || 100;
    if (placement === 'center-above') {
      const top = Math.max(10, window.innerHeight * 0.32 - th / 2);
      const left = Math.max(10, window.innerWidth / 2 - tw / 2);
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
      tooltip.style.visibility = '';
      return;
    }
    const r = target.getBoundingClientRect();
    const gap = 12;
    let top, left;
    if (r.bottom + gap + th < window.innerHeight - 10) {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - tw / 2;
    } else if (r.top - gap - th > 10) {
      top = r.top - gap - th;
      left = r.left + r.width / 2 - tw / 2;
    } else {
      top = r.top + r.height / 2 - th / 2;
      left = r.right + gap;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - gap;
    }
    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.style.visibility = '';
  }

  function _showStep(sel, text, opts) {
    opts = opts || {};
    const isFirst = !!opts.isFirst;
    const isLast = !!opts.isLast;
    const before = opts.before;
    const placement = opts.placement;
    const interactive = !!opts.interactive;
    const optional = !!opts.optional;
    return new Promise(resolve => {
      _clearHalos();
      if (before) { try { before(); } catch (_) {} }
      const target = document.querySelector(sel);
      if (!target) return resolve(optional ? 'next' : 'skip');
      _halos.push(_makeHalo(target));
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      tooltip.classList.remove('tour-fade-in');
      tooltip.innerHTML =
        '<div class="tour-text">' + text + '</div>' +
        '<div class="tour-nav">' +
          '<button class="tour-btn-arrow' + (isFirst ? ' disabled' : '') + '" data-act="back">←</button>' +
          '<button class="tour-btn-skip" data-act="skip">' + (isLast ? 'done' : 'skip tour') + '</button>' +
          '<button class="tour-btn-arrow" data-act="next">' + (isLast ? '✓' : '→') + '</button>' +
        '</div>';
      requestAnimationFrame(() => {
        _positionTooltip(target, placement);
        tooltip.classList.add('tour-fade-in');
      });

      let _onTarget;
      const cleanup = () => {
        tooltip.removeEventListener('click', onClick);
        if (_onTarget) target.removeEventListener('click', _onTarget, true);
      };
      const onClick = (e) => {
        const hit = e.target.closest && e.target.closest('[data-act]');
        const act = hit && hit.dataset.act;
        if (!act) return;
        cleanup();
        resolve(act);
      };
      tooltip.addEventListener('click', onClick);
      // Interactive steps advance when the user clicks the highlighted
      // element — letting the original click through so the real action
      // (open the Create modal, in the Library case) actually fires.
      if (interactive) {
        _onTarget = () => { cleanup(); resolve('next'); };
        target.addEventListener('click', _onTarget, true);
      }
    });
  }

  // ── Phase 1: Library overview ──
  const libSteps = [
    { sel: '#doclib-modal .doclib-modal-content',
      text: '<b>Welcome to Library!</b> Your hub for <b>Chats</b>, <b>Documents</b>, <b>Research</b>, and <b>Archive</b> — search, sort and tidy!',
      placement: 'center-above',
      before: () => {
        // Force the modal box to fill its intended frame so the halo wraps the
        // whole library window, not just the (possibly collapsed) content.
        const c = document.querySelector('#doclib-modal .doclib-modal-content');
        if (c) {
          c.style.height = '85vh';
          c.style.minHeight = '85vh';
        }
      } },
    { sel: '#doclib-create-btn',
      text: '<b>Create</b> a fresh blank document — click it to try it out! (Or hit <b>Import</b> next to it to bring in a file from disk.)',
      interactive: true },
    { sel: '#doclib-grid .doclib-card',
      text: 'Each card is a saved document. It’s linked to the chat you created it in — so either <b>clone</b> it for a new chat, or <b>open</b> it in its original.',
      optional: true },
  ];

  for (let i = 0; i < libSteps.length; i++) {
    const step = libSteps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: i === 0,
      isLast: false,
      before: step.before,
      placement: step.placement,
      interactive: step.interactive,
      optional: step.optional,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  // ── Phase 2: open a document & walk the editor ──
  // Try to load the user's most recent document. If none exist, end with a hint.
  let firstDocId = null;
  try {
    const r = await fetch('/api/documents/library?limit=1&sort=recent', { credentials: 'same-origin' });
    if (r.ok) {
      const data = await r.json();
      if (data.documents && data.documents.length) firstDocId = data.documents[0].id;
    }
  } catch (_) {}

  if (!firstDocId || !window.documentModule || !window.documentModule.loadDocument) {
    _clear();
    await typewriterReply('All yours — create or import a doc, then run /tour-library again to see the editor.');
    return true;
  }

  // Close library, open the doc in the editor, wait for the pane to mount.
  document.getElementById('doclib-close')?.click();
  await new Promise(r => setTimeout(r, 200));
  try { await window.documentModule.loadDocument(firstDocId); } catch (_) {}
  for (let i = 0; i < 25; i++) {
    if (document.getElementById('doc-editor-pane')) break;
    await new Promise(r => setTimeout(r, 80));
  }
  if (!document.getElementById('doc-editor-pane')) {
    _clear();
    await typewriterReply('All yours — open a doc and run /tour-library again for the editor walkthrough.');
    return true;
  }

  const editorSteps = [
    { sel: '#doc-editor-pane',
      text: '<b>This is your document editor.</b> You can write here, but so can your model.',
      placement: 'center-above' },
    { sel: '#message',
      text: 'Just tell your model what to write or edit.',
      placement: 'center-above' },
    { sel: '#doc-tab-bar',
      text: 'Multiple docs as <b>tabs</b>. Drag to reorder, click <b>+</b> for a new one, click the dots for rename / clone / export / delete.' },
    { sel: '#doc-language-select',
      text: 'Switch the <b>document type</b> — markdown shows a preview, email shows To/Subject/Send, PDF lets you fill blanks with AI.' },
    { sel: '#doc-editor-textarea',
      text: 'Ask the LLM to <i>draft</i>, <i>rewrite</i>, <i>summarize</i>, <i>feedback</i> — edits stream live.' },
  ];

  for (let i = 0; i < editorSteps.length; i++) {
    const step = editorSteps[i];
    const res = await _showStep(step.sel, step.text, {
      isFirst: false,
      isLast: i === editorSteps.length - 1,
      before: step.before,
      placement: step.placement,
    });
    if (res === 'skip') { _clear(); return true; }
    if (res === 'back') { if (i > 0) i -= 2; continue; }
  }

  _clear();
  await typewriterReply('All yours — write away!');
  return true;
}