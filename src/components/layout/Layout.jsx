import { Sidebar } from './Sidebar'
import { FilterBar } from './FilterBar'
import styles from './Layout.module.css'

export function Layout({ children }) {
  return (
    <div className={styles.root}>
      <Sidebar />
      <div className={styles.main}>
        <FilterBar />
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  )
}
