/**
 * Parser de CSV mínimo, escrito à mão em vez de trazer uma dependência.
 *
 * O motivo é o próprio arquivo do desafio: a coluna `servicos` vem entre
 * aspas ("Consulta;Exame;Retorno"), que é justamente o caso onde um
 * `linha.split(',')` ingênuo funciona por sorte hoje e quebra amanhã, quando
 * alguém puser uma vírgula dentro das aspas.
 *
 * Suporta: campos entre aspas, vírgula e quebra de linha dentro das aspas,
 * aspas escapadas ("" vira "), CRLF e BOM.
 */

/**
 * Varre o texto caractere a caractere e devolve uma matriz de linhas/campos.
 *
 * @param {string} texto conteúdo bruto do arquivo CSV
 * @returns {string[][]} uma lista por linha, com os campos já sem aspas
 */
export function separarLinhasECampos(texto) {
  const conteudo = String(texto ?? '').replace(/^﻿/, ''); // descarta o BOM do Excel

  const linhas = [];
  let campos = [];
  let campo = '';
  let dentroDeAspas = false;

  for (let i = 0; i < conteudo.length; i++) {
    const caractere = conteudo[i];

    if (dentroDeAspas) {
      if (caractere === '"') {
        if (conteudo[i + 1] === '"') {
          campo += '"'; // "" dentro de um campo entre aspas é uma aspa literal
          i++;
        } else {
          dentroDeAspas = false;
        }
        continue;
      }
      campo += caractere;
      continue;
    }

    if (caractere === '"') {
      dentroDeAspas = true;
    } else if (caractere === ',') {
      campos.push(campo);
      campo = '';
    } else if (caractere === '\n') {
      campos.push(campo);
      linhas.push(campos);
      campos = [];
      campo = '';
    } else if (caractere !== '\r') {
      campo += caractere;
    }
  }

  // Última linha, quando o arquivo não termina com quebra de linha.
  if (campo !== '' || campos.length > 0) {
    campos.push(campo);
    linhas.push(campos);
  }

  // Ignora linhas em branco (o rodapé vazio é comum em arquivos exportados).
  return linhas.filter((linha) => linha.some((valor) => valor.trim() !== ''));
}

/**
 * Interpreta a primeira linha como cabeçalho e devolve os demais registros
 * como objetos indexados pelo nome da coluna.
 *
 * @param {string} texto conteúdo bruto do arquivo CSV
 * @returns {{ colunas: string[], registros: Record<string, string>[] }}
 */
export function lerCsvComCabecalho(texto) {
  const linhas = separarLinhasECampos(texto);
  if (linhas.length === 0) {
    return { colunas: [], registros: [] };
  }

  const [cabecalho, ...corpo] = linhas;
  const colunas = cabecalho.map((coluna) => coluna.trim());

  const registros = corpo.map((linha) => {
    const registro = {};
    colunas.forEach((coluna, indice) => {
      registro[coluna] = (linha[indice] ?? '').trim();
    });
    return registro;
  });

  return { colunas, registros };
}
