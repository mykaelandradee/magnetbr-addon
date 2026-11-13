# MagnetBR Addon (Nuvio / Stremio)

Addon comunitário que consulta os indexadores expostos pelo serviço MagnetBR e apresenta os resultados no formato de streams do Stremio.

## Endpoints

- `/manifest.json` — manifesto do addon.
- `/catalog/movie/magnetbr-search.json?search=matrix` — catálogo de filmes por busca.
- `/catalog/series/magnetbr-search-series.json?search=dark` — catálogo de séries por busca.
- `/stream/movie/tt0133093.json` — streams de filme.
- `/stream/series/tt1234567.json?season=1&episode=2` — streams de episódio.
- `/health` — verificação de saúde.

## Deploy no Render

1. Crie um **Web Service** conectado a este repositório.
2. Runtime: Node.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Plano: Free.
6. Região: Ohio (ou a mais próxima disponível).
7. O `render.yaml` já contém os valores padrão.

Após o deploy, instale no Nuvio/Stremio usando `https://SEU-SERVICO.onrender.com/manifest.json`.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `MAGNETBR_BASE_URL` | `https://magnetbr.flixbr.online` | Serviço agregador |
| `SCRAPER_TYPES` | `db,hybrid,all,starck,rede,tfilme,comand,bludv,torrentclaw` | Indexadores configurados no projeto de origem |
| `REQUEST_TIMEOUT_MS` | `12000` | Timeout por indexador |
| `CACHE_TTL_SECONDS` | `300` | Cache de resultados |

## Limitações conhecidas

- O catálogo só consegue criar cards para resultados que tragam um IMDb ID válido.
- A rota de streams consulta os metadados no Cinemeta para recuperar o título associado ao IMDb ID.
- O projeto de origem documenta os parâmetros e o formato esperado, mas a disponibilidade e a resposta atual do serviço MagnetBR precisam ser verificadas em produção.
- Alguns indexadores podem falhar ou retornar resultados vazios; os demais continuam sendo consultados.
- O serviço não hospeda arquivos. Apenas encaminha links magnet retornados pelo agregador.
