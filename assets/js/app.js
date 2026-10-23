/* =========================================================
   AMC 공통 스크립트 — Firebase 초기화, 인증, 도우미, 수험표 렌더
   ---------------------------------------------------------
   Firestore 구조
   settings/current        회차 정보 (round, examDate, place, ticketOpen ...)
   students/{examNo}       응시자 { examNo, name, grade, school, phone, room, academy, token, createdAt }
   lookup/{sha256(이름|휴대폰)}  학생·학부모 조회용 사본 (examNo, name, grade, room, token)
   attendance/{examNo}     출석 { examNo, name, room, checkedAt, by, method: "qr"|"manual" }
   ========================================================= */
(function () {
  "use strict";

  var C = window.FIREBASE_CONFIG || {};
  var configured = !!(C.apiKey && C.projectId);
  var app, db, auth;

  if (configured && window.firebase) {
    app = firebase.initializeApp(C);
    db = firebase.firestore();
    auth = typeof firebase.auth === "function" ? firebase.auth() : null;
    try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
  }

  /* ---------- 도우미 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function digits(s) { return String(s || "").replace(/[^0-9]/g, ""); }
  function normName(s) { return String(s || "").replace(/\s+/g, "").trim(); }
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function fmtTime(ts) {
    var d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
    if (isNaN(d)) return "";
    return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2);
  }
  function fmtDateTime(ts) {
    var d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
    if (isNaN(d)) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2) + " " + fmtTime(d);
  }
  function randomToken(len) {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "";
    var arr = new Uint8Array(len || 8);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  function sha256(text) {
    var enc = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", enc).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }
  function lookupKey(name, phone) { return sha256(normName(name) + "|" + digits(phone)); }

  function show(box, html, tone) {
    if (!box) return;
    box.hidden = false;
    box.dataset.tone = tone || "";
    box.innerHTML = html;
  }
  function hide(box) { if (box) box.hidden = true; }

  /* QR 내용: AMC:수험번호:토큰 */
  function qrText(r) { return "AMC:" + r.examNo + ":" + r.token; }
  function parseQr(text) {
    var m = /^AMC:([0-9A-Za-z\-]+):([0-9A-Z]+)$/.exec(String(text || "").trim());
    return m ? { examNo: m[1], token: m[2] } : null;
  }

  /* ---------- 설정 ---------- */
  var settingsCache = null;
  function loadSettings() {
    var def = Object.assign({}, window.AMC_DEFAULT || {});
    if (!db) return Promise.resolve(def);
    if (settingsCache) return Promise.resolve(settingsCache);
    var timeout = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
    return Promise.race([db.collection("settings").doc("current").get(), timeout]).then(function (s) {
      if (!s) return def;
      settingsCache = Object.assign(def, s.exists ? s.data() : {});
      return settingsCache;
    }).catch(function () { return def; });
  }

  /* ---------- 관리자 인증 ---------- */
  /* 로그인 필요 페이지에서 호출: 로그인 전에는 로그인 폼만 보이고,
     로그인 후 onReady(user) 실행 */
  function requireAdmin(onReady) {
    var gate = $("#gate"), appEl = $("#app");
    if (!configured || !auth) {
      show($("#gate-msg"), "Firebase 구성값(assets/js/config.js)이 아직 비어 있습니다.", "err");
      return;
    }
    var form = $("#login-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        auth.signInWithEmailAndPassword(form.elements.email.value.trim(), form.elements.pw.value)
          .catch(function (err) {
            var msg = /password|credential|user-not-found/i.test(err.code) ? "이메일 또는 비밀번호가 맞지 않습니다." : "로그인하지 못했습니다. (" + err.code + ")";
            show($("#gate-msg"), msg, "err");
          }).then(function () { btn.disabled = false; });
      });
    }
    $$("[data-logout]").forEach(function (b) {
      b.addEventListener("click", function () { auth.signOut().then(function () { location.reload(); }); });
    });
    var started = false;
    auth.onAuthStateChanged(function (user) {
      if (user) {
        if (gate) gate.hidden = true;
        if (appEl) appEl.hidden = false;
        $$("[data-user]").forEach(function (el) { el.textContent = user.email; });
        if (!started) { started = true; onReady(user); }
      } else {
        if (gate) gate.hidden = false;
        if (appEl) appEl.hidden = true;
      }
    });
  }

  /* ---------- 수험표 ---------- */
  function ticketHtml(r, S, opts) {
    opts = opts || {};
    return '<div class="ticket">' +
      '<div class="ticket-head"><span>수험표</span><small>' + esc(S.round) + '</small></div>' +
      '<div class="ticket-body">' +
        '<dl>' +
          '<dt>수험번호</dt><dd class="no">' + esc(r.examNo) + '</dd>' +
          '<dt>성명</dt><dd>' + esc(r.name) + '</dd>' +
          '<dt>학년</dt><dd>' + esc(r.grade || "") + '</dd>' +
          (r.school ? '<dt>학교</dt><dd>' + esc(r.school) + '</dd>' : '') +
          (r.phone ? '<dt>학부모</dt><dd>' + esc(fmtPhone(r.phone)) + '</dd>' : '') +
          '<dt>시험장</dt><dd>' + esc(S.place) + (r.room ? ' ' + esc(r.room) : '') + '</dd>' +
          '<dt>시험일시</dt><dd>' + esc(S.examDate) + '</dd>' +
          '<dt>입실</dt><dd>' + esc(S.checkIn) + '</dd>' +
        '</dl>' +
        '<div class="qr" data-qr="' + esc(qrText(r)) + '"></div>' +
      '</div>' +
      '<div class="ticket-foot">시험 당일 입실할 때 이 QR 코드를 감독관에게 보여 주세요. 화면 캡처나 인쇄물 모두 가능합니다.' +
        (S.tel ? ' 문의 ' + esc(S.tel) : '') + '</div>' +
    '</div>';
  }
  function fmtPhone(p) {
    p = digits(p);
    return p.length === 11 ? p.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3") : p;
  }
  function drawQrs(root) {
    if (!window.QRCode) return;
    $$("[data-qr]", root).forEach(function (el) {
      if (el.dataset.done) return;
      el.dataset.done = "1";
      new QRCode(el, { text: el.dataset.qr, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
    });
  }

  /* 수험번호 자동 생성: 연도2 + 학년코드2 + 순번4 (예: 26050012) */
  var GRADE_CODE = { "초1": "01", "초2": "02", "초3": "03", "초4": "04", "초5": "05", "초6": "06", "중1": "07", "중2": "08", "중3": "09" };
  function gradeCode(g) {
    var k = normGrade(g);
    return GRADE_CODE[k] || "00";
  }
  function normGrade(g) {
    g = String(g || "").replace(/\s+/g, "");
    var m = /^(초등학교|초등|초)\s*(\d)/.exec(g) || /^(\d)학년?$/.exec(g);
    if (/^(초등학교|초등|초)/.test(g)) { var a = /(\d)/.exec(g); return a ? "초" + a[1] : g; }
    if (/^(중학교|중등|중)/.test(g)) { var b = /(\d)/.exec(g); return b ? "중" + b[1] : g; }
    return g;
  }

  window.AMCApp = {
    configured: configured, db: db, auth: auth, fb: window.firebase,
    esc: esc, $: $, $$: $$, digits: digits, normName: normName, normGrade: normGrade, gradeCode: gradeCode,
    pad: pad, fmtPhone: fmtPhone, fmtTime: fmtTime, fmtDateTime: fmtDateTime, randomToken: randomToken, sha256: sha256, lookupKey: lookupKey,
    show: show, hide: hide, qrText: qrText, parseQr: parseQr,
    loadSettings: loadSettings, requireAdmin: requireAdmin, ticketHtml: ticketHtml, drawQrs: drawQrs
  };

  /* 현재 페이지 메뉴 표시 */
  var here = location.pathname.split("/").pop() || "index.html";
  $$(".top nav a").forEach(function (a) {
    if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
  });
})();
