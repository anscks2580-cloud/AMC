/* =========================================================
   성적 공통 — 정오표 표, 통계, 엑셀 내보내기 (관리자·원장님 화면 공용)
   ========================================================= */
(function () {
  "use strict";
  var A = window.AMCApp, esc = A.esc;

  var GRADE_ORDER = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
  function gradeIdx(g) { var i = GRADE_ORDER.indexOf(A.normGrade(g)); return i === -1 ? 99 : i; }

  /* 상장 순서 (모르는 이름은 뒤로) */
  var AWARD_ORDER = ["대상", "최우수상", "금상", "우수상", "은상", "동상", "장려상", "입상", "참가상"];
  function awardIdx(a) {
    a = String(a || "").replace(/\s+/g, "");
    if (!a) return 999;
    for (var i = 0; i < AWARD_ORDER.length; i++) if (a.indexOf(AWARD_ORDER[i]) !== -1) return i;
    return 500;
  }

  function sortResults(list) {
    return list.slice().sort(function (a, b) {
      return gradeIdx(a.grade) - gradeIdx(b.grade)
        || (Number(b.total) || 0) - (Number(a.total) || 0)
        || String(a.examNo || "").localeCompare(String(b.examNo || ""))
        || String(a.name).localeCompare(String(b.name), "ko");
    });
  }

  function markHtml(v) {
    v = v == null ? "" : String(v);
    if (v === "O") return '<span class="mk mk-o">O</span>';
    if (v === "X") return '<span class="mk mk-x">X</span>';
    if (v === "") return '<span class="mk mk-e">·</span>';
    return '<span class="mk">' + esc(v) + "</span>";
  }
  function awardHtml(a) {
    if (!a) return '<span class="tag tag-no">-</span>';
    var i = awardIdx(a);
    var cls = i <= 2 ? "tag-gold" : i <= 5 ? "tag-ok" : "tag-no";
    return '<span class="tag ' + cls + '">' + esc(a) + "</span>";
  }
  function correctCount(r) {
    return (r.marks || []).filter(function (m) { return m === "O"; }).length;
  }
  function hasRank(list) { return list.some(function (r) { return r.rank !== "" && r.rank != null; }); }

  /* 표 그리기: table 요소, 성적 목록, 문항 이름 목록, { academy: 학원 열 표시 } */
  function renderTable(table, list, labels, opts) {
    opts = opts || {};
    labels = labels || [];
    var rank = hasRank(list);
    var head = "<tr>" +
      '<th class="sticky-col">성명</th><th>수험번호</th><th>학년</th><th>학교</th>' +
      (opts.academy ? "<th>학원</th>" : "") +
      labels.map(function (l) { return '<th class="q">' + esc(l) + "</th>"; }).join("") +
      '<th class="q">맞은 수</th><th>총점</th><th>상장</th>' + (rank ? "<th>석차</th>" : "") +
      "</tr>";
    table.querySelector("thead").innerHTML = head;
    var cols = 7 + (opts.academy ? 1 : 0) + labels.length + (rank ? 1 : 0);
    table.querySelector("tbody").innerHTML = list.map(function (r) {
      var marks = r.marks || [];
      return "<tr>" +
        '<td class="sticky-col"><b>' + esc(r.name) + "</b></td>" +
        '<td class="num">' + esc(r.examNo) + "</td>" +
        "<td>" + esc(r.grade) + "</td>" +
        "<td>" + esc(r.school) + "</td>" +
        (opts.academy ? "<td>" + esc(r.academy) + "</td>" : "") +
        labels.map(function (l, i) { return '<td class="q">' + markHtml(marks[i]) + "</td>"; }).join("") +
        '<td class="q num">' + correctCount(r) + "</td>" +
        '<td class="num"><b>' + esc(r.total) + "</b></td>" +
        "<td>" + awardHtml(r.award) + "</td>" +
        (rank ? '<td class="num">' + esc(r.rank) + "</td>" : "") +
      "</tr>";
    }).join("") || '<tr><td colspan="' + cols + '" style="text-align:center;color:var(--muted)">조회된 학생이 없습니다.</td></tr>';
  }

  function statsHtml(list) {
    var n = list.length;
    var totals = list.map(function (r) { return Number(r.total); }).filter(function (x) { return !isNaN(x); });
    var avg = totals.length ? (totals.reduce(function (a, b) { return a + b; }, 0) / totals.length) : 0;
    var awards = {};
    list.forEach(function (r) { if (r.award) awards[r.award] = (awards[r.award] || 0) + 1; });
    var awardKeys = Object.keys(awards).sort(function (a, b) { return awardIdx(a) - awardIdx(b); });
    var won = list.filter(function (r) { return r.award; }).length;
    return '<div class="stat"><b>' + n + '</b><span>응시 학생</span></div>' +
      '<div class="stat"><b>' + (totals.length ? (Math.round(avg * 10) / 10) : "-") + '</b><span>평균 점수</span></div>' +
      '<div class="stat"><b>' + won + '</b><span>수상</span></div>' +
      awardKeys.map(function (k) { return '<div class="stat"><b>' + awards[k] + "</b><span>" + esc(k) + "</span></div>"; }).join("");
  }

  function filterOptions(list) {
    var grades = {}, awards = {};
    list.forEach(function (r) { if (r.grade) grades[r.grade] = 1; if (r.award) awards[r.award] = 1; });
    return {
      grades: Object.keys(grades).sort(function (a, b) { return gradeIdx(a) - gradeIdx(b); }),
      awards: Object.keys(awards).sort(function (a, b) { return awardIdx(a) - awardIdx(b); })
    };
  }

  function exportXlsx(list, labels, filename, opts) {
    opts = opts || {};
    var rank = hasRank(list);
    var rows = list.map(function (r) {
      var o = { 수험번호: r.examNo || "", 성명: r.name, 학년: r.grade || "", 학교: r.school || "" };
      if (opts.academy) o.학원 = r.academy || "";
      (labels || []).forEach(function (l, i) { o[String(l)] = (r.marks || [])[i] || ""; });
      o["맞은 수"] = correctCount(r);
      o.총점 = r.total === "" || r.total == null ? "" : (isNaN(Number(r.total)) ? r.total : Number(r.total));
      o.상장 = r.award || "";
      if (rank) o.석차 = r.rank || "";
      return o;
    });
    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "성적");
    XLSX.writeFile(wb, filename);
  }

  window.AMCResults = {
    sortResults: sortResults, renderTable: renderTable, statsHtml: statsHtml, filterOptions: filterOptions,
    exportXlsx: exportXlsx, awardIdx: awardIdx, gradeIdx: gradeIdx, markHtml: markHtml
  };
})();
