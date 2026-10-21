# 트립부기 공개 가이드와 SEO 운영

공개 검색 진입점은 `/guide`이며 개인 여행 앱의 진입점은 기존 `/`이다. 초기 HTML이 시작 화면인 앱을 검색용 소개로 바꾸는 대신 로그인 없이 읽을 수 있는 공개 문서를 별도로 제공한다. 루트 레이아웃은 기본 `noindex, nofollow`를 유지하고 공개 페이지에서만 색인을 허용한다.

## 공개 URL

| URL | 내용 | 운영 배포 색인 |
| --- | --- | --- |
| `/guide` | 서비스 소개와 가이드 목록 | 허용 |
| `/guide/travel-itinerary` | 일정표 작성과 동행 공유 | 허용 |
| `/guide/travel-expenses` | 다중 통화 경비와 분담 | 허용 |
| `/guide/travel-checklist` | 개인별·공동 준비물 | 허용 |
| `/` | 기존 여행 앱 | 제외 |
| `/invite/[token]` | 동행 초대 | 제외 |
| `/auth/callback` | 인증 콜백 | 제외 |
| `/preview/overview` | 개발용 화면 | 제외 |

가이드는 서버에서 HTML을 생성하며 외부 데이터·로그인·개인 여행 레코드를 읽지 않는다. 제목·설명·canonical·Open Graph·Twitter 카드를 페이지마다 지정한다. 공통 공유 이미지는 `/opengraph-image`의 1200×630 PNG다. 이미지 생성에 외부 폰트 요청은 필요하지 않다.

구조화 데이터는 소개의 WebSite·WebPage·SoftwareApplication, 글의 Article·BreadcrumbList를 사용한다. 실제로 제공하지 않는 가격·평점·리뷰는 넣지 않는다. FAQ는 독자가 읽는 콘텐츠로 제공하며 검색 결과의 특수 표시를 보장하지 않는다. JSON-LD의 `<` 문자는 이스케이프한다.

## 색인 환경과 개인정보 경계

`NODE_ENV=production`이고 `VERCEL_ENV`가 없거나 `production`일 때만 공개 문서가 색인 가능하다. `VERCEL_ENV=preview` 또는 `development`인 배포와 개발 서버는 `noindex`다. `SEO_INDEXING_ENABLED=false`는 공개 문서 색인도 중지한다. 색인이 꺼지면 사이트맵은 빈 목록을 반환하고 robots.txt에서 사이트맵 안내를 제거한다.

메타데이터와 사이트맵은 정적으로 생성되므로 환경 변수 변경 뒤 재빌드·재배포해야 한다. Vercel 이외의 스테이징 환경은 `SEO_INDEXING_ENABLED=false`를 명시한다. canonical은 요청 Host나 프리뷰 주소를 사용하지 않고 현재 공식 도메인 `https://tripboogie.0xseo94.com`에 고정한다. 도메인 이전 시 `app/seo/site.ts`와 실제 리다이렉트·앱 링크·배포 설정을 함께 검토한다.

`robots.txt`는 `/api/` 수집을 제한하고 나머지 HTML과 정적 자원의 접근은 허용한다. 초대·인증·개인 화면은 크롤러가 접근해서 `noindex`를 읽을 수 있게 한다. 같은 경로를 robots.txt에서 막으면 검색 로봇이 noindex를 읽지 못할 수 있다. robots와 메타 태그는 접근 제어가 아니며 실제 데이터 접근은 기존 로그인·여행 권한이 담당한다. [Google noindex 안내](https://developers.google.com/search/docs/crawling-indexing/block-indexing)

`sitemap.xml`은 공개 URL 네 개만 명시적으로 생성하며 DB에서 URL을 수집하지 않는다. 개인 여행 ID·초대 토큰·프로필·인증 쿼리·개발 화면은 사이트맵에 포함하지 않는다. 실제 수정일을 관리하지 않는 콘텐츠에 매번 현재 시간을 lastmod로 넣지 않는다. [Google 사이트맵 안내](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

## 검색 도구 등록

소유자가 Google Search Console과 네이버 서치어드바이저에서 사이트를 등록하고, 필요한 경우 다음 공개 검증 토큰을 배포 환경에 설정한다. 로그인 비밀번호나 서비스 관리 키가 아니라 검증 태그의 content 값만 입력한다.

```text
GOOGLE_SITE_VERIFICATION=
NAVER_SITE_VERIFICATION=
SEO_INDEXING_ENABLED=
```

재배포 후 소유 확인을 완료하고 `/sitemap.xml`을 제출한다. URL 검사 대상으로 `/guide`와 개별 글을 사용한다. Google과 네이버에서 실제 수집·색인 여부를 확인하며, 구현 완료가 노출이나 순위 확보를 뜻하지 않는다. 현재 작업에서는 외부 계정 등록·배포·사이트맵 제출을 실행하지 않는다. [네이버 기본 가이드](https://searchadvisor.naver.com/guide/seo-help), [네이버 선호 URL 및 로봇 메타 태그](https://searchadvisor.naver.com/guide/markup-structure)

## 가이드 확장

콘텐츠 원본은 `app/seo/guides.ts`다. 새 글은 slug·고유한 제목과 설명·실제로 도움 되는 본문·가상임을 밝힌 예시·질문을 추가하면 정적 경로와 목록·사이트맵에 함께 반영된다. 알 수 없는 slug는 404다. 현재 제공하는 기능과 실제 제한을 확인하고 앱에 없는 자동 변환·송금·오프라인 열람을 홍보하지 않는다.

초기 글은 일정표, 다중 통화 경비, 동행 준비물에 집중한다. 다음 글은 실제 검색 유입과 고객 질문을 보고 선정한다. 도시 이름만 바꾼 얇은 문서를 대량 생성하거나 개인 여행을 공개 콘텐츠로 전환하지 않는다. 사용자가 공개를 선택하는 여행 템플릿 기능은 별도의 권한·개인정보 설계가 필요하다.

앱 내부 화면과 로그인 흐름은 이 작업에서 수정하지 않았다. 공개 가이드는 메뉴와 사이트맵으로 서로 연결하며 앱을 여는 버튼을 제공한다. 앱 설정이나 로그인 화면에 가이드 링크를 추가하는 작업은 해당 화면의 다른 개발과 조율한 뒤 진행할 수 있다.

## 검증 명령

```sh
node --test app/seo/seo.test.mjs
node node_modules/eslint/bin/eslint.js app/layout.tsx app/seo app/guide app/robots.ts app/sitemap.ts app/opengraph-image.tsx scripts/check-seo.mjs
npm run build -- --webpack
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 5194
# 별도 터미널에서 프로덕션 HTML 검사
node scripts/check-seo.mjs http://127.0.0.1:5194
```

검사 스크립트는 공개 4페이지의 HTML·canonical·robots·OG·JSON-LD, 개인 화면의 noindex, 알 수 없는 가이드 404, 사이트맵, robots.txt, PNG 크기를 확인한다. 프리뷰 환경을 실제 빌드할 때는 `VERCEL_ENV=preview npm run build -- --webpack`로 만들고 같은 검사에 `--noindex`를 붙인다.

## 동시 작업과 반영 범위

이 작업은 `codex/seo-business-model` 브랜치의 격리된 worktree에서 개발했다. 공용 예약·경비·체크리스트·일정 컴포넌트, API, DB, 모바일 프로젝트, 의존성과 잠금 파일은 변경하지 않는다. 기존 파일 변경은 `app/layout.tsx`의 메타데이터와 `.env.example`의 선택 환경 변수에 한정하고, 기능·문서·테스트는 새 파일로 추가한다.

공용 작업 폴더에 적용하기 전 `git diff -- app/layout.tsx .env.example`로 다른 변경을 확인한다. 다른 작업이 계속되는 동안 브랜치를 전환하거나 진행 중인 파일을 되돌리지 않는다. 배포는 다른 변경을 통합한 다음 별도 판단한다.

## 완료 시 검증 기록

2026년 10월 21일 격리된 worktree에서 TypeScript 검사, 추가 파일 린트, 프로덕션 빌드를 통과했다. SEO·시작 화면·내비게이션·네이티브 링크 관련 테스트 30개가 통과했다. 프로덕션 서버의 실제 응답으로 공개 4페이지, 개인 화면 4경로, 가이드 404, 사이트맵, robots.txt, 1200×630 PNG를 확인했다. 데스크톱 브라우저에서 소개와 상세 가이드의 레이아웃 및 목차 이동을 확인했다. 프리뷰와 색인 중지 환경의 정책은 단위 테스트로 검증했다.
