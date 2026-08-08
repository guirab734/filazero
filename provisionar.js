#!/usr/bin/env node
/**
 * Provisionamento de unidades.
 *
 * Lê o CSV de unidades, enriquece cada endereço com o ViaCEP, grava o
 * provisionamento.json e imprime um resumo do que deu certo e do que falhou.
 *
 * Uso: node provisionar.js [arquivo-de-entrada] [arquivo-de-saida]
 */

import { writeFileSync } from 'node:fs';
import { carregarUnidades } from './src/entrada.js';
import { consultarCep } from './src/viacep.js';
import { montarRegistroDeProvisionamento, divergenciaDeCidade } from './src/modelo.js';

const ENTRADA_PADRAO = 'unidades.csv';
const SAIDA_PADRAO = 'provisionamento.json';

async function main() {
  const [entrada = ENTRADA_PADRAO, saida = SAIDA_PADRAO] = process.argv.slice(2);

  let unidades;
  try {
    unidades = carregarUnidades(entrada);
  } catch (erro) {
    // Aqui não dá para seguir em frente: sem lista, não há o que provisionar.
    console.error(`\nNão foi possível ler "${entrada}": ${erro.message}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nLendo ${unidades.length} unidade(s) de "${entrada}"...\n`);

  const provisionadas = [];
  const falhas = [];
  const avisos = [];

  // Sequencial de propósito: são poucas unidades e o ViaCEP é uma API pública
  // e gratuita — não faz sentido disparar tudo de uma vez em cima dela.
  for (const unidade of unidades) {
    const identificacao = unidade.nome || `linha ${unidade.linha}`;

    try {
      if (!unidade.nome) {
        throw new Error('linha sem a coluna "nome" preenchida');
      }

      const endereco = await consultarCep(unidade.cep);

      const divergencia = divergenciaDeCidade(unidade, endereco);
      if (divergencia) {
        avisos.push({ unidade: identificacao, detalhe: divergencia });
      }

      provisionadas.push(montarRegistroDeProvisionamento(unidade, endereco));
      console.log(`  [ok]    ${identificacao} — ${endereco.logradouro}, ${endereco.bairro}`);
    } catch (erro) {
      // Uma unidade com problema não pode interromper as outras.
      falhas.push({ unidade: identificacao, motivo: erro.message });
      console.log(`  [falha] ${identificacao} — ${erro.message}`);
    }
  }

  writeFileSync(saida, `${JSON.stringify(provisionadas, null, 2)}\n`, 'utf8');

  imprimirResumo({ saida, total: unidades.length, provisionadas, falhas, avisos });

  // Sai com erro só quando nada foi provisionado — assim quem chamar o script
  // de dentro de outra automação percebe que a rodada não produziu nada,
  // mas um sucesso parcial continua sendo sucesso.
  process.exitCode = provisionadas.length === 0 ? 1 : 0;
}

function imprimirResumo({ saida, total, provisionadas, falhas, avisos }) {
  console.log('\n─────────── resumo ───────────');
  console.log(`  processadas: ${total}`);
  console.log(`  sucesso:     ${provisionadas.length}`);
  console.log(`  falhas:      ${falhas.length}`);

  if (falhas.length > 0) {
    console.log('\n  não provisionadas:');
    for (const falha of falhas) {
      console.log(`    - ${falha.unidade}: ${falha.motivo}`);
    }
  }

  if (avisos.length > 0) {
    console.log('\n  avisos (provisionadas, mas confira):');
    for (const aviso of avisos) {
      console.log(`    - ${aviso.unidade}: ${aviso.detalhe}`);
    }
  }

  console.log(`\n  arquivo gerado: ${saida}`);
  console.log('──────────────────────────────\n');
}

main();
