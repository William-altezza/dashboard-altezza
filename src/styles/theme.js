export const theme = {
  // Fundos
  bg:          '#0a1f1a',
  bgDeep:      '#081c18',
  surface:     '#0f2821',
  surfaceHover:'#132d25',
  border:      'rgba(201,169,122,0.15)',
  borderSubtle:'rgba(255,255,255,0.07)',

  // Cores de destaque
  gold:        '#C9A97A',
  goldLight:   '#DFC090',
  goldDim:     'rgba(201,169,122,0.35)',

  // Texto
  textPrimary:   '#F0EDE6',
  textSecondary: '#9BAEA8',
  textMuted:     '#5A7570',

  // Status / variações
  positive: '#4ADE80',
  negative: '#F87171',
  warning:  '#FBBF24',
  info:     '#38BDF8',

  // Paleta gráficos (harmônica com o tema)
  chartColors: [
    '#C9A97A',  // dourado — série principal
    '#4ADE80',  // verde
    '#38BDF8',  // azul-petróleo
    '#A78BFA',  // lavanda
    '#FB923C',  // laranja-areia
    '#F472B6',  // rosa suave
    '#34D399',  // verde-esmeralda
    '#60A5FA',  // azul suave
  ],

  // Funil — cores por etapa
  funnelColors: {
    new:             '#C9A97A',
    in_attendance:   '#38BDF8',
    scheduled_visit: '#A78BFA',
    done_visit:      '#4ADE80',
    created_offer:   '#FB923C',
    converted:       '#34D399',
    lost:            '#F87171',
  },

  // Tipografia
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  fontSizeSm: '11px',
  fontSizeMd: '13px',
  fontSizeLg: '15px',
  fontSizeXl: '22px',
  fontSize2xl:'32px',

  // Espaçamento
  gap:   '12px',
  gapSm: '8px',
  gapLg: '20px',

  // Borda
  radius:   '8px',
  radiusSm: '4px',
  radiusLg: '12px',
}

// CSS variables como string para injetar em :root
export const cssVars = Object.entries(theme)
  .filter(([, v]) => typeof v === 'string')
  .map(([k, v]) => `--${k}: ${v};`)
  .join('\n')
