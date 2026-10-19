import Image from "next/image";
import {LoaderCircle} from "lucide-react";
import styles from "./LaunchScreen.module.css";
export default function LaunchScreen(){
 return <div className={styles.screen}><div className={styles.brand} role="status" aria-label="트립부기 시작"><Image className={styles.art} src="/launch-splash.png" width={502} height={1155} sizes="100vw" unoptimized alt="트립부기" loading="lazy"/></div><div className={styles.refresh} role="status" aria-label="불러오는 중"><LoaderCircle size={25}/></div></div>;
}
