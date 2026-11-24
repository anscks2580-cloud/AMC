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
    var i = awardIdx(a);
    return '<span class="tag ' + (i <= 2 ? "tag-gold" : i < 500 ? "tag-ok" : "tag-no") + '">' + esc(a) + "</span>";
  }

  /* 학년별 표 묶음 그리기 */
  function renderGrades(box, list, keysByGrade, opts) {
    opts = opts || {};
    keysByGrade = keysByGrade || {};
    var groups = {};
    list.forEach(function (r) { (groups[r.grade] = groups[r.grade] || []).push(r); });
    var grades = Object.keys(groups).sort(function (a, b) { return gradeIdx(a) - gradeIdx(b); });
    if (!grades.length) { box.innerHTML = '<div class="card"><p class="hint" style="margin:0;text-align:center">조회된 학생이 없습니다.</p></div>'; return; }
    box.innerHTML = grades.map(function (g) {
      var rows = groups[g], labels = rows[0].labels || [], keys = keysByGrade[g] || [];
      var hasKey = keys.some(function (k) { return k !== "" && k != null; }) || rows.some(function (r) { return r.marks && r.marks.length; });
      var head = '<tr><th class="sticky-col">성명</th><th>수험번호</th><th>학교</th>' + (opts.academy ? "<th>학원</th>" : "") +
        '<th>총점</th><th>상장</th><th>인증</th>' + (hasKey ? '<th class="q">맞은 수</th>' : "") +
        labels.map(function (l, i) { return '<th class="q">' + esc(l) + (keys[i] ? '<br><small class="key">' + esc(keys[i]) + "</small>" : "") + "</th>"; }).join("") + "</tr>";
      var body = rows.map(function (r) {
        var cc = correctCount(r, keys);
        return "<tr>" +
          '<td class="sticky-col"><b>' + esc(r.name) + "</b>" + (r.entry === "개인접수" ? ' <small class="hint">개인</small>' : "") + "</td>" +
          '<td class="num">' + esc(r.examNo) + "</td><td>" + esc(r.school) + "</td>" +
          (opts.academy ? "<td>" + (r.academyId ? esc(r.academy) : '<span class="hint">학원 없음</span>') + "</td>" : "") +
          '<td class="num"><b>' + esc(r.total) + "</b></td><td>" + awardHtml(r.award) + "</td>" +
          "<td>" + (r.cert ? '<span class="tag ' + (r.cert === "인증" ? "tag-ok" : "tag-no") + '">' + esc(r.cert) + "</span>" : "") + "</td>" +
          (hasKey ? '<td class="q num">' + (cc == null ? "" : cc + "/" + labels.length) + "</td>" : "") +
          labels.map(function (l, i) { return '<td class="q">' + ansCell((r.answers || [])[i], markOf(r, i, keys)) + "</td>"; }).join("") +
        "</tr>";
      }).join("");
      return '<div class="card grade-card"><h3 class="grade-h">' + esc(g) + ' <small class="hint">' + rows.length + "명</small></h3>" +
        '<div class="table-wrap result-wrap"><table class="result-table"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div></div>";
    }).join("");
  }

  function statsHtml(list) {
    var awards = {};
    list.forEach(function (r) { if (r.award) awards[r.award] = (awards[r.award] || 0) + 1; });
    var keys = Object.keys(awards).sort(function (a, b) { return awardIdx(a) - awardIdx(b); });
    return '<div class="stat"><b>' + list.length + '</b><span>응시 학생</span></div>' +
      '<div class="stat"><b>' + list.filter(function (r) { return r.award; }).length + '</b><span>수상</span></div>' +
      keys.map(function (k) { return '<div class="stat stat-sm"><b>' + awards[k] + "</b><span>" + esc(k) + "</span></div>"; }).join("");
  }

  function filterOptions(list) {
    var grades = {}, awards = {};
    list.forEach(function (r) { if (r.grade) grades[r.grade] = 1; if (r.award) awards[r.award] = 1; });
    return {
      grades: Object.keys(grades).sort(function (a, b) { return gradeIdx(a) - gradeIdx(b); }),
      awards: Object.keys(awards).sort(function (a, b) { return awardIdx(a) - awardIdx(b); })
    };
  }

  /* 엑셀 내보내기: 첫 시트 「전체」에 모든 학생, 그다음 학년별 문항 정오표 시트 */
  function exportXlsx(list, keysByGrade, filename, opts) {
    opts = opts || {};
    var wb = XLSX.utils.book_new(), groups = {}, sorted = sortResults(list);
    var base = ["수험번호", "성명", "학년", "학교"].concat(opts.academy ? ["학원"] : []).concat(["접수", "총점", "상장", "인증", "맞은 수"]);
    function baseRow(r) {
      var cc = correctCount(r, (keysByGrade || {})[r.grade] || []);
      return [r.examNo || "", r.name, r.grade || "", r.school || ""].concat(opts.academy ? [r.academyId ? r.academy : "학원 없음"] : [])
        .concat([r.entry || "", isNaN(Number(r.total)) || r.total === "" ? r.total : Number(r.total), r.award || "", r.cert || "", cc == null ? "" : cc + "/" + (r.labels || []).length]);
    }
    var all = [base].concat(sorted.map(baseRow));
    var ws = XLSX.utils.aoa_to_sheet(all);
    ws["!cols"] = base.map(function (h) { return { wch: h === "상장" ? 26 : h === "학교" || h === "학원" ? 18 : 10 }; });
    XLSX.utils.book_append_sheet(wb, ws, "전체 " + sorted.length + "명");
    sorted.forEach(function (r) { (groups[r.grade] = groups[r.grade] || []).push(r); });
    Object.keys(groups).sort(function (a, b) { return gradeIdx(a) - gradeIdx(b); }).forEach(function (g) {
      var rows = groups[g], labels = rows[0].labels || [], keys = (keysByGrade || {})[g] || [];
      var aoa = [base.concat(labels.map(String))].concat(rows.map(function (r) {
        return baseRow(r).concat(labels.map(function (l, i) {
          var a = (r.answers || [])[i] || "", m = markOf(r, i, keys);
          return m === "X" ? (a ? a + " ✕" : "✕") : a;
        }));
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), g + " 정오표 " + rows.length + "명");
    });
    XLSX.writeFile(wb, filename);
  }

  window.AMCResults = {
    sortResults: sortResults, renderGrades: renderGrades, statsHtml: statsHtml, filterOptions: filterOptions,
    exportXlsx: exportXlsx, awardIdx: awardIdx, gradeIdx: gradeIdx, GRADE_ORDER: GRADE_ORDER
  };
})();
