/**
 * Testes de `consultarCep`, a função mais importante do script: é a única que
 * fala com o mundo externo e é onde mora a regra de "não pode quebrar".
 *
 * Rodar com: npm test
 *
 * O `fetch` é injetado em vez de real, os testes não dependem de rede, então
 * rodam offline e sempre com o mesmo resultado.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultarCep, ErroDeCep } from '../src/viacep.js';

/** Monta uma resposta parecida com a do fetch, para injetar no cliente. */
const resposta = (corpo, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corpo,
});

/** Substitui a espera do backoff, para o teste não gastar segundos de verdade. */
const naoEsperar = async () => {};

test('devolve o endereço quando o ViaCEP responde com sucesso', async () => {
  const fetchFalso = async () =>
    resposta({
      logradouro: 'Rua Boquim',
      bairro: 'Centro',
      localidade: 'Aracaju',
      uf: 'SE',
    });

  const endereco = await consultarCep('49010-390', { fetchImpl: fetchFalso });

  assert.deepEqual(endereco, {
    logradouro: 'Rua Boquim',
    bairro: 'Centro',
    cidade: 'Aracaju',
    uf: 'SE',
  });
});

test('trata CEP inexistente, que o ViaCEP devolve como HTTP 200 com erro:true', async () => {
  // Este é o caso que passa despercebido: o status é 200, então quem confia
  // só no status code grava um endereço vazio no provisionamento.
  let chamadas = 0;
  const fetchFalso = async () => {
    chamadas++;
    return resposta({ erro: true });
  };

  await assert.rejects(
    () => consultarCep('99999-999', { fetchImpl: fetchFalso, dormir: naoEsperar }),
    (erro) => erro instanceof ErroDeCep && /não encontrado/.test(erro.message),
  );

  // CEP inexistente não muda de resposta: tem que falhar de primeira,
  // sem gastar as retentativas.
  assert.equal(chamadas, 1);
});

test('retenta quando a API está fora do ar e desiste com erro tratado', async () => {
  let chamadas = 0;
  const fetchFalso = async () => {
    chamadas++;
    return resposta({}, 500);
  };

  await assert.rejects(
    () =>
      consultarCep('49010-390', {
        fetchImpl: fetchFalso,
        dormir: naoEsperar,
        tentativas: 3,
      }),
    // O erro é tratado, não uma exceção solta de rede: é o que permite ao
    // script registrar a falha e seguir para a próxima unidade.
    (erro) => erro instanceof ErroDeCep && erro.permanente === false,
  );

  assert.equal(chamadas, 3);
});
