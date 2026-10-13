import styles from "./Logo.module.css";

export function Logo() {
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="thule-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8f7bff" />
            <stop offset="1" stopColor="#ff5f9e" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#thule-logo)" />
        <path
          d="M9 19v-6M13 23V9M17 20v-8M21 24V8M25 18v-4"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      <span className={styles.name}>Thule</span>
    </span>
  );
}
