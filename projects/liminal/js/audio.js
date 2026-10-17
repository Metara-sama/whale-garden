/* ============================================================
   audio.js —— 全部声音都是 WebAudio 现场合成的，零音频文件
   ------------------------------------------------------------
     pool   水声（低通噪声）+ 偶尔的水滴
     rooms  荧光灯 50/100Hz 嗡鸣 + 极轻的电流噪声
     meadow 风声（带通噪声 + LFO）+ 零星虫鸣
   转场时叠一层噪声上扬，画面白闪同步。
   ============================================================ */
window.LIMINAL = window.LIMINAL || {};
(function (NS) {
  "use strict";

  var ctx = null;
  var master = null;
  var buses = [];
  var muted = false;
  var started = false;
  var timers = [];
  var curScene = -1;

  function noiseBuffer(seconds) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    /* 用一点粉色化处理，白噪太"嘶" */
    var b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  function makeNoiseLoop(filterType, freq, q) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    var g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    src.start(0);
    return { src: src, filter: f, gain: g };
  }

  function makeOsc(type, freq, gain) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g);
    o.start(0);
    return { osc: o, gain: g };
  }

  /* 短音：水滴 / 虫鸣 */
  function blip(type, freq, dur, vol, slideTo) {
    if (!ctx || muted) return;
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) {
      o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + dur + 0.02);
  }

  function scheduleWaterDrops() {
    var id = setTimeout(function () {
      if (document.hidden || muted) {
        scheduleWaterDrops();
        return;
      }
      if (curScene === 0) {
        /* 空洞的水滴：频率下滑，带一点余响 */
        blip("sine", 780 + Math.random() * 420, 0.20 + Math.random() * 0.25, 0.05, 300);
      }
      scheduleWaterDrops();
    }, 900 + Math.random() * 5200);
    timers.push(id);
  }

  function scheduleCrickets() {
    var id = setTimeout(function () {
      if (document.hidden || muted) {
        scheduleCrickets();
        return;
      }
      if (curScene === 2) {
        var n = 2 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) {
          (function (k) {
            var id2 = setTimeout(function () {
              blip("triangle", 3800 + Math.random() * 1400, 0.035, 0.010);
            }, k * 68);
            timers.push(id2);
          })(i);
        }
      }
      scheduleCrickets();
    }, 1400 + Math.random() * 4200);
    timers.push(id);
  }

  /* ---------- 三个场景的声部 ---------- */
  function build() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    /* 0 泳池：低频水声 + 中频水花 */
    var p1 = makeNoiseLoop("lowpass", 420, 0.7);
    var p2 = makeNoiseLoop("bandpass", 1500, 0.9);
    p1.gain.gain.value = 0.32;
    p2.gain.gain.value = 0.05;
    p1.gain.connect(master);
    p2.gain.connect(master);
    /* 泳池大空间的水压感 */
    var pOsc = makeOsc("sine", 62, 0.045);
    pOsc.gain.connect(master);
    buses.push({ id: 0, nodes: [p1.gain, p2.gain, pOsc.gain], levels: [0.32, 0.05, 0.045] });

    /* 1 后室：荧光灯嗡嗡 */
    var r1 = makeOsc("sawtooth", 100, 0.0);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    r1.osc.disconnect();
    r1.osc.connect(lp);
    var r1g = ctx.createGain();
    r1g.gain.value = 0.020;
    lp.connect(r1g);
    r1g.connect(master);
    var r2 = makeOsc("sine", 50, 0.030);
    r2.gain.connect(master);
    var r3 = makeNoiseLoop("highpass", 5200, 0.6);
    r3.gain.gain.value = 0.010;
    r3.gain.connect(master);
    buses.push({ id: 1, nodes: [r1g.gain, r2.gain, r3.gain], levels: [0.020, 0.030, 0.010] });

    /* 2 草地：风声 + 虫子 */
    var m1 = makeNoiseLoop("bandpass", 520, 0.8);
    m1.gain.gain.value = 0.16;
    m1.gain.connect(master);
    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.13;
    var lfoG = ctx.createGain();
    lfoG.gain.value = 0.09;
    lfo.connect(lfoG);
    lfoG.connect(m1.gain.gain);
    lfo.start(0);
    var m2 = makeOsc("sine", 148, 0.012);
    m2.gain.connect(master);
    buses.push({ id: 2, nodes: [m1.gain, m2.gain], levels: [0.16, 0.012] });

    scheduleWaterDrops();
    scheduleCrickets();
  }

  NS.Audio = {
    start: function () {
      if (started) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC();
      } catch (e) {
        return;
      }
      started = true;
      build();
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      if (curScene >= 0) NS.Audio.setScene(curScene);
    },

    setScene: function (i) {
      curScene = i;
      if (!started || !ctx) return;
      for (var k = 0; k < buses.length; k++) {
        var b = buses[k];
        var on = b.id === i;
        for (var j = 0; j < b.nodes.length; j++) {
          var node = b.nodes[j];
          var target = on ? b.levels[j] : 0;
          try {
            node.cancelScheduledValues(ctx.currentTime);
            node.setTargetAtTime(target, ctx.currentTime, on ? 0.35 : 0.25);
          } catch (e) {
            node.value = target;
          }
        }
      }
    },

    /* 转场白噪：和画面白闪同步 */
    whoosh: function () {
      if (!started || !ctx || muted) return;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1.4);
      var f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(420, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 1.0);
      f.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.35);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(ctx.currentTime);
      src.stop(ctx.currentTime + 1.5);
    },

    setMuted: function (m) {
      muted = m;
      if (master && ctx) {
        try {
          master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.08);
        } catch (e) {
          master.gain.value = m ? 0 : 0.9;
        }
      }
      return muted;
    },

    isMuted: function () { return muted; },

    stop: function () {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers.length = 0;
      if (ctx) {
        try { ctx.close(); } catch (e) {}
        ctx = null;
      }
      started = false;
    }
  };
})(window.LIMINAL);