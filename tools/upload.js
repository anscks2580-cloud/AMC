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
const RESULTS_ONLY = process.argv.includes("--results-only");
const RESET = process.argv.includes("--reset");  /* 원장님 비밀번호 재발급 */  /* 성적만 다시 올림 (계정·확인 기록은 그대로) */

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

function ask(q) {
  return new Promise(res => { const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a.trim()); }); });
}
async function resetMode() {
  await getToken();
  const list = (await listAll("academies")).filter(d => !d.data.revoked).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name), "ko"));
  const users = {}; (await listAll("academyUsers")).forEach(d => { users[d.id] = d.data; });
  log("\n번호  학원 (비밀번호 상태)");
  list.forEach((d, i) => { const u = users[d.data.uid] || {}; log(`${String(i + 1).padStart(3)}.  ${d.data.name}  ${u.pwChangedAt ? "(원장님 변경함)" : "(초기 비밀번호 사용 중)"}`); });
  const n = parseInt(await ask("\n재발급할 학원 번호를 입력하고 Enter: "), 10);
  const a = list[n - 1];
  if (!a) die("번호가 맞지 않습니다.");
  const pw = randomPassword();
  const u = await findUser(a.data.email);
  if (!u) die("Firebase 에서 이 학원 계정을 찾지 못했습니다.");
  await api(`${IDT}/accounts:update`, { method: "POST", body: JSON.stringify({ localId: u.localId, password: pw }) }, true);
  await commit([
    W.merge("academies", a.id, { initialPw: pw }),
    W.merge("academyUsers", u.localId, { pwChangedAt: null })
  ]);
  log(`\n완료! ${a.data.name} 새 비밀번호: ${pw}`);
  log("원장님은 다음 로그인 때 다시 비밀번호를 바꾸게 됩니다. 아래 문구를 복사해 보내세요.\n");
  log("----------------------------------------");
  log(`[제2회 안양시 수학경시대회] 비밀번호 재발급 안내\n\n${a.data.name} 원장님, 요청하신 비밀번호를 새로 발급해 드립니다.\n\n▶ 접속 주소: ${SITE}\n▶ 아이디: ${a.id}\n▶ 새 비밀번호: ${pw}\n\n로그인하시면 비밀번호 변경 창이 뜹니다. 원장님만 아시는 비밀번호로 바꿔 주세요.\n\n(사)안양시학원연합회 보습분과 협의회`);
  log("----------------------------------------");
}

(async function main() {
  if (RESET) return resetMode();
  const data = JSON.parse(fs.readFileSync(path.join(HERE, "amc_data.json"), "utf8"));
  log(`성적 파일: ${data.length}명`);
  await getToken();
  log("firebase 로그인 확인");

  if (RESULTS_ONLY) {
    const old = await listAll("results");
    await commit(old.map(d => W.del(d.name)));
    const t = new Date();
    await commit(data.map(r => W.set("results", "e_" + String(r.examNo).replace(/[\/\s]/g, ""), Object.assign({}, r, { uploadedAt: t }))));
    log(`성적 ${data.length}명 다시 등록 완료 (정오표 ${data.filter(r => r.marks).length}명). 학원 계정·확인 기록은 그대로입니다.`);
    return;
  }

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
