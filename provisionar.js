#!/usr/bin/env node
// A linha acima chama-se "shebang". No Linux e no macOS ela diz ao sistema
// qual programa deve executar este arquivo caso ele seja chamado direto
// (./provisionar.js). No Windows ela é ignorada e não atrapalha nada.

/**
 * Provisionamento de unidades.
 *
 * Lê o CSV de unidades, completa o endereço de cada uma consultando o ViaCEP,
 * grava o provisionamento.json e imprime um resumo do que deu certo e do que
 * falhou.
 *
 * Uso: node provisionar.js [entrada.csv] [saida.json]
 */

// Importa duas funções do módulo de sistema de arquivos que já vem no Node.
// O prefixo "node:" deixa explícito que é módulo nativo, não pacote do npm.
// readFileSync lê um arquivo inteiro; writeFileSync grava. O "Sync" no nome
// significa que a execução para e espera o disco responder, em vez de seguir
// adiante e avisar depois. Num script de linha de comando isso é o que se quer.
import { readFileSync, writeFileSync } from 'node:fs';

// Converte uma URL de arquivo ("file:///home/user/provisionar.js") no caminho
// normal do sistema ("/home/user/provisionar.js"). É usada só na última linha
// do arquivo; a explicação completa está lá embaixo.
import { fileURLToPath } from 'node:url';

// Endereço base da API. Lê a variável de ambiente VIACEP_BASE_URL e, quando ela
// não existe (o caso normal), usa o ViaCEP de verdade. Isso permite apontar o
// script para um servidor de teste sem editar código:
//   VIACEP_BASE_URL=http://localhost:8123 node provisionar.js
// O operador ?? devolve o lado esquerdo, exceto quando ele é null ou undefined.
const VIACEP = process.env.VIACEP_BASE_URL ?? 'https://viacep.com.br/ws';

// Colunas que o CSV precisa ter. Ficam numa constante para a mensagem de erro
// e a validação usarem a mesma lista, sem risco de uma desatualizar a outra.
const COLUNAS = ['nome', 'cidade', 'uf', 'cep', 'servicos'];

// Pausa a execução por alguns milissegundos.
// setTimeout sozinho não é "esperável" com await, porque ele avisa por callback.
// Envolver numa Promise transforma esse callback em algo que o await entende:
// a Promise só é resolvida quando o setTimeout dispara. Usada no retry.
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lê um CSV e devolve uma lista de objetos indexados pelo cabeçalho.
 *
 * Trata campos entre aspas porque o arquivo do desafio tem um: a coluna
 * servicos vem como "Consulta;Exame;Retorno". É onde um split(',') simples
 * quebraria se aparecesse vírgula dentro do campo, como em "Clínica X, Ltda".
 */
export function lerCsv(texto) {
  // A ideia: percorrer o texto caractere por caractere montando três níveis,
  // do menor para o maior: campo -> linha (lista de campos) -> arquivo.
  const linhas = []; // todas as linhas prontas
  let campos = []; // campos da linha que está sendo montada agora
  let campo = ''; // caracteres do campo que está sendo montado agora

  // Interruptor que lembra se estamos dentro de um par de aspas. É o coração do
  // parser: dentro das aspas, vírgula e quebra de linha são texto comum.
  let dentroDeAspas = false;

  // O replace tira o BOM, um caractere invisível que o Excel coloca no começo
  // de arquivos UTF-8. Sem isso, a primeira coluna se chamaria "﻿nome" e a
  // validação de cabeçalho acusaria coluna faltando sem motivo aparente.
  // O for...of percorre string por caractere.
  for (const caractere of texto.replace(/^\uFEFF/, '')) {
    if (caractere === '"') {
      // Aspas alternam o interruptor: a de abertura liga, a de fechamento
      // desliga. A própria aspa nunca entra no conteúdo do campo.
      dentroDeAspas = !dentroDeAspas;
    } else if (caractere === ',' && !dentroDeAspas) {
      // Vírgula fora das aspas encerra o campo atual e começa outro.
      campos.push(campo);
      campo = '';
    } else if (caractere === '\n' && !dentroDeAspas) {
      // Quebra de linha fora das aspas encerra o campo e a linha inteira.
      campos.push(campo);
      linhas.push(campos);
      campos = []; // listas novas, senão a próxima linha escreveria por cima
      campo = '';
    } else if (caractere !== '\r') {
      // Qualquer outro caractere faz parte do campo.
      // O \r é descartado porque arquivos criados no Windows terminam as linhas
      // com \r\n, e sem isso o último campo de cada linha carregaria um \r.
      campo += caractere;
    }
  }

  // O laço acabou, mas se o arquivo não termina com quebra de linha o último
  // campo e a última linha ainda estão pendentes. Este if os fecha.
  if (campo || campos.length) {
    campos.push(campo);
    linhas.push(campos);
  }

  // Descarta linhas totalmente vazias (rodapé em branco é comum em exportação).
  // some devolve true se ao menos um campo tem conteúdo depois de tirar espaços.
  const linhasUteis = linhas.filter((linha) => linha.some((valor) => valor.trim()));

  // Desestruturação: separa o primeiro item do resto. cabecalho recebe a
  // primeira linha, corpo recebe todas as outras. O "= []" é a garantia de que
  // cabecalho seja uma lista vazia, e não undefined, se o arquivo estiver vazio.
  const [cabecalho = [], ...corpo] = linhasUteis;

  // Transforma cada linha em objeto, casando pela posição com o cabeçalho:
  //   cabeçalho ["nome", "cidade"] + linha ["Clínica", "Aracaju"]
  //   vira      { nome: "Clínica", cidade: "Aracaju" }
  return corpo.map((linha) =>
    // Object.fromEntries monta um objeto a partir de pares [chave, valor].
    // O ?? '' cobre a linha que tem menos colunas que o cabeçalho: em vez de
    // undefined, o campo vira string vazia, que o resto do código sabe tratar.
    Object.fromEntries(cabecalho.map((coluna, i) => [coluna.trim(), (linha[i] ?? '').trim()])),
  );
}

/**
 * Consulta o CEP no ViaCEP e devolve logradouro e bairro.
 *
 * Todo erro conhecido vira um Error com mensagem legível, para quem chamou
 * registrar a falha e seguir para a próxima unidade. CEP inválido ou
 * inexistente falha na hora, porque repetir não muda a resposta; queda de rede
 * e erro 5xx são retentados com espera crescente.
 */
// O segundo parâmetro é um objeto de opções já desestruturado, todas com valor
// padrão. Quem chama normalmente passa só o CEP; o teste substitui fetchImpl por
// uma função falsa e dormir por uma que não espera, e assim roda sem rede e sem
// gastar segundos. O "= {}" no final permite chamar sem o segundo argumento.
export async function consultarCep(cep, { tentativas = 3, fetchImpl = fetch, dormir = espera } = {}) {
  // \D casa "qualquer caractere que não seja dígito", e o g aplica a troca em
  // todas as ocorrências. Assim "49010-390" vira "49010390". O CSV traz o CEP
  // com hífen, e o ViaCEP só aceita os 8 dígitos limpos.
  const digitos = String(cep).replace(/\D/g, '');

  // Validação local: CEP fora do formato não vira chamada de rede. É mais rápido
  // e a mensagem de erro fica mais precisa do que um 400 vindo da API.
  if (digitos.length !== 8) {
    throw new Error(`CEP "${cep}" inválido: esperado 8 dígitos, encontrado ${digitos.length}`);
  }

  // Laço de tentativas. Só chega na segunda volta em caso de falha transitória.
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    // Declarada aqui fora para continuar visível depois do try/catch.
    let resposta;

    try {
      // Crase permite interpolar variáveis com ${}, montando a URL final.
      resposta = await fetchImpl(`${VIACEP}/${digitos}/json/`, {
        // Cancela a requisição depois de 5 segundos. Sem isso, uma API que
        // aceita a conexão e nunca responde pendura o script para sempre.
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // fetch só lança exceção quando a requisição nem chega a completar:
      // sem internet, DNS falhando, timeout estourado. Resposta HTTP de erro
      // (404, 500) não cai aqui, chega normalmente e é tratada abaixo.
      // Engolimos a exceção de propósito: "resposta" fica undefined e o fluxo
      // segue para o retry no fim do laço.
    }

    // O ?. (encadeamento opcional) evita quebrar quando resposta é undefined:
    // em vez de erro, a expressão inteira vira undefined, que é falsy.
    // ok é true para status de 200 a 299.
    if (resposta?.ok) {
      // Segundo await: fetch entrega os cabeçalhos, mas o corpo ainda está
      // chegando. .json() espera o corpo terminar e converte o texto em objeto.
      const dados = await resposta.json();

      // Pegadinha da API: CEP bem formado mas inexistente vem como HTTP 200
      // com {"erro": true}. Quem olha só o status grava endereço vazio no
      // arquivo final e só descobre quando a unidade já está no ar.
      if (dados.erro) throw new Error('CEP não encontrado na base do ViaCEP');

      // Sucesso: sai da função e do laço. O ?? '' garante string em vez de
      // undefined caso a API omita algum campo (acontece em CEP de cidade
      // inteira, que não tem logradouro).
      return { logradouro: dados.logradouro ?? '', bairro: dados.bairro ?? '' };
    }

    // Chegou resposta, mas com erro abaixo de 500: o problema é a requisição
    // (400 CEP malformado, 404 rota errada). Repetir daria o mesmo resultado,
    // então falha na hora em vez de gastar as outras tentativas.
    if (resposta && resposta.status < 500) {
      throw new Error(`ViaCEP recusou a consulta (HTTP ${resposta.status})`);
    }

    // Sobrou o transitório: erro de rede, timeout ou 5xx do servidor.
    // Espera antes de tentar de novo, dobrando o tempo a cada volta
    // (500ms, depois 1s). Chama-se backoff exponencial, e serve para não
    // martelar um servidor que já está com problema.
    // O if evita esperar à toa depois da última tentativa.
    if (tentativa < tentativas) await dormir(500 * 2 ** (tentativa - 1));
  }

  // O laço terminou sem nenhum return, ou seja, todas as tentativas falharam.
  throw new Error(`ViaCEP indisponível após ${tentativas} tentativas`);
}

/** "Clínica Vida Aracaju" vira "clinica-vida-aracaju". */
export function gerarSlug(nome) {
  return nome
    // NFD separa letra e acento em dois caracteres: "í" vira "i" + acento solto.
    .normalize('NFD')
    // Este intervalo do Unicode contém justamente os acentos soltos, então o
    // replace remove só eles e preserva a letra: sobra o "i".
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Troca por hífen qualquer sequência do que não for letra sem acento ou
    // número: espaço, ponto, vírgula. O + trata "a  b" como um hífen só.
    .replace(/[^a-z0-9]+/g, '-')
    // Remove hífen sobrando no começo (^) ou no fim ($), que aparece quando o
    // nome termina em pontuação, como em "Clínica Vida.".
    .replace(/^-|-$/g, '');
}

/** Devolve o CEP no formato 00000-000. */
const formatarCep = (cep) =>
  String(cep)
    .replace(/\D/g, '') // limpa qualquer formatação que já viesse
    // Captura 5 dígitos e depois 3, e remonta com hífen no meio.
    // $1 e $2 se referem aos grupos entre parênteses, na ordem.
    .replace(/^(\d{5})(\d{3})$/, '$1-$2');

// async porque o corpo usa await ao consultar cada CEP.
async function main() {
  // process.argv é a lista de argumentos da linha de comando. As duas primeiras
  // posições são sempre o caminho do node e o do script, por isso o slice(2).
  // A desestruturação com valores padrão faz os dois argumentos serem opcionais:
  //   node provisionar.js                      usa unidades.csv e provisionamento.json
  //   node provisionar.js outro.csv saida.json usa os que você passou
  const [entrada = 'unidades.csv', saida = 'provisionamento.json'] = process.argv.slice(2);

  // Declarada fora do try para continuar acessível depois dele.
  let unidades;
  try {
    // 'utf8' faz readFileSync devolver texto. Sem isso ele devolveria bytes.
    unidades = lerCsv(readFileSync(entrada, 'utf8'));
  } catch (erro) {
    // Erros do sistema de arquivos trazem um código curto em erro.code.
    // Traduzimos o mais comum para uma frase que qualquer pessoa entende.
    const motivo = erro.code === 'ENOENT' ? 'arquivo não encontrado' : erro.message;
    // console.error escreve na saída de erro, separada da saída normal. Isso
    // permite redirecionar uma sem levar a outra junto.
    console.error(`\nNão foi possível ler "${entrada}": ${motivo}\n`);
    // Sem lista de unidades não há o que provisionar: encerra com código 1.
    process.exitCode = 1;
    return;
  }

  if (unidades.length === 0) {
    console.error(`\n"${entrada}" não tem nenhuma unidade.\n`);
    process.exitCode = 1;
    return;
  }

  // Cabeçalho errado é problema do arquivo inteiro, não de uma linha.
  // Como todas as linhas viram objetos com as mesmas chaves, basta olhar a
  // primeira. O operador "in" verifica se a chave existe no objeto.
  const faltando = COLUNAS.filter((coluna) => !(coluna in unidades[0]));
  if (faltando.length) {
    console.error(`\nCSV inválido: faltam as colunas ${faltando.join(', ')}.`);
    console.error(`Esperado o cabeçalho: ${COLUNAS.join(',')}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nLendo ${unidades.length} unidade(s) de "${entrada}"...\n`);

  // Duas listas: o que vai para o arquivo e o que vai para o relatório de erros.
  const provisionadas = [];
  const falhas = [];

  // Sequencial de propósito: são poucas unidades e o ViaCEP é uma API pública
  // e gratuita, não faz sentido disparar tudo de uma vez em cima dela.
  // .entries() entrega índice e item juntos; o índice serve para dizer em qual
  // linha do arquivo está o problema, quando a unidade nem nome tem.
  for (const [indice, unidade] of unidades.entries()) {
    // +2 porque o índice começa em 0 e a linha 1 do arquivo é o cabeçalho.
    // Assim o número bate com o que você vê ao abrir o CSV no editor.
    const identificacao = unidade.nome || `linha ${indice + 2}`;

    // O try dentro do laço é o que cumpre o requisito de não quebrar: o erro de
    // uma unidade é capturado aqui e o laço continua na próxima. Se o try
    // estivesse em volta do laço, a primeira falha abortaria todas as restantes.
    try {
      if (!unidade.nome) throw new Error('linha sem a coluna "nome" preenchida');

      // Desestruturação do retorno: pega logradouro e bairro do objeto que a
      // função devolve, já em variáveis separadas.
      const { logradouro, bairro } = await consultarCep(unidade.cep);

      provisionadas.push({
        unidade: unidade.nome,
        endereco: {
          // Escrever só "logradouro," equivale a "logradouro: logradouro".
          logradouro,
          bairro,
          // Cidade, UF e CEP saem do CSV, que é a lista que o cliente mandou
          // provisionar. O ViaCEP entra só para completar o que falta.
          cidade: unidade.cidade,
          uf: unidade.uf.toUpperCase(),
          cep: formatarCep(unidade.cep),
        },
        // "Consulta;Exame" vira ["Consulta", "Exame"].
        // split separa, map tira espaços das pontas, filter(Boolean) descarta
        // strings vazias, que aparecem quando o campo termina em ";".
        servicos: unidade.servicos.split(';').map((s) => s.trim()).filter(Boolean),
        slug: gerarSlug(unidade.nome),
      });

      console.log(`  [ok]    ${identificacao}: ${logradouro}, ${bairro}`);
    } catch (erro) {
      // Uma unidade com problema não pode interromper as outras.
      // Guarda o motivo para o resumo e segue o laço.
      falhas.push({ identificacao, motivo: erro.message });
      console.log(`  [falha] ${identificacao}: ${erro.message}`);
    }
  }

  // JSON.stringify converte a lista em texto. O null é para não filtrar campos,
  // e o 2 é a indentação, que deixa o arquivo legível para quem abrir.
  // O \n no final é convenção: arquivo de texto termina com quebra de linha.
  writeFileSync(saida, `${JSON.stringify(provisionadas, null, 2)}\n`);

  console.log('\n=========== resumo ===========');
  console.log(`  processadas: ${unidades.length}`);
  console.log(`  sucesso:     ${provisionadas.length}`);
  console.log(`  falhas:      ${falhas.length}`);
  if (falhas.length) {
    console.log('\n  não provisionadas:');
    for (const falha of falhas) console.log(`    - ${falha.identificacao}: ${falha.motivo}`);
  }
  console.log(`\n  arquivo gerado: ${saida}`);
  console.log('==============================\n');

  // Código de saída: 0 quer dizer sucesso, qualquer outro quer dizer falha.
  // Quem chama este script de dentro de outra automação usa esse número para
  // decidir se continua. Só falha de verdade quando nada foi provisionado;
  // sucesso parcial continua sendo sucesso.
  process.exitCode = provisionadas.length === 0 ? 1 : 0;
}

// import.meta.url é o endereço deste arquivo; process.argv[1] é o arquivo que o
// node recebeu para executar. Quando os dois são iguais, o script foi chamado
// direto e deve rodar. Quando são diferentes, ele foi importado por outro
// arquivo, e aí só as funções exportadas interessam.
// Sem esta condição, rodar "npm test" dispararia o provisionamento inteiro,
// porque o arquivo de teste importa deste aqui.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
