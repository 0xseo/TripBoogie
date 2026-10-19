# Triple APK 근거와 TripBoogie 구현 비교

2026-10-18 상세 UX 요청 반영 기준. 커뮤니티·리뷰·구매 기능은 제외한다. APK의 모델/리소스 관찰과 사용자의 독립적인 제품 요구를 구별한다. 원본 APK를 실행해 화면 전환이나 계산식을 재현했다고 주장하지 않는다.

| 영역 | 원본 정적 근거 | 현재 TripBoogie |
|---|---|---|
| 일정·메모 | `POI`, `CUSTOM_POI`, `MEMO` enum / 날짜별 계획 | 일정·메모 추가, 장소 선택은 별도 지도 화면, 장소 없이 필수 제목 입력 |
| 검색·지도 | POI 좌표/주소 모델, SearchPoiMapActivity | Geoapify 자동완성·기본 장소명 수정, DAY별 공통 MapLibre 지도 |
| 이동선 | 지도 좌표 모델. 정확한 선 단절 규칙은 미확인 | 사용자 규칙대로 직선·거리 자동 표시, 메모 무시·장소 없는 일정에서 단절, 수단/직접 시간 |
| 순서·복사·이동 | orderId와 편집 관련 리소스 | 드래그·위아래·일괄 복사/이동/삭제·날짜 맞바꾸기·하루/여행 복사·거리 정렬/되돌리기 |
| 경비 | payerUserIds·companionIds·exchangeRate | 여행 통화/프로필 기준 통화의 금액·환율 스냅샷, 결제 통화 선택, 복수 결제자·분담자별 금액과 카드/별도 편집, 전/DAY/후 보기 |
| 통화 변경 | 이후 항목부터 환율 변경 적용 문구 | 사용자 확인대로 프로필 기준 통화 변경은 신규 경비부터 적용. 기존 금액·통화·환율 보존 |
| 체크리스트 | 항목·분류·체크 구조 | 분류 편집·작성자·함께 한 번/각자 완료·멤버별 진행률. 각자 완료는 사용자 추가 요구 |
| 예약 | flightSchedule·MY_HOTEL·bookingInfo·첨부 모델 | 숙소/항공/투어 전용 예약, 숙소 일정 자동 추가, 수동 수정한 자동 일정 보존 |
| 항공편 조회 | 항공편 번호·출발/도착 모델 | 날짜·편명·공항·현지 시간/시간대 직접 입력. 자동 조회는 별도 데이터 서비스가 없어 미연결 |
| 첨부 | 예약·항공 첨부 필드 | 비공개 Supabase Storage, 예약별 첨부·자료함·다운로드·삭제 재시도 |
| 날짜 선택 | 출발/도착·숙박 범위 리소스 | 재사용 단일 날짜 범위 달력 |
| 여행 도구 | 날씨·시차·환율 리소스 | 도시별 방문 기간 기준 Open-Meteo 16일 예보와 17~46일 EC46 장기 전망, IANA 시간대의 현지 시각/출발일 시차, Frankfurter 참고 환율 |
| 공유·저장 | 공동 일정·초대 관련 문구 | 서버 원본 CRUD, 초대·권한·버전 검사, JSON 백업. 첨부 바이너리와 친구 권한은 JSON 가져오기로 복제하지 않음 |
| 제외 | 오프라인·번역 관련 리소스 | 사용자 요청으로 오프라인 열람과 번역 제외 |

원본의 정산 최소 송금 알고리즘·도시 콘텐츠·사진/영업시간·실시간 교통·대중교통 시간표는 재현하지 않는다. 향후 일정/장소와 경비의 세부 연결은 별도 요청 범위다.

## 검증과 한계

- 실제 Postgres(PGlite) 전체 마이그레이션 및 API 통합 테스트. Auth 검증과 PostgREST 전송은 대체한다.
- 실제 Supabase에서 새 스키마와 로그인 역할의 경비·프로필·개인 체크·숙소 자동 일정·첨부 메타데이터 흐름을 롤백 검증한다.
- 브라우저의 가상 여행에서 DAY 변경·지도 마커/직선·기간 달력·두 통화 입력 규칙과 390px 모바일 배치를 확인했다. 가상 화면은 배포하지 않는다.
- Geoapify 자동완성/도보 시간, Frankfurter 환율, Open-Meteo 시간대/예보 한계의 실제 공급자 응답을 확인했다.
- 두 실제 사용자 브라우저에서 새 기능을 연결한 종단 검증과 Storage의 실제 파일 업로드/다운로드는 별도 확인 범위다. SQL의 storage.objects 대체 테이블 테스트는 실제 오브젝트 저장소 검증이 아니다.

## 원본 근거 목록

분석 자료 위치: `/Users/0xseo/.codex/visualizations/2026/10/18/01a14d12-f689-7283-b396-15d3458d7306/triple-analysis`.

| 참조 | 파일·관찰 | Evidence ID 또는 보조 자료 위치 |
|---|---|---|
| O1 | `model-trip.json`: `geotags`, `geotagStyles`, `timezone`, 기간·제목 | `ev_6a7ce598300a79893c06cb7093cc24a3990268bc5d7d22fe0edbcba21d584a8f` |
| O2 | `model-plan.json`, `model-plan-type.json`: `orderId`, `flightSchedule`, `myHotelId`, `bookingInfo`, `tripPlanImageViews`, 유형 enum | `ev_dd13963b7746d39819629f4702b5081496d143a295d89b2442c2c2d6f326190d`, `ev_f456e7c7d6663be586e4ee0ef6dfbfbd8bca29e698b3a0343d19684ea6b61dc9` |
| O3 | `model-poi.json`, `model-custom-poi.json`: 좌표·주소·분류·이미지·영업시간, 저장 상태 | `ev_15fcc76dd9f7ef8c56694a4d2d32ba3df99735a7bbf0688ce8a29ba5be1ae16d`, `ev_28b554608687a1a38e88ceb107dde049329fcf24f0485eed71830878ac96c2b2` |
| O4 | `model-flight.json`: 항공편·출발/도착·첨부·메모 | `ev_4a50d9d158cf0b9441e0e505b71b1858cf329ff0bb8fac24b3cb4dc30730bf12` |
| O5 | `model-lodging.json`: 숙소 ID·POI·유형 | `ev_a850d32953e9df941187c58f1e39b10d9e06b3db75bc5fb97c4bc394cc8a3664` |
| O6 | `model-expense.json`, `request-expense.json`: `payerUserIds`, `companionIds`, `personal`, `memo`, `media`, `location`, `paymentMethod`, `exchangeRate` | `ev_eff0ec3e0d0340ddab283bc6ccc005a829e23e94ea8e10c2d33841f60935b983`, `ev_9e4e3f7af8af29023f65ce483d37b2596d7d1ff3b376e980b7f88bf0eecb34d5` |
| O7 | `model-checklist.json`, `model-checklist-item.json`, `model-checklist-category.json`: 분류·항목·템플릿·메모 구조 | `ev_a9ead6945501a7772eac7d7be934c031b88a5ca2843c90564054a7a6b1e98852`, `ev_7f90900beb472677ebc0c9288f9a1b2c7f448ae33593a4485dd695353e41f769`, `ev_2c34e2f61aeeda6d1b63c2fab0b76f5d651951297d8302dfb377ddc545fa4f9b` |
| O8 | `model-offline.json`: 지역·다운로드 URL·크기·버전·갱신 시각 | `ev_dfc78e6689e4062cdd2ddd318d9e4948165be3c42b4c5e971268604dd8102bee` |
| R02–R08, R10–R12 | `resources-findings.json`의 해당 finding ID와 그 안의 파일/행/리소스 이름 | `aapt2`/XML 보조 분석. REA Evidence와 구별 |
| R13 | 여행 삭제 | `base-resources.txt:22978`, `string/trip_home_edit_dialog_delete_trip`; `:23237`, `string/trip_planning_more_dialog_delete_trip` |
| R14 | 순서 변경 관련 문구 | `base-resources.txt:19746`, `string/ga_action_trip_planning_dragged_item_drop`. 분석 이벤트 문구만으로 실제 드래그 동작을 검증한 것은 아님 |
| R15 | 체크인-체크아웃 날짜 선택, 숙소 등록 기간 관련 문구 | `base-resources.txt:22272`, `string/select_schedule_description`; `:17553`, `string/error_trip_plan_add_lodging_exceed_max_days` |


도시·분담 금액·달력 UX 확장의 운영 DB 마이그레이션을 적용했다. 상세 검증 범위는 DATABASE.md에 기록한다.

## 모바일 화면 개편 근거 · 2026-10-19

동일 APK 해시를 대조한 추가 정적 확인 결과는 기존 분석 폴더의 `mobile-evidence-independent.json`과 `mobile-evidence-xml-*.txt`에 보존했다. `layout_with_lnb.xml`은 콘텐츠와 하단 고정 내비게이션의 분리를, 여행 홈 레이아웃과 `TripHomeActivity.onCreate`의 REA Evidence `ev_254ba9c76d987826a270206ff01a67d39adb6b4f50e228868af2b3feb41b1e5f`는 SwipeRefreshLayout 참조를 확인한다. 일정의 지도·날짜·목록 분리, 계정 헤더와 설정 진입의 분리도 패키지 리소스에서 확인했다. 원본 화면을 실행해 관찰한 근거와는 구분한다.

TripBoogie의 정확한 5개 하단탭(일정/준비/홈/여행도구/설정), 준비 내 경비, 설정 내 친구·백업 통합, 3→2→1 배열 및 정렬·필터는 사용자가 지정한 설계다. 원본에서 동일한 탭 순서나 모든 동작을 확인했다고 주장하지 않는다.


### 모바일 UX 개편 (2026-10-19)
홈부터 유지되는 하단탭, 준비 내 경비, 주간 Day 선택, 전체 지도와 일정 카드, 체크박스·드래그 핸들 분리, 공통 + 버튼을 반영했다. 트리플 정적 분석의 지도/목록 및 고정 내비게이션 구조와 룩부기 로컬 소스를 참고했으며 정확한 구성·문구는 사용자 요구에 따른 설계다. 자동 거리 정렬과 하루 복사 전용 버튼은 이번 요청에 따라 화면에서 제거했다.

## 2026-10-19 계정·화면 정리

계정 설정과 여행 설정을 분리했다. 여행 동행·백업은 헤더 수정하기, 분류 설정은 준비의 네 번째 탭, 자료함 기능은 예약으로 통합했다. 도시 자동 사진 재시도, 소셜/업로드 프로필 사진, 밝게/어둡게/기기 테마, 항공박을 제외한 박·일 표시를 추가했다. 트리플의 3개 프로필 겹침 자료는 여행 내 일행 UI에서 확인했으며, 홈 카드 겹침 표시는 이를 응용한 트립부기 디자인이다. 원본 앱 홈에 같은 표시가 있었다고 주장하지 않는다.
