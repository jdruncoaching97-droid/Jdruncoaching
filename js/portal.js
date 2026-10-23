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
      '</p><p class="muted" style="margin-top:14px"><a href="../privacy.html">Privacy</a></p></div>';
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
      '<div class="panel"><h2>Calculate from a race time</h2><p class="muted">Use a recent, all-out race or time trial.</p>' +
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

  /* ---------- Garmin workout download ---------- */
  function garminBtn(s) {
    return (s.steps && s.steps.length) ? ' <button class="btn small ghost" data-fit="' + esc(s.id) + '">Download for Garmin</button>' : '';
  }
  function downloadFit(sess, vdot) {
    var name = (sess.title || 'Workout').replace(/[^A-Za-z0-9 .+-]/g, '').slice(0, 15).trim() || 'Workout';
    var bytes = FitWorkout.build({ name: name, steps: sess.steps, paces: vdot ? V.paces(Number(vdot)) : null });
    var blob = new Blob([bytes], { type: 'application/octet-stream' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (sess.session_date || 'workout') + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.fit';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function bindFit(sessions, vdot) {
    document.querySelectorAll('[data-fit]').forEach(function (b) {
      b.onclick = function () {
        var sess = sessions.filter(function (x) { return x.id === b.dataset.fit; })[0];
        if (sess) downloadFit(sess, vdot);
      };
    });
  }

  /* ---------- comments + weekly summary ---------- */
  async function loadComments(athleteId) {
    var r = await sb.from('comments').select('*').eq('athlete_id', athleteId).order('created_at').limit(400);
    var m = { log: {}, chk: {} };
    (r.data || []).forEach(function (c) { var k = c.log_id ? 'log' : 'chk', id = c.log_id || c.checkin_id; (m[k][id] = m[k][id] || []).push(c); });
    return m;
  }
  function cmtHtml(list, kind, id, who) {
    var items = (list || []).map(function (c) {
      var mine = c.author_id === state.user.id;
      return '<div class="cmt' + (mine ? ' mine' : '') + '"><b>' + esc(mine ? 'You' : who) + '</b> <span class="muted">' + fmtDay(new Date(c.created_at)) + '</span><div>' + esc(c.body) + '</div></div>';
    }).join('');
    return '<div class="cmts">' + items + '<form class="cform" data-ckind="' + kind + '" data-cid="' + esc(id) + '"><input name="b" maxlength="1000" required placeholder="' + (state.profile.role === 'coach' ? 'Comment' : 'Reply') + '" aria-label="Comment"><button class="btn small" type="submit">Send</button></form></div>';
  }
  function bindComments(refresh) {
    app.querySelectorAll('.cform').forEach(function (f) {
      f.onsubmit = async function (e) {
        e.preventDefault();
        var body = f.elements.b.value.trim(); if (!body) return;
        var row = { body: body }; row[f.dataset.ckind === 'log' ? 'log_id' : 'checkin_id'] = f.dataset.cid;
        var r = await sb.from('comments').insert(row);
        if (r.error) alert(r.error.message); else refresh();
      };
    });
  }
  function logSummary(l, noKm) {
    var bits = [];
    if (!noKm) bits.push(esc(l.distance_km) + ' km');
    bits.push(pacePerKm(Number(l.distance_km), l.duration_sec));
    if (l.rpe) bits.push('RPE ' + esc(l.rpe));
    if (l.niggle) bits.push('niggle ' + esc(l.niggle) + (l.niggle_area ? ' (' + esc(l.niggle_area) + ')' : ''));
    return bits.join(' | ');
  }
  var NO_LOG_TYPES = { strength: 1, rest: 1, cross: 1 };
  async function weeksSummary(athleteId, endMonday) {
    var from = addDays(endMonday, -21), to = addDays(endMonday, 6);
    var q = await Promise.all([
      sb.from('plan_sessions').select('id,session_date,session_type,target_km').eq('athlete_id', athleteId).gte('session_date', iso(from)).lte('session_date', iso(to)),
      sb.from('session_logs').select('plan_session_id,log_date,distance_km').eq('athlete_id', athleteId).gte('log_date', iso(from)).lte('log_date', iso(to))]);
    var ps = q[0].data || [], ls = q[1].data || [], rows = '';
    for (var i = 0; i < 4; i++) {
      var a = iso(addDays(from, 7 * i)), b = iso(addDays(from, 7 * i + 6));
      var wp = ps.filter(function (x) { return x.session_date >= a && x.session_date <= b; });
      var wl = ls.filter(function (x) { return x.log_date >= a && x.log_date <= b; });
      var plannedKm = wp.reduce(function (t, x) { return t + Number(x.target_km || 0); }, 0);
      var loggedKm = wl.reduce(function (t, x) { return t + Number(x.distance_km); }, 0);
      var runs = wp.filter(function (x) { return !NO_LOG_TYPES[x.session_type] && Number(x.target_km) > 0; });
      var done = runs.filter(function (x) { return wl.some(function (l) { return l.plan_session_id === x.id; }); }).length;
      var pct = plannedKm > 0 ? Math.round(loggedKm / plannedKm * 100) : null;
      rows += '<tr><td data-label="Week of">' + fmtDay(addDays(from, 7 * i)) + '</td><td data-label="Planned">' + plannedKm.toFixed(1) + ' km</td><td data-label="Logged">' + loggedKm.toFixed(1) + ' km</td>' +
        '<td data-label="Done">' + (pct == null ? '-' : '<span class="bar"><i style="width:' + Math.min(pct, 100) + '%"></i></span> ' + pct + '%') + '</td><td data-label="Runs done">' + done + ' of ' + runs.length + '</td></tr>';
    }
    return '<h2>Planned vs logged, last 4 weeks</h2><div class="tablewrap"><table><thead><tr><th>Week of</th><th>Planned</th><th>Logged</th><th>Done</th><th>Runs done</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function checkinHtml(c, cm, who) {
    var low = c.sleep <= 2 || c.energy <= 2 || c.mood <= 2 || c.soreness >= 4;
    return '<div class="panel"><h3 style="margin:0 0 6px">Week of ' + fmtDay(parseISO(c.week_start)) + (low ? ' <span class="chip flag">Check</span>' : '') + '</h3>' +
      '<p class="muted" style="margin:0 0 6px">Sleep ' + c.sleep + '/5 | Energy ' + c.energy + '/5 | Mood ' + c.mood + '/5 | Soreness ' + c.soreness + '/10' + (c.soreness_area ? ' (' + esc(c.soreness_area) + ')' : '') + '</p>' +
      (c.notes ? '<p style="white-space:pre-wrap;margin:0 0 6px">' + esc(c.notes) + '</p>' : '') + cmtHtml((cm.chk || {})[c.id], 'chk', c.id, who) + '</div>';
  }
  async function athleteCheckin() {
    var uid = state.user.id, mon = mondayOf(new Date());
    var r = await sb.from('checkins').select('*').eq('athlete_id', uid).order('week_start', { ascending: false }).limit(12);
    var list = r.data || [], cm = await loadComments(uid);
    var weeks = [mon, addDays(mon, -7)];
    function opt(from, to, sel, lo, hi) { var o = ''; for (var n = from; n <= to; n++) o += '<option value="' + n + '"' + (n === sel ? ' selected' : '') + '>' + n + (n === from && lo ? ' (' + lo + ')' : '') + (n === to && hi ? ' (' + hi + ')' : '') + '</option>'; return o; }
    shell(ATHLETE_TABS, '<h1>Weekly check-in</h1>' + dbError(r.error) +
      '<div class="panel"><form class="stack" id="chkf"><label>Week<select name="week">' + weeks.map(function (w, i) { return '<option value="' + iso(w) + '">' + (i ? 'Last week' : 'This week') + ' (from ' + fmtDay(w) + ')</option>'; }).join('') + '</select></label>' +
      '<div class="grid3"><label>Sleep<select name="sleep">' + opt(1, 5, 3, 'poor', 'great') + '</select></label><label>Energy<select name="energy">' + opt(1, 5, 3, 'flat', 'great') + '</select></label><label>Mood<select name="mood">' + opt(1, 5, 3, 'low', 'great') + '</select></label></div>' +
      '<div class="grid2"><label>Soreness<select name="soreness">' + opt(0, 10, 0, 'none', 'worst') + '</select></label><label>Where?<input name="area" maxlength="120" placeholder="Left calf, right shin"></label></div>' +
      '<label>How was the week?<textarea name="notes" maxlength="1500" placeholder="Work, stress, sessions that felt hard or easy, questions for me"></textarea></label>' +
      '<div id="chkmsg"></div><div><button class="btn" type="submit">Save check-in</button></div></form></div>' +
      '<h2>Past check-ins</h2>' + (list.length ? list.map(function (c) { return checkinHtml(c, cm, 'Coach'); }).join('') : '<p class="empty">No check-ins yet.</p>'));
    var f = $('#chkf');
    function fill() {
      var ex = list.filter(function (c) { return c.week_start === f.elements.week.value; })[0];
      f.elements.sleep.value = ex ? ex.sleep : 3; f.elements.energy.value = ex ? ex.energy : 3; f.elements.mood.value = ex ? ex.mood : 3;
      f.elements.soreness.value = ex ? ex.soreness : 0; f.elements.area.value = ex ? (ex.soreness_area || '') : ''; f.elements.notes.value = ex ? (ex.notes || '') : '';
    }
    f.elements.week.onchange = fill; fill();
    f.onsubmit = async function (e) {
      e.preventDefault();
      var row = { athlete_id: uid, week_start: f.elements.week.value, sleep: Number(f.elements.sleep.value), energy: Number(f.elements.energy.value), mood: Number(f.elements.mood.value),
        soreness: Number(f.elements.soreness.value), soreness_area: f.elements.area.value.trim() || null, notes: f.elements.notes.value.trim() || null };
      var res = await sb.from('checkins').upsert(row, { onConflict: 'athlete_id,week_start' });
      if (res.error) { $('#chkmsg').innerHTML = dbError(res.error); return; }
      athleteCheckin();
    };
    bindComments(athleteCheckin);
  }

  /* ---------- athlete ---------- */
  var ATHLETE_TABS = [['week', 'This week'], ['log', 'Log a run'], ['check', 'Check-in'], ['history', 'History'], ['paces', 'Paces']];

  async function athleteWeek() {
    var uid = state.user.id, ws = state.weekStart, we = addDays(ws, 6);
    var q = await Promise.all([
      sb.from('plan_sessions').select('*').eq('athlete_id', uid).gte('session_date', iso(ws)).lte('session_date', iso(we)).order('session_date'),
      sb.from('session_logs').select('*').eq('athlete_id', uid).gte('log_date', iso(ws)).lte('log_date', iso(we)).order('log_date'),
      loadComments(uid), weeksSummary(uid, ws)]);
    var cm = q[2], summary = q[3];
    var sessions = q[0].data || [], logs = q[1].data || [], today = iso(new Date()), days = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(ws, i), key = iso(d);
      var ss = sessions.filter(function (s) { return s.session_date === key; });
      var ll = logs.filter(function (l) { return l.log_date === key; });
      var body = ss.map(function (s) {
        var dl = logs.filter(function (l) { return l.plan_session_id === s.id; })[0], done = !!dl;
        return '<div class="sess"><h3><span class="chip' + (done ? ' done' : '') + '">' + (done ? 'Logged' : esc(TYPES[s.session_type] || s.session_type)) + '</span>' + esc(s.title) + (s.target_km ? ' <span class="muted">(' + esc(s.target_km) + ' km)</span>' : '') + '</h3>' +
          (s.description ? '<p>' + esc(s.description) + '</p>' : '') +
          (dl ? '<p class="muted">Logged: ' + logSummary(dl) + '</p>' + cmtHtml(cm.log[dl.id], 'log', dl.id, 'Coach') : '') +
          (done || s.session_type === 'rest' ? '' : '<div><button class="btn small ghost" data-log="' + s.id + '" data-date="' + key + '">Log this session</button>' + garminBtn(s) + '</div>') + '</div>';
      }).join('');
      var extra = ll.filter(function (l) { return !l.plan_session_id; }).map(function (l) {
        return '<div class="sess"><h3><span class="chip done">Logged</span>' + esc(l.distance_km) + ' km</h3><p class="muted">' + esc(V.fmtTime(l.duration_sec)) + ' | ' + logSummary(l, true) + '</p>' + cmtHtml(cm.log[l.id], 'log', l.id, 'Coach') + '</div>';
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
      '<p class="muted">Logged ' + logged.toFixed(1) + ' km' + (planned ? ' of ' + planned.toFixed(1) + ' km planned' : '') + '</p><div class="week">' + days + '</div>' + summary);
    bindComments(athleteWeek);
    $('#prev').onclick = function () { state.weekStart = addDays(ws, -7); athleteWeek(); };
    $('#next').onclick = function () { state.weekStart = addDays(ws, 7); athleteWeek(); };
    $('#thisweek').onclick = function () { state.weekStart = mondayOf(new Date()); athleteWeek(); };
    bindFit(sessions, state.profile.vdot);
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
      '<label>Where is the niggle? (optional)<input name="area" maxlength="60" placeholder="Left calf, right shin"></label>' +
      '<label>Notes<textarea name="notes" placeholder="Paces, how it felt, shins or calves"></textarea></label>' +
      '<div id="logmsg"></div><div><button class="btn" type="submit">Save run</button></div></form></div>');
    $('#logf').onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target), sec = V.parseDuration(f.get('time')), msg = $('#logmsg');
      if (!(sec > 0)) { msg.innerHTML = '<p class="err" role="alert">Enter the time as mm:ss or h:mm:ss, for example 52:30.</p>'; return; }
      var row = { athlete_id: state.user.id, log_date: f.get('date'), distance_km: Number(f.get('km')), duration_sec: Math.round(sec),
        rpe: f.get('rpe') ? Number(f.get('rpe')) : null, niggle: Number(f.get('niggle')), notes: (f.get('notes') || '').trim() || null, plan_session_id: pre.plan_session_id || null };
      var area = (f.get('area') || '').trim(); if (area && row.niggle > 0) row.niggle_area = area;
      var r = await sb.from('session_logs').insert(row);
      if (r.error && row.niggle_area && /niggle_area/i.test(r.error.message || '')) { delete row.niggle_area; row.notes = ((row.notes ? row.notes + ' ' : '') + '(Niggle: ' + area + ')').slice(0, 2000); r = await sb.from('session_logs').insert(row); }
      if (r.error) { msg.innerHTML = dbError(r.error); return; }
      state.tab = 'week'; state.weekStart = mondayOf(parseISO(row.log_date)); route();
    };
  }

  async function history() {
    var r = await sb.from('session_logs').select('*').eq('athlete_id', state.user.id).order('log_date', { ascending: false }).limit(60);
    var logs = r.data || [], cm = await loadComments(state.user.id);
    shell(ATHLETE_TABS, '<h1>History</h1>' + dbError(r.error) + (logs.length ? logTable(logs, true, cm, 'Coach') : '<p class="empty">No runs logged yet. Log your first run from the Log a run tab.</p>'));
    bindComments(history);
    app.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Delete this run?')) return;
        var d = await sb.from('session_logs').delete().eq('id', b.dataset.del);
        if (d.error) alert(d.error.message); else history();
      };
    });
  }
  function logTable(logs, canDelete, cm, who) {
    return '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Distance</th><th>Time</th><th>Pace</th><th>RPE</th><th>Niggle</th><th>Notes</th>' + (canDelete ? '<th></th>' : '') + '</tr></thead><tbody>' +
      logs.map(function (l) {
        var n = l.niggle || 0;
        return '<tr><td data-label="Date">' + fmtDay(parseISO(l.log_date)) + '</td><td data-label="Distance">' + esc(l.distance_km) + ' km</td><td data-label="Time">' + V.fmtTime(l.duration_sec) + '</td><td data-label="Pace">' + pacePerKm(Number(l.distance_km), l.duration_sec) + '</td><td data-label="RPE">' + esc(l.rpe || '') + '</td>' +
          '<td data-label="Niggle">' + (n >= 4 ? '<span class="chip flag">' + n + '</span>' : n) + (l.niggle_area ? '<div class="muted">' + esc(l.niggle_area) + '</div>' : '') + '</td><td data-label="Notes">' + esc(l.notes || '') + (cm ? cmtHtml(cm.log[l.id], 'log', l.id, who) : '') + '</td>' +
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
        (e.plan ? '<p><strong>Option:</strong> ' + esc(e.plan) + '</p>' : '') +
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
    var athletes = r.data || [], ids = athletes.map(function (a) { return a.id; }), logs = [], checks = [];
    if (ids.length) {
      var since = iso(addDays(new Date(), -14));
      var lr = await sb.from('session_logs').select('athlete_id,log_date,distance_km,niggle').in('athlete_id', ids).gte('log_date', since);
      logs = lr.data || [];
      var cr = await sb.from('checkins').select('athlete_id,week_start,sleep,energy,mood,soreness').in('athlete_id', ids).order('week_start', { ascending: false }).limit(200);
      checks = cr.data || [];
    }
    var wk = iso(addDays(new Date(), -7));
    var rows = athletes.map(function (a) {
      var mine = logs.filter(function (l) { return l.athlete_id === a.id; });
      var last = mine.reduce(function (m, l) { return l.log_date > m ? l.log_date : m; }, '');
      var km = mine.filter(function (l) { return l.log_date > wk; }).reduce(function (s, l) { return s + Number(l.distance_km); }, 0);
      var flag = mine.some(function (l) { return l.log_date > wk && (l.niggle || 0) >= 4; });
      var lastChk = checks.filter(function (c) { return c.athlete_id === a.id; })[0];
      var lowChk = lastChk && lastChk.week_start >= iso(addDays(new Date(), -14)) && (lastChk.sleep <= 2 || lastChk.energy <= 2 || lastChk.mood <= 2 || lastChk.soreness >= 4);
      var mine_ = a.coach_id === state.user.id;
      return '<tr><td data-label="Athlete">' + (mine_ ? '<button class="link" data-open="' + esc(a.id) + '">' + esc(a.full_name || a.email) + '</button>' : esc(a.full_name || a.email)) + '<div class="muted">' + esc(a.email || '') + '</div></td>' +
        '<td data-label="VDOT">' + (a.vdot ? esc(a.vdot) : '-') + '</td><td data-label="Last run">' + (last ? fmtDay(parseISO(last)) : 'No runs') + '</td><td data-label="Last 7 days">' + km.toFixed(1) + ' km</td><td data-label="Check-in">' + (lastChk ? fmtDay(parseISO(lastChk.week_start)) : '-') + '</td>' +
        '<td data-label="">' + (flag ? '<span class="chip flag">Niggle 4+</span>' : '') + (lowChk ? '<span class="chip flag">Check-in low</span>' : '') + (mine_ ? '' : '<button class="btn small" data-claim="' + esc(a.id) + '">Add to my athletes</button>') + '</td></tr>';
    }).join('');
    var sessionBad = false;
    if (!athletes.length && !r.error) {   // an empty list with no error can mean the login has gone stale: check we can still read our own profile
      var me = await sb.from('profiles').select('id,role').eq('id', state.user.id).maybeSingle();
      sessionBad = !!(me.error || !me.data || me.data.role !== 'coach');
      if (sessionBad) { try { await sb.auth.refreshSession(); } catch (x) {} }
    }
    shell(COACH_TABS, '<h1>Athletes</h1>' + dbError(r.error) + (sessionBad ? '<div class="notice"><strong>Your login may have expired.</strong> The athlete list could not be loaded. Tap Try again, and if it is still empty, log out and log back in.<div style="margin-top:10px"><button class="btn small" id="retry">Try again</button> <button class="btn small ghost" id="relog">Log out</button></div></div>' : '') + (athletes.length ?
      '<div class="tablewrap"><table><thead><tr><th>Athlete</th><th>VDOT</th><th>Last run</th><th>Last 7 days</th><th>Check-in</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
      (sessionBad ? '' : '<p class="empty">No athletes yet. Ask athletes to create an account on this page, then add them here.</p><p style="text-align:center"><button class="btn small ghost" id="retry">Refresh</button></p>')));
    if ($('#retry')) $('#retry').onclick = coachAthletes;
    if ($('#relog')) $('#relog').onclick = function () { sb.auth.signOut(); };
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
      sb.from('session_logs').select('*').eq('athlete_id', a.id).order('log_date', { ascending: false }).limit(120),
      loadComments(a.id), weeksSummary(a.id, ws),
      sb.from('checkins').select('*').eq('athlete_id', a.id).order('week_start', { ascending: false }).limit(6)]);
    var sessions = q[0].data || [], allLogs = q[1].data || [], logs = allLogs.slice(0, 20), cm = q[2], summary = q[3], checks = q[4].data || [];
    var who = (a.full_name || 'Athlete').split(' ')[0], todayIso = iso(new Date());
    var planned = sessions.reduce(function (s, x) { return s + Number(x.target_km || 0); }, 0);
    function loggedCell(s) {
      var l = allLogs.filter(function (x) { return x.plan_session_id === s.id; })[0];
      if (l) return '<span class="chip done">Done</span>' + logSummary(l);
      return (!NO_LOG_TYPES[s.session_type] && s.session_date < todayIso && Number(s.target_km) > 0) ? '<span class="muted">Not logged</span>' : '';
    }
    var list = sessions.map(function (s) {
      return '<tr><td data-label="Day">' + DOW[(parseISO(s.session_date).getDay() + 6) % 7] + ' ' + fmtDay(parseISO(s.session_date)) + '</td><td data-label="Session"><span class="chip">' + esc(TYPES[s.session_type] || s.session_type) + '</span>' + esc(s.title) + '<div class="muted" style="white-space:pre-wrap">' + esc(s.description || '') + '</div></td><td data-label="km">' + esc(s.target_km || '') + '</td><td data-label="Logged">' + loggedCell(s) + '</td><td data-label="">' + garminBtn(s) + ' <button class="link" data-delsess="' + esc(s.id) + '">Delete</button></td></tr>';
    }).join('');
    shell(COACH_TABS,
      '<p><button class="link" id="back">Back to athletes</button></p><h1>' + esc(a.full_name || a.email) + '</h1>' + dbError(q[0].error || q[1].error) +
      '<div class="panel"><form class="row" id="vdotf"><label>VDOT<input name="v" type="number" step="0.1" min="20" max="90" value="' + esc(a.vdot || '') + '" style="max-width:9ch"></label><button class="btn small" type="submit">Save VDOT</button><span id="vmsg" class="muted"></span></form>' + (a.vdot ? '<div style="margin-top:14px">' + pacesHtml(Number(a.vdot)) + '</div>' : '') + '</div>' +
      '<h2>Plan: ' + fmtWeek(ws) + '</h2><div class="weeknav"><button class="btn small ghost" id="prev">Previous</button><button class="btn small ghost" id="next">Next</button><button class="btn small ghost" id="copyprev">Copy previous week here</button><span class="muted">Planned ' + planned.toFixed(1) + ' km</span></div>' +
      (sessions.length ? '<div class="tablewrap"><table><thead><tr><th>Day</th><th>Session</th><th>km</th><th>Logged</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>' : '<p class="empty">No sessions this week.</p>') +
      '<div class="panel" style="margin-top:20px"><h2>Add a session</h2><form class="stack" id="addf"><div class="grid3"><label>Date<input type="date" name="date" required value="' + iso(ws) + '"></label>' +
      '<label>Type<select name="type">' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>Target km<input type="number" name="km" step="0.1" min="0" max="200"></label></div>' +
      '<label>Title<input name="title" required placeholder="3 x 6 min at T, 2 min jog"></label>' +
      '<label>Details<textarea name="desc" placeholder="Warm-up, paces, notes"></textarea></label><div id="addmsg"></div><div><button class="btn" type="submit">Add session</button></div></form></div>' +
      '<div class="panel"><h2>Load a template plan</h2><p class="muted">Adds every session from a saved plan to this athlete\'s calendar. Pick the Monday that starts Week 1.</p>' +
      '<form class="stack" id="tplf"><div class="grid2"><label>Template<select name="tpl"><option value="">Loading</option></select></label>' +
      '<label>Week 1 starts (a Monday)<input type="date" name="start" required value="' + iso(mondayOf(new Date())) + '"></label></div><label class="check"><input type="checkbox" name="replace"> Replace this athlete\'s existing planned sessions from the start date onward</label><div id="tplmsg"></div><div><button class="btn" type="submit">Load plan</button></div></form></div>' +
      summary +
      '<h2>Check-ins</h2>' + (checks.length ? checks.map(function (c) { return checkinHtml(c, cm, who); }).join('') : '<p class="empty">No check-ins yet.</p>') +
      '<h2>Recent runs</h2>' + (logs.length ? logTable(logs, false, cm, who) : '<p class="empty">No runs logged yet.</p>'));
    bindComments(coachAthlete);
    $('#back').onclick = function () { state.athlete = null; coachAthletes(); };
    $('#prev').onclick = function () { state.athleteWeek = addDays(ws, -7); coachAthlete(); };
    $('#next').onclick = function () { state.athleteWeek = addDays(ws, 7); coachAthlete(); };
    bindFit(sessions, a.vdot);
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
    var tplSel = $('#tplf [name=tpl]'), tplList = [];
    fetch('../data/templates.json').then(function (r) { return r.json(); }).then(function (list) {
      tplList = list; tplSel.innerHTML = list.map(function (t) { return '<option value="' + esc(t.file) + '">' + esc(t.name) + '</option>'; }).join('');
    }).catch(function () { tplSel.innerHTML = '<option value="">No templates found</option>'; });
    $('#tplf').onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target), msg = $('#tplmsg'), start = parseISO(f.get('start'));
      if (!f.get('tpl')) { msg.innerHTML = '<p class="err" role="alert">No template selected.</p>'; return; }
      if (start.getDay() !== 1) { msg.innerHTML = '<p class="err" role="alert">Pick a Monday. Week 1 needs to start on a Monday.</p>'; return; }
      var tr; try { tr = await (await fetch('../data/' + f.get('tpl'))).json(); } catch (x) { msg.innerHTML = '<p class="err" role="alert">Could not load that template.</p>'; return; }
      var last = addDays(start, tr.weeks * 7 - 1);
      var replace = !!f.get('replace');
      var exq = sb.from('plan_sessions').select('id').eq('athlete_id', a.id).gte('session_date', iso(start));
      if (!replace) exq = exq.lte('session_date', iso(last));
      var ex = await exq;
      if (ex.error) { msg.innerHTML = dbError(ex.error); return; }
      if (replace) {
        if (!confirm('This will replace ' + ex.data.length + ' planned sessions from ' + fmtDay(start) + ' onward with the new plan. Logged runs are kept. Continue?')) return;
      } else if (ex.data.length && !confirm('This athlete already has ' + ex.data.length + ' sessions between ' + fmtDay(start) + ' and ' + fmtDay(last) + '. Load the plan anyway? The existing sessions stay.')) return;
      var rows = tr.sessions.map(function (s) { return { athlete_id: a.id, session_date: iso(addDays(start, s.day_offset)), session_type: s.type, title: s.title, description: s.description || null, target_km: s.km, steps: s.steps || null }; });
      var noSteps = false;
      for (var i = 0; i < rows.length; i += 50) {
        var ins = await sb.from('plan_sessions').insert(rows.slice(i, i + 50));
        if (ins.error && i === 0 && /steps/i.test(ins.error.message || '')) {   // steps column not added yet: load without Garmin data
          noSteps = true; rows.forEach(function (r) { delete r.steps; });
          ins = await sb.from('plan_sessions').insert(rows.slice(0, 50));
        }
        if (ins.error) { msg.innerHTML = dbError(ins.error) + '<p class="muted">Part of the plan may have loaded. Check the weeks before loading again.</p>'; return; }
      }
      if (replace) {   // new plan is in: now remove the sessions that were there before
        for (var j = 0; j < ex.data.length; j += 100) {
          var del = await sb.from('plan_sessions').delete().in('id', ex.data.slice(j, j + 100).map(function (x) { return x.id; }));
          if (del.error) { msg.innerHTML = dbError(del.error) + '<p class="muted">The new plan loaded, but some old sessions could not be removed. Delete them from the week view.</p>'; return; }
        }
      }
      if (noSteps) alert('Plan loaded, but the Garmin download data was left out because the steps column has not been added in Supabase yet.');
      state.athleteWeek = mondayOf(new Date()); coachAthlete();
    };
    $('#copyprev').onclick = async function () {
      if (sessions.length && !confirm('This week already has sessions. Copy the previous week in as well?')) return;
      var pw = addDays(ws, -7);
      var p = await sb.from('plan_sessions').select('*').eq('athlete_id', a.id).gte('session_date', iso(pw)).lte('session_date', iso(addDays(pw, 6)));
      if (p.error || !p.data.length) { alert(p.error ? p.error.message : 'The previous week has no sessions to copy.'); return; }
      var rows = p.data.map(function (s) { var r = { athlete_id: a.id, session_date: iso(addDays(parseISO(s.session_date), 7)), session_type: s.session_type, title: s.title, description: s.description, target_km: s.target_km }; if (s.steps) r.steps = s.steps; return r; });
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
    if (state.tab === 'check') return athleteCheckin();
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
