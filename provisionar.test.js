/**
 * Testes de `consultarCep`, a função mais importante do script: é a única que
 * fala com o mundo externo e é onde mora a regra de "não pode quebrar".
 *
 * Rodar com: npm test
 *
 * O `fetch` é injetado em vez de real, então os testes rodam offline e sempre
 * com o mesmo resultado.
 */

// test runner nativo do Node, disponível a partir da versão 18. Não precisa de
// Jest nem Vitest, por isso o projeto não tem nenhuma dependência.
import { test } from 'node:test';

// Biblioteca de asserções do próprio Node. A variante "/strict" faz as
// comparações usarem === em vez de ==, evitando que "1" passe por 1.
import assert from 'node:assert/strict';

// Importa a função a ser testada. Isso só é possível porque provisionar.js a
// exporta e só executa main() quando é chamado direto, nunca quando importado.
import { consultarCep } from './provisionar.js';

/**
 * Monta um objeto parecido com a resposta que o fetch devolveria, para injetar
 * na função no lugar da resposta real. Só precisa dos três pedaços que
 * consultarCep usa: ok, status e json().
 */
const resposta = (corpo, status = 200) => ({
  ok: status >= 200 && status < 300, // é o que o fetch de verdade faz
  status,
  json: async () => corpo, // async porque o .json() real também é assíncrono
});

/**
 * Substitui a espera do retry. Sem isso, o teste do backoff levaria 1,5 segundo
 * de relógio à toa. Como não faz nada e resolve na hora, o teste roda instantâneo.
 */
const naoEsperar = async () => {};

test('devolve o endereço quando o ViaCEP responde com sucesso', async () => {
  // fetch falso que sempre responde com um endereço válido.
  const fetchFalso = async () =>
    resposta({ logradouro: 'Rua Boquim', bairro: 'Centro', localidade: 'Aracaju', uf: 'SE' });

  const endereco = await consultarCep('49010-390', { fetchImpl: fetchFalso });

  // deepEqual compara o conteúdo do objeto, não a identidade dele na memória.
  // Repare que localidade e uf não aparecem: a função devolve só o que usa.
  assert.deepEqual(endereco, { logradouro: 'Rua Boquim', bairro: 'Centro' });
});

test('trata CEP inexistente, que o ViaCEP devolve como HTTP 200 com erro:true', async () => {
  // Este é o caso que passa despercebido: o status é 200, então quem confia só
  // no status code grava um endereço vazio no provisionamento.
  let chamadas = 0; // contador para provar que não houve retentativa
  const fetchFalso = async () => {
    chamadas++;
    return resposta({ erro: true });
  };

  // rejects espera que a promise falhe. O segundo argumento é uma expressão
  // regular testada contra a mensagem do erro. Se a função devolvesse
  // normalmente em vez de falhar, o teste quebraria aqui.
  await assert.rejects(
    () => consultarCep('99999-999', { fetchImpl: fetchFalso, dormir: naoEsperar }),
    /não encontrado/,
  );

  // CEP inexistente não muda de resposta: tem que falhar de primeira, sem
  // gastar as retentativas. Sem esta linha, o teste passaria mesmo que a função
  // tentasse três vezes à toa.
  assert.equal(chamadas, 1);
});

test('retenta quando a API está fora do ar e desiste com erro tratado', async () => {
  let chamadas = 0;
  const fetchFalso = async () => {
    chamadas++;
    return resposta({}, 500); // 500 é erro do servidor, ou seja, transitório
  };

  await assert.rejects(
    () => consultarCep('49010-390', { fetchImpl: fetchFalso, dormir: naoEsperar, tentativas: 3 }),
    // Erro tratado, não exceção solta de rede: é o que permite ao script
    // registrar a falha e seguir para a próxima unidade.
    /indisponível após 3 tentativas/,
  );

  // Prova que o backoff rodou as três voltas antes de desistir.
  assert.equal(chamadas, 3);
});
