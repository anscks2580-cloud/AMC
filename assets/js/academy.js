/* =========================================================
   원장님 성적 조회 — 학원 이름(아이디)+비밀번호 로그인, 자기 학원 학생 성적만 조회
   다른 학원 성적은 화면뿐 아니라 Firestore 규칙에서도 막혀 있음
   ========================================================= */
(function () {
  "use strict";
  var A = window.AMCApp, R = window.AMCResults, $ = A.$, esc = A.esc, db = A.db, auth = A.auth;
  var me = null, results = [], cfg = {};

  if (!A.configured || !auth) {
    A.show($("#gate-msg"), "Firebase 구성값이 비어 있습니다.", "err");
    return;
  }

  /* ---------- 로그인 ---------- */
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector("button[type=submit]");
    var name = A.normName(f.elements.name.value), pw = f.elements.pw.value;
    if (!name || !pw) { A.show($("#gate-msg"), "학원 이름과 비밀번호를 입력하세요.", "err"); return; }
    btn.disabled = true;
    A.academyEmail(name).then(function (email) {
      return auth.signInWithEmailAndPassword(email, pw);
    }).catch(function (err) {
      var msg = /password|credential|user-not-found|invalid-email|INVALID_LOGIN/i.test(err.code + err.message)
        ? "학원 이름 또는 비밀번호가 맞지 않습니다. 학원 이름은 안내받은 그대로 입력해 주세요."
        : /too-many-requests/.test(err.code) ? "로그인 시도가 많아 잠시 막혔습니다. 몇 분 뒤 다시 시도해 주세요."
        : "로그인하지 못했습니다. (" + esc(err.code) + ")";
      A.show($("#gate-msg"), msg, "err");
    }).then(function () { btn.disabled = false; });
  });

  $("#logout").addEventListener("click", function (e) {
    e.preventDefault();
    auth.signOut().then(function () { location.reload(); });
  });

  auth.onAuthStateChanged(function (user) {
    $("#app").hidden = true; $("#closed").hidden = true;
    if (!user) {
      $("#gate").hidden = false; $("#top-nav").hidden = true;
      $("[data-academy-name]").textContent = "";
      return;
    }
    $("#gate").hidden = true;
    if (!A.isAcademyEmail(user.email)) {
      showClosed("관리자 계정으로 로그인되어 있습니다", '관리자는 <a href="results.html" style="text-decoration:underline">성적 관리</a> 화면에서 전체 성적을 볼 수 있습니다. <a href="#" id="sw" style="text-decoration:underline">로그아웃</a>');
      var sw = $("#sw"); if (sw) sw.addEventListener("click", function (e) { e.preventDefault(); auth.signOut(); });
      return;
    }
    $("#top-nav").hidden = false;
    start(user);
  });

  function showClosed(title, html) {
    $("#closed-title").textContent = title;
    $("#closed-msg").innerHTML = html;
    $("#closed").hidden = false;
  }

  /* ---------- 조회 ---------- */
  function start(user) {
    db.collection("academyUsers").doc(user.uid).get().then(function (d) {
      if (!d.exists) {
        showClosed("사용할 수 없는 계정입니다", "계정이 해제되었거나 아직 연결되지 않았습니다. AMC 위원회에 문의해 주세요.");
        return null;
      }
      me = d.data();
      $("[data-academy-name]").textContent = me.name;
      return db.collection("settings").doc("results").get();
    }).then(function (s) {
      if (!s) return null;
      cfg = s.exists ? s.data() : {};
      if (!cfg.resultsOpen) {
        showClosed("성적 조회 기간이 아닙니다", "성적 조회가 열리면 이 화면에서 바로 확인할 수 있습니다." + (cfg.notice ? "<br><br>" + esc(cfg.notice) : ""));
        return null;
      }
      return db.collection("results").where("academyId", "==", me.academyId).get();
    }).then(function (snap) {
      if (!snap) return;
      results = R.sortResults(snap.docs.map(function (d) { return d.data(); }));
      $("#app").hidden = false;
      $("#ac-title").textContent = me.name;
      $("#round-title").textContent = (cfg.title || "") + (cfg.title ? " · " : "") + "우리 학원 응시 학생 " + results.length + "명";
      if (cfg.notice) A.show($("#notice"), esc(cfg.notice).replace(/\n/g, "<br>")); else A.hide($("#notice"));
      var opt = R.filterOptions(results);
      $("#f-grade").innerHTML = '<option value="">전체 학년</option>' + opt.grades.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + "</option>"; }).join("");
      $("#f-award").innerHTML = '<option value="">전체 (상장 무관)</option><option value="*">수상자만</option>' + opt.awards.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + "</option>"; }).join("");
      render();
    }).catch(function (err) {
      console.error(err);
      if (/permission/i.test(err.code)) showClosed("조회할 수 없습니다", "성적 조회 기간이 아니거나 계정 권한이 없습니다. AMC 위원회에 문의해 주세요.");
      else showClosed("불러오지 못했습니다", "잠시 후 다시 시도해 주세요. (" + esc(err.code || err.message) + ")");
    });
  }

  function filtered() {
    var g = $("#f-grade").value, a = $("#f-award").value, q = A.normName($("#q").value).toLowerCase();
    return results.filter(function (r) {
      if (g && r.grade !== g) return false;
      if (a === "*" && !r.award) return false;
      if (a && a !== "*" && r.award !== a) return false;
      if (q && [r.name, r.examNo, r.school].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function render() {
    var list = filtered();
    $("#stats").innerHTML = R.statsHtml(list);
    R.renderTable($("#result-table"), list, cfg.labels || [], {});
  }
  ["#f-grade", "#f-award"].forEach(function (s) { $(s).addEventListener("change", render); });
  $("#q").addEventListener("input", render);
  $("#dl-xlsx").addEventListener("click", function () {
    R.exportXlsx(filtered(), cfg.labels || [], "AMC_성적_" + (me ? me.name : "") + ".xlsx", {});
  });

  /* ---------- 비밀번호 변경 ---------- */
  var modal = $("#pw-modal");
  $("#open-pw").addEventListener("click", function (e) { e.preventDefault(); $("#pw-form").reset(); A.hide($("#pw-msg")); modal.hidden = false; });
  $("#pw-cancel").addEventListener("click", function () { modal.hidden = true; });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });
  $("#pw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, cur = f.elements.cur.value, nx = f.elements.next.value, nx2 = f.elements.next2.value;
    if (nx !== nx2) { A.show($("#pw-msg"), "새 비밀번호가 서로 다릅니다.", "err"); return; }
    if (nx.length < 8 || !/[A-Za-z]/.test(nx) || !/[0-9]/.test(nx)) { A.show($("#pw-msg"), "영문과 숫자를 섞어 8자 이상으로 정해 주세요.", "err"); return; }
    if (nx === cur) { A.show($("#pw-msg"), "지금 비밀번호와 다른 비밀번호로 정해 주세요.", "err"); return; }
    var user = auth.currentUser, btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    var cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
    user.reauthenticateWithCredential(cred).then(function () {
      return user.updatePassword(nx);
    }).then(function () {
      return db.collection("academyUsers").doc(user.uid).update({ pwChangedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(function () {});
    }).then(function () {
      A.show($("#pw-msg"), "비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.", "ok");
      f.reset();
    }).catch(function (err) {
      var msg = /wrong-password|invalid-credential|INVALID_LOGIN/i.test(err.code + err.message) ? "현재 비밀번호가 맞지 않습니다."
        : /weak-password/.test(err.code) ? "비밀번호가 너무 단순합니다."
        : "변경하지 못했습니다. (" + esc(err.code) + ")";
      A.show($("#pw-msg"), msg, "err");
    }).then(function () { btn.disabled = false; });
  });
})();
