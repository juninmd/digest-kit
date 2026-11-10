# Benchmark

Medição antes/depois da revisão de arquitetura e desempenho da 0.5.0. Todos os
números desta página foram medidos; nenhum foi estimado. Os arquivos brutos de
cada execução estão em [`bench/results/`](../bench/results).

## Como rodar

```bash
bun run bench                         # imprime a tabela
bun run bench --json saida.json       # salva os números brutos
bun run bench --filter store          # só os casos cujo nome contém "store"
bun run bench:compare antes.json depois.json
```

O benchmark não usa rede nem relógio: as entradas saem de um gerador
pseudoaleatório com semente fixa (`bench/fixtures.ts`), então os bytes são os
mesmos em toda execução. Ele importa a biblioteca só pela entrada pública
(`src/index.ts`), por isso o mesmo arquivo mede qualquer revisão de `src/`.

## Método

- **Antes:** commit `c74340d`, cujo `src/` é idêntico ao da 0.4.0 (`f87520d`); o
  commit só acrescenta o diretório `bench/`.
- **Depois:** `src/` do commit `24bbcd1`. Depois dele a única mudança em `src/`
  foi uma linha do texto de ajuda (`--status` em `src/agent/args.ts`), fora de
  qualquer caminho medido.
- As duas árvores rodaram o mesmo `bench/` (o desta revisão), na mesma máquina,
  intercaladas: antes, depois, antes, depois, antes, depois. São três execuções
  completas por lado.
- Cada caso coleta 25 amostras depois de aquecer. Casos rápidos rodam em lote
  (calibrado para ~20 ms por amostra) e reportam tempo por chamada; casos que
  precisam de estado novo a cada chamada (ingestão num banco vazio, por exemplo)
  têm a preparação fora da região cronometrada e uma chamada por amostra.
- O valor da tabela é a **mediana das três medianas**. Uma diferença só é
  marcada como ganho ou perda quando passa de 1,25x **e** nenhuma das três
  execuções de um lado se sobrepõe a alguma do outro. O resto é "same (within
  noise)".
- As entradas giram por um conjunto de variantes. Com uma única string
  constante o JIT elimina a chamada: a primeira versão do benchmark "media" uma
  varredura de regex em 4 KB em 4 ns.

### Máquina e ressalvas

| | |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz, 4 vCPUs |
| Memória | 16 GB |
| SO | Ubuntu 24.04, Linux 6.18, x64 |
| Runtime | Bun 1.4.4 |
| Data | 2026-11-10 |

- É uma VM compartilhada. Entre execuções idênticas o mesmo caso variou até
  ~40% (por exemplo `extractArticleFromHtml` de 30 KB: 10,8 / 15,0 / 13,7 ms
  no lado "antes"). Os valores absolutos não valem para outra máquina; o que
  interessa é a razão entre as colunas.
- Os casos "file DB" dependem da latência de `fsync` do disco, que nesta VM
  oscila muito. Para eles a evidência mais firme é a contagem de chamadas de
  sincronização (seção seguinte), que não depende do disco.

## Resultado

| Case | Before | After | Change |
|---|---:|---:|---|
| text.clean: 280-char plain snippet | 1.12 µs | 582.9 ns | **1.93x faster** |
| text.clean: 2 KB HTML body | 8.38 µs | 1.15 µs | **7.28x faster** |
| text.clean: 64 KB HTML body | 247.30 µs | 768.2 ns | **321.93x faster** |
| text.clean: 64 KB plain text (full-content feed) | 248.73 µs | 569.0 ns | **437.12x faster** |
| text.idFor: one link | 451.3 ns | 510.0 ns | same (within noise) |
| text.formatItems: 12 items | 1.96 µs | 1.91 µs | same (within noise) |
| text.splitMessage: 16 KB digest | 9.03 µs | 7.45 µs | same (within noise) |
| json.extractJsonObject: fenced JSON in prose | 1.42 µs | 1.42 µs | same (within noise) |
| json.extractJsonObject: fenced JSON + 12 braces in trailing prose | 22.70 µs | 3.93 µs | **5.78x faster** |
| json.extractJsonObject: no JSON, 40 stray braces | 24.90 µs | 26.09 µs | same (within noise) |
| prose.hasEnglishSentence: 4 KB pt-BR | 27.67 µs | 28.06 µs | same (within noise) |
| prose.looksGarbled: 4 KB pt-BR | 1.52 µs | 1.61 µs | same (within noise) |
| prose.isPollutedProse: 4 KB pt-BR | 9.78 µs | 10.24 µs | same (within noise) |
| net.isSafeExternalUrl: 8 URLs | 3.30 µs | 3.25 µs | same (within noise) |
| extract.extractArticleFromHtml: 30 KB article page | 13.71 ms | 10.46 ms | same (within noise) |
| extract.extractArticleFromHtml: 3 KB fragment | 1.41 ms | 1.22 ms | same (within noise) |
| feeds.parse (rss-parser): 50-item RSS, 190 KB | 3.33 ms | 3.25 ms | same (within noise) |
| agent.ingest: 20 feeds x 50 new items (:memory:) | 13.45 ms | 6.45 ms | **2.09x faster** |
| agent.ingest: 20 feeds x 50 new items (file DB, WAL) | 214.72 ms | 22.52 ms | **9.53x faster** |
| agent.ingest: 20 feeds x 50 items already stored (:memory:) | 12.43 ms | 4.58 ms | **2.71x faster** |
| agent.ingest: 20 feeds x 50 items already stored (file DB, WAL) | 13.62 ms | 4.88 ms | **2.79x faster** |
| store.pendingItems(12): 50k rows, 1k pending | 22.03 µs | 20.10 µs | same (within noise) |
| store.markDigested: 12 ids (100k rows, :memory:) | 22.96 µs | 14.45 µs | **1.59x faster** |
| vector: store 500 x 384d embeddings (:memory:) | 7.78 ms | 6.18 ms | **1.26x faster** |
| vector: store 200 x 384d embeddings (file DB, WAL) | 70.06 ms | 7.16 ms | **9.79x faster** |
| vector.upsert: replace one 384d row (1k rows, :memory:) | 33.54 µs | 16.15 µs | **2.08x faster** |
| vector.search k=5: 5k x 384d | 2.04 ms | 2.06 ms | same (within noise) |
| vector.hasSimilar: 5k x 384d | 1.81 ms | 2.01 ms | same (within noise) |

Resumo: 13 casos mais rápidos, 15 iguais dentro do ruído, nenhum mais lento.

### Sincronizações de disco

Contadas com `strace` sobre `bench/sync-count.ts` (chamadas `fsync`/`fdatasync`
entre os dois marcadores do script), uma execução por lado:

| Carga | Antes | Depois |
|---|---:|---:|
| `ingest`: 20 feeds x 50 itens novos, banco em arquivo | 1009 | 20 |
| `vector`: gravar 200 embeddings de 384 dimensões, banco em arquivo | 203 | 1 |

```bash
strace -f -e trace=fsync,fdatasync,write -o trace.txt bun bench/sync-count.ts ingest
awk '/MARK-START/{on=1} /MARK-END/{on=0} on && /sync\(/{n++} END{print n+0}' trace.txt
```

## De onde vem cada ganho

| Caso | Mudança |
|---|---|
| `text.clean` | Eram quatro passadas de regex sobre a entrada inteira para guardar 500 caracteres. Agora é uma passada que para quando o limite enche (`src/util/text.ts`). O ganho cresce com a entrada: feeds de conteúdo completo entregam o artigo inteiro como resumo. |
| `json.extractJsonObject` com chaves depois do JSON | Cada `}` na prosa final custava um `JSON.parse` falho do candidato inteiro. Agora o fim do objeto é achado por uma varredura que pula strings (`src/util/json.ts`). O caso comum (sem chaves em volta) continua indo direto ao parser nativo e ficou igual. |
| `agent.ingest` em arquivo | Um commit por item virou um commit por feed (`Store.insertItems`). É a linha 1009 -> 20 acima. |
| `agent.ingest` em memória e itens já gravados | Aqui não há `fsync`. As mesmas duas mudanças valem (lote numa transação e `clean` mais barato; metade dos feeds do cenário é de conteúdo completo), sem medição separada de quanto cabe a cada uma. |
| `store.markDigested` | Um `UPDATE` com `json_each` no lugar de doze, e o índice parcial: marcar um item passou a apagar uma entrada do índice em vez de movê-la. |
| `vector` (gravar lote) | `upsertMany`: uma transação para o lote. |
| `vector.upsert` | `UPDATE` no lugar e `INSERT` só quando a linha não existe, em vez de `DELETE` + `INSERT`. |

## O que não mudou

- `pendingItems`: já usava o índice e o `db.query` do Bun já guarda o statement
  preparado. O statement agora é preparado uma vez por clareza; sem ganho medido.
- `vector.search` / `hasSimilar`: o tempo é a busca exata dentro do sqlite-vec.
- `feeds.parse`, `extractArticleFromHtml`: o tempo está nas dependências
  (rss-parser, Readability, Turndown). Medido por fase na página de 30 KB:
  parse ~1,5 ms, Readability ~6,5 ms, Turndown ~2,5 ms.
- `idFor`, `formatItems`, `splitMessage`, `isSafeExternalUrl` e os detectores de
  `prose`: sem mudança de código.

## Tentado e descartado

Medições pontuais feitas durante a revisão, com scripts avulsos que não ficaram
no repositório. Entram aqui para ninguém repetir o experimento.

| Experimento | Medido | Decisão |
|---|---|---|
| `hasEnglishSentence` com uma regex combinada e saída antecipada | 28,4 -> 24,7 µs numa rodada, 31,3 -> 30,0 µs na outra | Descartado: dentro do ruído. O custo é a alternância da regex, não as alocações. |
| Reaproveitar a instância do `TurndownService` | construir uma custa ~0,01 ms numa chamada de ~10 ms | Descartado. |
| Entregar ao Turndown o nó DOM do Readability em vez do HTML serializado | 11,0 e 10,2 ms (string) contra 12,4 e 10,8 ms (nó) | Descartado: não é mais rápido. |
| `crypto.hash` de chamada única no `idFor` | 440 -> 226 ns | Não adotado: só existe no Node >= 21.7, e o pacote aceita Node 20; exigiria um caminho alternativo que os testes daqui não exercitam, para 0,2 µs por item. |
| Varredura de chaves sem tentar antes o parser nativo | caso comum 1,36 -> 2,27 µs (mais lento) | Substituído pela versão atual, que tenta o intervalo mais largo primeiro. |
| `upsert` vetorial como `DELETE` + `INSERT` dentro de transação | 28,7 -> 36,6 µs em memória (mais lento) | Substituído por `UPDATE` + `INSERT` condicional (16,2 µs na tabela). |
| Remover o boilerplate do HTML com um seletor só | etapa isolada: 337-451 µs -> 143-219 µs | Mantido por ser código mais simples. De ponta a ponta fica dentro do ruído; por isso a tabela não marca ganho em `extract`. |

O índice parcial também reduz o arquivo: num experimento com 200 mil itens
(resumos de 280 caracteres) o banco passou de 100.691.968 para 93.171.712 bytes.

## Reproduzir a comparação

```bash
git worktree add ../digest-kit-antes c74340d
cp bench/*.ts ../digest-kit-antes/bench/
(cd ../digest-kit-antes && bun install --frozen-lockfile)

for i in 1 2 3; do
  (cd ../digest-kit-antes && bun run bench/run.ts --json "$OLDPWD/antes-$i.json")
  bun run bench --json "depois-$i.json"
done
bun run bench:compare --before antes-*.json --after depois-*.json
```
