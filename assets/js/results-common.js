/* =========================================================
   성적 공통 — 학년별 답안·시상 표, 통계, 엑셀 내보내기
   성적 문서: { examNo, name, grade, school, academy, academyId, entry, total, award, cert, labels[], answers[] }
   정답: settings/results.keys = { "초1": ["3","4",...] }  (없으면 답안만 표시)
   ========================================================= */
(function () {
  "use strict";
  var A = window.AMCApp, esc = A.esc;

  var GRADE_ORDER = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
  function gradeIdx(g) { var i = GRADE_ORDER.indexOf(g); return i === -1 ? 99 : i; }

  /* 상장 서열 */
  var AWARD_ORDER = ["안양시장상", "지학사대표상", "국회의원상", "경기도의회의장상", "안양시의회의장상", "안양시의회의원상", "경기도의회의원상", "경기도학원연합회장상", "안양시학원연합회장상", "안양시학원연합회보습협의회장상"];
  function awardIdx(a) {
    a = String(a || "").replace(/\s+/g, "");
    if (!a) return 999;
    var i = AWARD_ORDER.indexOf(a);
    return i === -1 ? 500 : i;
  }

  /* 상장마다 다른 색 [배경, 글자] */
  var AWARD_COLORS = [
    ["#fff1c9", "#9a6b00"], ["#efe6ff", "#6b3fb5"], ["#ffe3e3", "#c0392b"], ["#e1e8ff", "#2c3e8f"], ["#d9f5f1", "#0f7d6f"],
    ["#dff0ff", "#1f6fb2"], ["#ece9ff", "#4a43b0"], ["#ffe9d6", "#b85d10"], ["#e2f5e6", "#2f7d3e"], ["#f0ece6", "#6b5d4f"]
  ];
  function awardColor(a) { var i = awardIdx(a); return AWARD_COLORS[i] || ["#eef1f5", "#5a6375"]; }

  function sortResults(list) {
    return list.slice().sort(function (a, b) {
      return gradeIdx(a.grade) - gradeIdx(b.grade)
        || (Number(b.total) || 0) - (Number(a.total) || 0)
        || String(a.name).localeCompare(String(b.name), "ko");
    });
  }

  function normAns(v) { return String(v == null ? "" : v).replace(/\s+/g, ""); }
  /* 학생 답안 칸: 정답이 있으면 O/X 색, 없으면 답안 그대로 */
  function ansCell(v, mark) {
    var s = normAns(v);
    var cls = mark === "O" ? " mk-o" : mark === "X" ? " mk-x" : (s ? "" : " mk-e");
    return '<span class="mk' + cls + '">' + (s ? esc(s) : "·") + "</span>";
  }
  /* 문항별 정오: 성적 파일의 빨간 글씨(틀림)로 만든 marks 가 우선, 없으면 입력한 정답과 비교 */
  function markOf(r, i, keys) {
    if (r.marks && r.marks.length) return r.marks[i] === "O" ? "O" : r.marks[i] === "X" ? "X" : null;
    if (keys && keys[i] != null && keys[i] !== "") return normAns((r.answers || [])[i]) && normAns((r.answers || [])[i]) === normAns(keys[i]) ? "O" : "X";
    return null;
  }
  function correctCount(r, keys) {
    if (r.marks && r.marks.length) return r.marks.filter(function (m) { return m === "O"; }).length;
    if (!keys || !keys.length) return null;
    var n = 0;
    (r.answers || []).forEach(function (a, i) { if (keys[i] != null && keys[i] !== "" && normAns(a) && normAns(a) === normAns(keys[i])) n++; });
    return n;
  }
  function awardHtml(a) {
    if (!a) return '<span class="tag tag-no">-</span>';
    var c = awardColor(a);
    return '<span class="tag" style="background:' + c[0] + ";color:" + c[1] + '">' + esc(a) + "</span>";
  }

  /* 학년별 표 묶음 그리기 — 상장·인증까지만 */
  function renderGrades(box, list, keysByGrade, opts) {
    opts = opts || {};
    var groups = {};
    list.forEach(function (r) { (groups[r.grade] = groups[r.grade] || []).push(r); });
    var grades = Object.keys(groups).sort(function (a, b) { return gradeIdx(a) - gradeIdx(b); });
    if (!grades.length) { box.innerHTML = '<div class="card"><p class="hint" style="margin:0;text-align:center">조회된 학생이 없습니다.</p></div>'; return; }
    box.innerHTML = grades.map(function (g) {
      var rows = groups[g];
      var head = '<tr><th>성명</th><th>수험번호</th><th>학교</th>' + (opts.academy ? "<th>학원</th>" : "") + "<th>총점</th><th>상장</th><th>인증</th></tr>";
      var body = rows.map(function (r) {
        return "<tr>" +
          "<td><b>" + esc(r.name) + "</b></td>" +
          '<td class="num">' + esc(r.examNo) + "</td><td>" + esc(r.school) + "</td>" +
          (opts.academy ? "<td>" + (r.academyId ? esc(r.academy) : '<span class="hint">개인' + (r.appliedVia ? " · " + esc(r.appliedVia) : "") + "</span>") + "</td>" : "") +
          '<td class="num"><b>' + esc(r.total) + "</b></td><td>" + awardHtml(r.award) + "</td>" +
          "<td>" + (r.cert ? '<span class="tag ' + (r.cert === "인증" ? "tag-ok" : "tag-warn") + '">' + esc(r.cert) + "</span>" : "") + "</td>" +
        "</tr>";
      }).join("");
      return '<div class="card grade-card"><h3 class="grade-h">' + esc(g) + ' <small class="hint">' + rows.length + "명</small></h3>" +
        '<div class="table-wrap result-wrap"><table class="result-table plain"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div></div>";
    }).join("");
  }

  function statsHtml(list) {
    var awards = {}, cert = 0, uncert = 0;
    list.forEach(function (r) {
      if (r.award) awards[r.award] = (awards[r.award] || 0) + 1;
      if (r.cert === "인증") cert++; else if (r.cert) uncert++;
    });
    var keys = Object.keys(awards).sort(function (a, b) { return awardIdx(a) - awardIdx(b); });
    function label(t) { var n = t.length; return '<span class="' + (n > 12 ? "lbl-xs" : n > 8 ? "lbl-s" : "") + '">' + esc(t) + "</span>"; }
    return '<div class="stat"><b>' + list.length + '</b><span>응시 학생</span></div>' +
      '<div class="stat"><b style="color:var(--ok)">' + cert + '</b><span>인증</span></div>' +
      '<div class="stat"><b style="color:var(--warn)">' + uncert + '</b><span>미인증</span></div>' +
      keys.map(function (k) { var c = awardColor(k); return '<div class="stat stat-sm stat-award" style="border-left:4px solid ' + c[1] + ";background:" + c[0] + '"><b style="color:' + c[1] + '">' + awards[k] + "</b>" + label(k) + "</div>"; }).join("");
  }

  function filterOptions(list) {
    var grades = {}, awards = {};
    list.forEach(function (r) { if (r.grade) grades[r.grade] = 1; if (r.award) awards[r.award] = 1; });
    return {
      grades: Object.keys(grades).sort(function (a, b) { return gradeIdx(a) - gradeIdx(b); }),
      awards: Object.keys(awards).sort(function (a, b) { return awardIdx(a) - awardIdx(b); })
    };
  }

  /* 엑셀 내보내기: 한 시트, 상장·인증까지만 */
  function exportXlsx(list, keysByGrade, filename, opts) {
    opts = opts || {};
    var sorted = sortResults(list);
    var base = ["수험번호", "성명", "학년", "학교"].concat(opts.academy ? ["학원"] : []).concat(["총점", "상장", "인증"]);
    var aoa = [base].concat(sorted.map(function (r) {
      return [r.examNo || "", r.name, r.grade || "", r.school || ""]
        .concat(opts.academy ? [r.academyId ? r.academy : "개인접수" + (r.appliedVia ? " (" + r.appliedVia + ")" : "")] : [])
        .concat([isNaN(Number(r.total)) || r.total === "" ? r.total : Number(r.total), r.award || "", r.cert || ""]);
    }));
    var wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = base.map(function (h) { return { wch: h === "상장" ? 28 : h === "학교" || h === "학원" ? 20 : 10 }; });
    XLSX.utils.book_append_sheet(wb, ws, "성적·시상 " + sorted.length + "명");
    XLSX.writeFile(wb, filename);
  }

  window.AMCResults = {
    sortResults: sortResults, renderGrades: renderGrades, statsHtml: statsHtml, filterOptions: filterOptions,
    exportXlsx: exportXlsx, awardIdx: awardIdx, gradeIdx: gradeIdx, GRADE_ORDER: GRADE_ORDER
  };
})();
