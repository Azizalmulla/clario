// Payment initiation script for Clario pricing
// Wires pricing buttons to backend /api/pay/create. Sends only { planId }.
// Requires user to be signed in; redirects to /signin if not.

// Use as a module: included by index.html
import { auth, onReady } from '/auth.js';

function setLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalText = btn.textContent || '';
    btn.textContent = 'Redirecting…';
    btn.disabled = true;
  } else {
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
    btn.disabled = false;
  }
}

async function startPayment(planId, btn) {
  try {
    console.log('startPayment called with planId:', planId);
    let user = auth.currentUser;
    if (!user) {
      console.log('No current user, waiting for auth...');
      // Wait for auth to resolve (handles early clicks after page load)
      user = await new Promise(resolve => onReady(resolve));
    }
    if (!user) {
      console.log('Still no user after auth ready, redirecting to signin');
      // Not signed in → remember intent and go to sign-in
      try { sessionStorage.setItem('postLogin', '/#pricing'); } catch(_) {}
      location.href = '/signin';
      return;
    }
    console.log('User found, starting payment for:', user.email);
    setLoading(btn, true);

    const idToken = await user.getIdToken();
    const resp = await fetch('/api/pay/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ planId })
    });

    if (!resp.ok) {
      console.error('Create payment failed', await resp.text());
      alert('Could not start payment. Please try again.');
      setLoading(btn, false);
      return;
    }
    const data = await resp.json();
    const url = data?.url;
    if (!url) {
      alert('Payment URL not returned.');
      setLoading(btn, false);
      return;
    }
    // Redirect to MyFatoorah payment page
    location.href = url;
  } catch (err) {
    console.error(err);
    alert('Unexpected error starting payment.');
    setLoading(btn, false);
  }
}

// Wire up pricing buttons
function wirePricing() {
  const btns = document.querySelectorAll('[data-plan]');
  console.log('wirePricing: Found', btns.length, 'buttons with data-plan');
  console.log('All buttons:', Array.from(btns).map(b => b.outerHTML));
  btns.forEach((btn, index) => {
    console.log(`Adding click listener to button ${index}:`, btn.getAttribute('data-plan'));
    // Remove any existing listeners and add new one
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Button clicked:', btn.getAttribute('data-plan'));
      const planId = btn.getAttribute('data-plan');
      if (!planId) return;
      startPayment(planId, btn);
    };
    // Also add via addEventListener as backup
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Button clicked (addEventListener):', btn.getAttribute('data-plan'));
    });
  });
}

// Try multiple timing approaches to ensure buttons are wired
function initPayment() {
  console.log('pay.js: initPayment called');
  wirePricing();
  console.log('pay.js: Found', document.querySelectorAll('[data-plan]').length, 'pricing buttons');
}

// Wire immediately if DOM is ready
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initPayment);
} else {
  initPayment();
}

// Also try after a short delay as fallback
setTimeout(initPayment, 100);
