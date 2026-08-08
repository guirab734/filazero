/**
 * Leitura e validação do CSV de unidades.
 */

import { readFileSync } from 'node:fs';
import { lerCsvComCabecalho } from './csv.js';

/** Colunas sem as quais o arquivo não serve para nada. */
export const COLUNAS_OBRIGATORIAS = ['nome', 'cidade', 'uf', 'cep', 'servicos'];

/**
 * Quebra a coluna `servicos` na lista esperada pelo JSON de saída.
 * "Consulta;Exame;Retorno" vira ["Consulta", "Exame", "Retorno"].
 *
 * @param {string} valor conteúdo bruto da coluna
 * @returns {string[]}
 */
export function separarServicos(valor) {
  return String(valor ?? '')
    .split(';')
    .map((servico) => servico.trim())
    .filter((servico) => servico !== '');
}

/**
 * Carrega o CSV do disco e devolve as unidades já normalizadas.
 *
 * Cabeçalho faltando é erro fatal: o arquivo inteiro está errado e processar
 * unidade por unidade só produziria lixo. Problemas de uma linha específica
 * (CEP inválido, por exemplo) são tratados adiante, unidade a unidade, para
 * que uma linha ruim não derrube as outras.
 *
 * @param {string} caminho caminho do arquivo CSV
 * @returns {{ linha: number, nome: string, cidade: string, uf: string, cep: string, servicos: string[] }[]}
 */
export function carregarUnidades(caminho) {
  let texto;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      throw new Error('arquivo não encontrado, confira o caminho');
    }
    if (erro.code === 'EACCES') {
      throw new Error('sem permissão de leitura no arquivo');
    }
    throw erro;
  }

  const { colunas, registros } = lerCsvComCabecalho(texto);

  const faltando = COLUNAS_OBRIGATORIAS.filter((coluna) => !colunas.includes(coluna));
  if (faltando.length > 0) {
    throw new Error(
      `CSV inválido: faltam as colunas ${faltando.join(', ')}. ` +
        `Esperado o cabeçalho: ${COLUNAS_OBRIGATORIAS.join(',')}`,
    );
  }

  return registros.map((registro, indice) => ({
    // +2 porque o índice começa em zero e a primeira linha do arquivo é o
    // cabeçalho — assim o número bate com o que a pessoa vê no editor.
    linha: indice + 2,
    nome: registro.nome,
    cidade: registro.cidade,
    uf: registro.uf.toUpperCase(),
    cep: registro.cep,
    servicos: separarServicos(registro.servicos),
  }));
}
