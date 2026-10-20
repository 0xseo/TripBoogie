# 트립부기 · TripBoogie

친구와 함께 여행 일정·지도·경비·준비물을 정리하는 웹앱입니다. PC·모바일 브라우저, iOS 홈 화면 웹앱, Android 앱을 지원합니다.

- 서비스: https://tripboogie.0xseo94.com
- 현재 버전: **0.1.11**
- 릴리즈 APK 파일명: **TripBoogie_버전.apk** (예: `TripBoogie_0.1.11.apk`).
- Android/iOS 앱 식별자: `com.tripboogie.app`

## 기능

- **나의 여행**: 여행 생성·수정·복사·삭제, 검색·필터·다가오는 순/지난 여행 최신순 정렬, 여행 중·D-day, 연초록 비행기 카드
- **일정·지도**: 날짜별 일정과 메모, 장소 자동완성·지도 직접 선택, 마커·직선 경로, 이동 수단·시간과 자동 이동시간 서버 저장, 드래그 순서 변경, 선택 이동·복사·삭제·날짜 맞바꾸기
- **경비**: 방문 국가·도시별 여러 결제 통화와 개인 기준 통화, 통화별 실제 사용액과 기준통화 환산 총액, 자동 환산 금액 수정, 복수 결제자·분담 금액 편집, 사용 시점과 분류
- **준비**: 개인별·공동 체크리스트와 완료 수·항목 순서 변경, 예약·첨부파일, 파일 미리보기·검색·개수·선택·일괄 태그 이동·삭제·웹 드래그 선택, 기본 자료 태그 보호·정렬·필터, 분류 순서 변경
- **예약**: 숙소·항공·투어티켓·기타, 항공 출발·도착과 숙소 체류일·투어 일정 자동 추가, 일정에서 예약 선택, 날짜·메모 양방향 연동과 독립된 일정 시간, 결제 완료 시 결제자 선택과 경비 즉시 반영, 항공 좌석·수하물 묶음, 공항 자동완성
- **여행 도구**: 같은 시간인 도시 그룹·시차, 도시별 접는 날씨, 여러 여행 통화 환율
- **동행**: 초대 링크, 편집·열람 권한, 서버 동기화와 충돌 검사
- **계정**: Google·Kakao 로그인, 이름·국가·검색 언어·기준 통화·계정별 테마, 복구 가능한 소프트 탈퇴
- **백업**: JSON 내보내기·가져오기. 첨부파일 원본은 별도로 다운로드합니다.

여행과 첨부파일은 Supabase에 저장합니다. 기기에는 로그인 세션을 보관하며 여행 데이터의 오프라인 열람은 제공하지 않습니다. 커뮤니티·공개 리뷰·번역기는 포함하지 않습니다. 항공편 자동 조회와 스토어 배포는 제공하지 않습니다.

## 로컬 실행

Node.js 22.13 이상과 npm 잠금 파일을 사용합니다.

```sh
npm ci
cp .env.example .env.local
# Supabase URL·Publishable key·Geoapify 서버 키 입력
npm run dev
```

http://127.0.0.1:5173 에서 실행됩니다. 새 Supabase 프로젝트는 `supabase/migrations/`를 순서대로 적용하고 Google·Kakao 제공자 및 앱의 callback 주소를 설정해야 합니다. DB의 멤버십·RLS/RPC가 여행 권한을 검사합니다. 제공자 비밀 키는 Supabase에 보관합니다.

```sh
npm run lint
node --test app/workspace-mutations.test.mjs app/checklist.test.mjs app/startup.test.mjs app/profile-state.test.mjs app/file-library.test.mjs app/file-upload.test.mjs app/pull-to-refresh.test.mjs app/navigation.test.mjs native/native.test.mjs app/theme.test.mjs
npm test
npm run build
# Android 에뮬레이터/기기를 연결한 상태에서 실제 소프트 키보드 회귀 검사
JAVA_HOME=/path/to/jdk21 node scripts/test-android-keyboard.mjs
```

서버 통합 테스트는 로컬 PGlite를 사용합니다. 실제 운영 계정·제공자 로그인을 대신 검증하지 않습니다.

## 웹 배포

Next.js를 Vercel에 배포합니다. 서버 환경 변수는 `.env.example`을 참고합니다. Supabase 관리 토큰, 서명키와 비밀번호는 앱 번들이나 Git에 넣지 않습니다. 서비스 워커는 설치만 지원하고 개인 데이터를 캐시하지 않습니다.

당겨서 새로고침하면 현재 화면을 유지한 채 서버 데이터를 갱신합니다. 새 웹 코드를 받으려면 사이트를 다시 열거나 브라우저에서 전체 새로고침합니다. 앱을 처음 시작할 때의 스플래시는 유지합니다.

## 모바일

- **Android**: GitHub Releases의 서명된 APK 또는 서비스의 앱 설치 메뉴에서 설치합니다. APK는 새 버전을 직접 설치해 업데이트합니다.
- **iPhone/iPad**: Safari에서 사이트를 연 뒤 공유 → 홈 화면에 추가로 설치합니다.
- **네이티브 소스**: Capacitor의 `android/`, `ios/` 프로젝트를 포함합니다. Google·Kakao 공식 SDK, 기기 보안 저장소, 앱 복귀 링크와 파일 공유를 사용합니다. iOS 네이티브 배포에는 별도의 Apple 서명·개발자 계정 설정이 필요합니다.

`.env.native.local`의 공개 앱 식별자 설정 후 `npm run native:sync`로 번들을 동기화합니다. Android 릴리스에는 별도 `.env.release.local`과 기존 배포 서명키가 필요합니다. 이 로컬 설정은 저장소에 포함하지 않습니다. 상세 설정은 [네이티브 안내](docs/NATIVE.md)를 참고하세요.

## 데이터 출처

지도는 MapLibre GL JS·OpenFreeMap·OpenStreetMap, 장소는 Geoapify와 공개 지명 데이터, 장소 사진은 Wikimedia Commons, 날씨는 Open-Meteo, 환율은 Frankfurter를 사용합니다. 개별 데이터 이용 조건·표시는 해당 화면과 `THIRD_PARTY_DATA_LICENSE.txt` 및 `app/data/`에 보관합니다. 공개 데이터에 없는 장소·사진·시간은 제공하지 못할 수 있습니다. 여행 카드의 도시 대표 사진 검색·선택 기능은 제거했으며, 일정과 장소 선택 화면의 장소 사진은 유지합니다.

[변경 기록](CHANGELOG.md) · [데이터베이스](docs/DATABASE.md) · [Vercel](docs/VERCEL.md)
