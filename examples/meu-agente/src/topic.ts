import { defineTopic } from "@juninmd/digest-kit";

// Este é o ÚNICO arquivo que um agente precisa escrever.
export const topic = defineTopic({
  name: "meu-agente",
  title: "Meu Agente",
  emoji: "📰",
  subject: "novidades de tecnologia",
  systemPrompt: `Você é um curador que resume novidades de tecnologia para desenvolvedores.

Regras do digest:
- Responda SEMPRE em português do Brasil.
- Formato: lista enxuta em Markdown, um item por notícia.
- Para cada item: título curto em *negrito*, 1 frase de resumo e o link.
- Descarte itens irrelevantes, duplicados ou puramente promocionais.
- Comece com uma linha de destaque do dia. Seja direto, sem enrolação.`,
  feeds: [
    { name: "Hacker News", url: "https://hnrss.org/frontpage" },
    { name: "GitHub Blog", url: "https://github.blog/feed/" },
  ],
});
