/* =========================================================
   AMC 서버 함수 (fanmath-login)
   resetAcademyPassword — 관리자가 원장님 비밀번호를 새 난수로 재발급
     { academyId: "송우찬수학학원" }  → 한 학원
     { all: true }                     → 해제되지 않은 모든 학원
   원장님이 비밀번호를 바꾼 뒤 잊어버려도 됨 (성적·확인 기록은 그대로)
   ========================================================= */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const ACADEMY_DOMAIN = "@amc.fanmath.co.kr";

/* 영문 소문자 4자 + 숫자 4자 (l, o, i, 0, 1 제외) */
function randomPassword() {
  const L = "abcdefghjkmnpqrstuvwxyz", D = "23456789", b = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 4; i++) s += L[b[i] % L.length];
  for (let i = 4; i < 8; i++) s += D[b[i] % D.length];
  return s;
}

async function resetOne(snap) {
  const a = snap.data();
  let uid = a.uid;
  try { await admin.auth().getUser(uid); }
  catch (e) { uid = (await admin.auth().getUserByEmail(a.email)).uid; }
  const pw = randomPassword();
  await admin.auth().updateUser(uid, { password: pw });
  const batch = db.batch();
  batch.update(snap.ref, { initialPw: pw, uid: uid });
  const uref = db.collection("academyUsers").doc(uid);
  if ((await uref.get()).exists) batch.update(uref, { pwChangedAt: null });
  await batch.commit();
  return { academyId: snap.id, name: a.name, password: pw };
}

exports.resetAcademyPassword = onCall({ region: "asia-northeast3", timeoutSeconds: 300 }, async (req) => {
  const email = (req.auth && req.auth.token && req.auth.token.email) || "";
  /* 관리자만: 로그인했고 학원 원장 계정이 아닌 사람 (firestore.rules 의 admin() 과 같은 기준) */
  if (!req.auth || !email || email.toLowerCase().endsWith(ACADEMY_DOMAIN)) {
    throw new HttpsError("permission-denied", "관리자만 재발급할 수 있습니다.");
  }
  const data = req.data || {};
  if (data.all) {
    const all = await db.collection("academies").get();
    const out = [], failed = [];
    for (const snap of all.docs) {
      if (snap.data().revoked) continue;
      try { out.push(await resetOne(snap)); }
      catch (e) { failed.push({ academyId: snap.id, name: snap.data().name, error: String(e.message || e) }); }
    }
    return { results: out, failed: failed };
  }
  const academyId = String(data.academyId || "");
  if (!academyId) throw new HttpsError("invalid-argument", "학원이 지정되지 않았습니다.");
  const snap = await db.collection("academies").doc(academyId).get();
  if (!snap.exists) throw new HttpsError("not-found", "학원 계정을 찾지 못했습니다.");
  const r = await resetOne(snap);
  return { name: r.name, academyId: r.academyId, password: r.password };
});
