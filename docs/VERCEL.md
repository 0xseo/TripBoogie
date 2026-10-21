# Vercel 배포

TripBoogie는 표준 Next.js App Router와 Node.js 서버에서 실행한다. 로그인과 여행 데이터는 기존 Supabase 프로젝트 faekdclvcieuksoxsrtw를 유지한다. ChatGPT 로그인이나 Sites 접근 권한은 이 서버의 인증에 사용하지 않는다.

## 환경 설정

로컬 실행은 npm ci, .env.example을 .env.local로 복사, npm run dev 순서다. 운영은 Vercel에 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 설정한다. 무료 검색·경로용 GEOAPIFY_API_KEY를 서버 Secret으로 설정한다. Google/Kakao client secret과 Supabase 관리 토큰은 Vercel에 등록하지 않는다.

관리용 토큰은 Next.js가 자동으로 읽지 않는 .env.management에 저장한다. scripts/supabase-management.mjs와 관리 스크립트는 해당 파일만 읽으며 다른 프로젝트의 Supabase OAuth 연결을 변경하지 않는다. .vercelignore는 환경 파일, 관리 인증 상태, 백업, 이전 Sites/Worker 배포물을 업로드에서 제외한다.

## 배포와 도메인 전환

### GitHub main 자동 배포

`.github/workflows/deploy.yml`이 `main` 푸시 또는 수동 실행을 감지해 검사 후 기존 Vercel 프로젝트의 운영 배포를 실행한다. GitHub 저장소의 암호화된 Actions secret `VERCEL_TOKEN`을 사용하며, 팀·프로젝트 식별자는 워크플로에 고정한다. 운영 배포는 차례로 실행해 이전 커밋이 늦게 배포되는 일을 막는다.

APK는 Git에 저장하지 않는다. 워크플로는 현재 `package.json` 버전의 GitHub Release에서 `TripBoogie_버전.apk`와 `release.json`을 받고, 패키지·버전·빌드·공개 인증서 지문·크기·SHA-256을 검사한 뒤 웹 다운로드에 포함한다. 앱 버전을 올리는 릴리즈는 서명 APK를 빌드하고 같은 커밋에 태그를 붙여 GitHub Release를 게시한 후 `main`을 푸시한다. 버전을 유지한 웹 수정은 그대로 푸시하면 된다. 서명키와 Android 빌드는 이 워크플로에 포함하지 않는다.

1. 기존 Vercel 계정에서 새 tripboogie 프로젝트를 생성하고 폴더를 연결한다.
2. 위 두 런타임 설정을 production과 preview에 등록한다.
3. npm test와 npm run build를 확인하고 Vercel 배포를 실행한다.
4. 배포 URL에서 첫 화면과 비로그인 /api/trips의 401을 확인한다.
5. Vercel 프로젝트에 tripboogie.0xseo94.com을 등록한다. 가비아에서 tripboogie의 기존 CNAME을 Vercel이 실제 반환한 목표값으로 변경한다. 기존 값을 기록하고 TTL은 600을 유지할 수 있다. 네임서버 전체 변경은 필요 없다.
6. 도메인 전파와 HTTPS를 확인한 뒤 해당 도메인에서 카카오/구글 로그인, 기존 여행, 새 여행 저장, 초대 수락을 확인한다.

Supabase Site URL과 허용 Redirect URL은 최종 도메인 및 /auth/callback이다. 제공자에 등록된 https://faekdclvcieuksoxsrtw.supabase.co/auth/v1/callback은 호스팅 변경으로 달라지지 않는다. 임시 Vercel URL에서 소셜 로그인을 검사하려면 그 배포의 /auth/callback을 Supabase 허용 목록에 추가해야 한다.

이전 Sites 배포와 로컬 D1 백업은 전환 검증이 끝날 때까지 유지한다. DNS 전환 전에는 기존 도메인이 Sites를 계속 가리킨다. 새 호스팅으로 옮겨도 기존 Supabase 계정과 여행 데이터는 같은 원본을 사용한다.

## 검증 범위

Next.js 16.3.4 production build와 TypeScript 검사, Postgres 통합 검사 4개가 통과했다. Node.js production 서버에서 /, /auth/callback, API 설정 및 모든 HTML 참조 JS/CSS 자산의 200을 확인했다. /api/trips는 비로그인 401이며 환경 파일 경로는 404다. 빌드 238개 파일에서 관리 토큰이 없음을 검사했다. 실제 Vercel 배포와 도메인 전환 결과는 .sites-runtime의 비공개 실행 기록으로 별도 보관한다.

Vercel의 첫 원격 빌드에서 사용하지 않는 이전 Vite 설정이 제외된 Sites 매니페스트를 참조해 타입 검사에 실패했다. Next.js로 대체된 Vite 설정과 사용되지 않는 ChatGPT 인증 헬퍼를 백업 후 제거했다.

## 2026-10-18 배포 결과

- Vercel 계정/팀: 0xseo / 0xseos-projects
- 프로젝트: tripboogie (prj_k7On5BoeJrRDoQLcQ13dqPEjMxpw)
- 성공한 운영 배포: dpl_5g2W7Qj4i69euH8hxCEwaxiyX5PQ
- 운영 주소: https://tripboogie.vercel.app
- 운영 첫 화면·정적 자산·인증 설정·로그인 콜백 200, 비로그인 여행 API 401 확인
- 이메일, Google, Kakao 제공자 활성 상태 확인
- 실제 브라우저에서 ChatGPT 로그인 화면 없이 TripBoogie 첫 화면 표시 확인
- 가비아에서 tripboogie CNAME을 e276dc6462af5c50.vercel-dns-017.com.으로 변경 필요, TTL 600 유지 가능
- 관리 토큰의 auth_config_read 권한이 없어 Supabase 앱 리다이렉트 허용 목록은 자동 변경하지 않음. 기존 최종 도메인 /auth/callback 사용.

## 초대 수락 JSON 요청 오류 수정

초대 수락 UI가 본문 없는 POST를 보내고 서버가 Request.body의 truthiness로 JSON 파싱 여부를 결정했다. Next.js Node 어댑터는 비어 있는 POST도 ReadableStream으로 제공하므로 application/json 헤더 검사에서 415가 발생했다. 실제 HTTP 요청과 설치된 Next.js 어댑터로 같은 오류를 재현했다.

JSON 직렬화와 Content-Type 설정을 client-api의 jsonRequest에 모으고 여행 변경·생성·초대 생성·취소·수락 호출을 이 생성자로 통일했다. 초대 수락도 {}를 보내며 서버는 항상 readJson으로 동일 출처·미디어 타입·크기·JSON 객체를 검증한다. Request.body 존재 여부로 JSON 요청 여부를 추정하던 분기를 제거했다.

브라우저에서 사용하는 JSON 생성 함수 → 실제 HTTP 연결 → Next.js Node 요청 어댑터 → 앱 API → 실제 PGlite Postgres 마이그레이션을 통과하는 테스트를 추가했다. 빈/잘못된 미디어 타입, 잘못된 JSON, null, 64 KiB 초과, 다른 출처가 멤버십을 변경하지 못하고 정상 초대 수락과 반복 수락이 성공함을 확인했다. 테스트 도우미가 모든 POST에 JSON 헤더를 자동으로 붙여 원인을 가리던 동작도 제거했다. 통합 검사 5개 통과. 실제 Supabase 로그인과 두 브라우저 수락은 별도 사용자 확인 범위다.


## 무료 지도 설정

`GEOAPIFY_API_KEY`는 Vercel production의 Secret 환경 변수로만 등록한다. 브라우저 지도 키나 Google 설정은 필요하지 않다. 키를 등록한 뒤 재배포해야 한다. `/api/map-config`는 공급자 이름과 검색 준비 여부만 반환한다. MapLibre 워커는 공식 Next.js 방식 `new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url)`로 번들한다.


## 2026-10-19 공개 APK와 계정 상태

웹 준비 세부탭은 모바일에서만 노출하고 자료함을 큰 메뉴에 둔다. `/downloads/tripboogie.apk`는 서명·패키지·non-debuggable 검사를 통과한 공개 릴리스만 배포한다. APK Content-Type/attachment/nosniff 및 재검증 캐시 정책을 설정했다. native-dist에는 다운로드 APK를 복사하지 않는다. 배포 전 파일 목록 검사에서 해당 APK 하나만 명시적으로 허용하며 개인 키·환경 파일·검증 화면은 허용하지 않는다.

마이그레이션 `20261019123213_soft_account_withdrawal`을 Supabase에 적용했다. 계정 상태와 RPC/Storage 가드를 추가했고 기존 데이터는 다시 쓰지 않았다. 탈퇴·복구는 사용자 세션과 본인 확인값으로 기존 RPC를 호출한다. 서비스 키나 다른 조직 연결은 필요 없다. 보안 점검은 이전과 같은 INFO 2건/WARN 1건이며 실제 사용자를 탈퇴시키는 운영 검증은 하지 않았다.

도시 검색 보완은 Open-Meteo Geocoding/GeoNames의 도시 유형·국가·시간대를 검증한다. 장소 이름 보완은 Wikipedia의 명확한 언어 연결만 사용하며 검색 요청을 앱 User-Agent로 식별한다. 외부 서비스 장애가 정상 직접 검색 결과를 지우지 않는다. 무료 데이터의 모든 한글 별칭을 보장하는 기능은 아니다.

최종 검증: 서버 36개·클라이언트 24개 통과, TypeScript/ESLint/Next 운영 빌드 성공, Android debug/release assemble·lint 성공(기존 경고는 유지), iOS simulator 0.0.1/build 5 성공. Vercel dpl_ErWAdYXfqQrjPdaQjX89qUV6JQ6p READY, 운영 HTTP 200, QA 3개 404, 익명 bootstrap private/no-store와 빈 데이터 확인. 공개 APK 9,158,484 bytes의 실제 다운로드 SHA-256은 28c98ea28cdd466e92098f65e70176ccd2fd44fe033a2e9275fb611c3c3e92d3로 검증했다. 연결 기기 SM_S948N에 debug build 5 install -r Success, 2026-10-19 21:45:55 KST. 실제 운영 모바일 브라우저에서 설정의 직접 소셜 로그인·앱 정보 표시를 확인했다. 릴리스 APK 로그인·실기기 키보드·iPhone 설치는 미검증이다.

## 2026-10-21 Android 한눈에 보기 자동 갱신 오류

설치 앱에서는 처음 여행 조회가 성공한 뒤 몇 초 후 `Failed to fetch`가 발생했다. 같은 로그인 세션으로 운영 서버를 조회해 일반 요청은 200/CORS 정상, 같은 데이터의 조건부 요청은 304이며 `Access-Control-Allow-Origin`이 사라지는 것을 확인했다. 응답에 직접 CORS를 추가해도 운영 304 경로에서 제거되는 현상은 같았고, 원본 HTTPS 응답으로도 재확인했다.

현재 서버는 정확한 앱 Origin(`https://localhost`, `capacitor://localhost`)의 workspace 조회에 항상 200 전체 스냅샷을 반환하고 ETag를 주지 않는다. 기존 APK도 정상 응답을 받은 뒤 저장해 둔 validator를 버려 이후 조건부 요청을 중단한다. 웹의 조건부 304 최적화는 유지한다. 네이티브 CORS 허용 출처·Bearer 검증·여행 멤버십 검사는 기존과 같으며 개인 데이터 캐시는 사용하지 않는다.

이 변경은 기존 0.2.0 APK에 서버 배포로 반영된다. APK·버전 번호·Supabase 데이터는 변경하지 않았다. Android 14 WebView에서 실제 배포 서버의 공개 설정 조회·조건부 헤더 요청·비인증 여행 API 401을 검증했고, 실제 여행의 인증된 요청은 로컬 전용 진단으로 헤더만 비교했다. 진단 코드와 인증 정보는 배포물에 포함하지 않았다. 실기기 전체 로그인·편집 종단 검증을 수행한 결과는 아니다.

최종 운영 배포: `dpl_EvBU1GFNwteUykgKH3MZUJd3ciXL` READY. 수정 후 같은 여행의 Android 일반·조건부 요청이 모두 200과 정확한 앱 CORS 헤더를 반환하고 ETag가 제거됨을 원본 HTTPS 응답으로 확인했다. 웹 ETag와 데이터 본문 크기는 이전과 같았다. 서버 통합 검사 62개, 클라이언트/네이티브 계약 검사 17개와 Android 네트워크 계측 검사 1개를 통과했다. 공개 APK 메타데이터·SHA-256은 기존 0.2.0과 동일하다.

## 2026-10-21 환율 요청 제한 분리와 0.2.1

환율·날씨·공휴일은 같은 `map-budget`을 쓰고 있어 지도 요청 직후 250ms 제한에 걸리거나 지도 안내를 출력했다. `tool-budget` RPC를 추가해 세 제공자와 지도 제한을 분리했다. 새 제공자 제한은 각 서비스 전역 초당 4회 버스트, 계정당 분당 30회다. 기존 지도 제한은 그대로 유지한다. 외부 환율 서비스 연결 실패·HTTP 오류도 환율 전용 문구를 출력한다.

운영 마이그레이션 `20261021071039_separate_travel_tool_budgets` 적용. 실제 운영 RPC에서 세 서비스 통과를 롤백 트랜잭션으로 검사했고, 익명·authenticated의 내부 함수 직접 실행 권한 차단을 확인했다. 여행·예약·요약표 내용은 변경하지 않았다. 보안 권고는 기존 private 테이블의 정책 없음 INFO 2건과 기존 유출 암호 보호 WARN만 남았다.

최종 0.2.1/build 28 배포: dpl_Fd96sVzuFAM5q5hh6auSCnCK71KN READY. 운영 홈 200, 로컬 미리보기 404, 앱 Origin의 설정 조회 200/CORS 정상. 실제 공개 APK 14606201 bytes, SHA-256 be38b7218e1227d5e82d913a76c10e42786d2ec21700b66619bf3955590eb681 검증. Android 14에서 갤러리·공유창 분리, 흐림 효과, 키보드 검사를 완료했고 iOS build 28 시뮬레이터 빌드도 성공했다.
