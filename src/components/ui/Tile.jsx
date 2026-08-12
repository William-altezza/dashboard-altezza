import styles from './Tile.module.css'

export function Tile({ title, subtitle, children, className = '', span = 1, onClick }) {
  return (
    <div
      className={`${styles.tile} ${className} ${onClick ? styles.clickable : ''}`}
      style={{ gridColumn: `span ${span}` }}
      onClick={onClick}
    >
      {(title || subtitle) && (
        <div className={styles.header}>
          {title && <span className={styles.title}>{title}</span>}
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
}
