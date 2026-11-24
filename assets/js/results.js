/* =========================================================
   관리자 — 성적 업로드, 전체 성적, 학원 계정 발급, 조회 설정
   ========================================================= */
(function () {
  "use strict";
  var A = window.AMCApp, R = window.AMCResults, $ = A.$, $$ = A.$$, esc = A.esc, db = A.db;

  var FIELDS = [
    ["name", "성명 (필수)", /성명|이름|학생명/],
    ["examNo", "수험번호", /수험/],
    ["grade", "학년", /학년/],
    ["school", "학교", /학교/],
    ["academy", "학원", /학원|접수처/],
    ["total", "총점", /총점|합계|총합|^점수$|득점/],
    ["award", "상장", /상장|수상|시상|입상|^상$|^등급$/],
    ["rank", "석차 (선택)", /석차|순위|등수/]
  ];
  var Q_HEAD = /^(문항|문제|Q)?\s*(\d{1,3})\s*(번)?$/i;

  var students = [], results = [], academies = {}, acUsers = {}, cfg = {};

  A.requireAdmin(function () {
    bindTabs();
    bindAll();
    bindUpload();
    bindAccounts();
    bindSettings();
    watch();
  });

  function bindTabs() {
    $$("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
        $$("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
      });
    });
  }

  function watch() {
    db.collection("students").onSnapshot(function (snap) {
      students = snap.docs.map(function (d) { return d.data(); });
      renderAccounts();
    });
    db.collection("results").onSnapshot(function (snap) {
      results = R.sortResults(snap.docs.map(function (d) { return d.data(); }));
      fillFilters(); renderAll(); renderAccounts();
    });
    db.collection("academies").onSnapshot(function (snap) {
      academies = {};
      snap.docs.forEach(function (d) { academies[d.id] = d.data(); });
      renderAccounts(); renderAll();
    });
    db.collection("academyUsers").onSnapshot(function (snap) {
      acUsers = {};
      snap.docs.forEach(function (d) { acUsers[d.id] = d.data(); });
      renderAccounts();
    });
    db.collection("settings").doc("results").onSnapshot(function (d) {
      cfg = d.exists ? d.data() : {};
      var f = $("#cfg-form");
      f.elements.resultsOpen.checked = !!cfg.resultsOpen;
      f.elements.title.value = cfg.title || "";
      f.elements.notice.value = cfg.notice || "";
      renderOpenState(); renderAll();
    });
  }

  /* ================= 전체 성적 ================= */
  function renderOpenState() {
    A.show($("#open-state"), cfg.resultsOpen
      ? "원장님 성적 조회가 <b>열려 있습니다</b>. 각 학원은 자기 학원 학생만 볼 수 있습니다."
      : "원장님 성적 조회가 <b>닫혀 있습니다</b>. 성적을 확인한 뒤 「조회 설정」 탭에서 열어 주세요.", cfg.resultsOpen ? "ok" : "");
  }
  function fillFilters() {
    var acs = {};
    results.forEach(function (r) { acs[r.academyId] = r.academy; });
    var keep = $("#a-academy").value, keepG = $("#a-grade").value, keepA = $("#a-award").value;
    $("#a-academy").innerHTML = '<option value="">전체 학원</option><option value="!">(학원 없음)</option>' +
      Object.keys(acs).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, "ko"); })
        .map(function (k) { return '<option value="' + esc(k) + '">' + esc(acs[k]) + "</option>"; }).join("");
    var opt = R.filterOptions(results);
    $("#a-grade").innerHTML = '<option value="">전체 학년</option>' + opt.grades.map(function (g) { return "<option>" + esc(g) + "</option>"; }).join("");
    $("#a-award").innerHTML = '<option value="">상장 무관</option><option value="*">수상자만</option>' + opt.awards.map(function (a) { return "<option>" + esc(a) + "</option>"; }).join("");
    $("#a-academy").value = keep; $("#a-grade").value = keepG; $("#a-award").value = keepA;
  }
  function allFiltered() {
    var ac = $("#a-academy").value, g = $("#a-grade").value, aw = $("#a-award").value, q = A.normName($("#a-q").value).toLowerCase();
    return results.filter(function (r) {
      if (ac === "!" && r.academyId) return false;
      if (ac && ac !== "!" && r.academyId !== ac) return false;
      if (g && r.grade !== g) return false;
      if (aw === "*" && !r.award) return false;
      if (aw && aw !== "*" && r.award !== aw) return false;
      if (q && [r.name, r.examNo, r.school, r.academy].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function renderAll() {
    var list = allFiltered();
    $("#all-stats").innerHTML = R.statsHtml(list);
    R.renderTable($("#all-table"), list, cfg.labels || [], { academy: true });
  }
  function bindAll() {
    ["#a-academy", "#a-grade", "#a-award"].forEach(function (s) { $(s).addEventListener("change", renderAll); });
    $("#a-q").addEventListener("input", renderAll);
    $("#a-xlsx").addEventListener("click", function () { R.exportXlsx(allFiltered(), cfg.labels || [], "AMC_성적_전체.xlsx", { academy: true }); });
    $("#a-del").addEventListener("click", function () {
      if (!results.length) return;
      if (prompt("성적 " + results.length + "건을 모두 삭제합니다. 확인하려면 '삭제'라고 입력하세요.") !== "삭제") return;
      deleteAllResults().then(function () { alert("삭제했습니다."); });
    });
  }
  function deleteAllResults() {
    return db.collection("results").get().then(function (snap) {
      return commitChunks(snap.docs.map(function (d) { return { op: "delete", ref: d.ref }; }));
    });
  }
  function commitChunks(ops) {
    var chain = Promise.resolve();
    for (var i = 0; i < ops.length; i += 400) {
      (function (slice) {
        chain = chain.then(function () {
          var b = db.batch();
          slice.forEach(function (o) { o.op === "delete" ? b.delete(o.ref) : b.set(o.ref, o.data); });
          return b.commit();
        });
      })(ops.slice(i, i + 400));
    }
    return chain;
  }

  /* ================= 업로드 ================= */
  var wb = null, rows = [], headers = [], dataRows = [], parsed = [], parsedLabels = [];

  function bindUpload() {
    var drop = $("#drop"), file = $("#file");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    file.addEventListener("change", function () { if (file.files[0]) readFile(file.files[0]); });
    $("#sheet-pick").addEventListener("change", function () { loadSheet(); });
    $("#head-row").addEventListener("change", function () { buildMapping(); });
    $("#q-all").addEventListener("click", function () { $$("#q-cols input").forEach(function (c) { c.checked = true; }); qCount(); });
    $("#q-none").addEventListener("click", function () { $$("#q-cols input").forEach(function (c) { c.checked = false; }); qCount(); });
    $("#q-cols").addEventListener("change", qCount);
    $("#preview").addEventListener("click", buildPreview);
    $("#save").addEventListener("click", saveParsed);
  }

  function readFile(f) {
    var reader = new FileReader();
    reader.onload = function (e) {
      wb = XLSX.read(e.target.result, { type: "array" });
      $("#sheet-pick").innerHTML = wb.SheetNames.map(function (n, i) { return '<option value="' + i + '">' + esc(n) + "</option>"; }).join("");
      $("#drop").textContent = f.name;
      loadSheet();
    };
    reader.readAsArrayBuffer(f);
  }

  function loadSheet() {
    var ws = wb.Sheets[wb.SheetNames[parseInt($("#sheet-pick").value, 10) || 0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
    if (rows.length < 2) { alert("데이터가 없습니다."); return; }
    /* 제목 행 추측: 앞쪽 10행 중 '이름/성명'이 있는 첫 행 */
    var guess = 0;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      if (rows[i].some(function (c) { return /성명|이름/.test(String(c)); })) { guess = i; break; }
    }
    $("#head-row").innerHTML = rows.slice(0, 10).map(function (r, i) {
      return '<option value="' + i + '"' + (i === guess ? " selected" : "") + ">" + (i + 1) + "행: " + esc(r.filter(function (c) { return String(c).trim(); }).slice(0, 5).join(" · ").slice(0, 40)) + "</option>";
    }).join("");
    buildMapping();
  }

  function buildMapping() {
    var h = parseInt($("#head-row").value, 10) || 0;
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    headers = [];
    for (var c = 0; c < width; c++) headers.push(String(rows[h][c] == null ? "" : rows[h][c]).replace(/\s+/g, " ").trim());
    dataRows = rows.slice(h + 1);
    var used = {};
    $("#map-rows").innerHTML = FIELDS.map(function (f) {
      var guess = -1;
      headers.forEach(function (hd, i) { if (guess === -1 && !used[i] && f[2].test(hd)) guess = i; });
      if (guess !== -1) used[guess] = 1;
      return '<div class="map-row"><label>' + f[1] + '</label><select class="input" data-field="' + f[0] + '">' +
        '<option value="-1">(없음)</option>' +
        headers.map(function (hd, i) { return '<option value="' + i + '"' + (i === guess ? " selected" : "") + ">" + esc(hd || "열 " + (i + 1)) + "</option>"; }).join("") +
        "</select></div>";
    }).join("");
    $("#q-cols").innerHTML = headers.map(function (hd, i) {
      var isQ = !used[i] && Q_HEAD.test(hd);
      return '<label class="q-col"><input type="checkbox" value="' + i + '"' + (isQ ? " checked" : "") + "> " + esc(hd || "열 " + (i + 1)) + "</label>";
    }).join("");
    qCount();
    $("#map-card").hidden = false;
    $("#preview-card").hidden = true;
  }
  function qCount() { $("#q-count").textContent = "— " + $$("#q-cols input:checked").length + "문항 선택"; }

  function qLabel(hd, i) {
    var m = Q_HEAD.exec(hd);
    return m ? String(parseInt(m[2], 10)) : (hd || "열" + (i + 1));
  }

  function normMark(v, mode, binary) {
    var s = String(v == null ? "" : v).trim();
    if (mode === "raw") return s;
    if (!s) return "";
    if (mode === "score") {
      var n = Number(s);
      if (!isNaN(n)) return n > 0 ? "O" : "X";
    }
    if (/^(o|○|◯|●|◎|정답|맞음|맞|v|✓|✔|√|true|y)$/i.test(s)) return "O";
    if (/^(x|×|✕|✗|✘|오답|틀림|틀|false|n)$/i.test(s)) return "X";
    if (binary) { if (s === "1") return "O"; if (s === "0") return "X"; }
    return s;
  }

  function buildPreview() {
    var map = {};
    $$("[data-field]").forEach(function (sel) { map[sel.dataset.field] = parseInt(sel.value, 10); });
    if (map.name < 0) { alert("성명 열은 꼭 지정해야 합니다."); return; }
    var qCols = $$("#q-cols input:checked").map(function (c) { return parseInt(c.value, 10); });
    parsedLabels = qCols.map(function (i) { return qLabel(headers[i], i); });
    var mode = $("#mark-mode").value;
    /* 1/0 만 있는 표인지 확인 */
    var binary = true, anyVal = false;
    dataRows.forEach(function (r) {
      qCols.forEach(function (i) {
        var s = String(r[i] == null ? "" : r[i]).trim();
        if (!s) return;
        anyVal = true;
        if (s !== "0" && s !== "1") binary = false;
      });
    });
    binary = binary && anyVal;

    var byNo = {}, byNameGrade = {}, byName = {};
    students.forEach(function (s) {
      byNo[String(s.examNo)] = s;
      var k1 = A.normName(s.name) + "|" + A.normGrade(s.grade);
      (byNameGrade[k1] = byNameGrade[k1] || []).push(s);
      var k2 = A.normName(s.name);
      (byName[k2] = byName[k2] || []).push(s);
    });

    parsed = dataRows.map(function (r) {
      function g(k) { return map[k] >= 0 ? String(r[map[k]] == null ? "" : r[map[k]]).trim() : ""; }
      var rec = {
        name: A.normName(g("name")), examNo: g("examNo").replace(/\.0$/, ""), grade: A.normGrade(g("grade")),
        school: g("school"), academy: g("academy").trim(), total: g("total"), award: g("award").replace(/\s+/g, ""), rank: g("rank"),
        marks: qCols.map(function (i) { return normMark(r[i], mode, binary); })
      };
      var status = "", from = "";
      if (!rec.name || /^(정답|답안|배점|평균|합계)$/.test(rec.name)) { rec._status = "건너뜀"; return rec; }
      /* 응시자 명단에서 빈 칸 채우기 */
      var st = rec.examNo && byNo[rec.examNo];
      if (!st) {
        var c1 = byNameGrade[rec.name + "|" + rec.grade];
        if (c1 && c1.length === 1) st = c1[0];
        else if (!rec.grade) { var c2 = byName[rec.name]; if (c2 && c2.length === 1) st = c2[0]; }
      }
      if (st) {
        if (!rec.academy && st.academy) { rec.academy = st.academy; from = "명단"; }
        if (!rec.examNo) rec.examNo = String(st.examNo);
        if (!rec.grade) rec.grade = st.grade || "";
        if (!rec.school) rec.school = st.school || "";
      }
      rec.academyId = A.academyId(rec.academy);
      if (!rec.academyId) status = "확인: 학원 없음";
      else status = from ? "정상 (학원은 명단에서)" : "정상";
      rec._status = status;
      return rec;
    });

    var ok = parsed.filter(function (p) { return p._status !== "건너뜀"; });
    /* 같은 수험번호 중복 확인 */
    var dup = {};
    ok.forEach(function (p) { if (p.examNo) dup[p.examNo] = (dup[p.examNo] || 0) + 1; });
    ok.forEach(function (p) { if (p.examNo && dup[p.examNo] > 1) p._status = "오류: 수험번호 중복"; });

    var saveable = ok.filter(function (p) { return p._status.indexOf("오류") !== 0; });
    var noAcademy = saveable.filter(function (p) { return !p.academyId; }).length;
    $("#preview-count").textContent = saveable.length + "명 저장 예정 · 문항 " + parsedLabels.length + "개" + (binary && mode === "auto" ? " · 1/0 을 O/X 로 표시" : "");

    /* 학원별 인원 + 계정 여부 */
    var acCount = {}, acName = {};
    saveable.forEach(function (p) { if (p.academyId) { acCount[p.academyId] = (acCount[p.academyId] || 0) + 1; acName[p.academyId] = p.academy; } });
    var acKeys = Object.keys(acCount).sort(function (a, b) { return a.localeCompare(b, "ko"); });
    $("#preview-academies").innerHTML = '<p class="hint" style="margin-bottom:6px">학원 ' + acKeys.length + "곳" + (noAcademy ? ' · <b style="color:var(--warn)">학원 없는 학생 ' + noAcademy + "명 (원장님 조회에 안 나옴)</b>" : "") + "</p>" +
      '<div class="chips">' + acKeys.map(function (k) {
        var has = academies[k] && !academies[k].revoked;
        return '<span class="chip' + (has ? "" : " chip-warn") + '">' + esc(acName[k]) + " " + acCount[k] + "명" + (has ? "" : " · 계정 없음") + "</span>";
      }).join("") + "</div>";

    var rank = parsed.some(function (p) { return p.rank; });
    $("#preview-table thead").innerHTML = "<tr><th>상태</th><th>성명</th><th>수험번호</th><th>학년</th><th>학교</th><th>학원</th>" +
      parsedLabels.map(function (l) { return '<th class="q">' + esc(l) + "</th>"; }).join("") + "<th>총점</th><th>상장</th>" + (rank ? "<th>석차</th>" : "") + "</tr>";
    $("#preview-table tbody").innerHTML = parsed.map(function (p) {
      var tone = p._status === "건너뜀" ? "tag-no" : p._status.indexOf("정상") === 0 ? "tag-ok" : "tag-warn";
      return "<tr>" + '<td><span class="tag ' + tone + '">' + esc(p._status) + "</span></td>" +
        "<td>" + esc(p.name) + '</td><td class="num">' + esc(p.examNo) + "</td><td>" + esc(p.grade) + "</td><td>" + esc(p.school) + "</td><td>" + esc(p.academy) + "</td>" +
        p.marks.map(function (m) { return '<td class="q">' + R.markHtml(m) + "</td>"; }).join("") +
        '<td class="num">' + esc(p.total) + "</td><td>" + esc(p.award) + "</td>" + (rank ? '<td class="num">' + esc(p.rank) + "</td>" : "") + "</tr>";
    }).join("");
    $("#preview-card").hidden = false;
    A.hide($("#preview-msg"));
  }

  function docIdFor(p) {
    if (p.examNo) return Promise.resolve("e_" + String(p.examNo).replace(/[\/\s]/g, ""));
    return A.sha256([p.academyId, p.name, p.grade, p.school].join("|")).then(function (h) { return "n_" + h.slice(0, 24); });
  }

  function saveParsed() {
    var list = parsed.filter(function (p) { return p._status !== "건너뜀" && p._status.indexOf("오류") !== 0; });
    if (!list.length) { alert("저장할 행이 없습니다."); return; }
    var replace = $("#opt-replace").checked;
    if (!confirm((replace ? "기존 성적을 모두 지우고 " : "") + list.length + "명의 성적을 저장할까요?")) return;
    var btn = $("#save"); btn.disabled = true; btn.textContent = "저장 중";
    var now = firebase.firestore.FieldValue.serverTimestamp();
    (replace ? deleteAllResults() : Promise.resolve()).then(function () {
      return Promise.all(list.map(function (p) {
        return docIdFor(p).then(function (id) {
          return { op: "set", ref: db.collection("results").doc(id), data: {
            name: p.name, examNo: p.examNo, grade: p.grade, school: p.school, academy: p.academy, academyId: p.academyId,
            total: p.total, award: p.award, rank: p.rank, marks: p.marks, uploadedAt: now
          } };
        });
      }));
    }).then(function (ops) {
      return commitChunks(ops);
    }).then(function () {
      return db.collection("settings").doc("results").set({ labels: parsedLabels, uploadedAt: now, count: list.length }, { merge: true });
    }).then(function () {
      A.show($("#preview-msg"), list.length + "명을 저장했습니다. 「학원 계정」 탭에서 계정 없는 학원을 발급하고, 「조회 설정」에서 조회를 열어 주세요.", "ok");
    }).catch(function (err) {
      console.error(err);
      A.show($("#preview-msg"), "저장 중 오류: " + esc(err.message), "err");
    }).then(function () { btn.disabled = false; btn.textContent = "성적 저장"; });
  }

  /* ================= 학원 계정 ================= */
  var creator = null;
  function creatorAuth() {
    if (!creator) {
      var app = firebase.apps.filter(function (a) { return a.name === "academy-creator"; })[0] || firebase.initializeApp(window.FIREBASE_CONFIG, "academy-creator");
      creator = app.auth();
      creator.setPersistence(firebase.auth.Auth.Persistence.NONE);
    }
    return creator;
  }

  function academyRows() {
    var map = {};
    function add(name) {
      var id = A.academyId(name);
      if (!id) return null;
      if (!map[id]) map[id] = { id: id, name: String(name).trim(), students: 0, results: 0 };
      return map[id];
    }
    Object.keys(academies).forEach(function (id) { var a = add(academies[id].name); if (a) a.name = academies[id].name; });
    students.forEach(function (s) { var a = add(s.academy); if (a) a.students++; });
    results.forEach(function (r) { var a = add(r.academy); if (a) a.results++; });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
  }
  function acState(id) {
    var a = academies[id];
    if (!a) return "none";
    if (a.revoked || !acUsers[a.uid]) return "revoked";
    return acUsers[a.uid].pwChangedAt ? "changed" : "issued";
  }

  function renderAccounts() {
    var list = academyRows();
    $("#ac-table tbody").innerHTML = list.map(function (r) {
      var st = acState(r.id), a = academies[r.id] || {};
      var stHtml = { none: '<span class="tag tag-no">미발급</span>', issued: '<span class="tag tag-ok">발급됨</span>', changed: '<span class="tag tag-gold">원장님 변경함</span>', revoked: '<span class="tag tag-warn">해제됨</span>' }[st];
      var pw = st === "issued" ? '<code class="pw">' + esc(a.initialPw) + "</code>" : st === "changed" ? '<span class="hint">원장님이 바꿈</span>' : "";
      var act = st === "none" ? '<button class="btn btn-sm" data-make="' + esc(r.id) + '">발급</button>'
        : st === "revoked" ? '<button class="btn btn-line btn-sm" data-relink="' + esc(r.id) + '">다시 연결</button>'
        : '<button class="btn btn-line btn-sm" data-reset="' + esc(r.id) + '">비밀번호 재발급</button> <button class="btn btn-line btn-sm" data-revoke="' + esc(r.id) + '">해제</button>';
      return "<tr><td><b>" + esc(r.name) + '</b><br><small class="hint">아이디: ' + esc(r.id) + "</small></td>" +
        '<td class="num">' + r.students + '</td><td class="num">' + r.results + "</td><td>" + stHtml + "</td><td>" + pw + "</td><td>" + act + "</td></tr>";
    }).join("") || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">학원이 없습니다. 응시자 명단이나 성적을 먼저 올리세요.</td></tr>';
  }

  function bindAccounts() {
    $("#ac-table").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var id = b.dataset.make || b.dataset.reset || b.dataset.revoke || b.dataset.relink;
      var row = academyRows().filter(function (r) { return r.id === id; })[0];
      if (!row) return;
      b.disabled = true;
      var job = b.dataset.make ? createAccount(row.name)
        : b.dataset.reset ? (confirm(row.name + " 비밀번호를 새로 발급할까요? 원장님께 새 비밀번호를 다시 알려 드려야 합니다.") ? resetPassword(id) : Promise.resolve())
        : b.dataset.revoke ? (confirm(row.name + " 계정을 해제할까요? 해제하면 원장님이 성적을 볼 수 없습니다.") ? revoke(id) : Promise.resolve())
        : relink(id);
      job.then(function (msg) { if (msg) A.show($("#ac-msg"), msg, "ok"); })
        .catch(function (err) { console.error(err); A.show($("#ac-msg"), esc(err.message || err), "err"); })
        .then(function () { b.disabled = false; });
    });
    $("#ac-make-all").addEventListener("click", function () {
      var todo = academyRows().filter(function (r) { return acState(r.id) === "none"; });
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
    $("#ac-add").addEventListener("click", function () {
      var name = prompt("학원 이름 (원장님 아이디가 됩니다)");
      if (!name || !A.academyId(name)) return;
      if (academies[A.academyId(name)]) { alert("이미 계정이 있는 학원입니다."); return; }
      createAccount(name).then(function (msg) { A.show($("#ac-msg"), msg, "ok"); })
        .catch(function (err) { A.show($("#ac-msg"), esc(err.message || err), "err"); });
    });
    $("#ac-xlsx").addEventListener("click", function () {
      var rows = academyRows().filter(function (r) { return academies[r.id]; }).map(function (r) {
        var st = acState(r.id), a = academies[r.id];
        return { 학원: r.name, 아이디: r.id, "초기 비밀번호": st === "issued" ? a.initialPw : "", 상태: { issued: "발급됨", changed: "원장님 변경함", revoked: "해제됨" }[st], 응시자: r.students, 성적: r.results, "조회 주소": academyUrl() };
      });
      var ws = XLSX.utils.json_to_sheet(rows), w = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(w, ws, "학원 계정");
      XLSX.writeFile(w, "AMC_학원계정.xlsx");
    });
  }

  function createAccount(name) {
    var id = A.academyId(name), ca = creatorAuth(), pw = A.randomPassword(), email;
    var prev = academies[id];
    return A.academyEmail(name).then(function (em) {
      email = em;
      return ca.createUserWithEmailAndPassword(email, pw).catch(function (err) {
        if (err.code === "auth/email-already-in-use" && prev && prev.initialPw) {
          pw = prev.initialPw;
          return ca.signInWithEmailAndPassword(email, pw).catch(function () {
            throw new Error(name + ": 이미 계정이 있고 원장님이 비밀번호를 바꿔서 다시 발급할 수 없습니다.");
          });
        }
        if (err.code === "auth/email-already-in-use") throw new Error(name + ": 이미 같은 이름의 계정이 있습니다.");
        throw err;
      });
    }).then(function (cred) {
      var uid = cred.user.uid, b = db.batch(), now = firebase.firestore.FieldValue.serverTimestamp();
      b.set(db.collection("academies").doc(id), { name: String(name).trim(), email: email, uid: uid, initialPw: pw, revoked: false, createdAt: now });
      b.set(db.collection("academyUsers").doc(uid), { academyId: id, name: String(name).trim(), email: email, pwChangedAt: null });
      return b.commit();
    }).then(function () {
      return ca.signOut();
    }).then(function () {
      return name + " 계정을 발급했습니다. 아이디 " + esc(id) + " / 비밀번호 " + esc(pw);
    });
  }

  function resetPassword(id) {
    var a = academies[id], ca = creatorAuth(), pw = A.randomPassword();
    return ca.signInWithEmailAndPassword(a.email, a.initialPw).catch(function () {
      throw new Error(a.name + ": 원장님이 비밀번호를 바꿔서 여기서 재발급할 수 없습니다. 원장님 현재 비밀번호로 로그인해 변경하거나, 위원회에 초기화를 요청해 주세요.");
    }).then(function (cred) {
      return cred.user.updatePassword(pw);
    }).then(function () {
      return db.collection("academies").doc(id).update({ initialPw: pw });
    }).then(function () {
      return ca.signOut();
    }).then(function () { return a.name + " 새 비밀번호: " + esc(pw); });
  }

  function revoke(id) {
    var a = academies[id], b = db.batch();
    b.update(db.collection("academies").doc(id), { revoked: true });
    if (a.uid) b.delete(db.collection("academyUsers").doc(a.uid));
    return b.commit().then(function () { return a.name + " 계정을 해제했습니다."; });
  }
  function relink(id) {
    var a = academies[id], b = db.batch();
    b.update(db.collection("academies").doc(id), { revoked: false });
    b.set(db.collection("academyUsers").doc(a.uid), { academyId: id, name: a.name, email: a.email, pwChangedAt: null });
    return b.commit().then(function () { return a.name + " 계정을 다시 연결했습니다. 비밀번호는 이전과 같습니다."; });
  }

  /* ================= 조회 설정 ================= */
  function academyUrl() { return location.href.replace(/[^\/]*$/, "") + "academy.html"; }
  function bindSettings() {
    var link = $("#ac-link"); link.href = academyUrl(); link.textContent = academyUrl();
    $("#cfg-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      db.collection("settings").doc("results").set({
        resultsOpen: f.elements.resultsOpen.checked, title: f.elements.title.value.trim(), notice: f.elements.notice.value.trim()
      }, { merge: true }).then(function () { A.show($("#cfg-msg"), "저장했습니다.", "ok"); })
        .catch(function (err) { A.show($("#cfg-msg"), "오류: " + esc(err.message), "err"); });
    });
  }
})();
