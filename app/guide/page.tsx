import Link from "next/link";
import StructuredData from "../seo/StructuredData";
import { guides } from "../seo/guides";
import { absoluteUrl, publicMetadata, site } from "../seo/site";
import styles from "./guide.module.css";

export const metadata = publicMetadata(site.title, site.description, "/guide");

export default function GuideHome() {
  return <main id="guide-content" className={styles.main}>
    <StructuredData value={{ "@context": "https://schema.org", "@graph": [
      { "@type": "WebSite", "@id": `${site.origin}/#website`, name: site.name, url: site.origin, inLanguage: "ko" },
      { "@type": "WebPage", name: site.title, description: site.description, url: absoluteUrl("/guide"), isPartOf: { "@id": `${site.origin}/#website` }, inLanguage: "ko" },
      { "@type": "SoftwareApplication", name: site.name, url: site.origin, applicationCategory: "TravelApplication", operatingSystem: "Web, Android, iOS", description: site.description },
    ] }} />
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>여행을 준비하는 우리만의 공간</p><h1>함께 만드는 여행 일정표,<br />가벼워지는 여행 준비</h1><p className={styles.lead}>지도에 장소를 모으고, 경비를 나누고, 준비물을 체크하세요. 흩어진 여행 계획을 동행과 한곳에서 정리할 수 있어요.</p><Link className={styles.button} href="/" prefetch={false}>트립부기에서 계획 시작하기 <span aria-hidden="true">↗</span></Link><p className={styles.hint}>웹 · Android 앱 · iPhone 홈 화면 웹앱</p></div>
      <div className={styles.sample} aria-label="가상 여행 계획 예시"><p className={styles.eyebrow}>OUR NEXT TRIP</p><h2>우리의 주말 여행</h2><p className={styles.hint}>설명을 위한 예시예요</p><ol><li><span>09:00</span><strong>숙소에서 만나기</strong></li><li><span>11:00</span><strong>박물관 산책</strong></li><li><span>13:00</span><strong>점심 먹고 카페</strong></li></ol><div className={styles.sampleNote}>일정과 지도부터 경비와 준비물까지</div></div>
    </section>
    <section className={styles.section} aria-labelledby="features-title"><p className={styles.eyebrow}>같이 준비하면 더 편하니까</p><h2 id="features-title">여행 준비에 필요한 것들을 한곳에</h2><div className={styles.cards}>
      <div className={styles.card}><span className={styles.number}>01</span><h3>날짜별 일정과 지도</h3><p>가고 싶은 장소와 메모를 날짜별로 정리하고 지도에서 동선을 확인하세요. 예약과 일정을 연결해 관리할 수 있어요.</p></div>
      <div className={styles.card}><span className={styles.number}>02</span><h3>다중 통화 경비와 분담</h3><p>현지 결제 통화와 기준 통화를 함께 보고, 결제자와 동행별 분담 금액을 기록하세요.</p></div>
      <div className={styles.card}><span className={styles.number}>03</span><h3>동행과 공동 준비</h3><p>동행을 초대하고 편집·열람 권한을 나누세요. 개인별·공동 준비물과 예약 확인서를 함께 정리할 수 있어요.</p></div>
    </div></section>
    <section id="guides" className={styles.section} aria-labelledby="guides-title"><p className={styles.eyebrow}>처음 준비하는 여행도 차근차근</p><h2 id="guides-title">여행 계획 가이드</h2><div className={styles.cards}>{guides.map(guide => <Link key={guide.slug} className={styles.card} href={`/guide/${guide.slug}`}><span className={styles.category}>{guide.category}</span><h3>{guide.title}</h3><p>{guide.description}</p><span className={styles.readMore}>가이드 읽기 <span aria-hidden="true">↗</span></span></Link>)}</div></section>
    <section className={styles.questions} aria-labelledby="questions-title"><h2 id="questions-title">시작하기 전에</h2><details><summary>PC와 휴대폰에서 함께 쓸 수 있나요?</summary><p>PC·모바일 브라우저에서 사용할 수 있어요. Android는 서비스의 앱 설치 메뉴에서 APK를 받을 수 있고, iPhone은 Safari에서 홈 화면에 추가할 수 있어요.</p></details><details><summary>여행 내용이 인터넷 검색에 공개되나요?</summary><p>이 가이드는 공개 문서예요. 개인 여행과 초대·인증 화면은 검색 대상에서 제외하며, 여행 데이터 접근은 로그인과 여행 권한으로 관리해요. 초대 링크는 참여할 동행에게만 전달해 주세요.</p></details><details><summary>인터넷 없이 여행 계획을 볼 수 있나요?</summary><p>현재 여행 데이터의 오프라인 열람은 지원하지 않아요. 연결이 어려운 구간에 필요한 예약 확인서는 기기에 별도로 보관해 주세요.</p></details></section>
    <aside className={styles.cta}><h2>다음 여행, 같이 준비해 볼까요?</h2><p>트립부기에서 여행을 만들고 동행을 초대하세요.</p><Link className={styles.button} href="/" prefetch={false}>여행 계획 시작하기 <span aria-hidden="true">↗</span></Link></aside>
  </main>;
}
