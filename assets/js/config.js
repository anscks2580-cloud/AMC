/* =========================================================
   Firebase 구성값 — 콘솔 > 프로젝트 설정 > 내 앱(웹) 에서 복사해 넣습니다.
   ========================================================= */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAfTpiKmQ206792HnbJzaO_S-xhUBrQkFA",
  authDomain: "fanmath-login.firebaseapp.com",
  projectId: "fanmath-login",
  storageBucket: "fanmath-login.firebasestorage.app",
  messagingSenderId: "100668436841",
  appId: "1:100668436841:web:0198e91a89c2588ca0cdf8"
};

/* 사이트 기본값 (Firestore settings/current 가 있으면 그 값이 우선) */
window.AMC_DEFAULT = {
  round: "2026 AMC 제2회 안양시 수학경시대회",
  examDate: "2026년 11월 15일(일) 오전 10:30",
  checkIn: "오전 10시까지 입실 완료",
  place: "신성중학교",
  ticketPeriod: "",
  ticketOpen: false,
  tel: "031-444-6780",
  bring: "컴퓨터용 사인펜(초등 1·2학년 제외), 필기도구, 수정테이프, 개인 텀블러",
  notes: [
    "오전 10시까지 입실을 마쳐 주세요. 입실할 때 수험표의 QR 코드를 감독관에게 보여 주면 출석이 처리됩니다.",
    "수험표는 인쇄물 또는 휴대폰 화면 캡처 모두 가능합니다.",
    "시험 중에는 휴대전화를 사용할 수 없습니다. 입실 전 전원을 끄고 가방에 넣어 주세요.",
    "시험이 끝나면 바로 귀가할 수 있습니다.",
    "학부모 대기 시 학교 주변 100m 이내는 금연입니다.",
    "교내 주차장을 이용할 수 있으며, 현장 주차 봉사자의 안내에 따라 주세요."
  ],
  host: "(사)안양시학원연합회 보습분과 협의회"
};
