# Provisionamento de unidades, Desafio Técnico Filazero

Automação que lê uma lista de unidades em CSV, completa o endereço de cada uma
consultando a API pública do [ViaCEP](https://viacep.com.br) e gera o
`provisionamento.json` pronto para alimentar o cadastro das unidades na
plataforma.

**Por que existe:** abrir três unidades é rápido na mão; abrir trinta não é. E o
trabalho manual erra justamente onde dói: endereço trocado, serviço faltando,
slug duplicado. O script resolve o caso pequeno de hoje já preparado para o
volume de amanhã, e principalmente **não morre no meio**. Um CEP errado ou a API
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

**2. Rode a automação**

```bash
npm start
```

Ou, equivalente:

```bash
node provisionar.js
```

Não precisa de `npm install`: o projeto não tem nenhuma dependência.

**3. Confira a saída**

O arquivo `provisionamento.json` é criado na raiz do projeto.

### Apontando para outros arquivos

```bash
node provisionar.js entrada.csv saida.json
```

### Rodando os testes

```bash
npm test
```

---

## O que você vai ver

```
Lendo 3 unidade(s) de "unidades.csv"...

  [ok]    Clínica Vida Aracaju: Rua Boquim, Centro
  [ok]    Clínica Vida Salvador: Rua Miguel Calmon, Comércio
  [ok]    Clínica Vida Recife: Rua do Hospício, Boa Vista

=========== resumo ===========
  processadas: 3
  sucesso:     3
  falhas:      0

  arquivo gerado: provisionamento.json
==============================
```

Quando alguma unidade falha, ela aparece no resumo com o motivo e o script segue
normalmente:

```
  [falha] Clínica CEP Curto: CEP "4901" inválido: esperado 8 dígitos, encontrado 4
  [falha] Clínica Inexistente: CEP não encontrado na base do ViaCEP
  [falha] Clínica Offline: ViaCEP indisponível após 3 tentativas
  [falha] linha 5: linha sem a coluna "nome" preenchida

=========== resumo ===========
  processadas: 6
  sucesso:     2
  falhas:      4

  não provisionadas:
    - Clínica CEP Curto: CEP "4901" inválido: esperado 8 dígitos, encontrado 4
    - Clínica Inexistente: CEP não encontrado na base do ViaCEP
    - Clínica Offline: ViaCEP indisponível após 3 tentativas
    - linha 5: linha sem a coluna "nome" preenchida
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
provisionar.js          o script inteiro
provisionar.test.js     testes da consulta de CEP
unidades.csv            entrada de exemplo (a do enunciado)
resposta-suporte.md     Parte 2 do desafio
```

O arquivo está dividido em quatro blocos, na ordem em que o fluxo acontece:
leitura do CSV, consulta ao ViaCEP, montagem do registro e execução. Cada bloco
tem funções pequenas com nome do que fazem, então dá para ler de cima a baixo
sem pular entre arquivos.

---

## Decisões que tomei

**Um arquivo só.** A primeira versão estava dividida em quatro módulos dentro de
`src/`, e isso era cerimônia para um script curto: obrigava a pular entre
arquivos para entender um fluxo que é linear. Juntei tudo. As funções continuam
exportadas, então o teste importa o que precisa sem executar o provisionamento.

**Código explícito, em vez de código curto.** Prefiro `for` com `if` a
encadeamento de `filter` com `some`, e prefiro guardar cada etapa numa constante
com nome descritivo a espremer tudo numa linha. O arquivo fica mais longo, e é
uma troca consciente: numa entrega em que preciso explicar cada linha, ganha
mais quem lê rápido do que quem escreve pouco. Pelo mesmo motivo evitei
desestruturação e atalhos como `?.` e `??` onde um `if` diz a mesma coisa.

**Node.js sem nenhuma dependência.** O Node 18+ já traz `fetch`, e o `node:test`
já é test runner. Menos dependência é menos superfície para quebrar, um clone
que roda de imediato, e, importante para uma entrega que vou defender numa
conversa, nenhuma linha que eu não saiba explicar.

**Leitura de CSV escrita à mão, em vez de biblioteca.** A coluna `servicos` vem
entre aspas (`"Consulta;Exame;Retorno"`). Esse é exatamente o caso em que um
`split(',')` funciona por sorte hoje e quebra amanhã, quando aparecer uma
vírgula dentro do campo, como em `"Clínica Vírgula, Ltda"`. A leitura acontece
em três funções separadas: separar em linhas e campos, descartar linhas vazias e
casar cada linha com o cabeçalho.

**Falha permanente e falha transitória são coisas diferentes.** CEP inválido ou
inexistente falha de imediato, porque repetir não muda a resposta e só gasta
tempo com a clínica esperando. Timeout, erro de rede e HTTP 5xx são retentados 3
vezes com espera crescente (500ms, 1s), porque instabilidade momentânea de API é
comum e não deveria custar uma unidade.

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
a lista que o cliente mandou provisionar, então ele é a fonte da verdade sobre
onde a unidade fica. O ViaCEP entra só para preencher o que falta.

**Consultas em sequência, não em paralelo.** São três unidades e o ViaCEP é uma
API pública e gratuita; não custa nada ser educado com ela.

**Código de saída.** `1` só quando nada foi provisionado ou o CSV é ilegível.
Sucesso parcial sai com `0`, porque quem chamar este script de dentro de outra
automação precisa distinguir "rodou e teve problema em uma unidade" de "não
produziu nada".

---

## Limitações conhecidas

**A leitura de CSV não é uma implementação completa de RFC 4180.** Cobre o que o
formato do desafio exige e um bom pedaço do que aparece na prática, mas não
trata aspas escapadas (`""` dentro de um campo entre aspas), separador diferente
de vírgula (o Excel em português exporta com `;`) nem codificação diferente de
UTF-8: um arquivo salvo em ANSI chega com acento corrompido. Se aparecer CSV de
origem variada, eu trocaria por `csv-parse`.

**Só a consulta de CEP tem teste.** Foi onde concentrei o bônus por ser a parte
de maior risco. `lerCsv` e `gerarSlug` ainda não têm cobertura, e são o que eu
escreveria em seguida, `lerCsv` especialmente, por ser código meu e não de
biblioteca.

**Não confiro se a cidade do CSV bate com a do CEP.** Se alguém digitar a cidade
errada, a unidade é provisionada assim mesmo. Daria para comparar a cidade do
CSV com a que o ViaCEP devolve e emitir um aviso, sem bloquear a abertura.

**Slugs não são checados contra duplicidade.** Duas unidades com o mesmo nome
geram o mesmo slug e ninguém percebe. Numa versão de produção eu adicionaria um
sufixo numérico ou usaria cidade mais nome na composição.

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
`provisionar.test.js`: três testes sobre `consultarCep`, cobrindo sucesso, CEP
inexistente e API fora do ar. Escolhi essa função porque é a única que fala com
o mundo externo. É onde mora o requisito de "o script não pode quebrar", e o
único ponto onde um bug passaria despercebido até chegar no cliente. O `fetch` é
injetado, então os testes rodam offline e sem variação.
