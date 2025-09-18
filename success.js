// Success page logic: show auth state and live credits from Firestore
import { auth, db, onReady } from '/auth.js';
import { doc, onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

function $(sel){ return document.querySelector(sel); }

function setStatus(text){
  const el = $('#status'); if(el) el.textContent = text;
}
function show(el){ if(el) el.style.display = ''; }
function hide(el){ if(el) el.style.display = 'none'; }

window.addEventListener('DOMContentLoaded', () => {
  const signedOut = $('#signed-out');
  const signedIn = $('#signed-in');
  const emailEl = $('#user-email');
  const creditsEl = $('#credits');
  const spinner = $('#spinner');

  setStatus('We are confirming your payment… this should only take a moment.');
  show(spinner);
  hide(signedIn);
  hide(signedOut);

  // Track listener & polling across auth changes
  let unsubscribe = null;
  let pollInterval = null;

  onReady((user) => {
    // Clean up any previous state on auth change
    try { if (unsubscribe) { unsubscribe(); unsubscribe = null; } } catch(_) {}
    try { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } } catch(_) {}

    if(!user){
      hide(spinner);
      show(signedOut);
      setStatus('Please sign in to view your credits.');
      return;
    }
    // Signed in
    if(emailEl) emailEl.textContent = user.email || user.uid;
    show(signedIn);

    // Track last seen credits to avoid redundant UI work
    let lastCredits = -1;

    // Start a short fallback poll (every 2s up to ~10s) in case webhook is delayed
    let attempts = 0;
    const maxAttempts = 5; // ~10 seconds total
    const ref = doc(db, 'users', user.uid);
    pollInterval = setInterval(async () => {
      attempts++;
      try{
        const snap = await getDoc(ref);
        const data = snap.data() || {};
        const c = typeof data.credits === 'number' ? data.credits : 0;
        if(creditsEl) creditsEl.textContent = String(c);
        if(c > lastCredits){
          hide(spinner);
          setStatus('Payment processed. Your credits are up to date.');
        }
        lastCredits = c;
      }catch(_){ /* ignore transient errors */ }
      if(attempts >= maxAttempts){
        try { clearInterval(pollInterval); } catch(_) {}
        pollInterval = null;
      }
    }, 2000);

    // Live listen to user doc to reflect credits after webhook processes
    unsubscribe = onSnapshot(ref, (snap) => {
      const data = snap.data() || {};
      const credits = typeof data.credits === 'number' ? data.credits : 0;
      if(creditsEl) creditsEl.textContent = String(credits);
      hide(spinner);
      // If credits just appeared/incremented, show success
      setStatus('Payment processed. Your credits are up to date.');
      lastCredits = credits;
    }, (err) => {
      console.error('User doc listen error', err);
      hide(spinner);
      setStatus('Unable to load credits. Please try again later.');
    });

    // Clean up on unload
    window.addEventListener('beforeunload', () => {
      try { if (unsubscribe) { unsubscribe(); unsubscribe = null; } } catch(_) {}
      try { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } } catch(_) {}
    });
  });
});
