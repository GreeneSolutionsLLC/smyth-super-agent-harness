---
name: data
triggers:
  - data
  - sql
  - postgres
  - analytics
  - etl
  - pipeline
  - csv
  - dataframe
  - pandas
  - polars
  - duckdb
  - chart
  - dashboard
weight: 1.0
---

# Data Skill

When working with data — queries, pipelines, analysis, or viz.

## Process

1. **Inspect the shape first.** Schema, row count, nulls, time range.
   Don't assume the columns mean what their names suggest.
2. **Sample before summarizing.** Cheap queries (`LIMIT 100`) save expensive
   surprises.
3. **Reproducibility beats cleverness.** Save the query, the seed, the
   timestamp.

## SQL

- One statement per code block unless the second is trivial.
- Use parameter binding, never string interpolation, for user values.
- Window functions over self-joins when ranking.
- CTEs over nested subqueries for readability.

## Python

- `polars` over `pandas` for new work — faster, stricter types, no
  SettingWithCopyWarning.
- `duckdb` for anything that fits in memory and wants SQL.
- Don't load a 10M-row CSV into pandas when `pandas.read_csv(..., usecols=...)`
  would do.

## Smyth-specific

- CRM data flows through the `crm_*` MCP tools, not raw SQL.
- Web analytics live in the `zernio_get_analytics` tool.
