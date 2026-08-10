/**
 * Testes de consultarCep, a função mais importante do script: é a única que
 * fala com o mundo externo e é onde mora a regra de "não pode quebrar".
 *
 * Rodar com: npm test
 *
 * O fetch é substituído por uma versão falsa, então os testes rodam offline e
 * sempre com o mesmo resultado.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultarCep } from './provisionar.js';

/**
 * Monta um objeto parecido com o que o fetch devolveria de verdade.
 * Só precisa das três partes que a consultarCep usa: ok, status e json().
 */
function respostaFalsa(corpo, status) {
  if (status === undefined) {
    status = 200;
  }

  const respostaDeuCerto = status >= 200 && status < 300;

  return {
    ok: respostaDeuCerto,
    status: status,
    json: async function () {
      return corpo;
    },
  };
}

/**
 * Substitui a espera entre as tentativas. Sem isso, o teste do retry levaria
 * 1,5 segundo de relógio à toa. Esta versão termina na hora.
 */
async function naoEsperar() {
  // de propósito não faz nada
}

test('devolve o endereço quando o ViaCEP responde com sucesso', async function () {
  async function fetchFalso() {
    return respostaFalsa({
      logradouro: 'Rua Boquim',
      bairro: 'Centro',
      localidade: 'Aracaju',
      uf: 'SE',
    });
  }

  const endereco = await consultarCep('49010-390', { fetchImpl: fetchFalso });

  // deepEqual compara o conteúdo do objeto, não se é o mesmo objeto na memória.
  // Repare que localidade e uf não aparecem: a função devolve só o que usa.
  assert.deepEqual(endereco, { logradouro: 'Rua Boquim', bairro: 'Centro' });
});

test('trata CEP inexistente, que o ViaCEP devolve como HTTP 200 com erro:true', async function () {
  // Este é o caso que passa despercebido: o status é 200, então quem confia só
  // no status code grava um endereço vazio no provisionamento.
  let quantidadeDeChamadas = 0;

  async function fetchFalso() {
    quantidadeDeChamadas = quantidadeDeChamadas + 1;
    return respostaFalsa({ erro: true });
  }

  // rejects espera que a função falhe. O segundo argumento é uma expressão
  // regular testada contra a mensagem do erro.
  await assert.rejects(
    function () {
      return consultarCep('99999-999', { fetchImpl: fetchFalso, dormir: naoEsperar });
    },
    /não encontrado/,
  );

  // CEP inexistente não muda de resposta, então tem que falhar de primeira, sem
  // gastar as retentativas. Sem esta linha, o teste passaria mesmo que a função
  // tentasse três vezes à toa.
  assert.equal(quantidadeDeChamadas, 1);
});

test('retenta quando a API está fora do ar e desiste com erro tratado', async function () {
  let quantidadeDeChamadas = 0;

  async function fetchFalso() {
    quantidadeDeChamadas = quantidadeDeChamadas + 1;
    return respostaFalsa({}, 500); // 500 é erro do servidor, ou seja, transitório
  }

  await assert.rejects(
    function () {
      return consultarCep('49010-390', {
        fetchImpl: fetchFalso,
        dormir: naoEsperar,
        tentativas: 3,
      });
    },
    // O erro é tratado, não uma exceção solta de rede. É isso que permite ao
    // script registrar a falha e seguir para a próxima unidade.
    /indisponível após 3 tentativas/,
  );

  // Prova que as três voltas do retry aconteceram antes de desistir.
  assert.equal(quantidadeDeChamadas, 3);
});
