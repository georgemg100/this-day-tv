// Viewer support ("membership"), done the way public television did it:
// programming stays free for everyone, supporters chip in, and the station
// says thank you. Nothing here interrupts a broadcast.
//
// Configured by the `support` block in station.json. With no tier links the
// whole thing stays hidden (preview it with ?pledge). Checkout happens on the
// payment provider's page (e.g. a Stripe Payment Link) whose success URL
// points back here with ?member, which marks this browser as a member.
// Membership is honour-system: it only quiets reminders and changes a few
// on-screen thank-yous, so there is nothing to protect.

const NUDGE_EVERY_MS = 7 * 24 * 3600 * 1000;
const NUDGE_SHOW_MS = 11000;

export const SUPPORT_DEFAULTS = {
  processor: 'Stripe',
  nudgeAfterMinutes: 25,
  manageUrl: '',
  tiers: [],
};

const httpsUrl = (v) => {
  if (typeof v !== 'string' || !v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
};
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Defensive copy of station.json's `support` block. */
export function supportConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const tiers = (Array.isArray(r.tiers) ? r.tiers : []).slice(0, 4).map((t) => ({
    name: text(t?.name, 24) || 'Member',
    price: text(t?.price, 32),
    blurb: text(t?.blurb, 90),
    url: httpsUrl(t?.url),
    featured: t?.featured === true,
  })).filter((t) => t.price);
  const after = Number(r.nudgeAfterMinutes);
  return {
    processor: text(r.processor, 24) || SUPPORT_DEFAULTS.processor,
    nudgeAfterMinutes: Number.isFinite(after) && after >= 0 ? after : SUPPORT_DEFAULTS.nudgeAfterMinutes,
    manageUrl: httpsUrl(r.manageUrl),
    tiers,
    enabled: tiers.some((t) => t.url),
  };
}

/** A gentle reminder at most once a week, only after a good long watch. */
export function shouldNudge({ enabled, member, afterMinutes, watchedSeconds, lastNudgeMs, nowMs }) {
  if (!enabled || member || !(afterMinutes > 0)) return false;
  if (watchedSeconds < afterMinutes * 60) return false;
  return !(lastNudgeMs > 0) || nowMs - lastNudgeMs >= NUDGE_EVERY_MS;
}

/** The small line under break and sign-off cards. */
export function cardFootText(style, { enabled, member }) {
  if (!enabled || (style !== 'break' && style !== 'sign-off')) return '';
  return member ? 'Made possible by members like you' : 'Viewer-supported television';
}

// ------------------------------------------------------------------ DOM
/**
 * Wire up the pledge card, entry points and the weekly reminder.
 * `store` is the page's try/catch localStorage wrapper; `canNudge()` says
 * whether the picture is free for a moment (no program title showing).
 */
export function mountSupport({ store, canNudge, stationName = 'This Day TV', callsign = 'WTDI' }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('pledge');
  let cfg = supportConfig(null);
  let preview = false;
  let watched = 0;
  let nudgeTimer = 0;

  const isMember = () => store.get('tdtv-member') === '1';
  const visible = () => cfg.enabled || preview;

  function setMember(on) {
    if (on) {
      store.set('tdtv-member', '1');
      if (!store.get('tdtv-member-since')) store.set('tdtv-member-since', new Date().toISOString().slice(0, 10));
    } else {
      store.set('tdtv-member', '0');
    }
    render();
  }

  function memberSince() {
    const d = new Date(`${store.get('tdtv-member-since') || new Date().toISOString().slice(0, 10)}T12:00:00`);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function tierRow(t) {
    const li = document.createElement('li');
    if (t.featured) li.className = 'featured';
    const box = document.createElement('span');
    box.className = 'box';
    box.setAttribute('aria-hidden', 'true');
    const body = document.createElement('span');
    body.className = 'tier';
    const name = document.createElement('b');
    name.textContent = t.name;
    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = t.price;
    body.append(name, price);
    if (t.blurb) {
      const blurb = document.createElement('small');
      blurb.textContent = t.blurb;
      body.append(blurb);
    }
    let action;
    if (t.url) {
      action = document.createElement('a');
      action.href = t.url;
      action.target = '_blank';
      action.rel = 'noopener';
      action.textContent = 'Pledge';
      action.setAttribute('aria-label', `Pledge ${t.price} as a ${t.name}`);
    } else {
      action = document.createElement('span');
      action.className = 'soon';
      action.textContent = 'Soon';
    }
    li.append(box, body, action);
    return li;
  }

  function render() {
    const member = isMember();
    const show = visible();
    $('btnSupport').hidden = !show;
    $('offSupport').hidden = !show;
    $('offSupport').textContent = member ? `Thank you for being a member` : 'Viewer-supported television · Become a member';
    $('guideSupport').hidden = !show;
    $('guideSupportText').textContent = member
      ? `${stationName} is made possible by members like you. Thank you.`
      : `${stationName} is free for everyone and supported by viewers like you.`;
    $('guideSupportBtn').textContent = member ? 'Your membership' : 'Become a member';
    $('btnSupport').setAttribute('aria-label', member ? 'Your membership' : 'Support the station');

    $('pledgeCallsign').textContent = `${callsign} · Viewer-supported television`;
    $('pledgeTiers').replaceChildren(...cfg.tiers.map(tierRow));
    $('pledgeTiers').hidden = cfg.tiers.length === 0;
    $('pledgeProcessor').textContent = cfg.tiers.some((t) => t.url)
      ? `Payments are handled securely by ${cfg.processor}. Cancel anytime.`
      : 'Memberships open soon.';
    $('pledgeManage').hidden = !cfg.manageUrl;
    if (cfg.manageUrl) $('pledgeManage').href = cfg.manageUrl;
    $('memberManage').hidden = !cfg.manageUrl;
    if (cfg.manageUrl) $('memberManage').href = cfg.manageUrl;
    $('memberSince').textContent = `Member since ${memberSince()}`;
    $('memberStation').textContent = stationName;
  }

  function open(view = isMember() ? 'member' : 'form') {
    hideNudge();
    $('pledgeForm').hidden = view !== 'form';
    $('pledgeMember').hidden = view !== 'member';
    $('memberThanks').hidden = view !== 'thanks';
    if (view === 'thanks') $('pledgeMember').hidden = false;
    if (!dialog.open) dialog.showModal();
  }
  const close = () => dialog.open && dialog.close();

  function hideNudge() {
    clearTimeout(nudgeTimer);
    $('nudge').hidden = true;
  }

  function showNudge() {
    store.set('tdtv-nudged', Date.now());
    $('nudge').hidden = false;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(hideNudge, NUDGE_SHOW_MS);
  }

  /** Call every tick with seconds actually spent watching. */
  function tick(seconds) {
    watched += seconds;
    if (dialog.open || !$('nudge').hidden) return;
    if (!shouldNudge({
      enabled: cfg.enabled,
      member: isMember(),
      afterMinutes: cfg.nudgeAfterMinutes,
      watchedSeconds: watched,
      lastNudgeMs: Number(store.get('tdtv-nudged')) || 0,
      nowMs: Date.now(),
    })) return;
    if (canNudge()) showNudge();
  }

  $('btnSupport').addEventListener('click', () => open());
  $('offSupport').addEventListener('click', () => open());
  $('guideSupportBtn').addEventListener('click', () => open());
  $('nudge').addEventListener('click', () => open('form'));
  $('pledgeClose').addEventListener('click', close);
  $('memberClose').addEventListener('click', close);
  $('pledgeAlready').addEventListener('click', () => { setMember(true); open('member'); });
  $('memberForget').addEventListener('click', () => { setMember(false); open('form'); });
  // Click on the backdrop (outside the card) closes.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  return {
    configure(raw, { previewMode = false } = {}) {
      cfg = supportConfig(raw);
      preview = previewMode;
      render();
    },
    /** Handle ?member (back from checkout) and ?pledge (preview / direct link). */
    handleLocation(params) {
      if (params.has('member')) {
        setMember(true);
        open('thanks');
      } else if (params.has('pledge') || params.has('support')) {
        open();
      }
    },
    open,
    isOpen: () => dialog.open,
    isMember,
    cardFoot: (style) => cardFootText(style, { enabled: visible(), member: isMember() }),
    tick,
    hideNudge,
  };
}
