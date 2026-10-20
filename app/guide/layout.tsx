import Link from "next/link";
import styles from "./guide.module.css";

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.site}>
    <a className={styles.skip} href="#guide-content">본문으로 건너뛰기</a>
    <header className={styles.header}>
      <Link className={styles.brand} href="/guide">트립부기 <span>TripBoogie</span></Link>
      <nav aria-label="가이드 메뉴"><Link href="/guide#guides">여행 가이드</Link><Link className={styles.button} href="/" prefetch={false}>앱 열기 <span aria-hidden="true">↗</span></Link></nav>
    </header>
    {children}
    <footer className={styles.footer}><p>느긋하게, 함께. 트립부기</p><div><Link href="/guide">서비스와 여행 가이드</Link><Link href="/" prefetch={false}>여행 계획 시작하기</Link></div></footer>
  </div>;
}
