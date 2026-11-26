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

  var isAdmin = false, me = null, cfg = {}, results = [], academies = {}, acUsers = {}, confirms = {}, picks = {}, view = "";

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
        db.collection("confirms").doc(me.academyId).get().catch(function () { return null; }),
        db.collection("specialPicks").doc(me.academyId).get().catch(function () { return "blocked"; })
      ]);
    }).then(function (res) {
      if (!res) return;
      results = R.sortResults(res[0].docs.map(function (d) { return d.data(); }));
      if (res[1] && res[1].exists) confirms[me.academyId] = res[1].data();
      if (res[2] === "blocked") pickBlocked = true;
      else if (res[2] && res[2].exists) picks[me.academyId] = res[2].data();
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
    /* 관리자는 비밀번호 변경을 강제하지 않음 (원할 때 상단 메뉴에서 변경) */
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
    db.collection("specialPicks").onSnapshot(function (snap) { picks = {}; snap.docs.forEach(function (d) { picks[d.id] = d.data(); }); renderSpecialAdmin(); renderSpecial(); }, function (err) { console.warn("특별상 추천 읽기 실패 (규칙 확인)", err); });
    $("#sp-xlsx").addEventListener("click", exportPicks);
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
      if (!map[id]) map[id] = { id: id, name: id ? r.academy : "개인접수 (관리자만 조회)", students: 0, awards: 0 };
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
      var ok = a.id && confirms[a.id] ? " ✓ 확인" : "";
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
    $("#f-award").innerHTML = '<option value="">전체 상장</option>' + opt.awards.map(function (x) { return '<option value="' + esc(x) + '">' + esc((R.awardTier(x) ? R.awardTier(x) + " · " : "") + R.awardName(x)) + "</option>"; }).join("");
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
    if (view === "!") return "개인접수 (관리자만 조회)";
    var a = academyList().filter(function (x) { return x.id === view; })[0];
    return a ? a.name : view;
  }
  function render() {
    if ($("#view").hidden) return;
    var list = filtered(), all = scoped();
    $("#ac-title").textContent = currentName();
    $("#round-title").textContent = (cfg.title ? cfg.title + " · " : "") + "응시 학생 " + all.length + "명";
    if (cfg.notice) A.show($("#notice"), esc(cfg.notice).replace(/\n/g, "<br>")); else A.hide($("#notice"));
    $("#legend").hidden = true;
    $("#stats").innerHTML = R.statsHtml(all);
    R.renderGrades($("#grade-tables"), list, cfg.keys || {}, { academy: isAdmin && (view === "*" || view === "!") });
    renderConfirm();
    renderSpecial();
  }

  /* ================= 특별상 추천 =================
     학원별 배정 매수만큼 (이미 상을 받은 우리 학원 학생 중에서) 고름 — 「특별상 학원별 배정 내역」 기준 */
  var SPECIALS = [
    { key: "jihaksa", name: "지학사 대표이사상" },
    { key: "pungsanja", name: "풍산자 수학연구소장상" }
  ];
  var QUOTA = {   /* 학원ID: [지학사, 풍산자] */
    "가람스카이수학학원": [0, 1], "강의하는아이들": [1, 1], "대시나루국어학원": [1, 2], "동일학원": [1, 1],
    "두드림창의수학학원": [1, 1], "리더스학원": [1, 2], "바른길수학학원": [1, 1], "백년대계학림학원": [1, 1],
    "송우찬수학학원": [1, 2], "수학이만드는세상학원": [0, 1], "유수하수학학원": [1, 2], "주선생영수학학원": [1, 2],
    "한빛주니어학원": [1, 1], "G1230수학학원": [1, 2], "JTD수학과학학원": [0, 1]
  };
  function quotaOf(id, key) { var q = QUOTA[id]; if (!q) return 0; return key === "jihaksa" ? q[0] : q[1]; }
  function quotaTotal(id) { var q = QUOTA[id]; return q ? q[0] + q[1] : 0; }
  /* 예전(한 명) 저장 형식도 목록으로 읽음 */
  function pickList(pk, key) { var v = pk && pk[key]; if (!v) return []; return Array.isArray(v) ? v : [v]; }

  var pickBlocked = false, pickDraft = {}, pickEditing = false;
  function studentLabel(r) {
    return r.name + " (" + (r.grade || "") + (r.school ? " · " + r.school : "") + ") · " + R.awardName(r.award);
  }
  function pickOneHtml(p) {
    return "<div class='sp-p'><b>" + esc(p.name) + '</b> <small class="hint">' + esc((p.grade || "") + (p.school ? " · " + p.school : "")) +
      (p.award ? " · " + esc(R.awardName(p.award)) : "") + "</small></div>";
  }
  function pickListHtml(pk, key, n) {
    var l = pickList(pk, key);
    if (!n) return '<span class="hint">배정 없음</span>';
    if (!l.length) return '<span class="tag tag-warn">미선택</span> <small class="hint">' + n + "명 배정</small>";
    return l.map(pickOneHtml).join("") + (l.length < n ? '<small class="tag tag-warn">' + l.length + "/" + n + "명</small>" : "");
  }
  function renderSpecial() {
    var card = $("#special-card"); if (!card) return;
    /* 관리자 「학원별 보기」: 특정 학원을 골랐을 때만, 읽기 전용 */
    if (isAdmin) {
      if (!view || view === "*" || view === "!" || !quotaTotal(view)) { card.hidden = true; return; }
      var pk = picks[view];
      card.hidden = false;
      card.innerHTML = '<h3 class="sp-h">특별상 추천 <small class="hint">' + (pk ? "제출 " + esc(fmt(pk.submittedAt)) : "아직 제출 안 함") + "</small></h3>" +
        '<div class="sp-grid">' + SPECIALS.filter(function (sp) { return quotaOf(view, sp.key); }).map(function (sp) {
          return '<div class="sp-item"><div class="sp-name">' + esc(sp.name) + ' <small class="hint">' + quotaOf(view, sp.key) + '명</small></div><div class="sp-val">' + pickListHtml(pk, sp.key, quotaOf(view, sp.key)) + "</div></div>";
        }).join("") + "</div>";
      return;
    }
    if (!me) { card.hidden = true; return; }
    var my = me.academyId;
    if (!quotaTotal(my)) { card.hidden = true; return; }
    card.hidden = false;
    if (pickBlocked) {
      card.innerHTML = '<h3 class="sp-h">특별상 추천</h3><p class="hint" style="margin:0">아직 추천을 받을 수 없습니다. 잠시 후 다시 들어와 주세요.</p>';
      return;
    }
    var saved = picks[my];
    var active = SPECIALS.filter(function (sp) { return quotaOf(my, sp.key) > 0; });
    var quotaTxt = active.map(function (sp) { return sp.name + " " + quotaOf(my, sp.key) + "명"; }).join(", ");
    /* 제출한 뒤: 결과만 보이고 「수정하기」로 고침 */
    if (saved && !pickEditing) {
      card.innerHTML = '<h3 class="sp-h">특별상 추천 <span class="tag tag-ok">제출 완료 ' + esc(fmt(saved.submittedAt)) + "</span></h3>" +
        '<div class="sp-grid">' + active.map(function (sp) {
          return '<div class="sp-item"><div class="sp-name">' + esc(sp.name) + ' <small class="hint">' + quotaOf(my, sp.key) + '명</small></div><div class="sp-val">' + pickListHtml(saved, sp.key, quotaOf(my, sp.key)) + "</div></div>";
        }).join("") + "</div>" +
        '<div class="row" style="margin-top:14px"><button class="btn btn-line" id="sp-edit">수정하기</button></div>';
      $("#sp-edit").addEventListener("click", function () {
        pickEditing = true;
        SPECIALS.forEach(function (sp) { pickDraft[sp.key] = pickList(saved, sp.key).map(function (p) { return p.docId; }); });
        renderSpecial();
      });
      return;
    }
    SPECIALS.forEach(function (sp) { if (!pickDraft[sp.key]) pickDraft[sp.key] = pickList(saved, sp.key).map(function (p) { return p.docId; }); });
    var awarded = results.filter(function (r) { return r.award; });
    card.innerHTML = '<h3 class="sp-h">특별상 추천 제출 ' + (saved ? '<span class="tag tag-gold">수정 중</span>' : '<span class="tag tag-warn">미제출</span>') + "</h3>" +
      '<p class="hint" style="margin:0 0 14px">우리 학원 배정: <b>' + esc(quotaTxt) + "</b>. 이미 상을 받은 우리 학원 학생 중에서 배정된 인원만큼 골라 제출해 주세요. 제출한 뒤에도 「수정하기」로 바꿀 수 있습니다.</p>" +
      '<div class="sp-grid">' + active.map(function (sp) {
        var n = quotaOf(my, sp.key);
        return '<div class="sp-item" data-sp="' + sp.key + '">' +
          '<div class="sp-name">' + esc(sp.name) + ' <span class="sp-count"></span></div>' +
          '<input class="input sp-q" placeholder="이름·학교로 찾기">' +
          '<div class="sp-list">' + awarded.map(function (r) {
            var id = docIdOf(r), on = pickDraft[sp.key].indexOf(id) !== -1;
            return '<label class="sp-opt' + (on ? " on" : "") + '"><input type="checkbox" value="' + esc(id) + '"' + (on ? " checked" : "") + "> <span>" + esc(studentLabel(r)) + "</span></label>";
          }).join("") + "</div>" +
          '<div class="sp-chosen"></div>' +
        "</div>";
      }).join("") + "</div>" +
      '<div class="row" style="margin-top:14px"><button class="btn btn-ochre" id="sp-submit">' + (saved ? "수정 내용 제출" : "제출하기") + "</button>" +
      (saved ? '<button class="btn btn-line" id="sp-cancel">수정 취소</button>' : "") + "</div>";
    $$(".sp-item", card).forEach(function (box) {
      var key = box.dataset.sp, n = quotaOf(my, key), q = $(".sp-q", box);
      function sync() {
        var sel = pickDraft[key];
        $(".sp-count", box).innerHTML = '<span class="tag ' + (sel.length === n ? "tag-ok" : "tag-warn") + '">' + sel.length + " / " + n + "명</span>";
        $(".sp-chosen", box).innerHTML = sel.length ? "선택: " + sel.map(function (id) { var r = findByDocId(id); return "<b>" + esc(r ? r.name + " (" + r.grade + ")" : id) + "</b>"; }).join(", ") : "선택: 없음";
        $$(".sp-opt", box).forEach(function (l) {
          var cb = $("input", l); l.classList.toggle("on", cb.checked);
          cb.disabled = !cb.checked && sel.length >= n;
          l.classList.toggle("off", cb.disabled);
        });
      }
      $$(".sp-opt input", box).forEach(function (cb) {
        cb.addEventListener("change", function () {
          var l = pickDraft[key], i = l.indexOf(cb.value);
          if (cb.checked && i === -1) { if (l.length >= n) { cb.checked = false; return; } l.push(cb.value); }
          if (!cb.checked && i !== -1) l.splice(i, 1);
          sync();
        });
      });
      q.addEventListener("input", function () {
        var t = A.normName(q.value).toLowerCase();
        $$(".sp-opt", box).forEach(function (l) { l.hidden = !!t && A.normName(l.textContent).toLowerCase().indexOf(t) === -1; });
      });
      sync();
    });
    $("#sp-submit").addEventListener("click", submitPicks);
    if ($("#sp-cancel")) $("#sp-cancel").addEventListener("click", function () { pickEditing = false; pickDraft = {}; renderSpecial(); });
  }
  function docIdOf(r) { return "e_" + String(r.examNo || "").replace(/[\/\s]/g, ""); }
  function findByDocId(id) { return results.filter(function (r) { return docIdOf(r) === id; })[0]; }
  function submitPicks() {
    var my = me.academyId;
    var active = SPECIALS.filter(function (sp) { return quotaOf(my, sp.key) > 0; });
    var short = active.filter(function (sp) { return (pickDraft[sp.key] || []).filter(findByDocId).length !== quotaOf(my, sp.key); });
    if (short.length) { alert(short.map(function (sp) { return sp.name + " " + quotaOf(my, sp.key) + "명"; }).join(", ") + "을(를) 모두 골라 주세요."); return; }
    var lines = active.map(function (sp) {
      return "· " + sp.name + ": " + pickDraft[sp.key].map(function (id) { var r = findByDocId(id); return r.name + "(" + r.grade + ")"; }).join(", ");
    }).join("\n");
    var isEdit = !!picks[my];
    if (!confirm("아래 학생으로 특별상 추천을 " + (isEdit ? "수정" : "제출") + "할까요?\n\n" + lines)) return;
    var data = { name: me.name || my, uid: auth.currentUser.uid, submittedAt: firebase.firestore.Timestamp.now() };
    SPECIALS.forEach(function (sp) {
      data[sp.key] = (quotaOf(my, sp.key) ? pickDraft[sp.key] : []).map(function (id) {
        var r = findByDocId(id);
        return { docId: id, examNo: r.examNo, name: r.name, grade: r.grade || "", school: r.school || "", award: r.award || "" };
      });
    });
    var b = $("#sp-submit"); b.disabled = true;
    db.collection("specialPicks").doc(my).set(data).then(function () {
      picks[my] = data; pickEditing = false; pickDraft = {}; renderSpecial();
      alert(isEdit ? "특별상 추천을 수정했습니다." : "특별상 추천을 제출했습니다.");
    }).catch(function (err) {
      b.disabled = false;
      alert("제출하지 못했습니다. (" + (err.code || err.message) + ")");
    });
  }
  /* 관리자: 학원별 추천 현황 */
  function renderSpecialAdmin() {
    if (!isAdmin) return;
    var names = {}; academyList().forEach(function (a) { names[a.id] = a.name; });
    var list = Object.keys(QUOTA).map(function (id) { return { id: id, name: names[id] || id }; });
    var done = list.filter(function (a) { return picks[a.id]; }).length;
    var tj = 0, tp = 0; list.forEach(function (a) { tj += quotaOf(a.id, "jihaksa"); tp += quotaOf(a.id, "pungsanja"); });
    $("#sp-stats").innerHTML = '<div class="stat"><b>' + list.length + '</b><span>배정 학원</span></div>' +
      '<div class="stat"><b style="color:var(--ok)">' + done + '</b><span>제출 완료</span></div>' +
      '<div class="stat"><b style="color:var(--warn)">' + (list.length - done) + '</b><span>미제출</span></div>' +
      '<div class="stat"><b>' + tj + '</b><span>지학사 대표이사상</span></div>' +
      '<div class="stat"><b>' + tp + '</b><span>풍산자 수학연구소장상</span></div>';
    var sorted = list.slice().sort(function (a, b) { return (picks[b.id] ? 1 : 0) - (picks[a.id] ? 1 : 0) || a.name.localeCompare(b.name, "ko"); });
    $("#sp-table tbody").innerHTML = sorted.map(function (a) {
      var pk = picks[a.id];
      return '<tr><td class="s-ac"><b>' + esc(a.name) + '</b><br><small class="hint">배정 지학사 ' + quotaOf(a.id, "jihaksa") + " · 풍산자 " + quotaOf(a.id, "pungsanja") + "</small></td>" +
        SPECIALS.map(function (sp) { return '<td class="s-pick"><span class="m-only sp-mlabel">' + esc(sp.name) + "</span>" + pickListHtml(pk, sp.key, quotaOf(a.id, sp.key)) + "</td>"; }).join("") +
        '<td class="s-time">' + (pk ? '<span class="tag tag-ok">제출</span> <small class="hint">' + esc(fmt(pk.submittedAt)) + "</small>" : '<span class="tag tag-warn">미제출</span>') + "</td></tr>";
    }).join("");
  }
  /* 엑셀: 상받는 학생 한 줄씩 */
  function exportPicks() {
    var names = {}; academyList().forEach(function (a) { names[a.id] = a.name; });
    var rows = [];
    Object.keys(QUOTA).sort(function (a, b) { return a.localeCompare(b, "ko"); }).forEach(function (id) {
      var pk = picks[id];
      SPECIALS.forEach(function (sp) {
        var n = quotaOf(id, sp.key); if (!n) return;
        var l = pickList(pk, sp.key);
        for (var i = 0; i < n; i++) {
          var p = l[i];
          rows.push({ 학원: names[id] || id, 특별상: sp.name, 성명: p ? p.name : "(미선택)", 학년: p ? p.grade : "", 학교: p ? p.school : "", 수험번호: p ? p.examNo : "", "받은 상": p ? R.awardName(p.award) : "", "제출 시각": pk ? fmt(pk.submittedAt) : "미제출" });
        }
      });
    });
    var w = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 6 }, { wch: 16 }, { wch: 11 }, { wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(w, ws, "특별상 추천");
    XLSX.writeFile(w, "AMC_특별상_추천명단.xlsx");
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

  /* 상격별 시상 안내 */
  $("#open-guide").addEventListener("click", function () { $("#guide-modal").hidden = false; });
  $("#guide-close").addEventListener("click", function () { $("#guide-modal").hidden = true; });
  $("#guide-modal").addEventListener("click", function (e) { if (e.target === $("#guide-modal")) $("#guide-modal").hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("#guide-modal").hidden = true; });

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
    var all = academyList().filter(function (a) { return a.id; });
    var list = all.filter(function (a) { return a.students > 0; });
    var empty = all.filter(function (a) { return a.students === 0; });
    var done = list.filter(function (a) { return confirms[a.id]; });
    var todo = list.filter(function (a) { return !confirms[a.id]; });
    var personal = results.filter(function (r) { return !r.academyId; }).length;
    function chips(arr, withTime) {
      return arr.length ? '<div class="chips">' + arr.map(function (a) {
        return '<button type="button" class="chip' + (withTime ? "" : " chip-warn") + '" data-see="' + esc(a.id) + '">' + esc(a.name) + " · " + a.students + "명" +
          (withTime ? " · " + esc(fmt(confirms[a.id].confirmedAt).slice(5)) : "") + "</button>";
      }).join("") + "</div>" : '<p class="hint" style="margin:0">없음</p>';
    }
    var summaryHtml =
      '<div class="stats">' +
        '<div class="stat"><b>' + list.length + '</b><span>전체 학원</span></div>' +
        '<div class="stat"><b style="color:var(--ok)">' + done.length + '</b><span>확인 완료</span></div>' +
        '<div class="stat"><b style="color:var(--warn)">' + todo.length + '</b><span>확인 미완료</span></div>' +
        '<div class="stat"><b>' + personal + '</b><span>개인접수 학생 (관리자만)</span></div>' +
      "</div>" +
      '<div class="card fold-card">' +
        '<details class="fold"><summary><span class="dot dot-ok"></span>확인 완료 <b>' + done.length + "곳</b><small><span class='d-only'>펼치기</span></small></summary>" + chips(done, true) + "</details>" +
        '<details class="fold"' + (todo.length && todo.length <= 30 ? "" : "") + '><summary><span class="dot dot-warn"></span>확인 미완료 <b>' + todo.length + "곳</b><small><span class='d-only'>펼치기</span></small></summary>" + chips(todo, false) + "</details>" +
        (empty.length ? '<details class="fold"><summary><span class="dot"></span>학원접수 학생 없음 <b>' + empty.length + "곳</b><small><span class='d-only'>계정만 있음 · 집계 제외 </span></small></summary>" + '<div class="chips">' + empty.map(function (a) { return '<span class="chip chip-gray">' + esc(a.name) + "</span>"; }).join("") + "</div></details>" : "") +
      "</div>";
    /* 펼쳐 둔 줄은 새로 그려도 펼친 채로 */
    ["#status-summary", "#home-summary"].forEach(function (sel) {
      var box = $(sel), open = $$("details.fold", box).map(function (d) { return d.open; });
      box.innerHTML = summaryHtml;
      $$("details.fold", box).forEach(function (d, i) { if (open[i]) d.open = true; });
    });
    $("#ac-table tbody").innerHTML = list.concat(empty).map(function (r) {
      var st = acState(r.id), a = academies[r.id] || {}, c = confirms[r.id];
      var stHtml = { none: '<span class="tag tag-no">미발급</span>', issued: '<span class="tag tag-ok">발급됨</span>', changed: '<span class="tag tag-gold">원장님 변경함</span>', revoked: '<span class="tag tag-warn">해제됨</span>' }[st];
      var pw = st === "issued" ? '<code class="pw">' + esc(a.initialPw) + "</code>" : st === "changed" ? '<span class="hint">원장님이 바꿈</span>' : "";
      var act = st === "none" ? '<button class="btn btn-sm" data-make="' + esc(r.id) + '">발급</button>'
        : st === "revoked" ? '<button class="btn btn-line btn-sm" data-relink="' + esc(r.id) + '">다시 연결</button>'
        : '<button class="btn btn-line btn-sm" data-reset="' + esc(r.id) + '">비밀번호 재발급</button> <button class="btn btn-line btn-sm" data-revoke="' + esc(r.id) + '">해제</button>';
      act = (st === "none" ? "" : '<button class="btn btn-ochre btn-sm" data-msg="' + esc(r.id) + '">안내 문자</button> ') + '<button class="btn btn-line btn-sm" data-see="' + esc(r.id) + '">보기</button> ' + act;
      var conf = r.students === 0 ? '<span class="tag tag-no">학생 없음</span>' : c ? '<span class="tag tag-ok">확인</span> <small class="hint">' + esc(fmt(c.confirmedAt)) + "</small>" : '<span class="tag tag-warn">미확인</span>';
      return '<tr><td class="a-name"><a href="#" class="ac-name" data-msg="' + esc(r.id) + '"><b>' + esc(r.name) + '</b></a><br><small class="hint">아이디: ' + esc(r.id) + "</small></td>" +
        '<td class="num a-cnt"><span class="m-only">학생 </span>' + r.students + '<span class="m-only">명</span></td><td class="a-conf">' + conf + '</td><td class="a-st">' + stHtml + '</td><td class="a-pw">' + pw + '</td><td class="a-act">' + act + "</td></tr>";
    }).join("") || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">성적을 먼저 올리세요.</td></tr>';
    renderSpecialAdmin();
  }
  function seeAcademy(id) {
    view = id; $("#pick-academy").value = view; render();
    $$("[data-tab]")[0].click(); window.scrollTo(0, 0);
  }
  function bindStatus() {
    ["#status-summary", "#home-summary"].forEach(function (sel) {
      $(sel).addEventListener("click", function (e) {
        var b = e.target.closest("[data-see]"); if (b) seeAcademy(b.dataset.see);
      });
    });
    $("#ac-table").addEventListener("click", function (e) {
      var m = e.target.closest("[data-msg]");
      if (m) { e.preventDefault(); openMsg(m.dataset.msg); return; }
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.see) { seeAcademy(b.dataset.see); return; }
      var id = b.dataset.make || b.dataset.reset || b.dataset.revoke || b.dataset.relink;
      var row = academyList().filter(function (r) { return r.id === id; })[0];
      if (!row) return;
      b.disabled = true;
      var job = b.dataset.make ? createAccount(row.name)
        : b.dataset.reset ? (confirm(row.name + " 비밀번호를 새 난수로 재발급할까요?\n(원장님이 바꾼 비밀번호는 더 이상 쓸 수 없게 됩니다)") ? resetPassword(id) : Promise.resolve())
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
    /* 전체 재발급: 모든 학원 비밀번호를 새 난수로 → 결과 엑셀(안내 문구 포함) 자동 다운로드 */
    $("#ac-reset-all").addEventListener("click", function () {
      var n = academyList().filter(function (r) { return r.id && (acState(r.id) === "issued" || acState(r.id) === "changed"); }).length;
      if (!n) { A.show($("#ac-msg"), "재발급할 학원 계정이 없습니다.", "err"); return; }
      if (prompt(n + "개 학원의 비밀번호를 모두 새 난수로 바꿉니다.\n원장님들이 쓰던 비밀번호는 더 이상 쓸 수 없게 됩니다.\n진행하려면 '재발급'이라고 입력하세요.") !== "재발급") return;
      var btn = $("#ac-reset-all"); btn.disabled = true; btn.textContent = "재발급 중… (1분 정도)";
      firebase.app().functions("asia-northeast3").httpsCallable("resetAcademyPassword", { timeout: 300000 })({ all: true }).then(function (res) {
        var list = (res.data.results || []).sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
        var rows = list.map(function (r) {
          return { 학원: r.name, 아이디: r.academyId, "새 비밀번호": r.password, "보낼 문구": guideText(r.name, r.academyId, r.password) };
        });
        var w = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 80 }];
        XLSX.utils.book_append_sheet(w, ws, "새 비밀번호");
        XLSX.writeFile(w, "AMC_비밀번호_재발급_" + fmt(new Date()).replace(/[-: ]/g, "").slice(0, 12) + ".xlsx");
        var fail = res.data.failed || [];
        A.show($("#ac-msg"), list.length + "개 학원 비밀번호를 재발급했습니다. 새 비밀번호와 보낼 문구가 엑셀로 내려받아졌습니다." +
          (fail.length ? "<br>실패: " + esc(fail.map(function (f) { return f.name; }).join(", ")) : ""), fail.length ? "err" : "ok");
      }).catch(function (err) {
        console.error(err);
        A.show($("#ac-msg"), "재발급하지 못했습니다. 서버 함수가 배포됐는지 확인해 주세요. (" + esc(err.message || err.code) + ")", "err");
      }).then(function () { btn.disabled = false; btn.textContent = "전체 비밀번호 재발급"; });
    });
    $("#ac-xlsx").addEventListener("click", function () {
      var rows = academyList().filter(function (r) { return r.id; }).sort(function (a, b) { return (confirms[a.id] ? 1 : 0) - (confirms[b.id] ? 1 : 0); }).map(function (r) {
        var st = acState(r.id), a = academies[r.id] || {}, c = confirms[r.id];
        return { 학원: r.name, 아이디: r.id, "초기 비밀번호": st === "issued" ? a.initialPw : "", 계정: { none: "미발급", issued: "발급됨", changed: "원장님 변경함", revoked: "해제됨" }[st], 학생: r.students, "시상 확인": r.students === 0 ? "학생 없음" : c ? "확인" : "미확인", "확인 시각": c ? fmt(c.confirmedAt) : "", "접속 주소": academyUrl() };
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
  /* 재발급: 서버 함수(resetAcademyPassword)가 원장님이 바꾼 뒤에도 새 난수로 바꿈.
     서버 함수가 아직 없으면 예전 방식(초기 비밀번호로 들어가 변경)으로 시도 */
  function resetPassword(id) {
    var a = academies[id];
    var call = firebase.app().functions("asia-northeast3").httpsCallable("resetAcademyPassword");
    return call({ academyId: id }).then(function (res) {
      return esc(a.name) + " 새 비밀번호: <b>" + esc(res.data.password) + "</b> (원장님은 다음 로그인 때 다시 바꾸게 됩니다)" +
        '<textarea class="input" readonly rows="9" style="margin-top:10px;font-size:13px" onclick="this.select()">' + esc(guideText(a.name, id, res.data.password)) + "</textarea>";
    }).catch(function (err) {
      console.warn("서버 함수 재발급 실패, 예전 방식 시도", err);
      return resetPasswordLocal(id);
    });
  }
  function resetPasswordLocal(id) {
    var a = academies[id], pw = A.randomPassword(), ca;
    return creatorAuth().then(function (c) { ca = c; return ca.signInWithEmailAndPassword(a.email, a.initialPw); }).catch(function () {
      throw new Error(a.name + ": 재발급하지 못했습니다. 서버 함수가 배포됐는지 확인해 주세요. (급하면 PC의 AMC\\_반영\\비밀번호재발급.bat)");
    }).then(function (cred) { return cred.user.updatePassword(pw); })
      .then(function () {
        var b = db.batch();
        b.update(db.collection("academies").doc(id), { initialPw: pw });
        if (a.uid && acUsers[a.uid]) b.update(db.collection("academyUsers").doc(a.uid), { pwChangedAt: null });
        return b.commit();
      })
      .then(function () { return ca.signOut(); })
      .then(function () { return esc(a.name) + " 새 비밀번호: <b>" + esc(pw) + "</b>"; });
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

  /* 원장님께 보낼 안내 문자 팝업 */
  function firstText(name, id, pw, n) {
    return "[제2회 안양시 수학경시대회] 성적·시상 조회 안내\n\n" + name + " 원장님, 안녕하세요.\n제2회 안양시 수학경시대회 성적·시상 조회 페이지를 안내드립니다.\n\n" +
      "▶ 접속 주소: " + academyUrl() + "\n▶ 아이디: " + id + "\n▶ 비밀번호: " + pw + "\n\n" +
      "· 처음 로그인하시면 비밀번호 변경 창이 뜹니다. 원장님만 아시는 비밀번호(영문+숫자 8자 이상)로 바꿔 주세요.\n" +
      "· 원장님 학원 학생 " + n + "명의 성적, 문항별 정오표, 시상 내역을 보실 수 있습니다.\n" +
      "· 시상 내용을 확인하신 뒤 화면의 「시상 내용 확인」 버튼을 꼭 눌러 주세요.\n\n(사)안양시학원연합회 보습분과 협의회";
  }
  var msgId = "";
  function openMsg(id) {
    msgId = id;
    var a = academies[id] || {}, st = acState(id);
    var row = academyList().filter(function (r) { return r.id === id; })[0] || { students: 0 };
    $("#msg-title").textContent = (a.name || id) + " 안내 문자";
    $("#msg-done").hidden = true;
    if (st === "issued") {
      $("#msg-text").value = firstText(a.name || id, id, a.initialPw, row.students);
      A.hide($("#msg-warn")); $("#msg-reset").hidden = true; $("#msg-copy").disabled = false;
    } else {
      $("#msg-text").value = "";
      A.show($("#msg-warn"), st === "changed" ? "원장님이 이미 비밀번호를 바꿨습니다. 바꾼 비밀번호는 관리자도 모르기 때문에, 새로 보내려면 비밀번호를 재발급해야 합니다." : "계정이 없거나 해제된 학원입니다.", "err");
      $("#msg-reset").hidden = st !== "changed"; $("#msg-copy").disabled = true;
    }
    $("#msg-modal").hidden = false;
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    var ta = $("#msg-text"); ta.focus(); ta.select(); document.execCommand("copy"); return Promise.resolve();
  }
  $("#msg-copy").addEventListener("click", function () {
    var t = $("#msg-text").value; if (!t) return;
    copyText(t).then(function () { $("#msg-done").hidden = false; setTimeout(function () { $("#msg-done").hidden = true; }, 2500); })
      .catch(function () { $("#msg-text").select(); alert("자동 복사가 막혀 있습니다. 글자가 선택됐으니 Ctrl+C 를 눌러 주세요."); });
  });
  $("#msg-close").addEventListener("click", function () { $("#msg-modal").hidden = true; });
  $("#msg-modal").addEventListener("click", function (e) { if (e.target === $("#msg-modal")) $("#msg-modal").hidden = true; });
  $("#msg-reset").addEventListener("click", function () {
    var id = msgId, b = $("#msg-reset");
    if (!confirm((academies[id] || {}).name + " 비밀번호를 새 난수로 재발급할까요?")) return;
    b.disabled = true;
    firebase.app().functions("asia-northeast3").httpsCallable("resetAcademyPassword")({ academyId: id }).then(function (res) {
      var a = academies[id] || {};
      var row = academyList().filter(function (r) { return r.id === id; })[0] || { students: 0 };
      $("#msg-text").value = firstText(a.name || id, id, res.data.password, row.students);
      A.hide($("#msg-warn")); b.hidden = true; $("#msg-copy").disabled = false;
    }).catch(function (err) {
      A.show($("#msg-warn"), "재발급하지 못했습니다. 서버 함수 배포를 확인해 주세요. (" + esc(err.message || err.code) + ")", "err");
    }).then(function () { b.disabled = false; });
  });

  function guideText(name, id, pw) {
    return "[제2회 안양시 수학경시대회] 비밀번호 재발급 안내\n\n" + name + " 원장님, 성적·시상 조회 비밀번호를 새로 발급해 드립니다.\n\n" +
      "▶ 접속 주소: " + academyUrl() + "\n▶ 아이디: " + id + "\n▶ 새 비밀번호: " + pw + "\n\n" +
      "로그인하시면 비밀번호 변경 창이 뜹니다. 원장님만 아시는 비밀번호로 바꿔 주세요.\n\n(사)안양시학원연합회 보습분과 협의회";
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
