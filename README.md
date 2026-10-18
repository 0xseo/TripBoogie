# TripBoogie · 트립부기

친구와 함께 여행 일정, 장소, 경비, 준비물을 정리하는 반응형 웹앱입니다. 커뮤니티와 공개 리뷰는 포함하지 않습니다.

## 현재 기능

- 날짜별 일정과 메모, 저장한 장소와 좌표, 통화별 경비 합계, 체크리스트
- 로그인 없이 이 브라우저에 저장하는 개인 여행과 JSON 내보내기·가져오기
- Supabase 이메일/비밀번호, Google, Kakao 로그인
- 공유 여행의 편집자·열람자 초대, 초대 만료·취소, 멤버 제거
- 공유 데이터의 버전 충돌 감지와 화면이 보이는 동안 8초 간격 동기화
- Google Maps 브라우저 키가 있으면 지도에 장소 표시, 없으면 Google Maps 링크 제공

개인 여행은 브라우저 저장소를 지우면 없어집니다. 공유 여행의 원본은 서버 D1에 저장되며 브라우저 캐시는 사용자별로 구분합니다. 오프라인에서 공유 여행을 수정하는 기능과 최초 오프라인 실행은 제공하지 않습니다. 실시간 장소 검색, 예약 판매, 원본 앱의 도시 콘텐츠는 구현 범위에 포함하지 않습니다.

## 실행 및 검증

Node.js 22.13 이상이 필요합니다. 프로젝트의 잠금 파일을 사용합니다.

```sh
npm ci
cp .env.example .dev.vars
npm run dev -- --port 5173
npx tsc --noEmit
node --test app/server/integration.test.mjs
npm run build
```

새 로컬 DB는 빌드 후 생성된 설정으로 마이그레이션을 한 번 적용합니다. 이미 적용한 SQL을 재실행하지 않습니다.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_skinny_virginia_dare.sql
```

`.dev.vars`와 백업은 Git에서 제외됩니다. 운영 환경 변수는 Sites에 저장하고 배포해야 적용됩니다. `.openai/hosting.json`의 기존 프로젝트 ID를 유지하세요. Sites 플러그인의 source helper가 정확한 소스 커밋을 저장소에 푸시하고 동일 소스로 배포 아카이브를 만듭니다.

## 로그인 설정

`SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 설정합니다. 서비스 역할 키는 사용하지 않습니다. API는 Supabase `/auth/v1/user`에서 액세스 토큰을 검증한 뒤 서버의 여행 멤버십을 검사합니다. 사용자 메타데이터는 표시 이름에만 사용합니다.

현재 연결 대상: `https://faekdclvcieuksoxsrtw.supabase.co`.

Supabase **Authentication → URL Configuration**:

- Site URL: `https://tripboogie.0xseo94.com`
- Redirect URLs: `https://tripboogie.0xseo94.com/auth/callback`
- 미리보기용 Redirect URL: `https://seo-travel-planner.quiet-haven-9637.chatgpt.site/auth/callback`
- 로컬 개발용 Redirect URL: `http://127.0.0.1:5173/auth/callback`

Google와 Kakao의 OAuth 제공자에 등록할 Redirect URI는 앱의 `/auth/callback`과 다릅니다:

```text
https://faekdclvcieuksoxsrtw.supabase.co/auth/v1/callback
```

제공자 비밀 키는 Supabase 대시보드에 입력합니다. Kakao는 이메일 없는 사용자를 허용할 수 있으며 앱은 이메일 없는 계정도 지원합니다. 이메일 없는 계정과 다른 이메일 로그인 계정이 자동으로 같은 계정이 된다고 가정하지 않습니다. 실제 소셜 로그인의 동의 항목·허용 사용자·게시 상태는 제공자에서 설정해야 합니다.

공식 안내: [이메일](https://supabase.com/docs/guides/auth/passwords), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao).

## 지도

`GOOGLE_MAPS_BROWSER_KEY`와 선택적으로 `GOOGLE_MAPS_MAP_ID`를 설정합니다. Google Cloud에서 Maps JavaScript API를 활성화하고 브라우저 키의 API 및 HTTP referrer 제한을 설정합니다. 사용자가 직접 입력한 장소와 좌표를 저장하며 Google 장소 데이터셋을 복제하지 않습니다.

## 데이터와 권한

서버는 소유자·편집자·열람자 역할을 검사합니다. 같은 레코드의 버전이 오래되면 409로 거절하고 서로 다른 레코드의 편집은 유지합니다. 삭제된 레코드의 식별자를 남겨 오래된 편집의 부활을 막습니다. 초대 토큰은 해시로 저장하며 7일 뒤 만료됩니다.

리소스 한도: 사용자당 여행 100개, 여행당 활성 레코드 5,000개·삭제 이력 포함 20,000개·활성 데이터 2 MiB, 멤버 100명, 활성 초대 20개·누적 초대 1,000개, 요청 본문 64 KiB. 레코드와 여행의 변경·초대 수락은 SQL의 멤버십 조건으로 다시 검사합니다.

SQLite 통합 테스트는 실제 생성된 SQL과 API·저장소 구현을 사용합니다. D1 전송과 인증 사용자 어댑터만 대체하므로 이 테스트가 실제 Supabase 로그인이나 운영 D1 검증을 대신하지는 않습니다.

## APK 분석의 근거와 한계

독립적인 화면과 코드를 작성했습니다. 원본의 코드·도시 콘텐츠·인증 정보는 사용하지 않습니다. REA의 정적 분석은 `com.titicacacorp.triple` 7.23.0 / 7230004의 base APK를 대상으로 했습니다.

- SHA-256: `6678c463c99bb144d6a5ace3fa61fcbeb108e797ae8e4a54e72cd8a06a7293f8`
- 모델에서 관찰: 여행 기간·시간대, 날짜별 계획, 장소·메모·항공·숙소 유형, 경비의 통화·지불자·참여자, 분류별 체크리스트
- 리소스에서 관찰: 지도, 경비, 일정, 도구함, 오프라인 가이드 관련 화면과 문구
- 도출: 비공개 여행 단위와 세부 레코드 단위로 웹앱을 구성
- 미확인: 원본 서버의 데이터와 권한 규칙, 실제 런타임 동작, 보호된 코드 전체

APK를 실행하거나 보호를 해제하지 않았습니다. REA Evidence와 보조 리소스 분석은 작업 공간의 형제 폴더 `triple-analysis/`에 보관합니다. 리소스 문구나 클래스 존재는 해당 기능의 런타임 활성화를 증명하지 않습니다.

## 마스코트

`public/turtle-mascot.png`는 새로 생성한 투명 배경 일러스트입니다. 이미지 생성 도구의 새 이미지 모드로 만들었고 후처리는 하지 않았습니다. 사용한 프롬프트:

```text
Use case: stylized-concept
Asset type: transparent raster mascot for the TripBoogie travel planning web app.
Subject: ONE friendly small mint-green turtle with a warm cream face and dark forest-green shell. A tiny travel backpack gently suggests travel planning.
Style: rounded editorial 3D/clay illustration, soft polished clay material, expressive kind eyes, clean friendly silhouette.
Composition: compact three-quarter front view, full body, standing and waving with one front flipper, centered with modest transparent padding. Readable when displayed at 48 pixels.
Background: genuinely transparent alpha background, no ground plane or scenery.
Constraints: only one turtle, no extra characters, no text, no logo, no watermark. Keep the silhouette simple and clear.
```
