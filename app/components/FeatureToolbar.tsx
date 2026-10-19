import type { ReactNode } from "react";
import styles from "./FeatureToolbar.module.css";

export default function FeatureToolbar({ children, action, tabs = false, className = "" }: {
  children?: ReactNode;
  action?: ReactNode;
  tabs?: boolean;
  className?: string;
}) {
  return <div className={`${styles.toolbar} ${tabs ? styles.tabs : ""} ${className}`}>
    {children && <div className={styles.context}>{children}</div>}
    {action && <div className={styles.actions}>{action}</div>}
  </div>;
}
