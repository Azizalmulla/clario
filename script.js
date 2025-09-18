// Mobile nav toggle and smooth scrolling + before/after sliders
(function(){
  const h = document.querySelector('.hamburger');
  const nav = document.querySelector('.nav-links');
  if(h){
    h.addEventListener('click', () => {
      const open = nav && getComputedStyle(nav).display !== 'none';
      if(nav){ nav.style.display = open ? 'none' : 'flex'; }
      h.setAttribute('aria-expanded', String(!open));
    });
  }

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if(id && id.length > 1){
        const el = document.querySelector(id);
        if(el){
          e.preventDefault();
          el.scrollIntoView({behavior:'smooth', block:'start'});
        }
      }
    });
  });

  // Before/After sliders
  function attachBA(card){
    const after = card.querySelector('img.after');
    const slider = card.querySelector('input.slider');
    if(!after || !slider) return;
    const update = () => { after.style.width = slider.value + '%'; };
    slider.addEventListener('input', update);
    update();
  }
  document.querySelectorAll('.ba-card').forEach(attachBA);

  // Year in footer
  const y = document.getElementById('year');
  if(y) y.textContent = new Date().getFullYear();
})();
