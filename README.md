# Gestão Equipe Amanda

Aplicação Node.js com PostgreSQL. Sem login interno: todas as pessoas com acesso ao endereço podem consultar e alterar os registros.

## Render

Envie package.json, server.mjs, page.html, seed.json e render.yaml para um repositório privado no GitHub. No Render, crie um Blueprint a partir desse repositório. O Blueprint configura a aplicação e o banco de dados. Confira as condições e a validade do plano gratuito de banco no painel do Render antes de confirmar.

Variável obrigatória: DATABASE_URL. Porta: PORT fornecida pelo Render. Comando inicial: npm start.

## Dados e limites desta versão

- 72 unidades da supervisora Amanda no relatório Admin, com supervisora, gerente, cadeiras e efetivações.
- Valores iniciais do relatório sem data confirmada; são identificados como base sem data.
- Upload de relatório Admin em XLSX ou CSV, com prévia e confirmação.
- Texto de avaliações reconhecido pelo código da unidade. Subtotais e linhas incompletas não são importados.
- Antes/depois das 18h são retratos: quando houver ambos, o painel usa o de depois das 18h para não duplicar a contagem.
- Metas por unidade ou supervisão, do dia ou mês. Metas históricas sem referência confirmada não são cadastradas automaticamente.
- Dados compartilhados no PostgreSQL, proteção contra sobrescrita simultânea e backup JSON.
- O histórico antigo das demais abas, regras de classificação Bronze/Prata/Ouro e cálculos de bonificação ainda não foram migrados.
- A leitura XLSX exige navegador moderno com DecompressionStream deflate-raw; CSV é a alternativa.
- Verificação feita: sintaxe JavaScript. Testes de interpretação de avaliações, totais, linhas incompletas, duplicidade entre retratos e CSV concluídos. Execução com banco depende da variável DATABASE_URL.
