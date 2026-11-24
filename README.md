# AMC 안양시 수학경시대회 — 수험표·출석 시스템

깃허브 페이지에 올리는 정적 사이트 + Firebase(Auth, Firestore).

| 페이지 | 용도 | 로그인 |
| --- | --- | --- |
| `index.html` | 학생·학부모 수험표 조회(이름+학부모 휴대폰) → QR 수험표 인쇄·이미지 저장 | 없음 |
| `admin.html` | 응시자 명단, 엑셀 업로드(수험번호 자동 생성), 회차 설정 | 관리자 |
| `print.html` | 수험표 일괄 인쇄(시험실·학원별) | 관리자 |
| `scan.html` | 감독관 휴대폰 카메라로 QR 출석 처리, 수기 출석 | 관리자 |
| `dashboard.html` | 실시간 출석 현황, 미출석자, 기록, 엑셀 다운로드 | 관리자 |
| `academy.html` | 성적·시상 조회 포털. 원장님(아이디=학원 이름)은 자기 학원 학생만 보고 「시상 내용 확인」을 누름. 관리자(아이디 admin)는 학원별 보기·확인 현황·학원 계정·성적 업로드·조회 설정 | 원장·관리자 |
| `tools/upload.js` | PC에서 반영하기.bat 로 실행: 테스트 데이터 백업·삭제, 성적 등록, 학원·admin 계정 발급 | — |

## 처음 설정

1. `assets/js/config.js` 에 Firebase 웹 앱 구성값 입력
2. Firebase 콘솔 → Authentication → 이메일/비밀번호 사용 설정 → 관리자 계정 추가
3. Firestore 생성(서울) → `firestore.rules` 배포 (`firebase deploy --only firestore:rules`)
4. 깃허브 Settings → Pages 에서 배포

## 데이터 구조

- `settings/current` — 회차 정보(round, examDate, place, checkIn, ticketPeriod, tel, host, rooms[], ticketOpen)
- `students/{수험번호}` — 응시자 원본 (name, grade, school, phone, room, academy, token)
- `lookup/{sha256(이름|휴대폰)}` — 조회용 사본. 이름과 번호를 아는 사람만 1건 읽을 수 있고 목록은 볼 수 없음
- `attendance/{수험번호}` — 출석 (checkedAt, by, method: qr|manual, scanRoom)
- `results/{문서ID}` — 성적 (name, examNo, grade, school, academy, academyId, marks[O/X], total, award, rank)
- `settings/results` — 성적 조회 설정 (resultsOpen, title, notice, labels[문항 번호])
- `academies/{학원ID}` — 학원 계정 원부, 관리자 전용 (name, email, uid, initialPw, revoked)
- `academyUsers/{uid}` — 원장 계정 연결 (academyId, name, email, pwChangedAt)
- `confirms/{학원ID}` — 원장님 시상 내용 확인 (confirmedAt, name, uid)
- `private/admin` — admin 아이디 초기 비밀번호 (관리자 전용)

## 학원 원장 계정

- 아이디는 학원 이름(띄어쓰기 무시). 실제 Firebase 계정은 학원 이름으로 만든 `ac…@amc.fanmath.co.kr` 이메일이라 원장님은 이메일을 몰라도 됩니다.
- 이 도메인 계정은 관리자 권한이 없고, `results` 중 `academyId` 가 자기 학원인 것만, 조회가 열려 있을 때만 읽을 수 있습니다(firestore.rules 에서 강제).
- 초기 비밀번호는 영문 4자 + 숫자 4자 난수. 원장님이 바꾸면 관리자 화면에 「원장님 변경함」으로 표시되고 초기 비밀번호는 더 이상 쓸 수 없습니다.
- 해제하면 `academyUsers` 연결이 지워져 바로 조회가 막힙니다. 「다시 연결」로 되살릴 수 있습니다.

QR 내용은 `AMC:수험번호:토큰`. 토큰은 학생마다 임의 생성되어 수험번호만 알고 남의 출석을 찍는 일을 막습니다.

## 운영 흐름

1. 접수 마감 → 엑셀 업로드(관리자) → 수험표 조회 열기(회차 설정)
2. 학부모는 `index.html` 에서 조회 후 인쇄 또는 캡처. 학원 배부용은 `print.html` 에서 학원별 일괄 인쇄
3. 시험 당일 감독관은 휴대폰으로 `scan.html` 로그인 → 담당 시험실 선택 → 카메라로 QR 인식
4. 본부는 `dashboard.html` 로 실시간 현황 확인, 종료 후 엑셀 다운로드
