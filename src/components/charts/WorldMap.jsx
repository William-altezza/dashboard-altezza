import { useState } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps'
import { scaleLinear } from 'd3-scale'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// ISO 3166-1 alpha-2 → alpha-3 (subconjunto relevante)
const ISO2_TO_3 = {
  BR:'076', US:'840', CA:'124', GB:'826', IE:'372', CH:'756', IT:'380',
  PT:'620', DE:'276', BE:'056', ES:'724', NO:'578', FR:'250', NL:'528',
  AT:'040', SE:'752', DK:'208', FI:'246', PL:'616', LU:'442',
  AU:'036', NZ:'554', MX:'484', AR:'032', CL:'152', CO:'170', PE:'604',
  JP:'392', SG:'702', AE:'784', ZA:'710', GG:'831', JE:'832',
}

export function WorldMap({ data, onCountryClick }) {
  const [tooltip, setTooltip] = useState(null)

  // data: Array<{ pais_iso, leads, vendas, receita, taxa_conv }>
  const maxLeads = Math.max(...(data || []).map(d => d.leads), 1)
  const colorScale = scaleLinear()
    .domain([0, maxLeads])
    .range(['#1a3d35', '#C9A97A'])

  const dataByIso2 = {}
  for (const d of (data || [])) {
    if (d.pais_iso) dataByIso2[d.pais_iso] = d
  }

  function getIso3(iso2) {
    return ISO2_TO_3[iso2] || null
  }

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <ComposableMap
        projection="geoMercator"
        style={{ background: 'transparent', width: '100%', height: '100%' }}
        height={260}
      >
        <ZoomableGroup center={[0, 20]} zoom={1}>
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => {
                // world-atlas usa numeric ISO 3166-1 no campo id
                const numericId = String(geo.id).padStart(3, '0')
                const iso2 = Object.entries(ISO2_TO_3).find(([, v]) => v === numericId)?.[0]
                const countryData = iso2 ? dataByIso2[iso2] : null
                const fill = countryData
                  ? colorScale(countryData.leads)
                  : '#132d25'

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#0a1f1a"
                    strokeWidth={0.4}
                    style={{
                      default:  { outline: 'none' },
                      hover:    { outline: 'none', fill: countryData ? '#DFC090' : '#1e4035', cursor: countryData ? 'pointer' : 'default' },
                      pressed:  { outline: 'none' },
                    }}
                    onMouseEnter={e => {
                      if (countryData) {
                        setTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          data: countryData,
                          iso2,
                        })
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => {
                      if (countryData && onCountryClick) {
                        onCountryClick(iso2)
                      }
                    }}
                  />
                )
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 12,
          top: tooltip.y - 8,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '8px 12px',
          fontSize: 11,
          color: 'var(--text-primary)',
          pointerEvents: 'none',
          zIndex: 999,
          minWidth: 140,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>
            {tooltip.iso2}
          </div>
          <div>Leads: <b>{tooltip.data.leads}</b></div>
          <div>Vendas: <b>{tooltip.data.vendas}</b></div>
          {tooltip.data.receita > 0 && (
            <div>Receita: <b>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(tooltip.data.receita)}</b></div>
          )}
          {tooltip.data.taxa_conv != null && (
            <div>Conversão: <b>{(tooltip.data.taxa_conv * 100).toFixed(1)}%</b></div>
          )}
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
            Clique para filtrar
          </div>
        </div>
      )}
    </div>
  )
}
