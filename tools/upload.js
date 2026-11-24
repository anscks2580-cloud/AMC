/* =========================================================
   AMC 성적·시상 반영 — 반영하기.bat 에서 실행
   1) 기존 테스트 데이터 백업 후 삭제 (students, lookup, attendance, results, confirms)
   2) amc_data.json 성적 등록
   3) 학원 원장 계정 + admin 계정 발급 (이미 있으면 그대로 둠)
   4) 계정 목록을 AMC_학원계정.csv 로 저장
   로그인은 이 PC의 firebase-tools 로그인 정보를 씁니다 (firebase login).
   ========================================================= */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");

const PROJECT = "fanmath-login";
const ACADEMY_DOMAIN = "amc.fanmath.co.kr";
const ADMIN_EMAIL = "admin@amc-admin.fanmath.co.kr";
const SITE = "https://anscks2580-cloud.github.io/AMC/academy.html";
const TITLE = "2026 AMC 제2회 안양시 수학경시대회 성적·시상";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCROOT = `projects/${PROJECT}/databases/(default)/documents`;
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const HERE = __dirname;
const DRY = process.argv.includes("--dry");

/* firebase-tools 공개 OAuth 클라이언트 (firebase login 이 쓰는 값) */
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

let TOKEN = "";
const http = global.__mockFetch || fetch;

function log(...a) { console.log(...a); }
function die(msg) { console.error("\n[오류] " + msg); process.exit(1); }

async function getToken() {
  const cands = [
    path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"),
    process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "configstore", "firebase-tools.json") : null
  ].filter(Boolean);
  const file = cands.find(f => fs.existsSync(f));
  if (!file) die("firebase 로그인 정보를 찾지 못했습니다. PowerShell 에서 firebase login 을 먼저 해 주세요.");
  const conf = JSON.parse(fs.readFileSync(file, "utf8"));
  const rt = conf.tokens && conf.tokens.refresh_token;
  if (!rt) die("firebase 로그인이 만료됐습니다. PowerShell 에서 firebase login --reauth 후 다시 실행해 주세요.");
  const res = await http("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }).toString()
  });
  const j = await res.json();
  if (!j.access_token) die("firebase 로그인 갱신 실패 — PowerShell 에서 firebase login --reauth 후 다시 실행해 주세요. (" + JSON.stringify(j) + ")");
  TOKEN = j.access_token;
}

async function api(url, opt = {}, quota = false) {
  const headers = Object.assign({ Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, quota ? { "x-goog-user-project": PROJECT } : {});
  const res = await http(url, Object.assign({}, opt, { headers }));
  const text = await res.text();
  let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) { j = { raw: text }; }
  if (!res.ok) { const err = new Error((j.error && j.error.message) || text || res.status); err.status = res.status; err.body = j; throw err; }
  return j;
}

/* ---------- Firestore 값 변환 ---------- */
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "object") return { mapValue: { fields: fields(v) } };
  return { stringValue: String(v) };
}
function fields(o) { const f = {}; Object.keys(o).forEach(k => { f[k] = enc(o[k]); }); return f; }
function dec(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) { const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = dec(x); }); return o; }
  return null;
}
function docName(col, id) { return `${DOCROOT}/${col}/${id}`; }

async function listAll(col) {
  const out = []; let token = "";
  do {
    const j = await api(`${FS}/${col}?pageSize=300${token ? "&pageToken=" + encodeURIComponent(token) : ""}`);
    (j.documents || []).forEach(d => {
      const o = {}; Object.entries(d.fields || {}).forEach(([k, x]) => { o[k] = dec(x); });
      out.push({ name: d.name, id: d.name.split("/").pop(), data: o });
    });
    token = j.nextPageToken || "";
  } while (token);
  return out;
}
async function getDoc(col, id) {
  try {
    const d = await api(`${FS}/${col}/${encodeURIComponent(id)}`);
    const o = {}; Object.entries(d.fields || {}).forEach(([k, x]) => { o[k] = dec(x); }); return o;
  } catch (e) { if (e.status === 404) return null; throw e; }
}
async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    if (DRY) { log(`  (시험 실행) ${Math.min(writes.length - i, 400)}건 쓰기 생략`); continue; }
    await api(`${FS}:commit`, { method: "POST", body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
  }
}
const W = {
  set: (col, id, data) => ({ update: { name: docName(col, id), fields: fields(data) } }),
  merge: (col, id, data) => ({ update: { name: docName(col, id), fields: fields(data) }, updateMask: { fieldPaths: Object.keys(data).map(k => "`" + k + "`") } }),
  del: name => ({ delete: name })
};

/* ---------- 계정 ---------- */
function academyId(name) { return String(name || "").replace(/\s+/g, ""); }
function academyEmail(name) {
  const h = crypto.createHash("sha256").update("AMC-ACADEMY|" + academyId(name), "utf8").digest("hex");
  return "ac" + h.slice(0, 24) + "@" + ACADEMY_DOMAIN;
}
function randomPassword() {
  const L = "abcdefghjkmnpqrstuvwxyz", D = "23456789", b = crypto.randomBytes(8);
  let s = ""; for (let i = 0; i < 4; i++) s += L[b[i] % L.length]; for (let i = 4; i < 8; i++) s += D[b[i] % D.length];
  return s;
}
async function findUser(email) {
  const j = await api(`${IDT}/accounts:lookup`, { method: "POST", body: JSON.stringify({ email: [email] }) }, true);
  return (j.users || [])[0] || null;
}
/* 계정이 없으면 만들고, 있으면 비밀번호를 새로 정함. uid 반환 */
async function ensureUser(email, pw) {
  if (DRY) return "dry-" + email.slice(0, 10);
  const u = await findUser(email);
  if (u) { await api(`${IDT}/accounts:update`, { method: "POST", body: JSON.stringify({ localId: u.localId, password: pw }) }, true); return u.localId; }
  const j = await api(`${IDT}/accounts`, { method: "POST", body: JSON.stringify({ email, password: pw, emailVerified: false }) }, true);
  return j.localId;
}

(async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(HERE, "amc_data.json"), "utf8"));
  log(`성적 파일: ${data.length}명`);
  await getToken();
  log("firebase 로그인 확인");

  /* 1) 백업 후 테스트 데이터 삭제 */
  const WIPE = ["students", "lookup", "attendance", "results", "confirms"];
  const backup = {};
  for (const c of WIPE.concat(["academies", "academyUsers", "settings"])) backup[c] = await listAll(c);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  fs.writeFileSync(path.join(HERE, `백업_${stamp}.json`), JSON.stringify(backup, null, 1));
  log(`백업 저장: 백업_${stamp}.json  (${WIPE.map(c => c + " " + backup[c].length).join(", ")})`);
  await commit(WIPE.flatMap(c => backup[c].map(d => W.del(d.name))));
  log("기존 데이터 삭제 완료");

  /* 2) 성적 등록 */
  const now = new Date();
  await commit(data.map(r => W.set("results", "e_" + String(r.examNo).replace(/[\/\s]/g, ""), Object.assign({}, r, { uploadedAt: now }))));
  await commit([W.merge("settings", "results", { resultsOpen: true, title: TITLE, uploadedAt: now, count: data.length })]);
  log(`성적 ${data.length}명 등록, 원장님 조회 열림`);

  /* 3) 학원 계정 */
  const academies = {}; backup.academies.forEach(d => { academies[d.id] = d.data; });
  const names = {}; data.forEach(r => { if (r.academyId) names[r.academyId] = r.academy; });
  const counts = {}; data.forEach(r => { if (r.academyId) counts[r.academyId] = (counts[r.academyId] || 0) + 1; });
  const rows = [], writes = [];
  for (const id of Object.keys(names).sort((a, b) => a.localeCompare(b, "ko"))) {
    const name = names[id], email = academyEmail(name), prev = academies[id];
    let pw, uid, note;
    if (prev && prev.uid && prev.initialPw && !DRY && await findUser(email)) {
      pw = prev.initialPw; uid = prev.uid; note = "기존 계정 유지";
    } else {
      pw = randomPassword(); uid = await ensureUser(email, pw); note = "새로 발급";
    }
    writes.push(W.set("academies", id, { name, email, uid, initialPw: pw, revoked: false, createdAt: now }));
    writes.push(W.set("academyUsers", uid, { academyId: id, name, email, pwChangedAt: null }));
    rows.push([name, id, pw, counts[id], note]);
    log(`  ${name}  ${pw}  (${counts[id]}명, ${note})`);
  }
  await commit(writes);

  /* admin 계정 */
  let adminPw;
  const priv = await getDoc("private", "admin");
  if (priv && priv.initialPw && !DRY && await findUser(ADMIN_EMAIL)) { adminPw = priv.initialPw + " (기존)"; }
  else {
    adminPw = randomPassword();
    await ensureUser(ADMIN_EMAIL, adminPw);
    await commit([W.set("private", "admin", { email: ADMIN_EMAIL, initialPw: adminPw, createdAt: now })]);
  }
  log(`admin 계정: admin / ${adminPw}`);

  /* 4) 계정 목록 CSV (엑셀에서 열림) */
  const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const csv = [["학원", "아이디", "비밀번호", "학생 수", "비고"].map(q).join(",")]
    .concat([["관리자", "admin", adminPw, data.length, "전체 관리"].map(q).join(",")])
    .concat(rows.map(r => r.map(q).join(",")))
    .concat(["", q("접속 주소") + "," + q(SITE)]);
  fs.writeFileSync(path.join(HERE, "..", "AMC_학원계정.csv"), "﻿" + csv.join("\r\n"));
  log(`\n완료! 학원 ${rows.length}곳 계정 목록 → AMC 폴더의 AMC_학원계정.csv`);
  log(`접속 주소: ${SITE}`);
})().catch(e => { console.error(e.body ? JSON.stringify(e.body) : e); die("반영 중 문제가 생겼습니다. 이 창 내용을 그대로 Claude 에게 보내 주세요."); });
