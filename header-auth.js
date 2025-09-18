// Header authentication UI handler
import { auth } from '/auth.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const userNav = document.getElementById('user-nav');
const guestNav = document.getElementById('guest-nav');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const signOutBtn = document.getElementById('sign-out');

function updateHeader(user) {
  console.log('updateHeader called with user:', user);
  if (user) {
    // Show user info in header
    if (userName) {
      userName.textContent = user.displayName || user.email?.split('@')[0] || 'User';
      console.log('Set user name to:', userName.textContent);
    }
    if (userAvatar && user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.style.display = 'block';
    } else if (userAvatar) {
      userAvatar.style.display = 'none';
    }
    
    if (userNav) {
      userNav.style.display = 'flex';
      console.log('Showing user nav');
    }
    if (guestNav) {
      guestNav.style.display = 'none';
      console.log('Hiding guest nav');
    }
  } else {
    // Show guest navigation
    console.log('No user, showing guest nav');
    if (userNav) userNav.style.display = 'none';
    if (guestNav) guestNav.style.display = 'flex';
  }
}

// Listen for auth state changes
onAuthStateChanged(auth, updateHeader);

// Sign out handler
signOutBtn?.addEventListener('click', async () => {
  try {
    await signOut(auth);
    location.href = '/';
  } catch (err) {
    console.error('Sign out failed:', err);
  }
});
