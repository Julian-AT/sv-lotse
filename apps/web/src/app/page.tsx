import { cookies } from "next/headers";
import { shellCopy } from "../features/shell/copy.ts";
import styles from "../features/shell/shell.module.css";

export default async function HomePage() {
  const language = (await cookies()).get("lotse_language")?.value === "en" ? "en" : "de";
  const copy = shellCopy[language];
  return (
    <section className={styles.welcome} aria-labelledby="welcome-title">
      <p className={styles.eyebrow}>{copy.eyebrow}</p>
      <h1 id="welcome-title">{copy.title}</h1>
      <p className={styles.introduction}>{copy.introduction}</p>
      <div className={styles.sessionNote}>
        <p>{copy.privacy}</p>
      </div>
      <p className={styles.boundary}>{copy.boundary}</p>
    </section>
  );
}
