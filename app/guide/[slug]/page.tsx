import Link from "next/link";
import { notFound } from "next/navigation";
import StructuredData from "../../seo/StructuredData";
import { findGuide, guides } from "../../seo/guides";
import { absoluteUrl, publicMetadata } from "../../seo/site";
import styles from "../guide.module.css";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return guides.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: Props) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();
  return publicMetadata(guide.title, guide.description, `/guide/${guide.slug}`);
}

export default async function GuidePage({ params }: Props) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();
  const url = absoluteUrl(`/guide/${guide.slug}`);
  return <main id="guide-content" className={styles.articleMain}>
    <StructuredData value={{ "@context": "https://schema.org", "@graph": [
      { "@type": "Article", headline: guide.title, description: guide.description, inLanguage: "ko", mainEntityOfPage: url, author: { "@type": "Organization", name: "트립부기" } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "여행 가이드", item: absoluteUrl("/guide") },
        { "@type": "ListItem", position: 2, name: guide.title, item: url },
      ] },
    ] }} />
    <nav aria-label="현재 위치" className={styles.breadcrumb}><Link href="/guide">여행 가이드</Link><span aria-hidden="true">/</span><span>{guide.category}</span></nav>
    <article><header className={styles.articleHeader}><p className={styles.eyebrow}>{guide.category}</p><h1>{guide.title}</h1><p className={styles.lead}>{guide.intro}</p><p className={styles.byline}>트립부기 가이드</p></header>
      <nav className={styles.toc} aria-label="이 글의 목차"><strong>이 글에서 알아볼 내용</strong><ol>{guide.sections.map((section, index) => <li key={section.title}><a href={`#step-${index + 1}`}>{section.title}</a></li>)}</ol></nav>
      {guide.sections.map((section, index) => <section className={styles.articleSection} id={`step-${index + 1}`} key={section.title}><h2>{section.title}</h2><p>{section.body}</p><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}
      <section className={styles.articleSection}><h2>{guide.example.title}</h2><div className={styles.tableWrap} role="region" aria-label={guide.example.title} tabIndex={0}><table><caption className={styles.hint}>{guide.example.note}</caption><thead><tr>{guide.example.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{guide.example.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className={styles.questions}><h2>자주 묻는 질문</h2>{guide.questions.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>
    </article>
    <aside className={styles.cta}><h2>계획을 우리 여행에 옮겨 보세요</h2><p>여행을 만들고 일정·경비·준비물을 동행과 정리해 보세요.</p><Link className={styles.button} href="/" prefetch={false}>트립부기 앱 열기 <span aria-hidden="true">↗</span></Link></aside>
    <nav className={styles.related} aria-label="다른 여행 가이드"><h2>함께 읽으면 좋은 가이드</h2>{guides.filter(item => item.slug !== guide.slug).map(item => <Link href={`/guide/${item.slug}`} key={item.slug}>{item.title} <span aria-hidden="true">↗</span></Link>)}</nav>
  </main>;
}
