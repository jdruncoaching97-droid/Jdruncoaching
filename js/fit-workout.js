/* Builds a Garmin-compatible structured workout (.fit) from a list of steps. No dependencies.
   Step format:
     { k: 'warmup'|'run'|'work'|'recover'|'cooldown', name, km | m | min | s | open:true, zone: 'E'|'M'|'T'|'I'|'R' }
     { rep: 6, steps: [ ...steps ] }   (repeat block)
*/
(function (root) {
  var CRC_T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
  function crc16(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i], t = CRC_T[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ CRC_T[b & 0xF];
      t = CRC_T[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ CRC_T[(b >> 4) & 0xF];
    }
    return crc;
  }
  var ENUM = 0x00, U16 = 0x84, U32 = 0x86, STR = 0x07, U32Z = 0x8C;
  function Buf() { this.a = []; }
  Buf.prototype.u8 = function (v) { this.a.push(v & 0xFF); };
  Buf.prototype.u16 = function (v) { this.u8(v); this.u8(v >> 8); };
  Buf.prototype.u32 = function (v) { this.u8(v); this.u8(v >>> 8); this.u8(v >>> 16); this.u8(v >>> 24); };
  Buf.prototype.str = function (s, size) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); bytes.push(c < 128 ? c : 63); }   // ASCII only
    bytes = bytes.slice(0, size - 1); while (bytes.length < size) bytes.push(0);
    for (var j = 0; j < size; j++) this.u8(bytes[j]);
  };
  function define(buf, local, globalNum, fields) {
    buf.u8(0x40 | local); buf.u8(0); buf.u8(0); buf.u16(globalNum); buf.u8(fields.length);
    fields.forEach(function (f) { buf.u8(f[0]); buf.u8(f[1]); buf.u8(f[2]); });
  }
  function put(buf, type, size, v) {
    if (type === STR) buf.str(String(v), size);
    else if (size === 1) buf.u8(v); else if (size === 2) buf.u16(v); else buf.u32(v);
  }

  // Turn the step spec into flat FIT workout steps. paces = result of VDOT.paces(vdot), or null for no pace targets.
  function speedRange(zone, paces) {
    if (!paces || !zone) return null;
    var slow, fast;
    if (zone === 'E') { slow = paces.easySlow; fast = paces.easyFast; }
    else {
      var p = zone === 'M' ? paces.marathon : zone === 'T' ? paces.threshold : zone === 'I' ? paces.interval : zone === 'R' ? paces.repetition400 / 0.4 : null;
      if (!p) return null; slow = p * 1.025; fast = p * 0.975;
    }
    return [Math.round(1000 / slow * 1000), Math.round(1000 / fast * 1000)];   // mm/s, lower then upper speed
  }
  var INTENSITY = { warmup: 2, cooldown: 3, run: 0, work: 5, recover: 4 };
  var DEFAULT_NAME = { warmup: 'Warm-up', cooldown: 'Cool-down', run: 'Run', work: 'Work', recover: 'Recover' };
  function flatten(spec, paces) {
    var out = [];
    function one(s) {
      var dt = 5, dv = 0;
      if (s.km != null) { dt = 1; dv = Math.round(s.km * 100000); }
      else if (s.m != null) { dt = 1; dv = Math.round(s.m * 100); }
      else if (s.min != null) { dt = 0; dv = Math.round(s.min * 60000); }
      else if (s.s != null) { dt = 0; dv = Math.round(s.s * 1000); }
      var r = speedRange(s.zone, paces);
      out.push({ name: s.name || DEFAULT_NAME[s.k] || 'Step', dt: dt, dv: dv, tt: r ? 0 : 2, tv: 0, lo: r ? r[0] : 0, hi: r ? r[1] : 0, intensity: INTENSITY[s.k] != null ? INTENSITY[s.k] : 0 });
    }
    spec.forEach(function (item) {
      if (item.rep) {
        var start = out.length; item.steps.forEach(one);
        out.push({ name: 'Repeat', dt: 6, dv: start, tt: 2, tv: item.rep, lo: 0, hi: 0, intensity: 0 });
      } else one(item);
    });
    return out;
  }

  function build(opts) {
    var steps = flatten(opts.steps, opts.paces || null);
    var body = new Buf();
    var fitNow = Math.floor((opts.now || Date.now()) / 1000) - 631065600;
    define(body, 0, 0, [[0, 1, ENUM], [1, 2, U16], [2, 2, U16], [3, 4, U32Z], [4, 4, U32]]);
    body.u8(0); body.u8(5); body.u16(255); body.u16(0); body.u32(1); body.u32(fitNow);
    define(body, 1, 26, [[4, 1, ENUM], [6, 2, U16], [8, 16, STR]]);
    body.u8(1); body.u8(1); body.u16(steps.length); body.str(opts.name || 'Workout', 16);
    define(body, 2, 27, [[254, 2, U16], [0, 16, STR], [1, 1, ENUM], [2, 4, U32], [3, 1, ENUM], [4, 4, U32], [5, 4, U32], [6, 4, U32], [7, 1, ENUM]]);
    steps.forEach(function (s, i) {
      body.u8(2); body.u16(i); body.str(s.name, 16); body.u8(s.dt); body.u32(s.dv); body.u8(s.tt); body.u32(s.tv); body.u32(s.lo); body.u32(s.hi); body.u8(s.intensity);
    });
    var data = body.a;
    var head = new Buf(); head.u8(14); head.u8(0x20); head.u16(21000); head.u32(data.length); ['.', 'F', 'I', 'T'].forEach(function (c) { head.u8(c.charCodeAt(0)); });
    head.u16(crc16(head.a));
    var all = head.a.concat(data); var crc = crc16(all); all.push(crc & 0xFF, crc >> 8);
    return new Uint8Array(all);
  }
  var api = { build: build, flatten: flatten, crc16: crc16 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FitWorkout = api;
})(this);
