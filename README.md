# Provisionamento de unidades — Desafio Técnico Filazero

Automação que lê uma lista de unidades em CSV, completa o endereço de cada uma
consultando a API pública do [ViaCEP](https://viacep.com.br) e gera o
`provisionamento.json` pronto para alimentar o cadastro das unidades na
plataforma.

**Por que existe:** abrir três unidades é rápido na mão; abrir trinta não é. E o
trabalho manual erra justamente onde dói — endereço trocado, serviço faltando,
slug duplicado. O script resolve o caso pequeno de hoje já preparado para o
volume de amanhã, e principalmente **não morre no meio**: um CEP errado ou a API
fora do ar viram uma linha no relatório, não uma execução perdida.

---

## Como rodar

**Pré-requisito:** Node.js 18 ou superior (usa o `fetch` nativo). Confira com:

```bash
node --version
```

**1. Clone o repositório e entre na pasta**

```bash
git clone https://github.com/guirab734/filazero.git
cd filazero
```

**2. Instale as dependências**

```bash
npm install
```

O projeto **não tem dependências de runtime**, então esse comando não baixa
nada — ele só confere o `package-lock.json`. Se preferir, pode pular direto
para o passo 3.

**3. Rode a automação**

```bash
npm start
```

Ou, equivalente:

```bash
node provisionar.js
```

**4. Confira a saída**

O arquivo `provisionamento.json` é criado na raiz do projeto.

### Apontando para outros arquivos

```bash
node provisionar.js caminho/do/entrada.csv caminho/da/saida.json
```

### Rodando os testes

```bash
npm test
```

---

## O que você vai ver

```
Lendo 3 unidade(s) de "unidades.csv"...

  [ok]    Clínica Vida Aracaju — Rua Boquim, Centro
  [ok]    Clínica Vida Salvador — Rua Miguel Calmon, Comércio
  [ok]    Clínica Vida Recife — Rua do Hospício, Boa Vista

─────────── resumo ───────────
  processadas: 3
  sucesso:     3
  falhas:      0

  arquivo gerado: provisionamento.json
──────────────────────────────
```

Quando alguma unidade falha, ela aparece no resumo com o motivo e o script segue
normalmente:

```
  [falha] Clínica CEP Curto — CEP "4901" é inválido: esperado 8 dígitos, encontrado 4
  [falha] Clínica Inexistente — CEP não encontrado na base do ViaCEP
  [falha] Clínica Offline — ViaCEP indisponível após 3 tentativas (ViaCEP respondeu HTTP 500)

─────────── resumo ───────────
  processadas: 6
  sucesso:     2
  falhas:      4

  não provisionadas:
    - Clínica CEP Curto: CEP "4901" é inválido: esperado 8 dígitos, encontrado 4
    ...

  avisos (provisionadas, mas confira):
    - Clínica Cidade Errada: CSV diz "São Paulo", mas o CEP 49010-390 é de "Aracaju"
```

### Formato do `provisionamento.json`

Uma lista com um objeto por unidade provisionada:

```json
[
  {
    "unidade": "Clínica Vida Aracaju",
    "endereco": {
      "logradouro": "Rua Boquim",
      "bairro": "Centro",
      "cidade": "Aracaju",
      "uf": "SE",
      "cep": "49010-390"
    },
    "servicos": ["Consulta", "Exame", "Retorno"],
    "slug": "clinica-vida-aracaju"
  }
]
```

---

## Organização

```
provisionar.js          entrypoint: orquestra o fluxo e imprime o resumo
src/
  csv.js                parser de CSV
  entrada.js            leitura e validação do arquivo de unidades
  viacep.js             cliente da API, com timeout e retentativa
  modelo.js             slug, formatação de CEP e montagem do registro
tests/
  viacep.test.js        testes da consulta de CEP
unidades.csv            entrada de exemplo (a do enunciado)
resposta-suporte.md     Parte 2 do desafio
```

Cada módulo tem uma responsabilidade só, o que mantém tudo testável sem `fetch`
de verdade. São arquivos pequenos de propósito: para um desafio deste tamanho,
uma arquitetura maior seria enfeite.

---

## Decisões que tomei

**Node.js sem nenhuma dependência de runtime.** O Node 18+ já traz `fetch`, e o
`node:test` já é test runner. Menos dependência é menos superfície para
quebrar, um `npm install` que não baixa nada, e — importante para uma entrega
que vou defender numa conversa — nenhuma linha que eu não saiba explicar.

**Parser de CSV escrito à mão, em vez de biblioteca.** A coluna `servicos` vem
entre aspas (`"Consulta;Exame;Retorno"`). Esse é exatamente o caso em que um
`split(',')` funciona por sorte hoje e quebra amanhã, quando aparecer uma
vírgula dentro do campo — como em `"Clínica Vírgula, Ltda"`. São ~40 linhas que
tratam aspas, aspas escapadas, vírgula e quebra de linha dentro do campo, CRLF e
BOM do Excel.

**Falha permanente e falha transitória são coisas diferentes.** CEP inválido ou
inexistente falha de imediato — repetir não muda a resposta e só gasta tempo com
a clínica esperando. Timeout, erro de rede e HTTP 5xx são retentados 3 vezes com
espera crescente (500ms, 1s), porque instabilidade momentânea de API é comum e
não deveria custar uma unidade.

**Trato o `{"erro": true}` do ViaCEP.** Para um CEP bem formado mas inexistente,
a API responde **HTTP 200** com esse corpo. Quem confia só no status code grava
`logradouro: ""` no arquivo de provisionamento e descobre o problema quando a
unidade já está no ar com endereço vazio. É a armadilha mais fácil de cair nesta
integração e o motivo de ela ter teste dedicado.

**Unidade que falha não entra no `provisionamento.json`.** Escolhi omitir em vez
de gravar com endereço nulo. Um arquivo de provisionamento alimenta um cadastro:
registro incompleto entra silenciosamente no sistema e vira problema do cliente
final, enquanto unidade ausente aparece no resumo e alguém age. Ficar de fora é
visível; ficar dentro pela metade, não.

**Cidade, UF e CEP saem do CSV; o ViaCEP completa logradouro e bairro.** O CSV é
a lista que o cliente mandou provisionar, então ele é a fonte da verdade. Mas
comparo a cidade do CSV com a que o CEP aponta e, se divergirem, a unidade é
provisionada **com um aviso** no resumo. Divergência quase sempre é digitação
errada, e o time precisa saber — sem que isso bloqueie a abertura da unidade.

**Consultas em sequência, não em paralelo.** São três unidades e o ViaCEP é uma
API pública e gratuita; não custa nada ser educado com ela.

**Código de saída.** `1` só quando nada foi provisionado ou o CSV é ilegível.
Sucesso parcial sai com `0` — quem chamar este script de dentro de outra
automação precisa distinguir "rodou e teve problema em uma unidade" de "não
produziu nada".

---

## Limitações conhecidas

**O parser de CSV não é uma implementação completa de RFC 4180.** Cobre o que o
formato do desafio exige e um bom pedaço do que aparece na prática, mas não
trata separador diferente de vírgula (o Excel em português exporta com `;`) nem
codificação diferente de UTF-8 — um arquivo salvo em ANSI vai chegar com acento
corrompido. Se aparecer CSV de origem variada, eu trocaria por `csv-parse`.

**Só a consulta de CEP tem teste.** Foi onde concentrei o bônus por ser a parte
de maior risco. O parser de CSV e o `gerarSlug` ainda não têm cobertura, e são o
que eu escreveria em seguida — o parser especialmente, por ser código meu e não
de biblioteca.

**Slugs não são checados contra duplicidade.** Duas unidades com o mesmo nome
geram o mesmo slug e ninguém percebe. Numa versão de produção eu adicionaria um
sufixo numérico ou usaria cidade + nome na composição.

**O processamento sequencial não escala.** Para as 3 unidades do desafio é
irrelevante; para algumas centenas eu paralelizaria com limite de concorrência
(4 a 8 simultâneas) e um cache dos CEPs já consultados.

**Não há reprocessamento das falhas.** Hoje, unidade que falhou precisa de uma
nova execução do arquivo inteiro. O próximo passo natural seria gravar um
`falhas.json` e aceitar uma flag `--somente-falhas`.

**A validação de CEP é de formato, não de existência.** Oito dígitos passam pela
validação local; se o CEP existe mesmo, quem decide é o ViaCEP.

---

## Sobre o bônus

O enunciado pede no máximo um. Escolhi **testes automatizados**, em
`tests/viacep.test.js`: três testes sobre `consultarCep`, cobrindo sucesso, CEP
inexistente e API fora do ar. Escolhi essa função porque é a única que fala com
o mundo externo — é onde mora o requisito de "o script não pode quebrar", e o
único ponto onde um bug passaria despercebido até chegar no cliente. O `fetch` é
injetado, então os testes rodam offline e sem variação.
