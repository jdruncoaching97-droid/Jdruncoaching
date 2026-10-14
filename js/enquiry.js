(function () {
  var form = document.querySelector('form.enquire');
  if (!form) return;
  var cfg = window.JD_CONFIG || {};
  var btn = form.querySelector('button[type=submit]');
  var msg = document.createElement('p');
  msg.setAttribute('role', 'alert'); msg.className = 'note'; form.appendChild(msg);
  form.addEventListener('submit', function (e) {
    var f = new FormData(form);
    if (f.get('bot-field')) { e.preventDefault(); location.href = 'thanks.html'; return; }   // spam trap
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;                                 // fall back to Netlify Forms
    e.preventDefault();
    btn.disabled = true; msg.textContent = 'Sending';
    fetch(cfg.SUPABASE_URL + '/rest/v1/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, Prefer: 'return=minimal' },
      body: JSON.stringify({ name: String(f.get('name')).trim(), email: String(f.get('email')).trim(), goal: String(f.get('goal') || '').trim() || null, background: String(f.get('background') || '').trim() || null })
    }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      location.href = 'thanks.html';
    }).catch(function () {
      form.submit();   // backup path: Netlify Forms
    });
  });
})();
