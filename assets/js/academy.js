/* =========================================================
   성적·시상 조회 포털 (academy.html) — 로그인 하나로 역할 구분
   - 원장님(아이디=학원 이름): 자기 학원 학생만, 「시상 내용 확인」 버튼
   - 관리자(아이디 admin 또는 관리자 이메일): 학원별 보기 + 확인 현황·계정 + 업로드 + 설정
   다른 학원 성적은 화면뿐 아니라 firestore.rules 에서도 막혀 있음
   ========================================================= */
(function () {
  "use strict";
  var A = window.AMCApp, R = window.AMCResults, $ = A.$, $$ = A.$$, esc = A.esc, db = A.db, auth = A.auth;
  var FV = function () { return firebase.firestore.FieldValue.serverTimestamp(); };

  var isAdmin = false, me = null, cfg = {}, results = [], academies = {}, acUsers = {}, confirms = {}, view = "";

  /* ---------- 전체 화면 바둑판 배경 (포토부스) ---------- */
  var BG_NAMES = ["가람스카이수학학원", "강의하는아이들", "대시나루국어학원", "대치레몬", "동일학원", "두드림창의수학학원", "리더스학원", "민단수학과학학원", "바른길수학학원", "백년대계학림학원", "생각이반짝창의수학", "송우찬수학학원", "수학이만드는세상학원", "스카이학원", "유수하수학학원", "주선생영수학학원", "지엔탑학원", "평촌다수인수학학원", "한빛주니어학원", "한빛학원", "G1230수학학원", "G1230안양캠퍼스", "JTD수학과학학원"];
  /* 바둑판은 윗부분 띠 바로 아래에서 시작해 페이지 끝까지 (함께 스크롤) */
  var gridKey = "";
  function drawGrid() {
    var g = $("#bg-grid"), head = document.querySelector(".booth-head"), main = document.querySelector("main"); if (!g || !head) return;
    var w = document.documentElement.clientWidth;
    var top = Math.round(head.getBoundingClientRect().bottom + window.scrollY);
    var bottom = Math.max(window.innerHeight, Math.round(main.getBoundingClientRect().bottom + window.scrollY));
    var cols = w < 640 ? 4 : Math.max(5, Math.round(w / 165)), th = w < 640 ? 64 : 76, rows = Math.ceil((bottom - top) / th);
    g.style.top = top + "px"; g.style.height = (bottom - top) + "px";
    var key = cols + "x" + rows;
    if (key === gridKey) return;
    gridKey = key;
    g.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    g.style.gridAutoRows = th + "px";
    var html = "", k = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if ((r + c) % 2 === 1) html += '<i class="d"><img src="assets/img/emblem.png" alt=""></i>';
      else if (r % 2 === 0) html += '<i class="l">' + esc(BG_NAMES[(k++) % BG_NAMES.length]) + "</i>";
      else html += '<i class="l en">AMC</i>';
    }
    g.innerHTML = html;
  }
  drawGrid();
  var gridTimer;
  function regrid() { clearTimeout(gridTimer); gridTimer = setTimeout(drawGrid, 120); }
  window.addEventListener("resize", regrid);
  window.addEventListener("load", regrid);
  if (window.ResizeObserver) new ResizeObserver(regrid).observe(document.querySelector("main"));

  if (!A.configured || !auth) { A.show($("#gate-msg"), "Firebase 구성값이 비어 있습니다.", "err"); return; }

  /* ================= 로그인 ================= */
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector("button[type=submit]");
    var id = f.elements.name.value.trim(), pw = f.elements.pw.value;
    if (!id || !pw) { A.show($("#gate-msg"), "아이디와 비밀번호를 입력하세요.", "err"); return; }
    btn.disabled = true;
    A.loginEmail(id).then(function (email) { return auth.signInWithEmailAndPassword(email, pw); }).catch(function (err) {
      var msg = /password|credential|user-not-found|invalid-email|INVALID_LOGIN/i.test(err.code + err.message)
        ? "아이디 또는 비밀번호가 맞지 않습니다. 학원 이름은 안내받은 그대로 입력해 주세요."
        : /too-many-requests/.test(err.code) ? "로그인 시도가 많아 잠시 막혔습니다. 몇 분 뒤 다시 시도해 주세요."
        : "로그인하지 못했습니다. (" + esc(err.code) + ")";
      A.show($("#gate-msg"), msg, "err");
    }).then(function () { btn.disabled = false; });
  });
  $("#logout").addEventListener("click", function (e) { e.preventDefault(); auth.signOut().then(function () { location.reload(); }); });

  var started = false;
  auth.onAuthStateChanged(function (user) {
    if (!user) {
      $("#gate").hidden = false; $("#top-nav").hidden = true; $("#view").hidden = true; $("#closed").hidden = true; $("#admin-tabs").hidden = true;
      return;
    }
    if (started) return;
    started = true;
    $("#gate").hidden = true; $("#top-nav").hidden = false;
    $("#booth").classList.add("compact"); document.body.classList.add("logged");
    isAdmin = !A.isAcademyEmail(user.email);
    if (isAdmin) startAdmin(user); else startAcademy(user);
  });

  function showClosed(title, html) {
    $("#closed-title").textContent = title;
    $("#closed-msg").innerHTML = html;
    $("#closed").hidden = false;
  }

  /* ================= 원장님 ================= */
  function startAcademy(user) {
    db.collection("academyUsers").doc(user.uid).get().then(function (d) {
      if (!d.exists) { showClosed("사용할 수 없는 계정입니다", "계정이 해제되었거나 아직 연결되지 않았습니다. AMC 위원회에 문의해 주세요."); return null; }
      me = d.data();
      $("[data-who]").textContent = me.name;
      if (!me.pwChangedAt) openPw(true);
      return db.collection("settings").doc("results").get();
    }).then(function (s) {
      if (!s) return null;
      cfg = s.exists ? s.data() : {};
      if (!cfg.resultsOpen) { showClosed("성적·시상 조회 기간이 아닙니다", "조회가 열리면 이 화면에서 바로 확인할 수 있습니다." + (cfg.notice ? "<br><br>" + esc(cfg.notice) : "")); return null; }
      return Promise.all([
        db.collection("results").where("academyId", "==", me.academyId).get(),
        db.collection("confirms").doc(me.academyId).get().catch(function () { return null; })
      ]);
    }).then(function (res) {
      if (!res) return;
      results = R.sortResults(res[0].docs.map(function (d) { return d.data(); }));
      if (res[1] && res[1].exists) confirms[me.academyId] = res[1].data();
      view = me.academyId;
      $("#view").hidden = false;
      setupFilters();
      render();
    }).catch(function (err) {
      console.error(err);
      if (/permission/i.test(err.code)) showClosed("조회할 수 없습니다", "조회 기간이 아니거나 계정 권한이 없습니다. AMC 위원회에 문의해 주세요.");
      else showClosed("불러오지 못했습니다", "잠시 후 다시 시도해 주세요. (" + esc(err.code || err.message) + ")");
    });
  }

  /* ================= 관리자 ================= */
  function startAdmin(user) {
    $("[data-who]").textContent = user.email === A.ADMIN_EMAIL ? "admin" : user.email;
    if (user.email === A.ADMIN_EMAIL) {
      db.collection("private").doc("admin").get().then(function (d) { if (!d.exists || !d.data().pwChangedAt) openPw(true); }).catch(function () {});
    }
    $$("[data-admin-only]").forEach(function (el) { el.hidden = false; });
    $("#admin-tabs").hidden = false;
    $("#view").hidden = false;
    $$("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
        $$("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
      });
    });
    $("#pick-academy").addEventListener("change", function () { view = this.value; render(); });
    bindStatus(); bindUpload(); bindSettings();

    db.collection("results").onSnapshot(function (snap) {
      results = R.sortResults(snap.docs.map(function (d) { return d.data(); }));
      fillPicker(); setupFilters(); render(); renderStatus();
    }, onErr);
    db.collection("academies").onSnapshot(function (snap) { academies = {}; snap.docs.forEach(function (d) { academies[d.id] = d.data(); }); renderStatus(); }, onErr);
    db.collection("academyUsers").onSnapshot(function (snap) { acUsers = {}; snap.docs.forEach(function (d) { acUsers[d.id] = d.data(); }); renderStatus(); }, onErr);
    db.collection("confirms").onSnapshot(function (snap) { confirms = {}; snap.docs.forEach(function (d) { confirms[d.id] = d.data(); }); renderStatus(); render(); fillPicker(); }, onErr);
    db.collection("settings").doc("results").onSnapshot(function (d) { cfg = d.exists ? d.data() : {}; fillSettings(); render(); }, onErr);
  }
  function onErr(err) {
    console.error(err);
    if (/permission/i.test(err.code)) showClosed("권한이 없습니다", "관리자 권한이 없는 계정이거나 규칙이 아직 반영되지 않았습니다.");
  }

  /* 학원 목록 (성적 기준 + 계정 기준) */
  function academyList() {
    var map = {};
    results.forEach(function (r) {
      var id = r.academyId || "";
      if (!map[id]) map[id] = { id: id, name: r.academy || "(학원 없음)", students: 0, awards: 0 };
      map[id].students++; if (r.award) map[id].awards++;
    });
    Object.keys(academies).forEach(function (id) { if (!map[id]) map[id] = { id: id, name: academies[id].name, students: 0, awards: 0 }; });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      if (!a.id) return 1; if (!b.id) return -1;
      return a.name.localeCompare(b.name, "ko");
    });
  }
  function fillPicker() {
    var sel = $("#pick-academy"), keep = view;
    sel.innerHTML = '<option value="*">전체 학원 (' + results.length + "명)</option>" + academyList().map(function (a) {
      var ok = a.id && confirms[a.id] ? " ✓" : "";
      return '<option value="' + esc(a.id || "!") + '">' + esc(a.name) + " (" + a.students + "명)" + ok + "</option>";
    }).join("");
    sel.value = keep || "*";
    if (!sel.value) sel.value = "*";
    view = sel.value;
  }

  /* ================= 학원 화면 그리기 (원장님·관리자 공용) ================= */
  function setupFilters() {
    var opt = R.filterOptions(results), g = $("#f-grade").value, a = $("#f-award").value;
    $("#f-grade").innerHTML = '<option value="">전체 학년</option>' + opt.grades.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("");
    $("#f-award").innerHTML = '<option value="">전체 상장</option>' + opt.awards.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("");
    $("#f-grade").value = g; $("#f-award").value = a;
  }
  function scoped() {
    if (!isAdmin) return results;
    if (view === "*" || !view) return results;
    if (view === "!") return results.filter(function (r) { return !r.academyId; });
    return results.filter(function (r) { return r.academyId === view; });
  }
  function filtered() {
    var g = $("#f-grade").value, aw = $("#f-award").value, q = A.normName($("#q").value).toLowerCase();
    return scoped().filter(function (r) {
      if (g && r.grade !== g) return false;
      if (aw && r.award !== aw) return false;
      if (q && [r.name, r.examNo, r.school, r.academy].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function currentName() {
    if (!isAdmin) return me ? me.name : "";
    if (view === "*" || !view) return "전체 학원";
    if (view === "!") return "학원 없음 (개인접수)";
    var a = academyList().filter(function (x) { return x.id === view; })[0];
    return a ? a.name : view;
  }
  function render() {
    if ($("#view").hidden) return;
    var list = filtered(), all = scoped();
    $("#ac-title").textContent = currentName();
    $("#round-title").textContent = (cfg.title ? cfg.title + " · " : "") + "응시 학생 " + all.length + "명";
    if (cfg.notice) A.show($("#notice"), esc(cfg.notice).replace(/\n/g, "<br>")); else A.hide($("#notice"));
    $("#legend").innerHTML = '<span class="mk mk-o">3</span> 맞음 <span class="mk mk-x">2</span> 틀림 · 칸 안의 숫자는 학생이 쓴 답입니다. 중3은 영역별 점수입니다.';
    $("#stats").innerHTML = R.statsHtml(all);
    R.renderGrades($("#grade-tables"), list, cfg.keys || {}, { academy: isAdmin && (view === "*" || view === "!") });
    renderConfirm();
  }

  function fmt(ts) { return ts ? A.fmtDateTime(ts).slice(0, 16) : ""; }
  function renderConfirm() {
    var box = $("#confirm-box");
    if (!isAdmin) {
      var c = confirms[me.academyId];
      box.innerHTML = c
        ? '<div class="confirm done"><b>시상 내용 확인 완료</b><span>' + esc(fmt(c.confirmedAt)) + " 확인함</span></div>"
        : '<div class="confirm"><div><b>시상 내용을 확인해 주세요</b><span>아래 학생별 시상 내역을 확인하신 뒤 버튼을 눌러 주세요. 확인 여부가 위원회에 전달됩니다.</span></div><button class="btn btn-ochre" id="do-confirm">시상 내용 확인</button></div>';
      var b = $("#do-confirm");
      if (b) b.addEventListener("click", doConfirm);
      return;
    }
    if (!view || view === "*" || view === "!") { box.innerHTML = ""; return; }
    var cc = confirms[view];
    box.innerHTML = cc ? '<div class="confirm done"><b>원장님 확인 완료</b><span>' + esc(fmt(cc.confirmedAt)) + "</span></div>"
      : '<div class="confirm"><div><b>원장님 미확인</b><span>원장님이 아직 시상 내용 확인을 누르지 않았습니다.</span></div></div>';
  }
  function doConfirm() {
    if (!confirm("우리 학원 학생 " + results.length + "명의 시상 내용을 확인하셨나요?")) return;
    var b = $("#do-confirm"); b.disabled = true;
    var data = { confirmedAt: firebase.firestore.Timestamp.now(), name: me.name, uid: auth.currentUser.uid };
    db.collection("confirms").doc(me.academyId).set(data).then(function () {
      confirms[me.academyId] = data; renderConfirm();
    }).catch(function (err) { alert("저장하지 못했습니다. (" + (err.code || err.message) + ")"); b.disabled = false; });
  }

  ["#f-grade", "#f-award"].forEach(function (s) { $(s).addEventListener("change", render); });
  $("#q").addEventListener("input", render);
  $("#dl-xlsx").addEventListener("click", function () {
    R.exportXlsx(filtered(), cfg.keys || {}, "AMC_성적시상_" + currentName().replace(/[\\\/:*?"<>|() ]/g, "") + ".xlsx", { academy: isAdmin });
  });

  /* ================= 관리자: 확인 현황·학원 계정 ================= */
  var creator = null;
  function creatorAuth() {
    if (!creator) {
      var app = firebase.apps.filter(function (a) { return a.name === "academy-creator"; })[0] || firebase.initializeApp(window.FIREBASE_CONFIG, "academy-creator");
      creator = app.auth();
    }
    return creator.setPersistence(firebase.auth.Auth.Persistence.NONE).then(function () { return creator; });
  }
  function acState(id) {
    var a = academies[id];
    if (!a) return "none";
    if (a.revoked || !acUsers[a.uid]) return "revoked";
    return acUsers[a.uid].pwChangedAt ? "changed" : "issued";
  }
  function renderStatus() {
    if (!isAdmin) return;
    var list = academyList().filter(function (a) { return a.id; });
    var done = list.filter(function (a) { return confirms[a.id]; }).length;
    var issued = list.filter(function (a) { var s = acState(a.id); return s === "issued" || s === "changed"; }).length;
    $("#status-stats").innerHTML = '<div class="stat"><b>' + list.length + '</b><span>학원</span></div>' +
      '<div class="stat"><b>' + issued + '</b><span>계정 발급</span></div>' +
      '<div class="stat"><b>' + done + '</b><span>시상 확인 완료</span></div>' +
      '<div class="stat"><b>' + (list.length - done) + '</b><span>미확인</span></div>';
    $("#ac-table tbody").innerHTML = list.map(function (r) {
      var st = acState(r.id), a = academies[r.id] || {}, c = confirms[r.id];
      var stHtml = { none: '<span class="tag tag-no">미발급</span>', issued: '<span class="tag tag-ok">발급됨</span>', changed: '<span class="tag tag-gold">원장님 변경함</span>', revoked: '<span class="tag tag-warn">해제됨</span>' }[st];
      var pw = st === "issued" ? '<code class="pw">' + esc(a.initialPw) + "</code>" : st === "changed" ? '<span class="hint">원장님이 바꿈</span>' : "";
      var act = st === "none" ? '<button class="btn btn-sm" data-make="' + esc(r.id) + '">발급</button>'
        : st === "revoked" ? '<button class="btn btn-line btn-sm" data-relink="' + esc(r.id) + '">다시 연결</button>'
        : '<button class="btn btn-line btn-sm" data-reset="' + esc(r.id) + '">비밀번호 재발급</button> <button class="btn btn-line btn-sm" data-revoke="' + esc(r.id) + '">해제</button>';
      act = '<button class="btn btn-line btn-sm" data-see="' + esc(r.id) + '">보기</button> ' + act;
      return "<tr><td><b>" + esc(r.name) + '</b><br><small class="hint">아이디: ' + esc(r.id) + "</small></td>" +
        '<td class="num">' + r.students + "</td>" +
        "<td>" + (c ? '<span class="tag tag-ok">확인</span> <small class="hint">' + esc(fmt(c.confirmedAt)) + "</small>" : '<span class="tag tag-warn">미확인</span>') + "</td>" +
        "<td>" + stHtml + "</td><td>" + pw + "</td><td>" + act + "</td></tr>";
    }).join("") || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">성적을 먼저 올리세요.</td></tr>';
  }
  function bindStatus() {
    $("#ac-table").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.see) {
        view = b.dataset.see; $("#pick-academy").value = view; render();
        $$("[data-tab]")[0].click(); window.scrollTo(0, 0); return;
      }
      var id = b.dataset.make || b.dataset.reset || b.dataset.revoke || b.dataset.relink;
      var row = academyList().filter(function (r) { return r.id === id; })[0];
      if (!row) return;
      b.disabled = true;
      var job = b.dataset.make ? createAccount(row.name)
        : b.dataset.reset ? (confirm(row.name + " 비밀번호를 새로 발급할까요?") ? resetPassword(id) : Promise.resolve())
        : b.dataset.revoke ? (confirm(row.name + " 계정을 해제할까요? 해제하면 원장님이 조회할 수 없습니다.") ? revoke(id) : Promise.resolve())
        : relink(id);
      job.then(function (msg) { if (msg) A.show($("#ac-msg"), msg, "ok"); })
        .catch(function (err) { console.error(err); A.show($("#ac-msg"), esc(err.message || err), "err"); })
        .then(function () { b.disabled = false; });
    });
    $("#ac-make-all").addEventListener("click", function () {
      var todo = academyList().filter(function (r) { return r.id && acState(r.id) === "none"; });
      if (!todo.length) { A.show($("#ac-msg"), "새로 발급할 학원이 없습니다.", "ok"); return; }
      if (!confirm(todo.length + "개 학원 계정을 발급할까요?")) return;
      var btn = $("#ac-make-all"); btn.disabled = true;
      var done = 0, fail = [];
      todo.reduce(function (p, r) {
        return p.then(function () {
          btn.textContent = "발급 중 " + (done + fail.length + 1) + "/" + todo.length;
          return createAccount(r.name).then(function () { done++; }).catch(function (err) { fail.push(r.name + " (" + (err.message || err) + ")"); });
        });
      }, Promise.resolve()).then(function () {
        A.show($("#ac-msg"), done + "개 학원 계정을 발급했습니다." + (fail.length ? "<br>실패: " + esc(fail.join(", ")) : ""), fail.length ? "err" : "ok");
        btn.disabled = false; btn.textContent = "계정 없는 학원 모두 발급";
      });
    });
    $("#ac-xlsx").addEventListener("click", function () {
      var rows = academyList().filter(function (r) { return r.id; }).map(function (r) {
        var st = acState(r.id), a = academies[r.id] || {}, c = confirms[r.id];
        return { 학원: r.name, 아이디: r.id, "초기 비밀번호": st === "issued" ? a.initialPw : "", 계정: { none: "미발급", issued: "발급됨", changed: "원장님 변경함", revoked: "해제됨" }[st], 학생: r.students, "시상 확인": c ? "확인" : "미확인", "확인 시각": c ? fmt(c.confirmedAt) : "", "접속 주소": academyUrl() };
      });
      var w = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(w, XLSX.utils.json_to_sheet(rows), "학원 계정");
      XLSX.writeFile(w, "AMC_학원계정_확인현황.xlsx");
    });
  }
  function createAccount(name) {
    var id = A.academyId(name), pw = A.randomPassword(), email, ca, prev = academies[id];
    return creatorAuth().then(function (c) { ca = c; return A.academyEmail(name); }).then(function (em) {
      email = em;
      return ca.createUserWithEmailAndPassword(email, pw).catch(function (err) {
        if (err.code === "auth/email-already-in-use" && prev && prev.initialPw) {
          pw = prev.initialPw;
          return ca.signInWithEmailAndPassword(email, pw).catch(function () { throw new Error(name + ": 이미 계정이 있고 비밀번호가 바뀌어 다시 발급할 수 없습니다."); });
        }
        if (err.code === "auth/email-already-in-use") throw new Error(name + ": 이미 같은 이름의 계정이 있습니다.");
        throw err;
      });
    }).then(function (cred) {
      var uid = cred.user.uid, b = db.batch();
      b.set(db.collection("academies").doc(id), { name: String(name).trim(), email: email, uid: uid, initialPw: pw, revoked: false, createdAt: FV() });
      b.set(db.collection("academyUsers").doc(uid), { academyId: id, name: String(name).trim(), email: email, pwChangedAt: null });
      return b.commit();
    }).then(function () { return ca.signOut(); })
      .then(function () { return esc(name) + " 계정 발급 — 아이디 " + esc(id) + " / 비밀번호 " + esc(pw); });
  }
  function resetPassword(id) {
    var a = academies[id], pw = A.randomPassword(), ca;
    return creatorAuth().then(function (c) { ca = c; return ca.signInWithEmailAndPassword(a.email, a.initialPw); }).catch(function () {
      throw new Error(a.name + ": 원장님이 비밀번호를 바꿔서 여기서 재발급할 수 없습니다.");
    }).then(function (cred) { return cred.user.updatePassword(pw); })
      .then(function () { return db.collection("academies").doc(id).update({ initialPw: pw }); })
      .then(function () { return ca.signOut(); })
      .then(function () { return esc(a.name) + " 새 비밀번호: " + esc(pw); });
  }
  function revoke(id) {
    var a = academies[id], b = db.batch();
    b.update(db.collection("academies").doc(id), { revoked: true });
    if (a.uid) b.delete(db.collection("academyUsers").doc(a.uid));
    return b.commit().then(function () { return esc(a.name) + " 계정을 해제했습니다."; });
  }
  function relink(id) {
    var a = academies[id], b = db.batch();
    b.update(db.collection("academies").doc(id), { revoked: false });
    b.set(db.collection("academyUsers").doc(a.uid), { academyId: id, name: a.name, email: a.email, pwChangedAt: null });
    return b.commit().then(function () { return esc(a.name) + " 계정을 다시 연결했습니다."; });
  }

  /* ================= 관리자: 업로드 (학원 매칭 엑셀) ================= */
  var upRows = null;
  function bindUpload() {
    var drop = $("#drop"), file = $("#file");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    file.addEventListener("change", function () { if (file.files[0]) readFile(file.files[0]); });
    $("#up-save").addEventListener("click", saveUpload);
  }
  function readFile(f) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var wb = XLSX.read(e.target.result, { type: "array" }), out = [];
      wb.SheetNames.forEach(function (n) {
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: true });
        if (!rows.length) return;
        var h = rows[0].map(function (x) { return String(x).trim(); });
        var ix = {}; h.forEach(function (x, i) { ix[x] = i; });
        if (ix["수험번호"] == null || ix["인증"] == null) return;
        var labels = h.slice(ix["인증"] + 1).filter(function (x) { return x !== ""; });
        rows.slice(1).forEach(function (r) {
          var name = A.normName(r[ix["성명"]]);
          if (!name) return;
          var academy = String(r[ix["학원"]] || "").trim();
          out.push({
            examNo: String(r[ix["수험번호"]]).trim(), name: name, grade: String(r[ix["학년"]]).trim(), school: String(r[ix["학교"]] || "").trim(),
            academy: academy, academyId: A.academyId(academy), entry: String(r[ix["접수"]] || "").trim(),
            total: r[ix["총점"]] === "" ? "" : r[ix["총점"]], award: String(r[ix["상장"]] || "").replace(/\s+/g, ""), cert: String(r[ix["인증"]] || "").trim(),
            labels: labels, answers: labels.map(function (l, i) { var v = r[ix["인증"] + 1 + i]; return v == null ? "" : String(v).trim(); })
          });
        });
      });
      if (!out.length) { A.show($("#up-msg"), "형식에 맞는 시트를 찾지 못했습니다. (제목 행에 수험번호·인증 열 필요)", "err"); return; }
      upRows = out;
      var acs = {}; out.forEach(function (r) { acs[r.academyId || "(학원 없음)"] = 1; });
      A.show($("#up-msg"), esc(f.name) + " — " + out.length + "명, 학원 " + Object.keys(acs).length + "곳 (학원 없음 " + out.filter(function (r) { return !r.academyId; }).length + "명)");
      $("#up-actions").hidden = false;
    };
    reader.readAsArrayBuffer(f);
  }
  function saveUpload() {
    if (!upRows || !confirm("기존 성적을 모두 지우고 " + upRows.length + "명을 저장할까요?")) return;
    var btn = $("#up-save"); btn.disabled = true; btn.textContent = "저장 중";
    db.collection("results").get().then(function (snap) {
      var ops = snap.docs.map(function (d) { return { del: d.ref }; });
      upRows.forEach(function (r) { ops.push({ ref: db.collection("results").doc("e_" + r.examNo.replace(/[\/\s]/g, "")), data: Object.assign({ uploadedAt: FV() }, r) }); });
      var chain = Promise.resolve();
      for (var i = 0; i < ops.length; i += 400) (function (sl) {
        chain = chain.then(function () { var b = db.batch(); sl.forEach(function (o) { o.del ? b.delete(o.del) : b.set(o.ref, o.data); }); return b.commit(); });
      })(ops.slice(i, i + 400));
      return chain;
    }).then(function () {
      A.show($("#up-msg"), upRows.length + "명을 저장했습니다. 「확인 현황·학원 계정」에서 계정 없는 학원을 발급하세요.", "ok");
    }).catch(function (err) { A.show($("#up-msg"), "오류: " + esc(err.message), "err"); })
      .then(function () { btn.disabled = false; btn.textContent = "성적 저장"; });
  }

  /* ================= 관리자: 조회 설정 ================= */
  function academyUrl() { return location.href.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + "academy.html"; }
  function gradesWithLabels() {
    var g = {};
    results.forEach(function (r) { if (!g[r.grade]) g[r.grade] = (r.labels || []).length; });
    return Object.keys(g).sort(function (a, b) { return R.gradeIdx(a) - R.gradeIdx(b); }).map(function (k) { return [k, g[k]]; });
  }
  function fillSettings() {
    var f = $("#cfg-form");
    f.elements.resultsOpen.checked = !!cfg.resultsOpen;
    f.elements.title.value = cfg.title || "";
    f.elements.notice.value = cfg.notice || "";
    var keys = cfg.keys || {};
    $("#key-rows").innerHTML = gradesWithLabels().map(function (g) {
      return '<div class="map-row"><label>' + esc(g[0]) + " (" + g[1] + '문항)</label><input class="input" data-key="' + esc(g[0]) + '" value="' + esc((keys[g[0]] || []).join(",")) + '" placeholder="예: 3,4,5,3,3,…"></div>';
    }).join("");
  }
  function bindSettings() {
    var link = $("#ac-link"); link.href = academyUrl(); link.textContent = academyUrl();
    $("#cfg-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, keys = {};
      $$("[data-key]").forEach(function (inp) {
        var v = inp.value.split(/[,\s]+/).map(function (x) { return x.trim(); });
        if (v.some(Boolean)) keys[inp.dataset.key] = v;
      });
      db.collection("settings").doc("results").set({
        resultsOpen: f.elements.resultsOpen.checked, title: f.elements.title.value.trim(), notice: f.elements.notice.value.trim(), keys: keys
      }, { merge: true }).then(function () { A.show($("#cfg-msg"), "저장했습니다.", "ok"); })
        .catch(function (err) { A.show($("#cfg-msg"), "오류: " + esc(err.message), "err"); });
    });
  }

  /* ================= 비밀번호 변경 (원장님·admin 공용) =================
     처음 로그인(아직 안 바꿈)이면 팝업이 닫히지 않고 바꿔야만 넘어감 */
  var modal = $("#pw-modal"), forced = false;
  function openPw(force) {
    forced = !!force;
    $("#pw-form").reset(); A.hide($("#pw-msg"));
    $("#pw-force").hidden = !forced;
    $("#pw-cancel").textContent = forced ? "로그아웃" : "닫기";
    modal.hidden = false;
    setTimeout(function () { var el = $("#pw-form").elements.cur; if (el) el.focus(); }, 50);
  }
  $("#open-pw").addEventListener("click", function (e) { e.preventDefault(); openPw(forced); });
  $("#pw-cancel").addEventListener("click", function () {
    if (forced) { auth.signOut().then(function () { location.reload(); }); return; }
    modal.hidden = true;
  });
  modal.addEventListener("click", function (e) { if (e.target === modal && !forced) modal.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !forced) modal.hidden = true; });
  $("#pw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, cur = f.elements.cur.value, nx = f.elements.next.value, nx2 = f.elements.next2.value;
    if (nx !== nx2) { A.show($("#pw-msg"), "새 비밀번호가 서로 다릅니다.", "err"); return; }
    if (nx.length < 8 || !/[A-Za-z]/.test(nx) || !/[0-9]/.test(nx)) { A.show($("#pw-msg"), "영문과 숫자를 섞어 8자 이상으로 정해 주세요.", "err"); return; }
    if (nx === cur) { A.show($("#pw-msg"), "안내받은 비밀번호와 다른 비밀번호로 정해 주세요.", "err"); return; }
    var user = auth.currentUser, btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, cur)).then(function () {
      return user.updatePassword(nx);
    }).then(function () {
      if (!isAdmin) return db.collection("academyUsers").doc(user.uid).update({ pwChangedAt: FV() }).catch(function () {});
      if (user.email === A.ADMIN_EMAIL) return db.collection("private").doc("admin").set({ pwChangedAt: FV(), initialPw: firebase.firestore.FieldValue.delete() }, { merge: true }).catch(function () {});
    }).then(function () {
      if (me) me.pwChangedAt = true;
      var wasForced = forced;
      forced = false;
      $("#pw-force").hidden = true; $("#pw-cancel").textContent = "닫기";
      f.reset();
      A.show($("#pw-msg"), "비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.", "ok");
      if (wasForced) setTimeout(function () { modal.hidden = true; }, 1200);
    }).catch(function (err) {
      A.show($("#pw-msg"), /wrong-password|invalid-credential|INVALID_LOGIN/i.test(err.code + err.message) ? "현재 비밀번호가 맞지 않습니다." : "변경하지 못했습니다. (" + esc(err.code) + ")", "err");
    }).then(function () { btn.disabled = false; });
  });
})();
