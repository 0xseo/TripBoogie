# TripBoogie 전용 관리 연결

기존 Supabase 플러그인과 전역 CLI 로그인은 변경하지 않는다. 이 프로젝트의 관리 스크립트만 `.env`을 읽는다. 앱의 로그인·데이터 접근에는 기존 publishable key와 사용자의 로그인 세션을 사용하며, 관리 토큰을 앱에 전달하지 않는다.

1. `0xseo9401@gmail.com`으로 [Access Tokens](https://supabase.com/dashboard/account/tokens)를 연다.
2. 토큰을 생성할 때 리소스를 `faekdclvcieuksoxsrtw` 프로젝트 하나로 제한한다.
3. Database: Read-write, Migrations: Read-write를 부여한다. Advisors: Read가 표시되면 점검용으로 추가할 수 있지만 연결과 SQL 실행의 필수 권한은 아니다. 작업용으로 짧은 만료 기간을 선택한다.
4. 토큰을 `.env`의 `TRIPBOOGIE_SUPABASE_MANAGEMENT_TOKEN=` 뒤에 입력한다. 채팅·Git·앱 런타임 환경변수에는 저장하지 않는다.
5. 프로젝트 폴더에서 `node scripts/supabase-admin-check.mjs`로 읽기 전용 연결 확인을 실행한다.

이 확인 스크립트는 프로젝트를 고정하고 public 테이블 목록만 조회한다. 테이블 생성이나 데이터 이전은 수행하지 않는다. 다른 계정의 프로젝트에는 요청하지 않는다.

공식 문서: [프로젝트와 권한을 제한한 관리 토큰](https://supabase.com/docs/guides/platform/personal-access-tokens).

연결 후 스키마와 권한·검증 범위는 [데이터베이스 문서](../docs/DATABASE.md)를 참고한다. 초기 마이그레이션은 적용 완료했으며 다시 적용하지 않는다.
