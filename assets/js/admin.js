/* =========================================================
   관리자 — 명단 관리, 엑셀 업로드, 회차 설정
   ========================================================= */
(function () {
  "use strict";
  var A = window.AMCApp, $ = A.$, $$ = A.$$, esc = A.esc, db = A.db;
  var FIELDS = [
    ["name", "성명 (필수)", /이름|성명|학생/],
    ["grade", "학년", /학년/],
    ["school", "학교", /학교/],
    ["phone", "학부모 휴대폰 (필수)", /휴대|전화|연락|핸드폰|폰/],
    ["room", "시험실", /시험실|고사실|교실|반/],
    ["academy", "접수 학원", /학원|접수처/],
    ["examNo", "수험번호", /수험|번호/]
  ];
  var students = [], attendance = {}, settings = {};

  A.requireAdmin(function () {
    bindTabs();
    bindList();
    bindUpload();
    bindSettings();
    watch();
  });

  /* ---------- 탭 ---------- */
  function bindTabs() {
    $$("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
        $$("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
      });
    });
  }

  /* ---------- 실시간 구독 ---------- */
  function watch() {
    db.collection("students").orderBy("examNo").onSnapshot(function (snap) {
      students = snap.docs.map(function (d) { return d.data(); });
      renderList();
    });
    db.collection("attendance").onSnapshot(function (snap) {
      attendance = {};
      snap.docs.forEach(function (d) { attendance[d.id] = d.data(); });
      renderList();
    });
    A.loadSettings().then(function (s) {
      settings = s;
      var f = $("#settings-form");
      Object.keys(s).forEach(function (k) {
        var el = f.elements[k];
        if (!el) return;
        if (el.type === "checkbox") el.checked = !!s[k];
        else el.value = Array.isArray(s[k]) ? s[k].join(", ") : (s[k] || "");
      });
    });
  }

  /* ---------- 명단 ---------- */
  function renderList() {
    var q = A.normName($("#q").value).toLowerCase();
    var rows = students.filter(function (s) {
      if (!q) return true;
      return [s.name, s.examNo, s.academy, s.school, s.room].join(" ").toLowerCase().indexOf(q) !== -1;
    });
    var present = students.filter(function (s) { return attendance[s.examNo]; }).length;
    $("#list-stats").innerHTML =
      '<div class="stat"><b>' + students.length + '</b><span>응시자</span></div>' +
      '<div class="stat"><b>' + present + '</b><span>출석</span></div>' +
      '<div class="stat"><b>' + (students.length - present) + '</b><span>미출석</span></div>';
    $("#list-table tbody").innerHTML = rows.map(function (s) {
      var at = attendance[s.examNo];
      return "<tr>" +
        '<td class="num">' + esc(s.examNo) + "</td>" +
        "<td>" + esc(s.name) + "</td>" +
        "<td>" + esc(s.grade) + "</td>" +
        "<td>" + esc(s.school) + "</td>" +
        '<td class="num">' + esc(fmtPhone(s.phone)) + "</td>" +
        "<td>" + esc(s.room) + "</td>" +
        "<td>" + esc(s.academy) + "</td>" +
        "<td>" + (at ? '<span class="tag tag-ok">' + esc(A.fmtTime(at.checkedAt)) + "</span>" : '<span class="tag tag-no">미출석</span>') + "</td>" +
        '<td><button class="btn btn-line btn-sm" data-edit="' + esc(s.examNo) + '">수정</button> ' +
        '<button class="btn btn-line btn-sm" data-del="' + esc(s.examNo) + '">삭제</button></td>' +
      "</tr>";
    }).join("") || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">응시자가 없습니다. 엑셀 업로드 탭에서 명단을 올리세요.</td></tr>';
  }
  function fmtPhone(p) {
    p = A.digits(p);
    return p.length === 11 ? p.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3") : p;
  }

  function bindList() {
    $("#q").addEventListener("input", renderList);
    $("#list-table").addEventListener("click", function (e) {
      var ed = e.target.closest("[data-edit]"), dl = e.target.closest("[data-del]");
      if (ed) editOne(students.filter(function (s) { return s.examNo === ed.dataset.edit; })[0]);
      if (dl && confirm(dl.dataset.del + " 응시자를 삭제할까요?")) removeStudent(dl.dataset.del);
    });
    $("#add-one").addEventListener("click", function () { editOne(null); });
    $("#del-all").addEventListener("click", function () {
      if (!students.length) return;
      if (prompt("전체 " + students.length + "명을 삭제합니다. 확인하려면 '삭제'라고 입력하세요.") !== "삭제") return;
      deleteAll().then(function () { alert("삭제했습니다."); });
    });
    $("#dl-xlsx").addEventListener("click", function () {
      var ws = XLSX.utils.json_to_sheet(students.map(function (s) {
        var at = attendance[s.examNo];
        return { 수험번호: s.examNo, 성명: s.name, 학년: s.grade, 학교: s.school, "학부모 휴대폰": fmtPhone(s.phone), 시험실: s.room, "접수 학원": s.academy, 출석: at ? A.fmtDateTime(at.checkedAt) : "", 출석방법: at ? (at.method === "manual" ? "수기" : "QR") : "" };
      }));
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "응시자");
      XLSX.writeFile(wb, "AMC_응시자명단.xlsx");
    });
  }

  function editOne(s) {
    var isNew = !s;
    s = s || {};
    var name = prompt("성명", s.name || ""); if (name == null) return;
    var grade = prompt("학년 (예: 초5, 중2)", s.grade || ""); if (grade == null) return;
    var school = prompt("학교", s.school || ""); if (school == null) return;
    var phone = prompt("학부모 휴대폰", fmtPhone(s.phone || "")); if (phone == null) return;
    var room = prompt("시험실", s.room || ""); if (room == null) return;
    var academy = prompt("접수 학원", s.academy || ""); if (academy == null) return;
    var examNo = isNew ? prompt("수험번호 (비우면 자동 생성)", "") : s.examNo; if (examNo == null) return;
    var rec = { name: A.normName(name), grade: A.normGrade(grade), school: school.trim(), phone: A.digits(phone), room: room.trim(), academy: academy.trim(), examNo: examNo.trim(), token: s.token || A.randomToken(8) };
    if (!rec.name || rec.phone.length < 10) { alert("성명과 휴대폰번호는 꼭 필요합니다."); return; }
    if (!rec.examNo) rec.examNo = nextExamNo(rec.grade, students);
    var prev = isNew ? null : s;
    saveStudents([rec], prev ? [prev] : []).then(function () { alert("저장했습니다."); });
  }

  /* 수험번호: 연도2 + 학년코드2 + 순번4 */
  function nextExamNo(grade, existing) {
    var yy = String(new Date().getFullYear()).slice(2), gc = A.gradeCode(grade), prefix = yy + gc;
    var max = 0;
    existing.forEach(function (s) {
      if (String(s.examNo).indexOf(prefix) === 0 && String(s.examNo).length === 8) max = Math.max(max, parseInt(String(s.examNo).slice(4), 10) || 0);
    });
    return prefix + A.pad(max + 1, 4);
  }

  function removeStudent(examNo) {
    var s = students.filter(function (x) { return x.examNo === examNo; })[0];
    if (!s) return Promise.resolve();
    return A.lookupKey(s.name, s.phone).then(function (key) {
      var b = db.batch();
      b.delete(db.collection("students").doc(examNo));
      b.delete(db.collection("lookup").doc(key));
      b.delete(db.collection("attendance").doc(examNo));
      return b.commit();
    });
  }
  function deleteAll() {
    return Promise.all([db.collection("students").get(), db.collection("lookup").get(), db.collection("attendance").get()]).then(function (res) {
      var refs = [];
      res.forEach(function (snap) { snap.docs.forEach(function (d) { refs.push(d.ref); }); });
      return commitChunks(refs.map(function (r) { return { op: "delete", ref: r }; }));
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

  /* 학생 저장: students + lookup. prevList 에는 교체 전 레코드(조회키 삭제용) */
  function saveStudents(list, prevList) {
    var ops = [], now = firebase.firestore.FieldValue.serverTimestamp();
    var pending = (prevList || []).map(function (p) {
      return A.lookupKey(p.name, p.phone).then(function (k) { ops.push({ op: "delete", ref: db.collection("lookup").doc(k) }); });
    });
    return Promise.all(pending).then(function () {
      return Promise.all(list.map(function (r) {
        return A.lookupKey(r.name, r.phone).then(function (k) {
          var rec = Object.assign({}, r, { createdAt: now });
          ops.push({ op: "set", ref: db.collection("students").doc(r.examNo), data: rec });
          ops.push({ op: "set", ref: db.collection("lookup").doc(k), data: { examNo: r.examNo, name: r.name, grade: r.grade, school: r.school, room: r.room, token: r.token } });
        });
      }));
    }).then(function () { return commitChunks(ops); });
  }

  /* ---------- 엑셀 업로드 ---------- */
  var sheetRows = [], headers = [], parsed = [];
  function bindUpload() {
    var drop = $("#drop"), file = $("#file");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("on"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("on"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    file.addEventListener("change", function () { if (file.files[0]) readFile(file.files[0]); });
    $("#preview").addEventListener("click", buildPreview);
    $("#save").addEventListener("click", saveParsed);
  }

  function readFile(f) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var wb = XLSX.read(e.target.result, { type: "array" });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
      if (rows.length < 2) { alert("데이터가 없습니다."); return; }
      headers = rows[0].map(function (h) { return String(h).trim(); });
      sheetRows = rows.slice(1);
      $("#map-rows").innerHTML = FIELDS.map(function (f) {
        var guess = -1;
        headers.forEach(function (h, i) { if (guess === -1 && f[2].test(h)) guess = i; });
        return '<div class="map-row"><label>' + f[1] + '</label><select class="input" data-field="' + f[0] + '">' +
          '<option value="-1">(없음)</option>' +
          headers.map(function (h, i) { return '<option value="' + i + '"' + (i === guess ? " selected" : "") + ">" + esc(h || "열 " + (i + 1)) + "</option>"; }).join("") +
          "</select></div>";
      }).join("");
      $("#map-card").hidden = false;
      $("#preview-card").hidden = true;
      $("#drop").textContent = f.name + " — " + sheetRows.length + "행";
    };
    reader.readAsArrayBuffer(f);
  }

  function buildPreview() {
    var map = {};
    $$("[data-field]").forEach(function (sel) { map[sel.dataset.field] = parseInt(sel.value, 10); });
    if (map.name < 0 || map.phone < 0) { alert("성명과 학부모 휴대폰 열은 꼭 지정해야 합니다."); return; }
    var replace = $("#opt-replace").checked;
    var pool = replace ? [] : students.slice();
    var seen = {};
    students.forEach(function (s) { seen[s.examNo] = s; });
    parsed = sheetRows.map(function (r, idx) {
      function g(k) { return map[k] >= 0 ? String(r[map[k]] == null ? "" : r[map[k]]).trim() : ""; }
      var rec = { name: A.normName(g("name")), grade: A.normGrade(g("grade")), school: g("school"), phone: A.digits(g("phone")), room: g("room"), academy: g("academy"), examNo: g("examNo").replace(/\.0$/, "") };
      var status = "신규";
      if (!rec.name || rec.phone.length < 10) status = "오류: 성명·휴대폰 확인";
      else {
        if (!rec.examNo) { rec.examNo = nextExamNo(rec.grade, pool); }
        var old = !replace && seen[rec.examNo];
        rec.token = old ? old.token : A.randomToken(8);
        if (old) status = "갱신";
        pool.push(rec);
      }
      rec._status = status;
      return rec;
    });
    var ok = parsed.filter(function (p) { return p._status.indexOf("오류") !== 0; });
    var dup = {};
    ok.forEach(function (p) { dup[p.examNo] = (dup[p.examNo] || 0) + 1; });
    ok.forEach(function (p) { if (dup[p.examNo] > 1) p._status = "오류: 수험번호 중복"; });
    $("#preview-count").textContent = ok.filter(function (p) { return p._status.indexOf("오류") !== 0; }).length + "명 저장 예정 / 전체 " + parsed.length + "행";
    $("#preview-table tbody").innerHTML = parsed.map(function (p) {
      var err = p._status.indexOf("오류") === 0;
      return "<tr>" + ['<td class="num">' + esc(p.examNo) + "</td>", "<td>" + esc(p.name) + "</td>", "<td>" + esc(p.grade) + "</td>", "<td>" + esc(p.school) + "</td>", '<td class="num">' + esc(fmtPhone(p.phone)) + "</td>", "<td>" + esc(p.room) + "</td>", "<td>" + esc(p.academy) + "</td>",
        '<td><span class="tag ' + (err ? "tag-warn" : "tag-ok") + '">' + esc(p._status) + "</span></td>"].join("") + "</tr>";
    }).join("");
    $("#preview-card").hidden = false;
    A.hide($("#preview-msg"));
  }

  function saveParsed() {
    var list = parsed.filter(function (p) { return p._status.indexOf("오류") !== 0; }).map(function (p) {
      var r = Object.assign({}, p); delete r._status; return r;
    });
    if (!list.length) { alert("저장할 행이 없습니다."); return; }
    var replace = $("#opt-replace").checked;
    if (!confirm((replace ? "기존 명단을 모두 지우고 " : "") + list.length + "명을 저장할까요?")) return;
    var btn = $("#save"); btn.disabled = true; btn.textContent = "저장 중";
    var prev = replace ? [] : students.filter(function (s) { return list.some(function (l) { return l.examNo === s.examNo; }); });
    (replace ? deleteAll() : Promise.resolve()).then(function () {
      return saveStudents(list, prev);
    }).then(function () {
      A.show($("#preview-msg"), list.length + "명을 저장했습니다. 응시자 명단 탭에서 확인하세요.", "ok");
    }).catch(function (err) {
      console.error(err);
      A.show($("#preview-msg"), "저장 중 오류: " + esc(err.message), "err");
    }).then(function () { btn.disabled = false; btn.textContent = "Firestore에 저장"; });
  }

  /* ---------- 설정 ---------- */
  function bindSettings() {
    var f = $("#settings-form");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = {};
      ["round", "examDate", "place", "checkIn", "ticketPeriod", "tel", "host"].forEach(function (k) { data[k] = f.elements[k].value.trim(); });
      data.rooms = f.elements.rooms.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      data.ticketOpen = f.elements.ticketOpen.checked;
      db.collection("settings").doc("current").set(data, { merge: true }).then(function () {
        A.show($("#settings-msg"), "저장했습니다.", "ok");
      }).catch(function (err) { A.show($("#settings-msg"), "오류: " + esc(err.message), "err"); });
    });
  }
})();
