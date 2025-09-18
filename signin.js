import { auth, signInWithGoogle, signInWithGitHub, redirectAfterLogin } from '/auth.js';

const q = (id) => document.getElementById(id);
const msg = q('msg');

function setMsg(text, isError = true){
  if(!msg) return;
  msg.style.color = isError ? '#ef4444' : '#22c55e';
  msg.textContent = text || '';
}

async function handle(promise){
  try{
    setMsg('');
    await promise;
    redirectAfterLogin();
  }catch(e){
    console.error(e);
    setMsg(e?.message || 'Authentication failed');
  }
}

// Social sign-in buttons
q('btn-google')?.addEventListener('click', ()=> handle(signInWithGoogle()));
q('btn-github')?.addEventListener('click', ()=> handle(signInWithGitHub()));

// On /signin page load, redirect if already signed in
window.addEventListener('DOMContentLoaded', () => {
  if (auth.currentUser) {
    redirectAfterLogin();
  }
});
