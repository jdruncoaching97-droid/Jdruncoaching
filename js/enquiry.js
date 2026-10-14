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
    var row = { name: String(f.get('name')).trim(), email: String(f.get('email')).trim(), goal: String(f.get('goal') || '').trim() || null,
      background: String(f.get('background') || '').trim() || null, plan: String(f.get('plan') || '').trim() || null };
    function send(body) {
      return fetch(cfg.SUPABASE_URL + '/rest/v1/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      });
    }
    send(row).then(function (r) {
      if (r.ok) return r;
      if (r.status === 400 && row.plan) {   // plan column not added yet: keep the choice in the text instead
        var alt = Object.assign({}, row, { background: ('Option: ' + row.plan + (row.background ? '\n' + row.background : '')).slice(0, 2000) }); delete alt.plan;
        return send(alt);
      }
      return r;
    }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      location.href = 'thanks.html';
    }).catch(function () {
      form.submit();   // backup path: Netlify Forms
    });
  });
  // Apply buttons pre-select the option in the form
  document.querySelectorAll('[data-plan]').forEach(function (a) {
    a.addEventListener('click', function () { var s = form.querySelector('[name=plan]'); if (s) s.value = a.dataset.plan; });
  });
})();
