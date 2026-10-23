import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import styles from './Sidebar.module.css'

const NAV_ITEMS = [
  { to: '/',              label: 'Visão Geral',       icon: '◼' },
  { to: '/corretores',    label: 'Corretores',         icon: '◉' },
  { to: '/origens',       label: 'Origens & Regiões',  icon: '◈' },
  { to: '/cohort',        label: 'Cohort & Ciclo',     icon: '◧' },
  { to: '/leads',         label: 'Leads',              icon: '◫' },
  { to: '/heatmap',       label: 'Heatmap',            icon: '▦' },
  { to: '/campanhas',     label: 'Campanhas Meta',     icon: '◎' },
  { to: '/duplicados',    label: 'Duplicados',         icon: '⧉' },
]

const ADMIN_NAV = { to: '/admin', label: 'Admin', icon: '⚙' }

export function Sidebar() {
  const { isAdmin, signOut, user } = useAuth()

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoMark}>▲</span>
        <span className={styles.logoText}>Altezza</span>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink
            to={ADMIN_NAV.to}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''} ${styles.adminItem}`
            }
          >
            <span className={styles.icon}>{ADMIN_NAV.icon}</span>
            <span className={styles.navLabel}>{ADMIN_NAV.label}</span>
          </NavLink>
        )}
      </nav>

      <div className={styles.footer}>
        <div className={styles.userEmail}>{user?.email}</div>
        <button className={styles.signOut} onClick={signOut}>Sair</button>
      </div>
    </aside>
  )
}
