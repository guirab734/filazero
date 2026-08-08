/**
 * Cliente da API pública do ViaCEP (https://viacep.com.br).
 *
 * Toda a lógica de falha do desafio mora aqui: o script não pode quebrar
 * porque um CEP é inválido nem porque a API saiu do ar.
 */

/** Endereço base da API. Sobrescrevível para apontar para um stub em testes. */
const BASE_PADRAO = process.env.VIACEP_BASE_URL ?? 'https://viacep.com.br/ws';

/**
 * Erro de consulta de CEP.
 *
 * `permanente: true`  -> repetir não vai adiantar (CEP inválido ou inexistente).
 * `permanente: false` -> falha transitória (rede, timeout, 5xx), vale retentar.
 */
export class ErroDeCep extends Error {
  constructor(mensagem, { permanente = true } = {}) {
    super(mensagem);
    this.name = 'ErroDeCep';
    this.permanente = permanente;
  }
}

/**
 * Reduz o CEP aos 8 dígitos e recusa o que não tiver esse formato.
 * Evita gastar uma chamada de rede com um valor que já sabemos ser inválido.
 *
 * @param {string} cep CEP como veio do CSV, com ou sem hífen
 * @returns {string} os 8 dígitos
 */
export function normalizarCep(cep) {
  const digitos = String(cep ?? '').replace(/\D/g, '');
  if (digitos.length !== 8) {
    throw new ErroDeCep(
      `CEP "${cep}" é inválido: esperado 8 dígitos, encontrado ${digitos.length}`,
    );
  }
  return digitos;
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Consulta um CEP e devolve o endereço, com retentativa em falha transitória.
 *
 * @param {string} cep CEP a consultar
 * @param {object} [opcoes]
 * @param {number} [opcoes.tentativas=3] número máximo de tentativas
 * @param {number} [opcoes.timeoutMs=5000] tempo limite de cada tentativa
 * @param {number} [opcoes.esperaBaseMs=500] espera inicial do backoff exponencial
 * @param {Function} [opcoes.fetchImpl] injetável para testar sem rede
 * @param {Function} [opcoes.dormir] injetável para não esperar de verdade nos testes
 * @param {string} [opcoes.base] endereço base da API
 * @returns {Promise<{ logradouro: string, bairro: string, cidade: string, uf: string }>}
 */
export async function consultarCep(cep, opcoes = {}) {
  const {
    tentativas = 3,
    timeoutMs = 5000,
    esperaBaseMs = 500,
    fetchImpl = globalThis.fetch,
    dormir = esperar,
    base = BASE_PADRAO,
  } = opcoes;

  const digitos = normalizarCep(cep);
  const url = `${base}/${digitos}/json/`;

  let ultimoMotivo = 'motivo desconhecido';

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await consultarUmaVez(url, timeoutMs, fetchImpl);
    } catch (erro) {
      // CEP inválido ou inexistente não muda de resposta: falha na hora.
      if (erro instanceof ErroDeCep && erro.permanente) {
        throw erro;
      }
      ultimoMotivo = erro.message;
      if (tentativa < tentativas) {
        await dormir(esperaBaseMs * 2 ** (tentativa - 1)); // 500ms, 1s, 2s...
      }
    }
  }

  throw new ErroDeCep(
    `ViaCEP indisponível após ${tentativas} tentativas (${ultimoMotivo})`,
    { permanente: false },
  );
}

/**
 * Uma única chamada HTTP, sem retentativa.
 */
async function consultarUmaVez(url, timeoutMs, fetchImpl) {
  const resposta = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    // Sem timeout, uma API lenta pendura o script para sempre.
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (resposta.status === 400) {
    throw new ErroDeCep('CEP recusado pelo ViaCEP (formato inválido)');
  }
  if (!resposta.ok) {
    throw new ErroDeCep(`ViaCEP respondeu HTTP ${resposta.status}`, { permanente: false });
  }

  const dados = await resposta.json();

  // Pegadinha da API: para um CEP bem formado mas inexistente, o ViaCEP
  // responde HTTP 200 com {"erro": true}. Quem só olha o status code acaba
  // gravando um endereço vazio no arquivo de provisionamento.
  if (dados?.erro === true || dados?.erro === 'true') {
    throw new ErroDeCep('CEP não encontrado na base do ViaCEP');
  }

  return {
    logradouro: dados.logradouro ?? '',
    bairro: dados.bairro ?? '',
    cidade: dados.localidade ?? '',
    uf: dados.uf ?? '',
  };
}
