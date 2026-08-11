#!/usr/bin/env node
/**
 * Provisionamento de unidades.
 *
 * Lê o CSV de unidades, completa o endereço de cada uma consultando o ViaCEP,
 * grava o provisionamento.json e imprime um resumo do que deu certo e do que
 * falhou.
 *
 * Uso: node provisionar.js [entrada.csv] [saida.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Endereço base da API pública de CEP.
const ENDERECO_DA_API = 'https://viacep.com.br/ws';

// Colunas que o CSV precisa ter para o script conseguir trabalhar.
const COLUNAS_OBRIGATORIAS = ['nome', 'cidade', 'uf', 'cep', 'servicos'];

/**
 * Pausa a execução pelo número de milissegundos pedido.
 * Usada entre as tentativas de consulta ao ViaCEP.
 */
function espera(milissegundos) {
  return new Promise(function (avisarQueTerminou) {
    setTimeout(avisarQueTerminou, milissegundos);
  });
}

// ---------------------------------------------------------------------------
// Leitura do CSV
// ---------------------------------------------------------------------------

/**
 * Percorre o texto do CSV caractere a caractere e devolve uma lista de linhas,
 * onde cada linha é uma lista de campos.
 *
 * Precisa ser caractere a caractere por causa das aspas: a coluna servicos vem
 * como "Consulta;Exame;Retorno", e uma vírgula dentro das aspas faz parte do
 * texto, não separa campo. Um texto.split(',') não sabe dessa diferença.
 */
function separarEmLinhasECampos(textoOriginal) {
  // Tira o BOM, caractere invisível que o Excel coloca no começo do arquivo.
  const texto = textoOriginal.replace(/^\uFEFF/, '');

  const linhas = [];
  let camposDaLinhaAtual = [];
  let campoAtual = '';
  let estouDentroDeAspas = false;

  for (const caractere of texto) {
    if (caractere === '"') {
      // Aspas não entram no texto do campo. Elas só ligam e desligam o modo
      // "o que vier agora é texto comum".
      if (estouDentroDeAspas) {
        estouDentroDeAspas = false;
      } else {
        estouDentroDeAspas = true;
      }
      continue;
    }

    if (caractere === ',' && estouDentroDeAspas === false) {
      // Vírgula fora das aspas termina o campo atual.
      camposDaLinhaAtual.push(campoAtual);
      campoAtual = '';
      continue;
    }

    if (caractere === '\n' && estouDentroDeAspas === false) {
      // Quebra de linha fora das aspas termina o campo e a linha.
      camposDaLinhaAtual.push(campoAtual);
      linhas.push(camposDaLinhaAtual);

      // Listas novas para a próxima linha. Se reaproveitássemos as mesmas, a
      // linha já guardada em "linhas" seria alterada junto.
      camposDaLinhaAtual = [];
      campoAtual = '';
      continue;
    }

    if (caractere === '\r') {
      // Arquivos feitos no Windows terminam a linha com \r\n. O \r é descartado
      // para não sobrar preso no fim do último campo.
      continue;
    }

    campoAtual = campoAtual + caractere;
  }

  // Se o arquivo não terminar com quebra de linha, a última linha ficou
  // pendente, porque o gatilho que fecha a linha é o \n, que não veio.
  const sobrouTexto = campoAtual !== '';
  const sobraramCampos = camposDaLinhaAtual.length > 0;
  if (sobrouTexto || sobraramCampos) {
    camposDaLinhaAtual.push(campoAtual);
    linhas.push(camposDaLinhaAtual);
  }

  return linhas;
}

/**
 * Descarta as linhas em que todos os campos estão vazios.
 * Linha em branco no fim do arquivo é comum e não é uma unidade.
 */
function removerLinhasVazias(linhas) {
  const linhasUteis = [];

  for (const linha of linhas) {
    let temAlgumConteudo = false;

    for (const campo of linha) {
      // trim() tira os espaços das pontas. Uma linha só com espaços continua
      // sendo uma linha vazia.
      if (campo.trim() !== '') {
        temAlgumConteudo = true;
        break;
      }
    }

    if (temAlgumConteudo) {
      linhasUteis.push(linha);
    }
  }

  return linhasUteis;
}

/**
 * Casa cada linha de dados com o cabeçalho, pela posição, e devolve objetos.
 *
 * cabecalho     ["nome", "cidade"]
 * linha         ["Clínica Vida Aracaju", "Aracaju"]
 * vira          { nome: "Clínica Vida Aracaju", cidade: "Aracaju" }
 *
 * Isso é o que permite escrever unidade.cep no resto do código, em vez de
 * linha[3], que quebraria se alguém reordenasse as colunas do arquivo.
 */
function transformarLinhasEmObjetos(cabecalho, linhasDeDados) {
  const registros = [];

  for (const linha of linhasDeDados) {
    const registro = {};

    for (let coluna = 0; coluna < cabecalho.length; coluna++) {
      const nomeDaColuna = cabecalho[coluna].trim();

      // A linha pode ter menos campos que o cabeçalho. Nesse caso o valor vem
      // undefined, e undefined.trim() derrubaria o script.
      let valor = linha[coluna];
      if (valor === undefined) {
        valor = '';
      }

      registro[nomeDaColuna] = valor.trim();
    }

    registros.push(registro);
  }

  return registros;
}

/**
 * Lê o texto de um CSV e devolve uma lista de objetos, um por linha de dados.
 */
export function lerCsv(texto) {
  const todasAsLinhas = separarEmLinhasECampos(texto);
  const linhasUteis = removerLinhasVazias(todasAsLinhas);

  // Sem nenhuma linha não há nem cabeçalho para trabalhar.
  if (linhasUteis.length === 0) {
    return [];
  }

  const cabecalho = linhasUteis[0];
  const linhasDeDados = linhasUteis.slice(1); // tudo a partir da posição 1

  return transformarLinhasEmObjetos(cabecalho, linhasDeDados);
}

// ---------------------------------------------------------------------------
// Consulta ao ViaCEP
// ---------------------------------------------------------------------------

/**
 * Consulta um CEP no ViaCEP e devolve o logradouro e o bairro.
 *
 * Quando alguma coisa dá errado, lança um Error com mensagem legível, para
 * quem chamou registrar a falha e seguir para a próxima unidade.
 *
 * O segundo parâmetro é opcional e serve para os testes trocarem o fetch e a
 * espera por versões falsas, que rodam sem rede e sem gastar segundos.
 */
export async function consultarCep(cep, opcoes) {
  if (!opcoes) {
    opcoes = {};
  }

  let tentativas = 3;
  if (opcoes.tentativas) {
    tentativas = opcoes.tentativas;
  }

  let fazerRequisicao = fetch;
  if (opcoes.fetchImpl) {
    fazerRequisicao = opcoes.fetchImpl;
  }

  let dormir = espera;
  if (opcoes.dormir) {
    dormir = opcoes.dormir;
  }

  // O CSV traz o CEP com hífen ("49010-390") e o ViaCEP só aceita os 8 dígitos.
  // O \D casa tudo que não é dígito, e o g aplica em todas as ocorrências.
  const digitos = String(cep).replace(/\D/g, '');

  // CEP fora do formato nem vira chamada de rede: é mais rápido e a mensagem
  // de erro fica mais precisa do que um 400 vindo da API.
  if (digitos.length !== 8) {
    throw new Error(`CEP "${cep}" inválido: esperado 8 dígitos, encontrado ${digitos.length}`);
  }

  const url = `${ENDERECO_DA_API}/${digitos}/json/`;

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    let resposta = null;

    try {
      resposta = await fazerRequisicao(url, {
        // Cancela a requisição em 5 segundos. Sem isso, uma API que aceita a
        // conexão e nunca responde deixaria o script parado para sempre.
        signal: AbortSignal.timeout(5000),
      });
    } catch (erro) {
      // O fetch só lança exceção quando a requisição nem completa: sem
      // internet, DNS falhando, tempo esgotado. Resposta com erro HTTP não cai
      // aqui, chega normalmente e é tratada abaixo.
      resposta = null;
    }

    if (resposta !== null && resposta.ok === true) {
      const dados = await resposta.json();

      // Pegadinha da API: para um CEP bem formado mas inexistente, o ViaCEP
      // responde HTTP 200 com {"erro": true}. Quem olha só o status acaba
      // gravando um endereço vazio no arquivo de provisionamento.
      if (dados.erro) {
        throw new Error('CEP não encontrado na base do ViaCEP');
      }

      // Alguns CEPs, como os de cidade inteira, não têm logradouro. Nesses
      // casos a API omite o campo, e queremos string vazia em vez de undefined.
      const endereco = { logradouro: '', bairro: '' };
      if (dados.logradouro) {
        endereco.logradouro = dados.logradouro;
      }
      if (dados.bairro) {
        endereco.bairro = dados.bairro;
      }
      return endereco;
    }

    if (resposta !== null && resposta.status < 500) {
      // Erro abaixo de 500 é problema da requisição, não do servidor. Tentar de
      // novo daria exatamente a mesma resposta.
      throw new Error(`ViaCEP recusou a consulta (HTTP ${resposta.status})`);
    }

    // Sobrou o transitório: queda de rede, tempo esgotado ou erro 5xx do
    // servidor. Espera um pouco e tenta de novo, dobrando o tempo a cada volta
    // (500ms, depois 1s) para não insistir em cima de um servidor com problema.
    const ehAUltimaTentativa = tentativa === tentativas;
    if (!ehAUltimaTentativa) {
      const tempoDeEspera = 500 * Math.pow(2, tentativa - 1);
      await dormir(tempoDeEspera);
    }
  }

  throw new Error(`ViaCEP indisponível após ${tentativas} tentativas`);
}

// ---------------------------------------------------------------------------
// Montagem do registro de provisionamento
// ---------------------------------------------------------------------------

/**
 * Transforma o nome da unidade em slug.
 * "Clínica Vida Aracaju" vira "clinica-vida-aracaju".
 */
export function gerarSlug(nome) {
  // normalize('NFD') separa a letra do acento em dois caracteres, e o replace
  // seguinte apaga só o acento, preservando a letra.
  const separado = nome.normalize('NFD');
  const semAcento = separado.replace(/[\u0300-\u036f]/g, '');
  const minusculo = semAcento.toLowerCase();

  // Tudo que não for letra sem acento ou número vira hífen. O + faz uma
  // sequência de vários caracteres virar um hífen só.
  const comHifens = minusculo.replace(/[^a-z0-9]+/g, '-');

  // Tira hífen sobrando no começo e no fim, que aparece quando o nome termina
  // em pontuação.
  const semHifenNasPontas = comHifens.replace(/^-|-$/g, '');

  return semHifenNasPontas;
}

/** Devolve o CEP no formato 00000-000. */
function formatarCep(cep) {
  const digitos = String(cep).replace(/\D/g, '');

  if (digitos.length !== 8) {
    return String(cep);
  }

  const primeiraParte = digitos.slice(0, 5);
  const segundaParte = digitos.slice(5);
  return `${primeiraParte}-${segundaParte}`;
}

/**
 * Quebra a coluna servicos na lista esperada pelo arquivo de saída.
 * "Consulta;Exame;Retorno" vira ["Consulta", "Exame", "Retorno"].
 */
function separarServicos(textoDosServicos) {
  const partes = textoDosServicos.split(';');
  const servicos = [];

  for (const parte of partes) {
    const servico = parte.trim();

    // Campo terminado em ";" produz uma parte vazia no fim, que não interessa.
    if (servico !== '') {
      servicos.push(servico);
    }
  }

  return servicos;
}

/**
 * Junta a unidade que veio do CSV com o endereço que veio do ViaCEP.
 *
 * Cidade, UF e CEP saem do CSV, que é a lista que o cliente mandou provisionar.
 * O ViaCEP entra só para completar logradouro e bairro.
 */
function montarRegistro(unidade, endereco) {
  return {
    unidade: unidade.nome,
    endereco: {
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      cidade: unidade.cidade,
      uf: unidade.uf.toUpperCase(),
      cep: formatarCep(unidade.cep),
    },
    servicos: separarServicos(unidade.servicos),
    slug: gerarSlug(unidade.nome),
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

/** Lê os nomes dos arquivos passados na linha de comando. */
function lerArgumentos() {
  // As duas primeiras posições de process.argv são o caminho do node e o do
  // script, por isso a leitura começa da posição 2.
  const argumentos = process.argv.slice(2);

  let arquivoDeEntrada = 'unidades.csv';
  let arquivoDeSaida = 'provisionamento.json';

  if (argumentos[0]) {
    arquivoDeEntrada = argumentos[0];
  }
  if (argumentos[1]) {
    arquivoDeSaida = argumentos[1];
  }

  return { arquivoDeEntrada, arquivoDeSaida };
}

/** Confere se o CSV tem todas as colunas necessárias. */
function procurarColunasQueFaltam(primeiraUnidade) {
  const colunasQueFaltam = [];

  for (const coluna of COLUNAS_OBRIGATORIAS) {
    const existe = coluna in primeiraUnidade;
    if (!existe) {
      colunasQueFaltam.push(coluna);
    }
  }

  return colunasQueFaltam;
}

/** Imprime o resumo final da execução. */
function imprimirResumo(totalDeUnidades, provisionadas, falhas, arquivoDeSaida) {
  console.log('\n=========== resumo ===========');
  console.log(`  processadas: ${totalDeUnidades}`);
  console.log(`  sucesso:     ${provisionadas.length}`);
  console.log(`  falhas:      ${falhas.length}`);

  if (falhas.length > 0) {
    console.log('\n  não provisionadas:');
    for (const falha of falhas) {
      console.log(`    - ${falha.identificacao}: ${falha.motivo}`);
    }
  }

  console.log(`\n  arquivo gerado: ${arquivoDeSaida}`);
  console.log('==============================\n');
}

async function main() {
  const argumentos = lerArgumentos();
  const arquivoDeEntrada = argumentos.arquivoDeEntrada;
  const arquivoDeSaida = argumentos.arquivoDeSaida;

  // Passo 1: ler o arquivo do disco.
  let textoDoArquivo;
  try {
    textoDoArquivo = readFileSync(arquivoDeEntrada, 'utf8');
  } catch (erro) {
    let motivo = erro.message;
    if (erro.code === 'ENOENT') {
      motivo = 'arquivo não encontrado, confira o caminho';
    }
    console.error(`\nNão foi possível ler "${arquivoDeEntrada}": ${motivo}\n`);
    process.exitCode = 1;
    return;
  }

  // Passo 2: transformar o texto em uma lista de unidades.
  const unidades = lerCsv(textoDoArquivo);

  if (unidades.length === 0) {
    console.error(`\n"${arquivoDeEntrada}" não tem nenhuma unidade.\n`);
    process.exitCode = 1;
    return;
  }

  // Passo 3: conferir o cabeçalho. Coluna faltando é problema do arquivo
  // inteiro, então aqui vale parar; problema de uma linha só é tratado adiante.
  const colunasQueFaltam = procurarColunasQueFaltam(unidades[0]);
  if (colunasQueFaltam.length > 0) {
    console.error(`\nCSV inválido: faltam as colunas ${colunasQueFaltam.join(', ')}.`);
    console.error(`Esperado o cabeçalho: ${COLUNAS_OBRIGATORIAS.join(',')}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nLendo ${unidades.length} unidade(s) de "${arquivoDeEntrada}"...\n`);

  const provisionadas = [];
  const falhas = [];

  // Passo 4: uma unidade por vez. Em sequência de propósito, porque são poucas
  // unidades e o ViaCEP é uma API pública e gratuita.
  for (let posicao = 0; posicao < unidades.length; posicao++) {
    const unidade = unidades[posicao];

    // +2 porque a contagem começa em 0 e a primeira linha do arquivo é o
    // cabeçalho. Assim o número bate com o que aparece no editor.
    const numeroDaLinha = posicao + 2;

    let identificacao = unidade.nome;
    if (!identificacao) {
      identificacao = `linha ${numeroDaLinha}`;
    }

    // O try fica dentro do laço de propósito: assim o erro de uma unidade é
    // capturado aqui e o laço continua na próxima. Se ele estivesse em volta do
    // laço, a primeira falha abortaria todas as unidades restantes.
    try {
      if (!unidade.nome) {
        throw new Error('linha sem a coluna "nome" preenchida');
      }

      const endereco = await consultarCep(unidade.cep);
      const registro = montarRegistro(unidade, endereco);

      provisionadas.push(registro);
      console.log(`  [ok]    ${identificacao}: ${endereco.logradouro}, ${endereco.bairro}`);
    } catch (erro) {
      falhas.push({ identificacao: identificacao, motivo: erro.message });
      console.log(`  [falha] ${identificacao}: ${erro.message}`);
    }
  }

  // Passo 5: gravar o arquivo. O null é para não filtrar nenhum campo, e o 2 é
  // a indentação, que deixa o JSON legível para quem abrir.
  const textoDeSaida = JSON.stringify(provisionadas, null, 2);
  writeFileSync(arquivoDeSaida, `${textoDeSaida}\n`);

  imprimirResumo(unidades.length, provisionadas, falhas, arquivoDeSaida);

  // Código de saída: 0 quer dizer sucesso e qualquer outro quer dizer falha.
  // Só falha de verdade quando nada foi provisionado; sucesso parcial continua
  // sendo sucesso para quem chamar este script de dentro de outra automação.
  if (provisionadas.length === 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

// process.argv[1] é o arquivo que o node recebeu para executar, e
// import.meta.url é o endereço deste arquivo aqui. Quando os dois são iguais,
// o script foi chamado direto e deve rodar. Quando são diferentes, ele foi
// importado por outro arquivo (o de teste), e aí só as funções interessam.
const esteArquivoFoiChamadoDireto = process.argv[1] === fileURLToPath(import.meta.url);
if (esteArquivoFoiChamadoDireto) {
  main();
}
