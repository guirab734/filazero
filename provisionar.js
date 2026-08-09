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

const VIACEP = process.env.VIACEP_BASE_URL ?? 'https://viacep.com.br/ws';
const COLUNAS = ['nome', 'cidade', 'uf', 'cep', 'servicos'];

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lê um CSV e devolve uma lista de objetos indexados pelo cabeçalho.
 *
 * Trata campos entre aspas porque o arquivo do desafio tem um: a coluna
 * servicos vem como "Consulta;Exame;Retorno". É onde um split(',') simples
 * quebraria se aparecesse vírgula dentro do campo, como em "Clínica X, Ltda".
 */
export function lerCsv(texto) {
  const linhas = [];
  let campos = [];
  let campo = '';
  let dentroDeAspas = false;

  for (const caractere of texto.replace(/^\uFEFF/, '')) {
    if (caractere === '"') dentroDeAspas = !dentroDeAspas;
    else if (caractere === ',' && !dentroDeAspas) {
      campos.push(campo);
      campo = '';
    } else if (caractere === '\n' && !dentroDeAspas) {
      campos.push(campo);
      linhas.push(campos);
      campos = [];
      campo = '';
    } else if (caractere !== '\r') campo += caractere;
  }
  if (campo || campos.length) {
    campos.push(campo);
    linhas.push(campos);
  }

  const [cabecalho = [], ...corpo] = linhas.filter((linha) => linha.some((valor) => valor.trim()));
  return corpo.map((linha) =>
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
export async function consultarCep(cep, { tentativas = 3, fetchImpl = fetch, dormir = espera } = {}) {
  const digitos = String(cep).replace(/\D/g, '');
  if (digitos.length !== 8) {
    throw new Error(`CEP "${cep}" inválido: esperado 8 dígitos, encontrado ${digitos.length}`);
  }

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    let resposta;
    try {
      resposta = await fetchImpl(`${VIACEP}/${digitos}/json/`, {
        signal: AbortSignal.timeout(5000), // sem isso, API lenta pendura o script
      });
    } catch {
      // Erro de rede ou timeout: cai no retry lá embaixo.
    }

    if (resposta?.ok) {
      const dados = await resposta.json();
      // Pegadinha da API: CEP bem formado mas inexistente vem como HTTP 200
      // com {"erro": true}. Quem olha só o status grava endereço vazio.
      if (dados.erro) throw new Error('CEP não encontrado na base do ViaCEP');
      return { logradouro: dados.logradouro ?? '', bairro: dados.bairro ?? '' };
    }
    if (resposta && resposta.status < 500) {
      throw new Error(`ViaCEP recusou a consulta (HTTP ${resposta.status})`);
    }
    if (tentativa < tentativas) await dormir(500 * 2 ** (tentativa - 1));
  }

  throw new Error(`ViaCEP indisponível após ${tentativas} tentativas`);
}

/** "Clínica Vida Aracaju" vira "clinica-vida-aracaju". */
export function gerarSlug(nome) {
  return nome
    .normalize('NFD') // separa a letra do acento
    .replace(/[\u0300-\u036f]/g, '') // e descarta só o acento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Devolve o CEP no formato 00000-000. */
const formatarCep = (cep) =>
  String(cep).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2');

async function main() {
  const [entrada = 'unidades.csv', saida = 'provisionamento.json'] = process.argv.slice(2);

  let unidades;
  try {
    unidades = lerCsv(readFileSync(entrada, 'utf8'));
  } catch (erro) {
    const motivo = erro.code === 'ENOENT' ? 'arquivo não encontrado' : erro.message;
    console.error(`\nNão foi possível ler "${entrada}": ${motivo}\n`);
    process.exitCode = 1;
    return;
  }

  if (unidades.length === 0) {
    console.error(`\n"${entrada}" não tem nenhuma unidade.\n`);
    process.exitCode = 1;
    return;
  }

  // Cabeçalho errado é problema do arquivo inteiro, não de uma linha.
  const faltando = COLUNAS.filter((coluna) => !(coluna in unidades[0]));
  if (faltando.length) {
    console.error(`\nCSV inválido: faltam as colunas ${faltando.join(', ')}.`);
    console.error(`Esperado o cabeçalho: ${COLUNAS.join(',')}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nLendo ${unidades.length} unidade(s) de "${entrada}"...\n`);

  const provisionadas = [];
  const falhas = [];

  // Sequencial de propósito: são poucas unidades e o ViaCEP é uma API pública
  // e gratuita, não faz sentido disparar tudo de uma vez em cima dela.
  for (const [indice, unidade] of unidades.entries()) {
    const identificacao = unidade.nome || `linha ${indice + 2}`;
    try {
      if (!unidade.nome) throw new Error('linha sem a coluna "nome" preenchida');

      const { logradouro, bairro } = await consultarCep(unidade.cep);

      provisionadas.push({
        unidade: unidade.nome,
        endereco: {
          logradouro,
          bairro,
          cidade: unidade.cidade,
          uf: unidade.uf.toUpperCase(),
          cep: formatarCep(unidade.cep),
        },
        servicos: unidade.servicos.split(';').map((s) => s.trim()).filter(Boolean),
        slug: gerarSlug(unidade.nome),
      });
      console.log(`  [ok]    ${identificacao}: ${logradouro}, ${bairro}`);
    } catch (erro) {
      // Uma unidade com problema não pode interromper as outras.
      falhas.push({ identificacao, motivo: erro.message });
      console.log(`  [falha] ${identificacao}: ${erro.message}`);
    }
  }

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

  // Só falha de verdade quando nada foi provisionado; sucesso parcial é sucesso.
  process.exitCode = provisionadas.length === 0 ? 1 : 0;
}

// Roda apenas quando chamado direto, para o arquivo de teste poder importar as
// funções acima sem disparar o provisionamento.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
