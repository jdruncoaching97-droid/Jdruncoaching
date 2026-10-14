/* Daniels/Gilbert VDOT maths. Pure functions, no DOM. */
(function (root) {
  // Oxygen cost of running at velocity v (m/min)
  function vo2(v) { return -4.6 + 0.182258 * v + 0.000104 * v * v; }
  // Fraction of VO2max a runner can hold for t minutes
  function frac(t) { return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); }
  function vdotFromRace(distM, seconds) {
    var t = seconds / 60, v = distM / t;
    return vo2(v) / frac(t);
  }
  // velocity (m/min) that costs a given VO2
  function velocityForVo2(x) {
    var a = 0.000104, b = 0.182258, c = -4.6 - x;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  // fraction of VDOT used for each training intensity (tuned to match Daniels' published tables)
  var ZONES = { Elow: 0.63, Ehigh: 0.73, M: 0.815, T: 0.88, I: 0.98, R: 1.09 };
  function secPerKm(vdot, f) { return 1000 / velocityForVo2(vdot * f) * 60; }
  function paces(vdot) {
    return {
      easyFast: secPerKm(vdot, ZONES.Ehigh), easySlow: secPerKm(vdot, ZONES.Elow),
      marathon: secPerKm(vdot, ZONES.M), threshold: secPerKm(vdot, ZONES.T),
      interval: secPerKm(vdot, ZONES.I),
      repetition400: secPerKm(vdot, ZONES.R) * 0.4
    };
  }
  // time (seconds) a runner of this VDOT would run a distance: bisection on time
  function raceSeconds(vdot, distM) {
    var lo = distM / 600 * 60, hi = distM / 60 * 60;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (vdotFromRace(distM, mid) > vdot) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function fmtPace(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function fmtTime(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  // "mm:ss" or "h:mm:ss" (or plain minutes) -> seconds, NaN if invalid
  function parseDuration(str) {
    var p = String(str).trim().split(':').map(Number);
    if (!p.length || p.length > 3 || p.some(function (n) { return !isFinite(n) || n < 0; })) return NaN;
    if (p.length === 1) return p[0] * 60;
    if (p.length === 2) return p[0] * 60 + p[1];
    return p[0] * 3600 + p[1] * 60 + p[2];
  }
  var api = { vdotFromRace: vdotFromRace, paces: paces, raceSeconds: raceSeconds, fmtPace: fmtPace, fmtTime: fmtTime, parseDuration: parseDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VDOT = api;
})(this);
