(function () {
  'use strict';
  var app = document.getElementById('app');
  var cfg = window.JD_CONFIG || {};
  var V = window.VDOT;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || app).querySelector(sel); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseISO(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(d) { return d.getDate() + ' ' + MON[d.getMonth()]; }
  function fmtWeek(m) { return fmtDay(m) + ' to ' + fmtDay(addDays(m, 6)); }
  var TYPES = { easy: 'Easy', long: 'Long run', threshold: 'Threshold', interval: 'Interval', repetition: 'Repetition', race: 'Race', strength: 'Strength', cross: 'Cross-training', rest: 'Rest' };
  function pacePerKm(km, sec) { return km > 0 ? V.fmtPace(sec / km) + '/km' : ''; }

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    app.innerHTML = '<div class="auth"><h1>Portal not connected</h1><p>Add the Supabase project URL and anon key to <code>js/config.js</code>, then reload. Setup steps are in the README.</p></div>';
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  var state = { user: null, profile: null, tab: 'week', weekStart: mondayOf(new Date()), athlete: null, athleteWeek: mondayOf(new Date()) };

  /* ---------- auth ---------- */
  function renderAuth(mode, msg) {
    var signup = mode === 'signup', reset = mode === 'reset';
    app.innerHTML =
      '<div class="auth"><h1>' + (reset ? 'Reset password' : signup ? 'Create account' : 'Athlete login') + '</h1>' +
      '<p class="muted">JD Run Coaching</p>' +
      (msg ? '<p class="' + (msg.ok ? 'ok' : 'err') + '" role="alert">' + esc(msg.text) + '</p>' : '') +
      '<form class="stack" id="authform">' +
      (signup ? '<label>Full name<input name="name" required autocomplete="name"></label>' : '') +
      '<label>Email<input type="email" name="email" required autocomplete="email"></label>' +
      (reset ? '' : '<label>Password<input type="password" name="password" required minlength="8" autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></label>') +
      '<button class="btn" type="submit">' + (reset ? 'Send reset link' : signup ? 'Create account' : 'Log in') + '</button></form>' +
      '<p class="switch">' +
      (mode === 'login' ? '<button class="link" data-m="signup">Create an account</button> &nbsp;|&nbsp; <button class="link" data-m="reset">Forgot password</button>' : '<button class="link" data-m="login">Back to login</button>') +
      '</p></div>';
    app.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { renderAuth(b.dataset.m); }; });
    $('#authform').onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target), email = f.get('email'), pw = f.get('password'), res;
      if (reset) {
        res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        return renderAuth('reset', res.error ? { text: res.error.message } : { ok: true, text: 'Check your email for a reset link.' });
      }
      if (signup) {
        res = await sb.auth.signUp({ email: email, password: pw, options: { data: { full_name: f.get('name') } } });
        if (res.error) return renderAuth('signup', { text: res.error.message });
        if (!res.data.session) return renderAuth('login', { ok: true, text: 'Account created. Confirm your email, then log in.' });
        return;
      }
      res = await sb.auth.signInWithPassword({ email: email, password: pw });
      if (res.error) renderAuth('login', { text: 'Email or password is incorrect.' });
    };
  }

  /* ---------- shell ---------- */
  function shell(tabs, bodyHtml) {
    var p = state.profile;
    app.innerHTML =
      '<header class="topbar"><div class="in"><a class="brand" href="./">JD</a><div class="who"><span>' + esc(p.full_name || p.email) + (p.role === 'coach' && !/coach/i.test(p.full_name || '') ? ' (coach)' : '') + '</span><button id="out">Log out</button></div></div></header>' +
      '<nav class="tabs" aria-label="Portal"><div class="in">' +
      tabs.map(function (t) { return '<button data-tab="' + t[0] + '"' + (state.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>'; }).join('') +
      '</div></nav><main class="main" id="view">' + bodyHtml + '</main>';
    $('#out').onclick = function () { sb.auth.signOut(); };
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { state.tab = b.dataset.tab; state.athlete = null; route(); }; });
  }
  function dbError(error) { return error ? '<p class="err" role="alert">' + esc(error.message) + '</p>' : ''; }

  /* ---------- shared: pace table + calculator ---------- */
  function pacesHtml(vdot) {
    var p = V.paces(vdot);
    return '<div class="paces">' +
      [['Easy', V.fmtPace(p.easyFast) + ' to ' + V.fmtPace(p.easySlow) + '/km'], ['Marathon', V.fmtPace(p.marathon) + '/km'], ['Threshold', V.fmtPace(p.threshold) + '/km'],
       ['Interval', V.fmtPace(p.interval) + '/km'], ['Repetition (400 m)', Math.round(p.repetition400) + ' s'],
       ['5K', V.fmtTime(V.raceSeconds(vdot, 5000))], ['10K', V.fmtTime(V.raceSeconds(vdot, 10000))], ['Half marathon', V.fmtTime(V.raceSeconds(vdot, 21097.5))]]
      .map(function (r) { return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</div>';
  }
  function calcView(currentVdot) {
    return '<h1>Paces</h1>' +
      (currentVdot ? '<div class="panel"><h2>Your coach set VDOT ' + esc(currentVdot) + '</h2>' + pacesHtml(Number(currentVdot)) + '</div>' : '') +
      '<div class="panel"><h2>Calculate from a race time</h2><p class="muted">Use a recent, all-out race or time trial. Paces follow Daniels\' tables to within a couple of seconds.</p>' +
      '<form class="grid3" id="calc"><label>Distance<select name="d"><option value="5000">5K</option><option value="10000">10K</option><option value="21097.5">Half marathon</option><option value="42195">Marathon</option><option value="3000">3K</option></select></label>' +
      '<label>Time (mm:ss or h:mm:ss)<input name="t" required placeholder="21:30"></label><label>&nbsp;<button class="btn" type="submit">Calculate</button></label></form>' +
      '<div id="calcout" style="margin-top:16px"></div></div>';
  }
  function bindCalc() {
    var f = $('#calc'); if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(f), sec = V.parseDuration(fd.get('t')), d = Number(fd.get('d')), out = $('#calcout');
      if (!(sec > 0)) { out.innerHTML = '<p class="err" role="alert">Enter the time as mm:ss or h:mm:ss, for example 21:30.</p>'; return; }
      var vd = V.vdotFromRace(d, sec);
      if (!(vd > 20 && vd < 90)) { out.innerHTML = '<p class="err" role="alert">That time gives a VDOT outside 20 to 90. Check the distance and time.</p>'; return; }
      out.innerHTML = '<p><strong>VDOT ' + vd.toFixed(1) + '</strong></p>' + pacesHtml(vd);
    };
  }

  /* ---------- athlete ---------- */
  var ATHLETE_TABS = [['week', 'This week'], ['log', 'Log a run'], ['history', 'History'], ['paces', 'Paces']];

  async function athleteWeek() {
    var uid = state.user.id, ws = state.weekStart, we = addDays(ws, 6);
    var q = await Promise.all([
      sb.from('plan_sessions').select('*').eq('athlete_id', uid).gte('session_date', iso(ws)).lte('session_date', iso(we)).order('session_date'),
      sb.from('session_logs').select('*').eq('athlete_id', uid).gte('log_date', iso(ws)).lte('log_date', iso(we)).order('log_date')]);
    var sessions = q[0].data || [], logs = q[1].data || [], today = iso(new Date()), days = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(ws, i), key = iso(d);
      var ss = sessions.filter(function (s) { return s.session_date === key; });
      var ll = logs.filter(function (l) { return l.log_date === key; });
      var body = ss.map(function (s) {
        var done = logs.some(function (l) { return l.plan_session_id === s.id; });
        return '<div class="sess"><h3><span class="chip' + (done ? ' done' : '') + '">' + (done ? 'Logged' : esc(TYPES[s.session_type] || s.session_type)) + '</span>' + esc(s.title) + (s.target_km ? ' <span class="muted">(' + esc(s.target_km) + ' km)</span>' : '') + '</h3>' +
          (s.description ? '<p>' + esc(s.description) + '</p>' : '') +
          (done || s.session_type === 'rest' ? '' : '<div><button class="btn small ghost" data-log="' + s.id + '" data-date="' + key + '">Log this session</button></div>') + '</div>';
      }).join('');
      var extra = ll.filter(function (l) { return !l.plan_session_id; }).map(function (l) {
        return '<div class="sess"><h3><span class="chip done">Logged</span>' + esc(l.distance_km) + ' km</h3><p class="muted">' + esc(V.fmtTime(l.duration_sec)) + ' | ' + pacePerKm(Number(l.distance_km), l.duration_sec) + '</p></div>';
      }).join('');
      days += '<div class="day' + (key === today ? ' today' : '') + '"><div class="date">' + DOW[i] + '<small>' + fmtDay(d) + '</small></div><div class="body">' +
        ((body || extra) ? body + extra : '<span class="muted">Nothing planned</span>') + '</div></div>';
    }
    var logged = logs.reduce(function (a, l) { return a + Number(l.distance_km); }, 0);
    var planned = sessions.reduce(function (a, s) { return a + Number(s.target_km || 0); }, 0);
    shell(ATHLETE_TABS,
      '<h1>This week</h1>' + dbError(q[0].error || q[1].error) +
      (state.profile.coach_id ? '' : '<p class="notice">Your coach hasn\'t added you yet. You can log runs now, and plans will appear here once they do.</p>') +
      '<div class="weeknav"><button class="btn small ghost" id="prev">Previous</button><strong>' + fmtWeek(ws) + '</strong><button class="btn small ghost" id="next">Next</button><button class="btn small ghost" id="thisweek">This week</button></div>' +
      '<p class="muted">Logged ' + logged.toFixed(1) + ' km' + (planned ? ' of ' + planned.toFixed(1) + ' km planned' : '') + '</p><div class="week">' + days + '</div>');
    $('#prev').onclick = function () { state.weekStart = addDays(ws, -7); athleteWeek(); };
    $('#next').onclick = function () { state.weekStart = addDays(ws, 7); athleteWeek(); };
    $('#thisweek').onclick = function () { state.weekStart = mondayOf(new Date()); athleteWeek(); };
    app.querySelectorAll('[data-log]').forEach(function (b) {
      b.onclick = function () { state.tab = 'log'; state.prefill = { plan_session_id: b.dataset.log, date: b.dataset.date }; route(); };
    });
  }

  function logForm() {
    var pre = state.prefill || {}; state.prefill = null;
    shell(ATHLETE_TABS,
      '<h1>Log a run</h1><div class="panel"><form class="stack" id="logf">' +
      '<div class="grid3"><label>Date<input type="date" name="date" required value="' + esc(pre.date || iso(new Date())) + '"></label>' +
      '<label>Distance (km)<input type="number" name="km" step="0.01" min="0.1" max="299" required></label>' +
      '<label>Time (mm:ss or h:mm:ss)<input name="time" required placeholder="52:30"></label></div>' +
      '<div class="grid2"><label>Effort (RPE 1 to 10)<select name="rpe"><option value="">Not rated</option>' + [1,2,3,4,5,6,7,8,9,10].map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label>Niggle score (0 none, 10 worst)<select name="niggle">' + [0,1,2,3,4,5,6,7,8,9,10].map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Notes<textarea name="notes" placeholder="Paces, how it felt, shins or calves"></textarea></label>' +
      '<div id="logmsg"></div><div><button class="btn" type="submit">Save run</button></div></form></div>');
    $('#logf').onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target), sec = V.parseDuration(f.get('time')), msg = $('#logmsg');
      if (!(sec > 0)) { msg.innerHTML = '<p class="err" role="alert">Enter the time as mm:ss or h:mm:ss, for example 52:30.</p>'; return; }
      var row = { athlete_id: state.user.id, log_date: f.get('date'), distance_km: Number(f.get('km')), duration_sec: Math.round(sec),
        rpe: f.get('rpe') ? Number(f.get('rpe')) : null, niggle: Number(f.get('niggle')), notes: (f.get('notes') || '').trim() || null, plan_session_id: pre.plan_session_id || null };
      var r = await sb.from('session_logs').insert(row);
      if (r.error) { msg.innerHTML = dbError(r.error); return; }
      state.tab = 'week'; state.weekStart = mondayOf(parseISO(row.log_date)); route();
    };
  }

  async function history() {
    var r = await sb.from('session_logs').select('*').eq('athlete_id', state.user.id).order('log_date', { ascending: false }).limit(60);
    var logs = r.data || [];
    shell(ATHLETE_TABS, '<h1>History</h1>' + dbError(r.error) + (logs.length ? logTable(logs, true) : '<p class="empty">No runs logged yet. Log your first run from the Log a run tab.</p>'));
    app.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Delete this run?')) return;
        var d = await sb.from('session_logs').delete().eq('id', b.dataset.del);
        if (d.error) alert(d.error.message); else history();
      };
    });
  }
  function logTable(logs, canDelete) {
    return '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Distance</th><th>Time</th><th>Pace</th><th>RPE</th><th>Niggle</th><th>Notes</th>' + (canDelete ? '<th></th>' : '') + '</tr></thead><tbody>' +
      logs.map(function (l) {
        var n = l.niggle || 0;
        return '<tr><td data-label="Date">' + fmtDay(parseISO(l.log_date)) + '</td><td data-label="Distance">' + esc(l.distance_km) + ' km</td><td data-label="Time">' + V.fmtTime(l.duration_sec) + '</td><td data-label="Pace">' + pacePerKm(Number(l.distance_km), l.duration_sec) + '</td><td data-label="RPE">' + esc(l.rpe || '') + '</td>' +
          '<td data-label="Niggle">' + (n >= 4 ? '<span class="chip flag">' + n + '</span>' : n) + '</td><td data-label="Notes">' + esc(l.notes || '') + '</td>' +
          (canDelete ? '<td data-label=""><button class="link" data-del="' + esc(l.id) + '">Delete</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- coach ---------- */
  var COACH_TABS = [['athletes', 'Athletes'], ['enquiries', 'Enquiries'], ['paces', 'Paces']];

  async function coachEnquiries() {
    var r = await sb.from('enquiries').select('*').order('created_at', { ascending: false }).limit(100);
    var list = r.data || [], fresh = list.filter(function (e) { return !e.handled; }).length;
    var cards = list.map(function (e) {
      var d = new Date(e.created_at);
      return '<div class="panel"><div class="row"><h2 style="margin:0">' + esc(e.name) + (e.handled ? '' : ' <span class="chip flag">New</span>') + '</h2><span class="muted">' + fmtDay(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</span></div>' +
        '<p><a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a></p>' +
        (e.goal ? '<p><strong>Goal:</strong> ' + esc(e.goal) + '</p>' : '') +
        (e.background ? '<p style="white-space:pre-wrap">' + esc(e.background) + '</p>' : '') +
        '<div class="row" style="justify-content:flex-start"><button class="btn small ' + (e.handled ? 'ghost' : '') + '" data-handled="' + esc(e.id) + '" data-to="' + (e.handled ? 'false' : 'true') + '">' + (e.handled ? 'Mark as new' : 'Mark as handled') + '</button><button class="link" data-delenq="' + esc(e.id) + '">Delete</button></div></div>';
    }).join('');
    shell(COACH_TABS, '<h1>Enquiries</h1>' + dbError(r.error) + (list.length ? '<p class="muted">' + fresh + ' new</p>' + cards : '<p class="empty">No enquiries yet. They appear here when someone uses the form on your site.</p>'));
    app.querySelectorAll('[data-handled]').forEach(function (b) {
      b.onclick = async function () {
        var u = await sb.from('enquiries').update({ handled: b.dataset.to === 'true' }).eq('id', b.dataset.handled);
        if (u.error) alert(u.error.message); else coachEnquiries();
      };
    });
    app.querySelectorAll('[data-delenq]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Delete this enquiry?')) return;
        var d = await sb.from('enquiries').delete().eq('id', b.dataset.delenq);
        if (d.error) alert(d.error.message); else coachEnquiries();
      };
    });
  }

  async function coachAthletes() {
    var r = await sb.from('profiles').select('*').eq('role', 'athlete').order('full_name');
    var athletes = r.data || [], ids = athletes.map(function (a) { return a.id; }), logs = [];
    if (ids.length) {
      var since = iso(addDays(new Date(), -14));
      var lr = await sb.from('session_logs').select('athlete_id,log_date,distance_km,niggle').in('athlete_id', ids).gte('log_date', since);
      logs = lr.data || [];
    }
    var wk = iso(addDays(new Date(), -7));
    var rows = athletes.map(function (a) {
      var mine = logs.filter(function (l) { return l.athlete_id === a.id; });
      var last = mine.reduce(function (m, l) { return l.log_date > m ? l.log_date : m; }, '');
      var km = mine.filter(function (l) { return l.log_date > wk; }).reduce(function (s, l) { return s + Number(l.distance_km); }, 0);
      var flag = mine.some(function (l) { return l.log_date > wk && (l.niggle || 0) >= 4; });
      var mine_ = a.coach_id === state.user.id;
      return '<tr><td data-label="Athlete">' + (mine_ ? '<button class="link" data-open="' + esc(a.id) + '">' + esc(a.full_name || a.email) + '</button>' : esc(a.full_name || a.email)) + '<div class="muted">' + esc(a.email || '') + '</div></td>' +
        '<td data-label="VDOT">' + (a.vdot ? esc(a.vdot) : '-') + '</td><td data-label="Last run">' + (last ? fmtDay(parseISO(last)) : 'No runs') + '</td><td data-label="Last 7 days">' + km.toFixed(1) + ' km</td>' +
        '<td data-label="">' + (flag ? '<span class="chip flag">Niggle 4+</span>' : '') + (mine_ ? '' : '<button class="btn small" data-claim="' + esc(a.id) + '">Add to my athletes</button>') + '</td></tr>';
    }).join('');
    shell(COACH_TABS, '<h1>Athletes</h1>' + dbError(r.error) + (athletes.length ?
      '<div class="tablewrap"><table><thead><tr><th>Athlete</th><th>VDOT</th><th>Last run</th><th>Last 7 days</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
      '<p class="empty">No athletes yet. Ask athletes to create an account on this page, then add them here.</p>'));
    app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { state.athlete = athletes.find(function (a) { return a.id === b.dataset.open; }); state.athleteWeek = mondayOf(new Date()); coachAthlete(); }; });
    app.querySelectorAll('[data-claim]').forEach(function (b) {
      b.onclick = async function () {
        var u = await sb.from('profiles').update({ coach_id: state.user.id }).eq('id', b.dataset.claim);
        if (u.error) alert(u.error.message); else coachAthletes();
      };
    });
  }

  async function coachAthlete() {
    var a = state.athlete, ws = state.athleteWeek, we = addDays(ws, 6);
    var q = await Promise.all([
      sb.from('plan_sessions').select('*').eq('athlete_id', a.id).gte('session_date', iso(ws)).lte('session_date', iso(we)).order('session_date'),
      sb.from('session_logs').select('*').eq('athlete_id', a.id).order('log_date', { ascending: false }).limit(20)]);
    var sessions = q[0].data || [], logs = q[1].data || [];
    var planned = sessions.reduce(function (s, x) { return s + Number(x.target_km || 0); }, 0);
    var list = sessions.map(function (s) {
      return '<tr><td data-label="Day">' + DOW[(parseISO(s.session_date).getDay() + 6) % 7] + ' ' + fmtDay(parseISO(s.session_date)) + '</td><td data-label="Session"><span class="chip">' + esc(TYPES[s.session_type] || s.session_type) + '</span>' + esc(s.title) + '<div class="muted" style="white-space:pre-wrap">' + esc(s.description || '') + '</div></td><td data-label="km">' + esc(s.target_km || '') + '</td><td data-label=""><button class="link" data-delsess="' + esc(s.id) + '">Delete</button></td></tr>';
    }).join('');
    shell(COACH_TABS,
      '<p><button class="link" id="back">Back to athletes</button></p><h1>' + esc(a.full_name || a.email) + '</h1>' + dbError(q[0].error || q[1].error) +
      '<div class="panel"><form class="row" id="vdotf"><label>VDOT<input name="v" type="number" step="0.1" min="20" max="90" value="' + esc(a.vdot || '') + '" style="max-width:9ch"></label><button class="btn small" type="submit">Save VDOT</button><span id="vmsg" class="muted"></span></form>' + (a.vdot ? '<div style="margin-top:14px">' + pacesHtml(Number(a.vdot)) + '</div>' : '') + '</div>' +
      '<h2>Plan: ' + fmtWeek(ws) + '</h2><div class="weeknav"><button class="btn small ghost" id="prev">Previous</button><button class="btn small ghost" id="next">Next</button><button class="btn small ghost" id="copyprev">Copy previous week here</button><span class="muted">Planned ' + planned.toFixed(1) + ' km</span></div>' +
      (sessions.length ? '<div class="tablewrap"><table><thead><tr><th>Day</th><th>Session</th><th>km</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>' : '<p class="empty">No sessions this week.</p>') +
      '<div class="panel" style="margin-top:20px"><h2>Add a session</h2><form class="stack" id="addf"><div class="grid3"><label>Date<input type="date" name="date" required value="' + iso(ws) + '"></label>' +
      '<label>Type<select name="type">' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>Target km<input type="number" name="km" step="0.1" min="0" max="200"></label></div>' +
      '<label>Title<input name="title" required placeholder="3 x 6 min at T, 2 min jog"></label>' +
      '<label>Details<textarea name="desc" placeholder="Warm-up, paces, notes"></textarea></label><div id="addmsg"></div><div><button class="btn" type="submit">Add session</button></div></form></div>' +
      '<h2>Recent runs</h2>' + (logs.length ? logTable(logs, false) : '<p class="empty">No runs logged yet.</p>'));
    $('#back').onclick = function () { state.athlete = null; coachAthletes(); };
    $('#prev').onclick = function () { state.athleteWeek = addDays(ws, -7); coachAthlete(); };
    $('#next').onclick = function () { state.athleteWeek = addDays(ws, 7); coachAthlete(); };
    $('#vdotf').onsubmit = async function (e) {
      e.preventDefault();
      var v = new FormData(e.target).get('v'), val = v === '' ? null : Number(v);
      var u = await sb.from('profiles').update({ vdot: val }).eq('id', a.id);
      if (u.error) { $('#vmsg').textContent = u.error.message; return; }
      a.vdot = val; coachAthlete();
    };
    $('#addf').onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      var ins = await sb.from('plan_sessions').insert({ athlete_id: a.id, session_date: f.get('date'), session_type: f.get('type'), title: f.get('title').trim(), description: (f.get('desc') || '').trim() || null, target_km: f.get('km') ? Number(f.get('km')) : null });
      if (ins.error) { $('#addmsg').innerHTML = dbError(ins.error); return; }
      state.athleteWeek = mondayOf(parseISO(f.get('date'))); coachAthlete();
    };
    app.querySelectorAll('[data-delsess]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Delete this session?')) return;
        var d = await sb.from('plan_sessions').delete().eq('id', b.dataset.delsess);
        if (d.error) alert(d.error.message); else coachAthlete();
      };
    });
    $('#copyprev').onclick = async function () {
      if (sessions.length && !confirm('This week already has sessions. Copy the previous week in as well?')) return;
      var pw = addDays(ws, -7);
      var p = await sb.from('plan_sessions').select('*').eq('athlete_id', a.id).gte('session_date', iso(pw)).lte('session_date', iso(addDays(pw, 6)));
      if (p.error || !p.data.length) { alert(p.error ? p.error.message : 'The previous week has no sessions to copy.'); return; }
      var rows = p.data.map(function (s) { return { athlete_id: a.id, session_date: iso(addDays(parseISO(s.session_date), 7)), session_type: s.session_type, title: s.title, description: s.description, target_km: s.target_km }; });
      var ins = await sb.from('plan_sessions').insert(rows);
      if (ins.error) alert(ins.error.message); else coachAthlete();
    };
  }

  /* ---------- routing ---------- */
  function route() {
    if (!state.user) return renderAuth('login');
    if (!state.profile) { app.innerHTML = '<p class="loading">Loading</p>'; return; }
    if (state.profile.role === 'coach') {
      if (state.tab === 'paces') { shell(COACH_TABS, calcView(null)); return bindCalc(); }
      if (state.tab === 'enquiries') return coachEnquiries();
      state.tab = 'athletes';
      return state.athlete ? coachAthlete() : coachAthletes();
    }
    if (state.tab === 'log') return logForm();
    if (state.tab === 'history') return history();
    if (state.tab === 'paces') { shell(ATHLETE_TABS, calcView(state.profile.vdot)); return bindCalc(); }
    state.tab = 'week'; return athleteWeek();
  }

  async function onSession(session) {
    state.user = session ? session.user : null; state.profile = null;
    if (!state.user) return route();
    app.innerHTML = '<p class="loading">Loading</p>';
    var r = await sb.from('profiles').select('*').eq('id', state.user.id).single();
    if (r.error) { app.innerHTML = '<div class="auth"><h1>Account not ready</h1><p class="err">' + esc(r.error.message) + '</p><button class="btn" onclick="location.reload()">Reload</button></div>'; return; }
    state.profile = r.data; state.tab = r.data.role === 'coach' ? 'athletes' : 'week'; route();
  }
  var lastUid = null;
  sb.auth.onAuthStateChange(function (ev, session) {
    var uid = session ? session.user.id : null;
    if (ev === 'TOKEN_REFRESHED' || (uid === lastUid && ev !== 'SIGNED_OUT')) return;
    lastUid = uid; onSession(session);
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) { lastUid = null; route(); } });
})();
