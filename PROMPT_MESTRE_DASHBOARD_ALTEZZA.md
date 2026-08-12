# PROMPT MESTRE — Dashboard Altezza Negócios Imobiliários

Construa um dashboard executivo completo para a imobiliária Altezza, substituindo um dashboard quebrado do Looker Studio. Stack: **React + Vite + Recharts**, backend **Supabase** (Postgres + Auth + Edge Functions), deploy na **Vercel**. Interface em português (Brasil), valores em BRL formato `R$ 1.234.567,89`.

## DESIGN — ESTILO POWER BI PREMIUM

Referência: dashboards do Power BI — grade densa de tiles modulares, informação compacta e escaneável, zero espaço desperdiçado. Aplicar com a identidade Altezza:

- **Tema escuro premium**: fundo `#0a1f1a`/`#081c18` (verde profundo), tiles em superfície levemente mais clara com borda sutil, destaque dourado `#C9A97A` para valores-chave e séries principais, paleta secundária harmônica para gráficos (tons de verde, dourado, areia, azul-petróleo). Tipografia limpa (Inter ou similar), números grandes em destaque nos cards.
- **Grade de tiles** responsiva (CSS grid): cards pequenos de KPI (valor grande + variação % vs período anterior com seta ▲▼ verde/vermelha + sparkline discreto), tiles médios com gráficos (donut, barras, linhas), tiles grandes para mapa e cohort. Cada tile com título pequeno em caps + subtítulo da dimensão (ex. "VENDAS · por corretor").
- **Mapa-múndi interativo** (tile grande, como o "Profitability by Country" do Power BI): bolhas por país dimensionadas por leads e coloridas por receita/conversão — essencial, pois o público da Altezza está em 15+ países. Usar react-simple-maps ou similar. Tooltip com leads, vendas, receita, taxa de conversão do país. Clique no país filtra o dashboard.
- **Interatividade cross-filter estilo Power BI**: clicar num corretor, origem, país ou fatia de gráfico filtra os demais tiles da página, com chips visíveis dos filtros ativos e botão "limpar filtros".
- **Micro-detalhes**: skeleton loading nos tiles, transições suaves, hover com elevação sutil, tooltips ricos, formatação compacta de números grandes (R$ 19,6 mi) com valor completo no tooltip.
- Manter tudo legível no celular: em telas pequenas a grade colapsa para 1–2 colunas mantendo a hierarquia.

---

## CONTEXTO DO NEGÓCIO

- Imobiliária focada em pré-lançamentos em Itapema/Porto Belo-SC para brasileiros no exterior. Ticket médio real ~R$ 700 mil. Ciclo de conversão 3–6 meses.
- CRM: C2S (Contact2Sale). Funil: Novo Lead → Em Atendimento → Visita Agendada → Visita Realizada → Proposta → Negócio Fechado / Arquivado.
- Nos dados da API, os estágios aparecem como: `new` / `New lead`, `In attendance`, `Scheduled visit`, `Done visit`, `Created offer`, `converted` (fechado), `lost` (arquivado).
- Corretores atuais: Ricardo Alexandre Werner, Rafaela Nilsen, Ana Caroline, Ermesson, Derci Magnaguagno, Marcelo Falcon, Karina Rauen, William Werner (e outros que possam surgir — nunca hardcodar nomes).
- Origens de lead conhecidas: Instagram Leads, Facebook Leads, CTWA Facebook - Anúncios, CTWA Instagram, CTWA Postagens, C2Sbot, Leads Turbo, Importados da planilha, Indicação (tratar dinamicamente).

## FONTE DE DADOS — API C2S

- Base: `https://api.contact2sale.com/integration/leads`
- Auth: `Authorization: Bearer {C2S_TOKEN}` — token SEMPRE em variável de ambiente / Supabase secret. NUNCA no código do front, NUNCA commitado.
- Paginação: parâmetros `page` e `perpage` (usar o máximo permitido, ex. 50).
- Rate limit: **10 requisições/minuto** — implementar throttle com sleep.
- Filtro incremental: `updated_gte` (ISO8601 `YYYY-MM-DDTHH:MM:SSZ`).
- Estratégia:
  1. **Full load inicial**: script Node (`scripts/full-load.js`) rodado localmente uma vez, percorre todas as páginas respeitando o rate limit e faz upsert no Supabase. Deve ser retomável (salvar progresso) caso caia no meio.
  2. **Sync incremental**: Supabase Edge Function agendada (pg_cron ou Scheduled Function) a cada 15 minutos, buscando `updated_gte` = última sincronização registrada na tabela `sync_log`.
  3. Guardar o payload bruto de cada lead num campo `raw jsonb` para nunca perder informação.

## FONTE DE DADOS — META MARKETING API (investimento automatizado)

O gasto em anúncios deve ser puxado automaticamente da Meta Marketing API — a empresa TROCOU de conta de anúncios recentemente, então o sistema precisa suportar **múltiplas contas** (antiga + nova) para o histórico ficar completo e trocas futuras serem só configuração.

- Endpoint: `GET https://graph.facebook.com/v21.0/act_{AD_ACCOUNT_ID}/insights` com `fields=spend`, `time_increment=1` (diário), `time_range={'since':'YYYY-MM-DD','until':'YYYY-MM-DD'}`.
- Auth: token de **System User** do Business Manager com permissão `ads_read` (longa duração). Guardar em Supabase secret `META_ACCESS_TOKEN`.
- Contas de anúncio cadastradas na tabela `contas_anuncio` (gerenciável pelo Admin — adicionar/desativar conta sem mexer em código). No setup inicial, cadastrar a conta antiga E a nova; fazer backfill diário desde o início do histórico de cada conta.
- Edge Function agendada 1x/dia (madrugada): busca o spend diário dos últimos 7 dias de todas as contas ativas (janela de 7 dias cobre ajustes retroativos do Meta) e faz upsert em `investimentos` com `fonte='api'`.
- Entradas manuais continuam existindo como fallback/correção: para um mesmo mês, se houver dado de API e manual, o dado **manual tem precedência** (é correção consciente) e o Admin exibe aviso de duplicidade. Meses sem API ficam com o manual.
- Tratar erros de token expirado com alerta visível no Admin ("reconectar Meta").

## REGRAS DE LIMPEZA DE DADOS (CRÍTICAS — o dashboard anterior quebrou por causa delas)

1. **Deduplicação por `id_lead`**: a API/exports podem trazer o mesmo lead várias vezes (histórico de status). A tabela `leads` tem UMA linha por `id_lead` (upsert). Mudanças de status viram linhas na tabela `lead_eventos`, com constraint UNIQUE para não duplicar eventos idênticos.
2. **Datas em 3 formatos misturados** nos dados históricos:
   - `2025/11/21 19:54:54`
   - `23/11/2025, 21:11:17`
   - `2025-12-29T06:54:53.000-03:00` (ISO com timezone)
   Criar um parser único que detecta e normaliza os três para `timestamptz`, timezone `America/Sao_Paulo`. Datas não parseáveis → log de erro em tabela `data_quality_issues`, nunca falha silenciosa.
3. **País/região a partir do telefone**: NÃO usar os 2 primeiros dígitos (bug anterior: EUA +1774... virava "região 17"). Usar `libphonenumber-js` para extrair o país correto (+1 EUA/Canadá, +44 UK, +353 Irlanda, +41 Suíça, +39 Itália, +351 Portugal, +49 Alemanha, +32 Bélgica, +34 Espanha, +47 Noruega, +55 Brasil, etc.). Guardar `pais_iso` (ex. "US") e `regiao` agrupada: **Brasil / América do Norte / Europa / Outros**.
4. **Valores monetários em formatos mistos**: `1.050.000,00` (BR) e `531325.00` (US). Parser que detecta e normaliza para numeric.
5. **Atribuição de corretor**: o lead pode trocar de corretor. O corretor "dono" para métricas é o do evento mais recente (ou o do fechamento, se fechado). Manter histórico em `lead_eventos.corretor`.
6. **Registros corrompidos** (mesmo id com nomes de clientes diferentes): logar em `data_quality_issues` e usar o registro mais recente.

## SCHEMA SUPABASE (com RLS)

```sql
-- Uma linha por lead (upsert por id_lead)
create table leads (
  id_lead text primary key,
  data_entrada timestamptz not null,
  origem text,
  canal text,
  nome_cliente text,
  telefone text,
  pais_iso text,
  regiao text,                 -- Brasil | América do Norte | Europa | Outros
  corretor text,               -- atribuição atual (regra 5)
  status_atual text,           -- Novo | Em negociação | Negócio fechado | Arquivado
  funnel_status_atual text,    -- new | in_attendance | scheduled_visit | done_visit | created_offer
  tags text[],
  valor_potencial numeric,
  done_deal_at timestamptz,    -- data do fechamento
  valor_venda numeric,         -- editável no admin (done_price da API quando existir)
  arquivado boolean default false,
  motivo_arquivamento text,
  foi_recuperado boolean default false,   -- regra de recuperação abaixo
  data_recuperacao timestamptz,
  empreendimento text,         -- product_description
  created_at_c2s timestamptz,
  updated_at_c2s timestamptz,
  raw jsonb,
  synced_at timestamptz default now()
);

-- Histórico de mudanças de estágio (para velocidade entre etapas e funil)
create table lead_eventos (
  id bigint generated always as identity primary key,
  id_lead text references leads(id_lead),
  status text,
  funnel_status text,
  corretor text,
  data_evento timestamptz not null,
  unique (id_lead, funnel_status, data_evento)
);

-- Investimento em mídia: API do Meta (diário, por conta) + entradas manuais (mensais, fallback/correção)
create table contas_anuncio (
  id text primary key,         -- act_XXXXXXXXX
  nome text,                   -- ex: "Conta Antiga", "Conta Nova Altezza"
  ativa boolean default true,
  criado_em timestamptz default now()
);

create table investimentos (
  id bigint generated always as identity primary key,
  data date not null,          -- dia (fonte api) ou primeiro dia do mês (fonte manual)
  canal text not null default 'Meta Ads',
  conta_id text references contas_anuncio(id),
  valor numeric not null,
  fonte text not null check (fonte in ('api','manual')),
  unique (data, canal, conta_id, fonte)
);
-- Regra de agregação: para cada mês, se existir entrada manual, ela prevalece sobre a soma da API naquele mês (correção consciente).

create table custos (
  id bigint generated always as identity primary key,
  mes date not null,
  tipo text not null check (tipo in ('fixo','variavel')),
  descricao text,
  valor numeric not null
);

create table metas (
  chave text primary key,      -- ex: 'pct_compradores_que_indicam' = 40, 'pct_conversao_indicacao' = 50
  valor numeric
);

create table sync_log (
  id bigint generated always as identity primary key,
  tipo text,                   -- full_load | incremental
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  registros integer,
  ultimo_updated_gte timestamptz,
  status text,
  erro text
);

create table data_quality_issues (
  id bigint generated always as identity primary key,
  id_lead text,
  problema text,
  detalhe jsonb,
  criado_em timestamptz default now()
);
```

Habilitar RLS em tudo: leitura para usuários autenticados; escrita em `investimentos`, `custos`, `metas`, `leads.valor_venda` apenas para role admin. Edge Function usa service role.

**Regra de recuperação** (item 7 da spec original): um lead é "recuperado" quando teve evento de arquivamento (`lost`/Arquivado) e DEPOIS um novo evento ativo (Em negociação ou superior). Marcar `foi_recuperado = true` e `data_recuperacao`. Métricas: total de arquivados → quantos recuperados → quantos recuperados fecharam.

## MÉTRICAS — FÓRMULAS EXATAS

Todas respeitam o filtro de período ativo (leads contados por `data_entrada`; vendas por `done_deal_at` — exceto no cohort, que cruza os dois).

**Cards principais (Visão Geral):**
- Leads totais = count distinct id_lead no período
- Vendas = count leads com done_deal_at no período
- Receita (VGV) = sum(valor_venda) das vendas do período
- Investimento = sum(investimentos) do período
- CPL = Investimento ÷ Leads totais
- CAC = Investimento ÷ Vendas
- ROAS = Receita de vendas cujo lead veio de origem paga (Instagram/Facebook/CTWA/Turbo) ÷ Investimento
- ROI = (Receita total − Custos totais) ÷ Custos totais, onde Custos totais = fixos + variáveis + investimento em mídia do período. Se não houver custos cadastrados no período, exibir "—" com tooltip "cadastre custos no Admin" (nunca mostrar número errado)
- Ticket médio = Receita ÷ Vendas
- Taxa de conversão = Vendas ÷ Leads totais
- Tempo médio de conversão = média(done_deal_at − data_entrada) em dias, das vendas do período; mostrar também lead mais rápido e mais demorado (com nome do cliente e corretor)
- Pipeline em aberto = leads ativos por etapa do funil, com quantidade e sum(valor_potencial) por etapa

**Indicações** (comparar com metas da tabela `metas`):
- % de compradores que indicaram = compradores com indicação vinculada ÷ total de compradores
- % de vendas vindas de indicação = vendas com origem/tag Indicação ÷ total de vendas

**Recuperação de arquivados:** arquivados totais → recuperados → recuperados que fecharam (com taxa em cada passo).

**Por corretor** (tabela comparativa + card por corretor):
- Leads recebidos, investimento direcionado = CPL geral × leads do corretor, CPL, vendas, taxa de conversão, CAC, receita, ticket médio, tempo médio de conversão, valor potencial em pipeline, contagem por etapa do funil (todas as 6 etapas — não só Novo/Negociação/Vendas).
- **Validação obrigatória:** a soma de leads e vendas por corretor DEVE bater com os totais gerais. Leads sem corretor entram numa linha "Sem atribuição". Escrever teste automatizado disso.

**Por origem:** leads, CPL, investimento, vendas, taxa de conversão, CAC, receita, ROAS, ticket médio, tempo médio, valor potencial. Destaque visual para a origem mais rentável.

**Por região:** mesmo conjunto, agrupado por Brasil / América do Norte / Europa / Outros, com detalhamento por país.

**Cohort (mês de entrada × mês de fechamento):** matriz com meses SEMPRE em ordem cronológica, linha = mês de entrada, coluna = mês de fechamento, célula = nº de vendas (tooltip com valor). Linha de total. Incluir leituras derivadas: vendas fechadas no mesmo mês da entrada, fechadas de meses anteriores, e leads do período ainda em aberto.

**Velocidade entre etapas:** tempo médio de cada transição (Novo→Atendimento, Atendimento→Visita Agendada, Agendada→Realizada, Realizada→Proposta, Proposta→Fechado), geral e por corretor, calculado a partir de `lead_eventos`.

**Heatmap de cadastros:** dia da semana × hora (horas em ordem cronológica 0–23, NUNCA ordenadas por volume), com filtro por região para ver horários de cada público.

## PÁGINAS DO APP

1. **Visão Geral** — cards de KPIs, funil geral, pipeline por etapa, indicações, recuperação
2. **Corretores** — tabela comparativa + cards individuais com funil completo
3. **Origens & Regiões** — tabelas + gráficos de rentabilidade
4. **Cohort & Ciclo** — matriz cohort, velocidade entre etapas, mais rápido/mais lento
5. **Leads** — tabela geral pesquisável (cliente, corretor, origem, país, entrada, fechamento, dias de conversão, valor), com export CSV
6. **Heatmap** — dia/hora por região
7. **Admin** (apenas admins) — gestão de contas de anúncio do Meta (adicionar/trocar/desativar conta + botão de backfill histórico), visão de cobertura do investimento por mês (API vs manual, com alertas de duplicidade ou meses vazios), entradas manuais de investimento, custos fixos/variáveis, metas, edição de valor_venda de vendas fechadas (backfill), status das sincronizações C2S e Meta (última execução, registros, erros, alerta de token expirado), tabela de data_quality_issues

**Filtros globais** (persistem entre páginas): período (presets: este mês, mês passado, últimos 3/6/12 meses, este ano, personalizado), corretor, origem, status.

## AUTENTICAÇÃO

Supabase Auth com e-mail/senha. Dois papéis: `admin` (William, Eduardo) e `viewer` (Ricardo e demais). Papel em `user_metadata` ou tabela `perfis`. Viewers não veem a página Admin.

## QUALIDADE / TESTES

- Testes unitários do parser de datas (3 formatos), parser de moeda (2 formatos) e extração de país por telefone.
- Teste de reconciliação: soma por corretor = total geral; soma por origem = total geral.
- Loading states e tratamento de erro em todas as queries.
- Responsivo (William acompanha pelo celular).

## VARIÁVEIS DE AMBIENTE

```
C2S_TOKEN=                  # Bearer token da API C2S (Supabase secret para a Edge Function; .env local só para o full load)
META_ACCESS_TOKEN=          # Token de System User do Business Manager, permissão ads_read (Supabase secret)
SUPABASE_URL=
SUPABASE_ANON_KEY=          # front
SUPABASE_SERVICE_ROLE_KEY=  # apenas scripts/Edge Function, nunca no front
```

## ORDEM DE EXECUÇÃO SUGERIDA

1. Criar projeto Supabase + rodar o schema SQL + RLS
2. Escrever e testar os parsers (datas, moeda, telefone) com os exemplos das regras de limpeza
3. Script de full load do C2S com throttle e retomada
4. Edge Function de sync incremental C2S + agendamento
5. Edge Function de sync diário do Meta (multi-conta) + script de backfill histórico do spend
6. Front: layout Power BI (grade de tiles, tema, cross-filter), auth e filtros globais
7. Páginas 1–7 na ordem (mapa-múndi incluso na página Origens & Regiões ou na Visão Geral)
8. Testes de reconciliação
9. Deploy Vercel + secrets
